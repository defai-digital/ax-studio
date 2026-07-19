# MCP Integrations (Option A) — PRD & ADR

> **Feature**: One-click tool integrations via MCP + secure API key storage
> **Approach**: Option A — MCP ecosystem + Tauri secure credential store
> **Branch**: `branch1`
> **Date**: 2026-03-06
> **Status**: Draft

---

# Part 1 — Product Requirements Document (PRD)

## 1. Problem Statement

Ax-Fabric already has a full MCP server runtime. Users can connect any MCP server by
manually editing `mcp_config.json` and pasting API tokens as plain-text `env` values:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxx" }
    }
  }
}
```

This works — but has three critical problems:

1. **Credentials stored in plain text** inside `mcp_config.json` in the app data folder
2. **No UI** — users must know which MCP package to use, what env vars it expects, and how to get a token
3. **No guidance** — there is no curated list of supported integrations; users discover them on their own

Non-developer users cannot use MCP tool integrations at all. Developer users face unnecessary friction and a security risk from plain-text token storage.

---

## 2. Goals & Non-Goals

### Goals
- **G1**: Provide a curated "Integrations" settings page listing popular MCP-backed services with one-click setup
- **G2**: Store all API keys and tokens in the OS keychain (encrypted at rest) via `tauri-plugin-stronghold` — never in plain-text `mcp_config.json`
- **G3**: Auto-inject stored credentials into MCP server process ENV at spawn time, transparently
- **G4**: Allow users to test a connection before saving (verify token is valid)
- **G5**: Show connection status per integration (Connected / Not connected / Error)
- **G6**: Per-agent tool scoping — each agent in a multi-agent team can enable only the integrations it needs
- **G7**: Works fully offline for all integrations (no external auth server required)
- **G8**: Zero new runtime dependencies beyond existing MCP + Tauri stack
- **G9**: Support the top 5 integrations at launch: GitHub, Linear, Notion, Slack, Jira

### Non-Goals
- OAuth2 flows (browser-redirect auth) — Phase 2
- Building our own MCP server packages (use community / official packages)
- Multi-account per service (one token per service in Phase 1)
- Webhook / trigger support
- Replacing the existing manual MCP server configuration (power users keep full control)

---

## 3. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|--------------|------------|
| US-01 | User | See a list of popular integrations in settings | I know what I can connect |
| US-02 | User | Enter my GitHub token once and click Connect | My agents can read/write GitHub without manual JSON editing |
| US-03 | User | See a green "Connected" badge next to GitHub | I know the token is valid and the MCP server is running |
| US-04 | User | Click Disconnect to remove a token | I can revoke access without editing JSON files |
| US-05 | Power user | Assign GitHub to Agent A and Slack to Agent B | Each agent only has the tools it needs |
| US-06 | Developer | Still edit `mcp_config.json` directly for custom servers | Advanced configuration is not blocked |
| US-07 | User | My token is not visible after I save it | My credentials are secure |

---

## 4. Supported Integrations (Phase 1)

| Integration | MCP Package | Token Type | Token Source |
|-------------|-------------|------------|--------------|
| GitHub | `@modelcontextprotocol/server-github` | Personal Access Token | github.com → Settings → Developer Settings → PAT |
| Linear | `@linear/mcp-server` | API Key | linear.app → Settings → API |
| Notion | `@notionhq/notion-mcp-server` | Integration Token | notion.so → Settings → Integrations |
| Slack | `@modelcontextprotocol/server-slack` | Bot Token | api.slack.com → Your Apps → OAuth Tokens |
| Jira | `mcp-server-jira` (community) | API Token + Email + URL | id.atlassian.com → Security → API Tokens |

All packages are open-source and installable via `npx` — no bundling required.

---

## 5. Functional Requirements

### 5.1 Integrations Settings Page

- New route: `/settings/integrations`
- Navigation entry alongside "Models", "Assistants", "MCP Servers"
- Grid of integration cards, one per supported service
- Each card shows:
  - Service icon + name + short description
  - Status badge: `Connected` (green) / `Not connected` (grey) / `Error` (red)
  - **Connect** button → opens credential input modal
  - **Disconnect** button (when connected) → removes token from keychain, deactivates MCP server
- Search/filter bar to find integrations by name

### 5.2 Credential Input Modal

For each integration, a modal collects the required credentials:

```
┌─────────────────────────────────────────┐
│  Connect GitHub                          │
│                                          │
│  Personal Access Token                   │
│  [••••••••••••••••••••••]  [Show]        │
│                                          │
│  Required scopes: repo, read:user        │
│  How to get a token →                    │
│                                          │
│  [Cancel]              [Test] [Connect]  │
└─────────────────────────────────────────┘
```

- Password-masked input field with show/hide toggle
- "How to get a token" link opens the service's token page in system browser
- **Test** button: validates the token by calling a lightweight API check before saving
- **Connect** button: saves token to keychain, activates MCP server, closes modal
- Jira (multi-field): collects API Token + Email + Instance URL

### 5.3 Secure Credential Storage

All tokens stored via `tauri-plugin-stronghold` (AES-256-GCM encrypted vault, unlocked by app-derived key):

```
Stronghold vault
  ├── integrations/github/token    = "ghp_xxxx"
  ├── integrations/linear/token    = "lin_api_xxxx"
  ├── integrations/notion/token    = "secret_xxxx"
  ├── integrations/slack/token     = "xoxb-xxxx"
  └── integrations/jira/token      = "ATATxxxx"
       integrations/jira/email     = "user@example.com"
       integrations/jira/url       = "https://myorg.atlassian.net"
