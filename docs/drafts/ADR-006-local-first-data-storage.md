# ADR-006 - Local-First Data Storage

> **Status:** ACCEPTED - Final repository-aligned decision
> **Date:** 2026-05-11
> **Deciders:** Engineering Team

---

## Context

AX Studio stores conversation threads, messages, model/provider configuration, MCP configuration, downloaded assets, extension bundles, and user settings. The team needed to decide between:

- Cloud-synced storage (requires account, always-on connectivity)
- Local-only storage (no account, fully offline)
- Hybrid (local primary, optional cloud sync)

This decision is tightly coupled to AX Studio's core value proposition around data control and privacy. It also affects release requirements for backup, migration, encryption, and support.

---

## Decision

**Store user workspace data locally by default. No AX Studio cloud account should be required to launch the app, configure providers, use local models, or resume local threads. Remote providers are accessed for inference when the user configures them; conversations are not stored by an AX Studio-hosted backend.**

---

## Rationale

1. **Privacy by design** - Users working with sensitive data (legal, medical, financial, proprietary code) cannot use cloud-synced chat apps. Local-first removes this blocker entirely.
2. **Offline capability** - Local inference + local storage means the app is fully functional without internet, which is a hard requirement for some users.
3. **Data mode selector** - The Guardrails feature lets users explicitly choose Local / Hybrid / Cloud per workspace, making the tradeoff visible and user-controlled rather than hidden.
4. **No AX Studio server lock-in** - User data is not held by AX Studio's servers. Users should be able to locate, back up, and eventually export their data.

---

## Storage Architecture

| Data Type | Current / Expected Storage |
|---|---|
| Conversation threads and messages | Local app data. Current thread module documents per-thread directories and `messages.jsonl`. |
| App settings and config | Local JSON/Tauri store files in the app data directory. |
| MCP server configuration | Local `mcp_config.json` in app data. Manual env values may exist until managed credential storage is implemented. |
| Provider configuration | Local provider configuration managed by native commands; renderer reads must redact secrets. |
| Managed integration credentials | Secure local storage is a requirement/proposal, but should not be claimed as complete until verified in code. |
| Downloaded model files | Local filesystem (user-configurable path) |
| Extension bundles | App data directory |

---

## Consequences

**Positive:**

- No backend infrastructure to maintain for data storage
- Zero data breach surface for conversation content
- Works fully offline with local models
- Simple deployment, with no database server or auth service required
- Fits the product's data-boundary and local-only guardrail messaging

**Negative:**

- No cross-device sync (user must manually export/import)
- No collaborative features (two users cannot share a thread in real-time)
- Backup is the user's responsibility
- Search, analytics, and cross-thread queries need explicit local indexes or service support
- Local data loss becomes a support risk without backup/export/import UX
- Local secrets still require careful redaction and storage hardening even without cloud sync

---

## Alternatives Considered

- **Cloud-synced (e.g., Supabase/Firebase)**: Rejected as primary because it contradicts the privacy value prop; it can be offered as optional future feature
- **SQLite**: A future option for richer local querying and migration support. Some local MCP/runtime setup references SQLite flags, so storage architecture should remain explicit per subsystem rather than assuming one database for all data.
- **Plain JSON files**: Rejected for threads because it does not scale for large conversation histories and concurrent access

---

## Status Notes

Cloud sync is not ruled out long-term but is explicitly deferred. If added, it must be opt-in and the data mode selector must clearly reflect sync state. No design work has been done on this yet.

The current storage layer has no clearly documented export/import UI. For users who switch devices this is a pain point. A future deliverable should address backup and portability.

## Open Items

- Define workspace export/import and backup requirements.
- Define local data deletion requirements.
- Confirm whether local provider/API credentials must be encrypted at rest beyond existing native storage.
- Define migration tests for older app data versions.
- Document exact app data paths and file formats for support/debugging.
