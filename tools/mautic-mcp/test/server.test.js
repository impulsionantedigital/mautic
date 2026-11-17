import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';
import { MauticClient } from '../src/mautic-client.js';

const ENV = { MAUTIC_URL: 'https://mautic.test/', MAUTIC_PUBLIC_KEY: 'id', MAUTIC_SECRET_KEY: 'secret' };

/** Fake fetch: routes "METHOD /path" to a handler and records every call. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, query: Object.fromEntries(url.searchParams), body, auth: init.headers?.Authorization });
    if (key === 'POST /oauth/v2/token') {
      return new Response(JSON.stringify({ access_token: `tok${calls.filter((c) => c.key === key).length}`, expires_in: 3600 }), { status: 200 });
    }
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ errors: [{ message: `no route ${key}` }] }), { status: 404 });
    }
    const result = handler({ query: url.searchParams, body, calls });
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 });
  };
  return { impl, calls };
}

async function connect(routes, env = ENV) {
  const fetch = fakeFetch(routes);
  const server = createServer(env, fetch.impl);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, calls: fetch.calls };
}

const callJson = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};

const contact = {
  id: 7,
  points: 3,
  fields: { all: { id: 7, email: 'ana@x.com', firstname: 'Ana', lastname: '', city: null, points: 3 } },
  tags: [{ id: 2, tag: 'cliente' }],
  stage: null,
  owner: null,
  doNotContact: [],
  dateAdded: '2026-11-01T00:00:00+00:00',
};

test('exposes every tool, and only read tools in read-only mode', async () => {
  const { client } = await connect({});
  const all = (await client.listTools()).tools.map((t) => t.name);
  assert.equal(all.length, 17);
  assert.ok(all.includes('send_email_to_contact'));

  const ro = await connect({}, { ...ENV, MAUTIC_MCP_READ_ONLY: 'true' });
  const readOnly = (await ro.client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(readOnly, ['get_campaign', 'get_contact', 'get_contact_activity', 'list_campaigns', 'list_emails', 'list_segments', 'list_tags', 'search_contacts']);
});

test('search_contacts trims contacts and handles id-keyed collections', async () => {
  const { client, calls } = await connect({ 'GET /api/contacts': () => ({ total: '1', contacts: { 7: contact } }) });
  const data = await callJson(client, 'search_contacts', { search: 'tag:cliente' });
  assert.deepEqual(data, {
    total: 1,
    contacts: [{ id: 7, fields: { email: 'ana@x.com', firstname: 'Ana' }, tags: ['cliente'], points: 3, dateAdded: '2026-11-01T00:00:00+00:00' }],
  });
  const call = calls.find((c) => c.key === 'GET /api/contacts');
  assert.equal(call.query.search, 'tag:cliente');
  assert.equal(call.query.limit, '30');
  assert.equal(call.auth, 'Bearer tok1');
});

test('get_contact merges segments and campaign membership', async () => {
  const { client } = await connect({
    'GET /api/contacts/7': () => ({ contact }),
    'GET /api/contacts/7/segments': () => ({ total: 1, lists: { 3: { id: 3, name: 'Clientes', alias: 'clientes' } } }),
    'GET /api/contacts/7/campaigns': () => ({ total: 1, campaigns: { 4: { id: 4, name: 'Nutrição', date_added: '2026-11-02', manually_added: '1', manually_removed: '0' } } }),
  });
  const data = await callJson(client, 'get_contact', { contactId: 7 });
  assert.deepEqual(data.segments, [{ id: 3, name: 'Clientes', alias: 'clientes' }]);
  assert.deepEqual(data.campaigns, [{ id: 4, name: 'Nutrição', dateAdded: '2026-11-02', manuallyAdded: true, manuallyRemoved: false }]);
});

test('modify_contact_tags sends added tags and "-" prefixed removals', async () => {
  const { client, calls } = await connect({
    'PATCH /api/contacts/7/edit': ({ body }) => ({ contact: { ...contact, tags: body.tags.filter((t) => !t.startsWith('-')).map((tag, i) => ({ id: i, tag })) } }),
  });
  const data = await callJson(client, 'modify_contact_tags', { contactId: 7, add: ['ade-cliente'], remove: ['ado-checkout-iniciado'] });
  assert.deepEqual(calls.at(-1).body, { tags: ['ade-cliente', '-ado-checkout-iniciado'] });
  assert.deepEqual(data, { id: 7, tags: ['ade-cliente'] });

  const empty = await client.callTool({ name: 'modify_contact_tags', arguments: { contactId: 7 } });
  assert.equal(empty.isError, true);
});

test('upsert_contact posts fields, email and tags', async () => {
  const { client, calls } = await connect({ 'POST /api/contacts/new': () => ({ contact }) });
  await callJson(client, 'upsert_contact', { email: 'ana@x.com', fields: { firstname: 'Ana' }, tags: ['cliente'] });
  assert.deepEqual(calls.at(-1).body, { firstname: 'Ana', email: 'ana@x.com', tags: ['cliente'] });
});

test('create_tag refuses duplicates without calling the create endpoint', async () => {
  const { client, calls } = await connect({ 'GET /api/tags': () => ({ total: 1, tags: [{ id: 2, tag: 'cliente' }] }) });
  const result = await client.callTool({ name: 'create_tag', arguments: { tag: 'cliente' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /already exists/);
  assert.ok(!calls.some((c) => c.key === 'POST /api/tags/new'));
});

test('segment and campaign membership hit the right endpoints', async () => {
  const { client, calls } = await connect({
    'POST /api/segments/3/contact/7/add': () => ({ success: 1 }),
    'POST /api/campaigns/4/contact/7/remove': () => ({ success: 1 }),
  });
  assert.deepEqual(await callJson(client, 'add_contact_to_segment', { segmentId: 3, contactId: 7 }), { success: true, segmentId: 3, contactId: 7, operation: 'add' });
  assert.deepEqual(await callJson(client, 'remove_contact_from_campaign', { campaignId: 4, contactId: 7 }), { success: true, campaignId: 4, contactId: 7, operation: 'remove' });
  assert.equal(calls.filter((c) => c.key.startsWith('POST /api/')).length, 2);
});

test('get_campaign exposes event settings such as condition tags', async () => {
  const { client } = await connect({
    'GET /api/campaigns/4': () => ({
      campaign: {
        id: 4,
        name: 'Nutrição',
        isPublished: true,
        lists: [{ id: 3, name: 'Clientes' }],
        events: [{ id: 5, name: 'É Cliente ADE?', type: 'lead.tags', eventType: 'condition', triggerMode: 'immediate', properties: { properties: { tags: ['4'] } } }],
      },
    }),
  });
  const data = await callJson(client, 'get_campaign', { campaignId: 4 });
  assert.deepEqual(data.events[0], { id: 5, name: 'É Cliente ADE?', type: 'lead.tags', eventType: 'condition', trigger: 'immediate', properties: { tags: ['4'] } });
});

test('API errors come back as tool errors with the Mautic message', async () => {
  const { client } = await connect({
    'GET /api/contacts/99': () => new Response(JSON.stringify({ errors: [{ message: 'Item was not found.', code: 404 }] }), { status: 404 }),
  });
  const result = await client.callTool({ name: 'get_contact', arguments: { contactId: 99 } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 404: Item was not found\./);
});

test('client caches the token and refreshes it once on 401', async () => {
  let now = 0;
  let rejectNext = false;
  const fetch = fakeFetch({
    'GET /api/tags': () => {
      if (rejectNext) {
        rejectNext = false;
        return new Response('{}', { status: 401 });
      }
      return { tags: [] };
    },
  });
  const client = new MauticClient({ baseUrl: 'https://mautic.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fetch.impl, now: () => now });
  const tokenCalls = () => fetch.calls.filter((c) => c.key === 'POST /oauth/v2/token').length;

  await client.get('/tags');
  await client.get('/tags');
  assert.equal(tokenCalls(), 1);

  now = 3541 * 1000; // past expires_in - 60s
  await client.get('/tags');
  assert.equal(tokenCalls(), 2);

  rejectNext = true;
  await client.get('/tags');
  assert.equal(tokenCalls(), 3);
  assert.equal(fetch.calls.at(-1).auth, 'Bearer tok3');
});

test('client rejects missing credentials', () => {
  assert.throws(() => new MauticClient({ baseUrl: 'https://x', clientId: '', clientSecret: 's' }), /must all be set/);
});