```

`mcp_config.json` stores MCP server command/args but **never stores env var values**:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {},
      "managed": true,
      "integration": "github"
    }
  }
}
```

The `managed: true` + `integration: "github"` flags tell the Rust spawn logic to pull credentials from stronghold at process start.

### 5.4 Credential Injection at MCP Server Spawn

When `start_mcp_server` spawns a managed integration's process, it reads the credentials from stronghold and injects them as env vars before spawning:

```
start_mcp_server(name="github", config)
  → config.integration == "github"
  → stronghold.get("integrations/github/token") → "ghp_xxxx"
  → command.env("GITHUB_PERSONAL_ACCESS_TOKEN", "ghp_xxxx")
  → spawn process
```

The token exists only in the child process's environment — never written to disk.

### 5.5 Connection Status

- `useIntegrations` Zustand store tracks per-integration status: `idle | connecting | connected | error`
- Status is derived at startup by checking stronghold for each integration's key
- Live status checks: after connecting, the MCP server's tools are fetched; success = `connected`, failure = `error`
- Error message shown in the card (e.g., "Invalid token — GitHub returned 401")

### 5.6 Per-Agent Tool Scoping

In the Agent Builder (multi-agent teams), each agent's "Tools" tab shows:

```
MCP Tools
  [x] GitHub — create_issue, list_prs, get_file_contents
  [ ] Linear
  [x] Slack — send_message, list_channels

Custom MCP Servers
  [ ] My Custom Server
```

Only checked integrations are injected into that agent's `ToolLoopAgent` tool set. Unchecked integrations are excluded even if the server is running globally.

### 5.7 Disconnect Flow

1. User clicks Disconnect
2. Confirmation dialog: "Remove GitHub token and disconnect?"
3. Token deleted from stronghold
4. MCP server process killed via `deactivate_mcp_server` Tauri command
5. Status badge updates to "Not connected"
6. Server entry removed from active `mcp_config.json` (or marked `active: false`)

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Security | Tokens encrypted at rest via stronghold; never appear in logs, JSON files, or React state |
| Privacy | All credentials stay on-device; no telemetry or credential sync |
| Offline | App and all integrations work fully offline after initial `npx` package cache |
| Performance | Credential read from stronghold < 5 ms; no added latency to MCP server startup |
| Reliability | If stronghold read fails, MCP server starts without that env var and logs a warning; no crash |
| Compatibility | Existing manually-configured MCP servers in `mcp_config.json` are unaffected |
| Bundle | No new npm/cargo packages beyond `tauri-plugin-stronghold` (already a Tauri ecosystem plugin) |

---

## 7. Success Metrics

