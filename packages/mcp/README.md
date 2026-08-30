# @ems/mcp

MCP server for [ems](https://electronicmailservices.com) — lets AI agents **send** and
**verify** email through ems via tools.

## Tools
- `send_email` — send a transactional email (`from`, `to`, `subject`, `html`/`text`, …)
- `verify_emails` — validate a list before sending (deliverable / risky / undeliverable)
- `get_email` — look up a sent email's status + events

## Run

```bash
EMS_API_KEY=um_live_xxx npx @ems/mcp
```

## Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "ems": {
      "command": "npx",
      "args": ["-y", "@ems/mcp"],
      "env": { "EMS_API_KEY": "um_live_xxx" }
    }
  }
}
```

Then ask your agent: *"verify these 50 addresses and send the deliverable ones a
welcome email."*

`EMS_BASE_URL` overrides the API base (defaults to `https://api.electronicmailservices.com`).

Hosted inboxes (read/reply/forward) live in the dashboard, not these tools. To
react to mail arriving at `you@yourdomain.com`, subscribe a webhook to
`email.inbound` — see the [developer docs](https://electronicmailservices.com/docs/dev#inbound).
