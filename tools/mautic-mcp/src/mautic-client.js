// Thin Mautic REST API client using OAuth2 client credentials.

export class MauticApiError extends Error {
  constructor(status, method, path, body) {
    const detail = extractErrorMessage(body);
    super(`Mautic API ${method} ${path} failed with HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'MauticApiError';
    this.status = status;
    this.body = body;
  }
}

function extractErrorMessage(body) {
  if (!body || typeof body !== 'object') {
    return typeof body === 'string' ? body.slice(0, 300) : '';
  }
  const errors = body.errors ?? body.error;
  if (Array.isArray(errors)) {
    return errors.map((e) => e.message ?? JSON.stringify(e)).join('; ');
  }
  if (errors && typeof errors === 'object') {
    return errors.message ?? JSON.stringify(errors);
  }
  return typeof errors === 'string' ? errors : '';
}

export class MauticClient {
  /**
   * @param {{baseUrl: string, clientId: string, clientSecret: string, fetchImpl?: typeof fetch, now?: () => number}} options
   */
  constructor({ baseUrl, clientId, clientSecret, fetchImpl = globalThis.fetch, now = Date.now }) {
    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error('MAUTIC_URL, MAUTIC_PUBLIC_KEY and MAUTIC_SECRET_KEY must all be set.');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getToken(forceRefresh = false) {
    if (!forceRefresh && this.token && this.now() < this.tokenExpiresAt) {
      return this.token;
    }
    const response = await this.fetch(`${this.baseUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const body = await parseBody(response);
    if (!response.ok || !body?.access_token) {
      throw new MauticApiError(response.status, 'POST', '/oauth/v2/token', body);
    }
    this.token = body.access_token;
    // Refresh one minute early so a token never expires mid-request.
    this.tokenExpiresAt = this.now() + Math.max(0, (Number(body.expires_in) || 3600) - 60) * 1000;
    return this.token;
  }

  /**
   * @param {string} method
   * @param {string} path  Path below /api, e.g. "/contacts/1".
   * @param {{query?: Record<string, unknown>, body?: unknown}} [options]
   */
  async request(method, path, { query, body } = {}) {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const send = async (token) =>
      this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

    let response = await send(await this.getToken());
    if (response.status === 401) {
      response = await send(await this.getToken(true));
    }
    const parsed = await parseBody(response);
    if (!response.ok) {
      throw new MauticApiError(response.status, method, path, parsed);
    }
    return parsed;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body) {
    return this.request('POST', path, { body });
  }

  patch(path, body) {
    return this.request('PATCH', path, { body });
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