| Metric | Target |
|--------|--------|
| Time from opening settings to first agent using GitHub tools | < 2 minutes |
| Credentials visible in mcp_config.json | 0 (never) |
| Integration connection success rate | > 98% (valid token) |
| MCP server startup time with credential injection | < 100 ms overhead |

---

# Part 2 — Architecture Decision Record (ADR)

## ADR-001: Extend Existing MCP Runtime, Don't Add a New Integration Layer

**Status**: Accepted

### Context

Two approaches were considered for tool integrations:
- **Option A** (this doc): Extend existing MCP runtime with secure credential storage + curated UI
- **Option B**: Add Composio SDK as a new integration layer on top of MCP

### Decision

Use Option A. Extend the existing MCP runtime.

### Rationale

| Factor | Option A (MCP + Stronghold) | Option B (Composio) |
|--------|-----------------------------|---------------------|
| New dependencies | 1 (tauri-plugin-stronghold) | 3+ (composio-core, composio-langchain, composio-mcp) |
| Account required | No | Yes (managed cloud) |
| Credentials on-device | Always | Managed cloud: no |
| Builds on existing code | Yes (MCP runtime, useMCPServers) | No (new pipeline) |
| Works offline | Yes | Managed cloud: no |
| OSS + self-hostable | Yes | Yes (but more complex) |
| Implementation complexity | Low | High |

### Consequences

- We own the full credential lifecycle — more responsibility, more control
- Limited to services that have MCP server packages (currently ~50+, growing fast)
- No OAuth2 in Phase 1 — services requiring browser-redirect auth (Gmail, Google Calendar) deferred to Phase 2

---

## ADR-002: Tauri Stronghold for Credential Storage

**Status**: Accepted

### Context

Credentials must not be stored in plain text. Options considered:

| Option | Encrypted | Cross-platform | Tauri native | Complexity |
|--------|-----------|----------------|--------------|------------|
| `tauri-plugin-stronghold` | AES-256-GCM | Yes | Yes | Low |
| OS keychain (`tauri-plugin-keychain`) | OS-native | Partial | Community | Medium |
| Plain text `mcp_config.json` | No | Yes | N/A | None (current) |
| Custom encrypted file | Yes | Yes | No | High |

### Decision

Use `tauri-plugin-stronghold` — Tauri's official encrypted key-value store backed by IOTA Stronghold (a memory-safe, encrypted vault written in Rust).

### Key properties

- Vault encrypted with a key derived from a machine-local secret (never user-facing password)
- Keys stored as paths: `integrations/<service>/<field>`
- Read/write via Tauri commands; never exposed to JS directly
- Vault file stored in Tauri app data dir alongside `mcp_config.json`

### Consequences

- Adds `tauri-plugin-stronghold` to `src-tauri/Cargo.toml` and `src-tauri/capabilities/`
- Vault unlock key must be derived deterministically (e.g., machine UUID + app bundle ID) — no user password prompt
- If vault file is deleted, all integration tokens are lost; user must reconnect

---

## ADR-003: `managed` Flag in mcp_config.json Separates Managed vs Manual Servers

**Status**: Accepted

### Context

Existing manually-configured MCP servers must continue to work unchanged. We need a way to distinguish:
- **Managed integrations**: credentials come from stronghold, injected at spawn
- **Manual servers**: credentials are in `env` in `mcp_config.json` (existing behavior)

### Decision

Add two optional fields to `MCPServerConfig`:

```typescript
type MCPServerConfig = {
  command: string
  args: string[]
  env: Record<string, string>   // existing — used for manual servers only
  active?: boolean
  type?: 'stdio' | 'http' | 'sse'
  url?: string
  // NEW:
  managed?: boolean             // true = credentials come from stronghold
  integration?: string          // e.g. "github", "slack", "linear"
}
```

In `start_mcp_server` (Rust):
```rust
if config.managed == Some(true) {
    let integration = config.integration.as_deref().unwrap_or("");
    if let Ok(token) = stronghold_read(&format!("integrations/{integration}/token")) {
        let env_key = INTEGRATION_ENV_KEYS.get(integration)?;
        command.env(env_key, token);
    }
} else {
    // existing behavior: inject config.envs directly
    for (k, v) in &config.envs {
        command.env(k, v);
    }
}
```

