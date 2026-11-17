// MCP tool definitions for the Mautic REST API.
import { z } from 'zod';

const id = (what) => z.number().int().positive().describe(`${what} ID`);
const limit = z.number().int().min(1).max(200).default(30).describe('Max records to return (1-200).');
const start = z.number().int().min(0).default(0).describe('Offset for pagination.');
const search = z
  .string()
  .optional()
  .describe('Mautic search expression, e.g. "joao", "email:joao@x.com", "tag:cliente", "segment:alias".');

/** Mautic returns collections either as an object keyed by id or as an array. */
export function asList(collection) {
  if (!collection) {
    return [];
  }
  return Array.isArray(collection) ? collection : Object.values(collection);
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)),
  );
}

export function summarizeContact(contact) {
  const fields = compact({ ...(contact.fields?.all ?? {}) });
  delete fields.id;
  delete fields.points;
  delete fields.last_active;
  return compact({
    id: contact.id,
    fields,
    tags: asList(contact.tags).map((t) => t.tag),
    points: contact.points,
    stage: contact.stage?.name,
    owner: contact.owner ? compact({ id: contact.owner.id, name: [contact.owner.firstName, contact.owner.lastName].filter(Boolean).join(' ') }) : undefined,
    doNotContact: asList(contact.doNotContact).map((d) => compact({ channel: d.channel, reason: d.reason, comments: d.comments })),
    dateAdded: contact.dateAdded,
    dateModified: contact.dateModified,
    dateIdentified: contact.dateIdentified,
    lastActive: contact.lastActive,
  });
}

function summarizeEvent(event) {
  return compact({
    id: event.id,
    name: event.name,
    type: event.type,
    eventType: event.eventType,
    parentId: event.parent?.id,
    decisionPath: event.decisionPath,
    trigger: event.triggerMode === 'interval' ? `${event.triggerInterval} ${event.triggerIntervalUnit}` : event.triggerMode,
    properties: event.properties?.properties ?? undefined,
  });
}

const toBool = (v) => (v === undefined || v === null ? undefined : Boolean(Number(v)));

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

/**
 * @param {import('./mautic-client.js').MauticClient} client
 * @returns {Array<{name: string, write: boolean, config: object, handler: (args: any) => Promise<any>}>}
 */
