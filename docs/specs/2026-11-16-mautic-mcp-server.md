# MCP server for the Mautic REST API

Status: **shipped** (2026-11-16) - code in `tools/mautic-mcp/`.

## Problem

Mautic 7 ships no MCP (Model Context Protocol) server, so an AI assistant
can't look up contacts, tag them or move them between segments and
campaigns without someone writing ad-hoc `curl` calls each time.

## Goal

A small local MCP server (stdio) that wraps the Mautic REST API with the
OAuth2 client credentials already used by this fork's `.env`
(`MAUTIC_URL`, `MAUTIC_PUBLIC_KEY`, `MAUTIC_SECRET_KEY`). One process talks
to one Mautic instance; register it once per client instance.

## Non-goals

- No delete operations (contacts, tags, segments, campaigns, emails).
  Removing a tag *from a contact* or a contact *from a segment/campaign* is
  allowed; destroying records is not.
- No campaign/segment/email *authoring*. Building campaigns stays in the
  Mautic UI, where the builder validates the graph.
- No bulk operations. One contact per call keeps mistakes small.
- Not deployed with Mautic: it runs next to the assistant, not in the
  container (`tools/` is in `.dockerignore`).

## Operations

Read (always available):

| Tool | Mautic endpoint |
|---|---|
| `search_contacts` | `GET /api/contacts?search=` |
| `get_contact` | `GET /api/contacts/{id}` + `/segments` + `/campaigns` |
| `get_contact_activity` | `GET /api/contacts/{id}/activity` |
| `list_tags` | `GET /api/tags` |
| `list_segments` | `GET /api/segments` |
| `list_campaigns` | `GET /api/campaigns` |
| `get_campaign` | `GET /api/campaigns/{id}` |
| `list_emails` | `GET /api/emails` |

Write (hidden when `MAUTIC_MCP_READ_ONLY=true`):

| Tool | Mautic endpoint |
|---|---|
| `upsert_contact` | `POST /api/contacts/new` (updates when the email already exists) |
| `update_contact` | `PATCH /api/contacts/{id}/edit` |
| `modify_contact_tags` | `PATCH /api/contacts/{id}/edit` with `tags` / `-tag` |
| `create_tag` | `POST /api/tags/new` |
| `add_contact_to_segment` / `remove_contact_from_segment` | `POST /api/segments/{id}/contact/{cid}/add\|remove` |
| `add_contact_to_campaign` / `remove_contact_from_campaign` | `POST /api/campaigns/{id}/contact/{cid}/add\|remove` |
| `send_email_to_contact` | `POST /api/emails/{id}/contact/{cid}/send` |

## Decisions

- **Plain JavaScript (ESM), no build step.** Node is already a dependency of
  this repo; one `npm install` and it runs.
- **Token cache.** The client fetches a `client_credentials` token, reuses
  it until 60 s before expiry, and retries a request once on HTTP 401.
- **Read-only switch** instead of per-tool permissions: simplest safe mode
  for exploring a production instance.
- **Responses trimmed.** Contact payloads are reduced to id, core fields,
  tags, points, stage and dates; the raw Mautic contact JSON is several KB
  of mostly-empty fields and wastes the assistant's context.
- Manual campaign membership (`add_contact_to_campaign`) bypasses segment
  sync: such contacts are *not* removed when they leave the segment. The
  tool description says so.