### Consequences

- Zero breaking changes to existing manual server configs
- Clean separation of concerns: managed = stronghold; manual = mcp_config.json
- `INTEGRATION_ENV_KEYS` map maintained in Rust constants (e.g., `github` → `GITHUB_PERSONAL_ACCESS_TOKEN`)

---

## ADR-004: Token Validation Before Save

**Status**: Accepted

### Decision

Each integration defines a lightweight validation function called when the user clicks "Test":

| Integration | Validation call |
|-------------|----------------|
| GitHub | `GET /user` with the token → expect 200 |
| Linear | GraphQL `{ viewer { id } }` → expect data |
| Notion | `GET /v1/users/me` → expect 200 |
| Slack | `auth.test` API → expect `ok: true` |
| Jira | `GET /rest/api/3/myself` → expect 200 |

Validation runs via `reqwest` in a Tauri command (not from the WebView — avoids CORS). Returns `Ok(username)` on success or `Err(message)` on failure. The username/workspace name is shown in the modal as confirmation.

### Consequences

- Token is validated before being written to stronghold — no silent bad credentials
- Requires internet at connect time (acceptable — token setup is a one-time action)
- Validation Tauri command: `validate_integration_token(integration: String, credentials: HashMap<String, String>) -> Result<String, String>`

---

## ADR-005: Integration Registry as a Static Config File

**Status**: Accepted

### Decision

All supported integrations are described in a static TypeScript registry file rather than fetched from a remote source:

```typescript
// web-app/src/lib/integrations-registry.ts
export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Read/write issues, PRs, files, and repositories',
    icon: '/icons/integrations/github.svg',
    category: 'Dev Tools',
    mcpPackage: '@modelcontextprotocol/server-github',
    fields: [
      { key: 'token', label: 'Personal Access Token', type: 'password',
        hint: 'Requires scopes: repo, read:user',
        docsUrl: 'https://github.com/settings/tokens/new' }
    ],
    envMap: { token: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  },
  // ... linear, notion, slack, jira
]
```

No API call to fetch integrations — the list ships with the app. New integrations added via code PRs.

### Consequences

- No network dependency for the integrations page to load
- Adding a new integration = one entry in the registry + test of `npx` package
- Registry is the single source of truth for field definitions, env var names, docs links

---

## 8. Implementation Plan

### Phase 1 — Secure Storage + Credential Injection

| Task | File(s) | Notes |
|------|---------|-------|
| Add `tauri-plugin-stronghold` | `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` | Official Tauri plugin |
| Add `managed` + `integration` fields to `MCPServerConfig` | `web-app/src/hooks/useMCPServers.ts`, `src-tauri/src/core/mcp/models.rs` | Backward compatible |
| Credential injection in `start_mcp_server` | `src-tauri/src/core/mcp/helpers.rs` | Read from stronghold, inject as ENV |
| Tauri commands: `save_integration_token`, `delete_integration_token`, `get_integration_status` | `src-tauri/src/core/integrations/commands.rs` | New module |
| Token validation command: `validate_integration_token` | `src-tauri/src/core/integrations/commands.rs` | reqwest call per integration |
| Integration env key map constant | `src-tauri/src/core/integrations/constants.rs` | `"github" → "GITHUB_PERSONAL_ACCESS_TOKEN"` |

### Phase 2 — Frontend UI

| Task | File(s) | Notes |
|------|---------|-------|
| Integration registry | `web-app/src/lib/integrations-registry.ts` | Static config for 5 integrations |
| `useIntegrations` Zustand store | `web-app/src/hooks/useIntegrations.ts` | Status per integration, connect/disconnect actions |
| Integrations settings page | `web-app/src/routes/settings/integrations.tsx` | Grid of integration cards |
| Integration card component | `web-app/src/components/integrations/IntegrationCard.tsx` | Icon, status badge, connect/disconnect |
| Credential input modal | `web-app/src/components/integrations/ConnectModal.tsx` | Fields, test button, docs link |
| Settings nav entry | `web-app/src/routes/settings/index.tsx` | Add "Integrations" link |
| Integration icons | `web-app/public/icons/integrations/` | GitHub, Linear, Notion, Slack, Jira SVGs |