export function buildTools(client) {
  return [
    // ---------------------------------------------------------------- read
    {
      name: 'search_contacts',
      write: false,
      config: {
        title: 'Search contacts',
        description: 'Search Mautic contacts. Returns a trimmed summary (fields, tags, points, stage) and the total match count.',
        inputSchema: { search, limit, start },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ search: s, limit: l, start: st }) => {
        const data = await client.get('/contacts', { search: s, limit: l, start: st, orderBy: 'last_active', orderByDir: 'DESC' });
        return json({ total: Number(data?.total ?? 0), contacts: asList(data?.contacts).map(summarizeContact) });
      },
    },
    {
      name: 'get_contact',
      write: false,
      config: {
        title: 'Get contact',
        description: 'Get one contact with its fields, tags, segments and campaign memberships.',
        inputSchema: { contactId: id('Contact') },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ contactId }) => {
        const [contact, segments, campaigns] = await Promise.all([
          client.get(`/contacts/${contactId}`),
          client.get(`/contacts/${contactId}/segments`),
          client.get(`/contacts/${contactId}/campaigns`),
        ]);
        return json({
          ...summarizeContact(contact.contact),
          segments: asList(segments?.lists).map((s) => ({ id: s.id, name: s.name, alias: s.alias })),
          campaigns: asList(campaigns?.campaigns).map((c) =>
            compact({ id: c.id, name: c.name, dateAdded: c.date_added ?? c.dateAdded, manuallyAdded: toBool(c.manually_added), manuallyRemoved: toBool(c.manually_removed) }),
          ),
        });
      },
    },
    {
      name: 'get_contact_activity',
      write: false,
      config: {
        title: 'Get contact activity',
        description: 'Timeline of a contact: email sends/opens/clicks, page hits, form submits, campaign events, tag and point changes.',
        inputSchema: { contactId: id('Contact'), limit },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ contactId, limit: l }) => {
        const data = await client.get(`/contacts/${contactId}/activity`, { limit: l });
        return json({
          total: data?.total,
          events: asList(data?.events).map((e) => compact({ timestamp: e.timestamp, event: e.event, label: typeof e.eventLabel === 'object' ? e.eventLabel?.label : e.eventLabel, type: e.eventType })),
        });
      },
    },
    {
      name: 'list_tags',
      write: false,
      config: {
        title: 'List tags',
        description: 'List all tags that exist in Mautic.',
        inputSchema: { search },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ search: s }) => {
        const data = await client.get('/tags', { search: s, limit: 1000, orderBy: 'tag' });
        return json(asList(data?.tags).map((t) => compact({ id: t.id, tag: t.tag, description: t.description })));
      },
    },
    {
      name: 'list_segments',
      write: false,
      config: {
        title: 'List segments',
        description: 'List segments with their alias and whether they are dynamic (have filters).',
        inputSchema: { search },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ search: s }) => {
        const data = await client.get('/segments', { search: s, limit: 500 });
        return json(
          asList(data?.lists).map((l) => compact({ id: l.id, name: l.name, alias: l.alias, published: l.isPublished, dynamic: asList(l.filters).length > 0, description: l.description })),
        );
      },
    },
    {
      name: 'list_campaigns',
      write: false,
      config: {
        title: 'List campaigns',
        description: 'List campaigns with publish state, source segments and event count.',
        inputSchema: { search },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ search: s }) => {
        const data = await client.get('/campaigns', { search: s, limit: 500 });
        return json(
          asList(data?.campaigns).map((c) =>
            compact({ id: c.id, name: c.name, published: c.isPublished, segments: asList(c.lists).map((l) => l.name), events: asList(c.events).length, allowRestart: c.allowRestart }),
          ),
        );
      },
    },
    {
      name: 'get_campaign',
      write: false,
      config: {
        title: 'Get campaign',
        description: 'Get a campaign with its source segments, forms and every event (actions, decisions, conditions) and their settings.',
        inputSchema: { campaignId: id('Campaign') },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ campaignId }) => {
        const { campaign: c } = await client.get(`/campaigns/${campaignId}`);
        return json(
          compact({
            id: c.id,
            name: c.name,
            description: c.description,
            published: c.isPublished,
            allowRestart: c.allowRestart,
            segments: asList(c.lists).map((l) => ({ id: l.id, name: l.name })),
            forms: asList(c.forms).map((f) => ({ id: f.id, name: f.name })),
            events: asList(c.events).map(summarizeEvent),
          }),
        );
      },
    },
    {
      name: 'list_emails',
      write: false,
      config: {
        title: 'List emails',
        description: 'List emails with subject, type (template or segment) and sent/read counts.',
        inputSchema: { search },
        annotations: { readOnlyHint: true },
      },
      handler: async ({ search: s }) => {
        const data = await client.get('/emails', { search: s, limit: 500, minimal: 1 });
        return json(
          asList(data?.emails).map((e) =>
            compact({ id: e.id, name: e.name, subject: e.subject, type: e.emailType, published: e.isPublished, sentCount: e.sentCount, readCount: e.readCount }),
          ),
        );
      },
    },

    // --------------------------------------------------------------- write
    {
      name: 'upsert_contact',
      write: true,
      config: {
        title: 'Create or update contact',
        description:
          'Create a contact, or update it when a contact with the same email already exists. Tags in "tags" are added (existing tags are kept). New tag names are created automatically.',
        inputSchema: {
          email: z.string().email(),
          fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Field alias -> value, e.g. {"firstname": "Ana", "phone": "+55..."}'),
          tags: z.array(z.string().min(1)).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      handler: async ({ email, fields = {}, tags }) => {
        const body = { ...fields, email, ...(tags?.length ? { tags } : {}) };
        const data = await client.post('/contacts/new', body);
        return json(summarizeContact(data.contact));
      },
    },
    {
      name: 'update_contact',
      write: true,
      config: {
        title: 'Update contact fields',
        description: 'Update fields of an existing contact. Only the given fields change.',
        inputSchema: {
          contactId: id('Contact'),
          fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).describe('Field alias -> new value.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      handler: async ({ contactId, fields }) => {
        const data = await client.patch(`/contacts/${contactId}/edit`, fields);
        return json(summarizeContact(data.contact));
      },
    },
    {
      name: 'modify_contact_tags',
      write: true,
      config: {
        title: 'Add or remove contact tags',
        description: 'Add and/or remove tags on one contact. Unknown tag names in "add" are created. Tags not mentioned are kept.',
        inputSchema: {
          contactId: id('Contact'),
          add: z.array(z.string().min(1)).default([]),
          remove: z.array(z.string().min(1)).default([]),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      handler: async ({ contactId, add, remove }) => {
        if (!add.length && !remove.length) {
          throw new Error('Provide at least one tag in "add" or "remove".');
        }
        const tags = [...add, ...remove.map((t) => `-${t}`)];
        const data = await client.patch(`/contacts/${contactId}/edit`, { tags });
        return json({ id: data.contact.id, tags: asList(data.contact.tags).map((t) => t.tag) });
      },
    },
    {
      name: 'create_tag',
      write: true,
      config: {
        title: 'Create tag',
        description: 'Create a tag. Fails if a tag with this exact name already exists.',
        inputSchema: { tag: z.string().min(1), description: z.string().optional() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      handler: async ({ tag, description }) => {
        const existing = await client.get('/tags', { search: tag, limit: 1000 });
        if (asList(existing?.tags).some((t) => t.tag === tag)) {
          throw new Error(`Tag "${tag}" already exists.`);
        }
        const data = await client.post('/tags/new', compact({ tag, description }));
        return json({ id: data.tag.id, tag: data.tag.tag });
      },
    },
    ...['add', 'remove'].map((op) => ({
      name: `${op}_contact_${op === 'add' ? 'to' : 'from'}_segment`,
      write: true,
      config: {
        title: `${op === 'add' ? 'Add contact to' : 'Remove contact from'} segment`,
        description:
          op === 'add'
            ? 'Add a contact to a segment manually. A manually added contact stays even if it stops matching dynamic filters.'
            : 'Remove a contact from a segment. The contact is not re-added by dynamic filters afterwards.',
        inputSchema: { segmentId: id('Segment'), contactId: id('Contact') },
        annotations: { readOnlyHint: false, destructiveHint: op === 'remove', idempotentHint: true },
      },
      handler: async ({ segmentId, contactId }) => {
        const data = await client.post(`/segments/${segmentId}/contact/${contactId}/${op}`);
        return json({ success: Boolean(data?.success), segmentId, contactId, operation: op });
      },
    })),
    ...['add', 'remove'].map((op) => ({
      name: `${op}_contact_${op === 'add' ? 'to' : 'from'}_campaign`,
      write: true,
      config: {
        title: `${op === 'add' ? 'Add contact to' : 'Remove contact from'} campaign`,
        description:
          op === 'add'
            ? 'Add a contact to a campaign manually. Manually added contacts are NOT removed when they leave the campaign source segment.'
            : 'Remove a contact from a campaign. Pending scheduled events for the contact will not run.',
        inputSchema: { campaignId: id('Campaign'), contactId: id('Contact') },
        annotations: { readOnlyHint: false, destructiveHint: op === 'remove', idempotentHint: true },
      },
      handler: async ({ campaignId, contactId }) => {
        const data = await client.post(`/campaigns/${campaignId}/contact/${contactId}/${op}`);
        return json({ success: Boolean(data?.success), campaignId, contactId, operation: op });
      },
    })),
    {
      name: 'send_email_to_contact',
      write: true,
      config: {
        title: 'Send email to contact',
        description:
          'Send a template email to one contact right now. This delivers a real email; confirm with the user before calling. Respects Do Not Contact.',
        inputSchema: {
          emailId: id('Email'),
          contactId: id('Contact'),
          tokens: z.record(z.string(), z.string()).optional().describe('Extra {token} values, e.g. {"{coupon}": "ABC10"}'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      handler: async ({ emailId, contactId, tokens }) => {
        const data = await client.post(`/emails/${emailId}/contact/${contactId}/send`, tokens ? { tokens } : {});
        return json({ success: Boolean(data?.success), emailId, contactId });
      },
    },
  ];
}
