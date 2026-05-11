# ADR-004 - Desktop Framework: Tauri + React

> **Status:** ACCEPTED - Final repository-aligned decision
> **Date:** 2026-05-11
> **Deciders:** Engineering Team

---

## Context

AX Studio requires a cross-platform native desktop application for macOS, Windows, and Linux that can:

- Access the local file system and spawn subprocesses (llama.cpp, MCP servers)
- Deliver a rich, interactive UI for AI chat and artifact rendering
- Bundle and distribute without requiring a runtime installation
- Stay lightweight compared to Electron-based alternatives
- Expose native IPC commands for downloads, updates, MCP, local API, filesystem, provider configuration, and local inference workflows
- Preserve a web-development path for fast UI iteration without making browser mode the production runtime

The team needed to choose between Electron, Tauri, Flutter, and native-per-platform approaches.

---

## Decision

**Use Tauri 2 with a Rust backend and React 19/TypeScript frontend as the application framework.**

The web app remains useful for frontend development and tests, but the product deliverable is the native Tauri desktop app.

---

## Rationale

| Criteria | Tauri + React | Electron | Flutter |
|---|---|---|---|
| Bundle size | Small (Rust, no Node bundled) | Large (Node + Chromium) | Medium |
| Memory footprint | Low | High | Medium |
| Native OS access | Full (Rust stdlib + plugins) | Full (Node) | Partial |
| UI flexibility | High (web stack) | High (web stack) | Medium |
| Ecosystem (AI/TS libs) | Full access via web layer | Full access | Limited |
| Security sandboxing | Capability-based (Tauri 2) | Manual | Managed |
| Team expertise | React/TS + Rust | React/TS | Dart |

**Tauri 2** was chosen because:

1. React frontend gives access to the full web/AI SDK ecosystem (Vercel AI SDK, TanStack, etc.)
2. Rust backend provides safe, performant subprocess management (llama.cpp, MCP stdio servers)
3. Tauri's capability-based permission system enforces least-privilege for file/network access
4. Significantly smaller app bundle vs. Electron
5. The team had existing React and Rust competency

## Requirements Implied by This Decision

- All native behavior must be validated through Tauri, not only Vite/browser mode.
- IPC commands must validate renderer input and return structured errors.
- Capability files must be updated whenever new frontend-accessible native commands are added.
- Release testing must include platform-specific packaging and smoke testing, not only JavaScript unit tests.
- Windows release planning must account for WebView2/runtime requirements.
- macOS release planning must account for signing/notarization if distributed outside local developer builds.

---

## Consequences

**Positive:**

- Small binary, fast startup
- Strong security boundary between frontend and backend via IPC
- Rust's memory safety eliminates a class of backend bugs
- Tauri's plugin system allows clean extension of native capabilities
- Native backend can keep provider secrets, filesystem writes, downloads, and subprocess control outside normal React component code

**Negative:**

- Two languages (TypeScript + Rust) increase onboarding friction
- IPC boundary means all frontend-backend communication is async and serialized
- Tauri 2 is newer, so some plugins and ecosystem tooling are less mature than Electron's
- Hot reload for Rust requires full recompile (slower iteration on backend changes)
- Browser mode can hide native integration defects; contributors must test native flows in the desktop shell when touching Tauri-backed features

---

## Alternatives Considered

- **Electron**: Rejected due to bundle size, memory overhead, and weaker security model
- **Flutter**: Rejected due to limited TypeScript/AI SDK ecosystem compatibility
- **Native per platform (Swift/WinUI)**: Rejected due to tripled development cost and no code sharing

---

## Status Notes

Mobile targets and commands appear in parts of the codebase, but mobile is not defined as a product deliverable in the current repository docs. This decision should be revisited if iOS or Android becomes a formal release target.

## Open Items

- Confirm which desktop platforms are mandatory for the next release.
- Confirm whether signed/notarized installers and auto-update artifacts are required.
- Keep README, package scripts, CI, and release docs aligned on the exact Tauri version and platform support story.