### Phase 3 — Agent Builder Integration

| Task | File(s) | Notes |
|------|---------|-------|
| Composio tools tab in Agent Builder | `web-app/src/components/agent-builder/IntegrationsTab.tsx` | Per-agent integration scoping |
| Filter MCP tools by agent's enabled integrations | `web-app/src/lib/multi-agent/delegation-tools.ts` | At ToolLoopAgent build time |

---

## 9. File Structure

```
src-tauri/src/core/
  integrations/
    mod.rs              # Module declaration
    commands.rs         # save_integration_token, delete_integration_token,
                        # validate_integration_token, get_integration_status
    constants.rs        # INTEGRATION_ENV_KEYS map, supported integration IDs
  mcp/
    helpers.rs          # MODIFIED: credential injection in start_mcp_server

web-app/src/
  lib/
    integrations-registry.ts    # Static integration definitions
  hooks/
    useIntegrations.ts          # Zustand store: status, connect, disconnect
  routes/settings/
    integrations.tsx            # Settings page
  components/integrations/
    IntegrationCard.tsx         # Card with status badge
    ConnectModal.tsx            # Token input + test + save
    DisconnectConfirm.tsx       # Confirmation dialog
  components/agent-builder/
    IntegrationsTab.tsx         # Per-agent tool scoping

web-app/public/icons/integrations/
  github.svg
  linear.svg
  notion.svg
  slack.svg
  jira.svg
```

---

## 10. Security Model

```
User enters token in ConnectModal (React)
  → token sent via Tauri IPC to Rust command (never stored in JS state)
  → validate_integration_token: reqwest call to service API
  → if valid: stronghold.insert(key, token)
  → token cleared from IPC call memory

At MCP server spawn:
  → start_mcp_server reads token from stronghold (Rust only)
  → token injected as child process ENV var
  → token never returned to JS, never written to disk

At disconnect:
  → stronghold.remove(key)
  → MCP server process killed
  → token gone from all storage locations
```

**Threat model coverage:**

| Threat | Mitigation |
|--------|------------|
| Token stolen from `mcp_config.json` | Tokens never written to that file |
| Token in JS memory / React state | Token only in Rust memory during IPC call |
| Token in app logs | Rust commands must not log token values (enforced in code review) |
| Vault file stolen from disk | Stronghold AES-256-GCM encryption; key derived from machine secret |
| XSS reads token from JS | Token never in JS — only in Rust stronghold |

---

## 11. Risks & Open Questions

| # | Risk / Question | Mitigation |
|---|-----------------|------------|
| R1 | `npx` not available on user's machine | Check for Node.js at startup; show install prompt if missing (same as existing MCP servers) |
| R2 | MCP package not cached — slow first run | Show "Installing..." spinner; `npx` caches after first use |
| R3 | Token validation fails on first attempt due to rate limit | Retry once; show specific error message |
| R4 | Stronghold vault key derivation differs across OS reinstalls | Document: reinstall = re-auth required. Acceptable UX. |
| R5 | Jira self-hosted instances have different API URLs | Accept custom URL in Jira credential modal |
| Q1 | Should we support multiple tokens per service (e.g., two GitHub accounts)? | No — Phase 1 is one token per service |
| Q2 | Should managed integrations appear in the main MCP Servers settings page? | Yes, read-only — to show they're running; editable only from Integrations page |

---

## 12. References

- Tauri Stronghold Plugin: https://github.com/tauri-apps/tauri-plugin-stronghold
- MCP Server GitHub: https://github.com/modelcontextprotocol/servers/tree/main/src/github
- MCP Server Slack: https://github.com/modelcontextprotocol/servers/tree/main/src/slack
- Linear MCP: https://github.com/linear/linear/tree/master/packages/mcp
- Notion MCP: https://github.com/makenotion/notion-mcp-server
- Existing MCP runtime: `src-tauri/src/core/mcp/`
- Existing MCP store: `web-app/src/hooks/useMCPServers.ts`
- Multi-Agent PRD: `docs/PRD-Multi-Agent-Framework.md`
