# Mautic MCP server

Local MCP (Model Context Protocol) server that lets an AI assistant such as
Claude Code read and update a Mautic instance through its REST API. Design
and scope: `docs/specs/2026-11-16-mautic-mcp-server.md`.

## Setup

1. In Mautic, go to **Settings > API Credentials**, create an **OAuth 2**
   credential and copy its public and secret keys. API access must be
   enabled under **Configuration > API Settings**.
2. Put the credentials in a dotenv file **that git ignores** (for example
   `.env.local` at the repo root; never the tracked `.env`):

   ```dotenv
   MAUTIC_URL=https://mkt.example.com
   MAUTIC_PUBLIC_KEY=1_xxxxxxxx
   MAUTIC_SECRET_KEY=xxxxxxxx
   ```

3. Install and test:

   ```bash
   cd tools/mautic-mcp
   npm install
   npm test
   ```

4. Register it with Claude Code (local scope keeps the path out of git):

   ```bash
   claude mcp add --scope local mautic \
     -e MAUTIC_ENV_FILE="$PWD/../../.env.local" \
     -- node "$PWD/src/index.js"
   ```

   For a second Mautic instance, register again with another name and
   another env file, e.g. `mautic-clienteX`.

## Environment variables

| Variable | Purpose |
|---|---|
| `MAUTIC_URL` | Base URL of the instance, no trailing `/api`. |
| `MAUTIC_PUBLIC_KEY` / `MAUTIC_SECRET_KEY` | OAuth2 client credentials. |
| `MAUTIC_ENV_FILE` | Optional path to a dotenv file holding the three above. |
| `MAUTIC_MCP_READ_ONLY` | `true` hides every write tool. Use it to explore production safely. |

## Tools

Read: `search_contacts`, `get_contact`, `get_contact_activity`, `list_tags`,
`list_segments`, `list_campaigns`, `get_campaign`, `list_emails`.

Write: `upsert_contact`, `update_contact`, `modify_contact_tags`,
`create_tag`, `add_contact_to_segment`, `remove_contact_from_segment`,
`add_contact_to_campaign`, `remove_contact_from_campaign`,
`send_email_to_contact`.

There are no delete tools on purpose. `search_contacts` accepts Mautic's
search syntax, e.g. `email:ana@x.com`, `tag:cliente`, `segment:alias`.
