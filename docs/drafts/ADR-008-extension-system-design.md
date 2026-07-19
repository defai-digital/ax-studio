# ADR-008 - TypeScript Extension System Design

> **Status:** ACCEPTED - Final repository-aligned decision
> **Date:** 2026-05-11
> **Deciders:** Engineering Team

---

## Context

AX Studio needs a way to package and ship core AI behaviors as modular units that can be independently developed, tested, and bundled without coupling all behavior tightly to the host app's React render tree or Rust backend.

Current bundled extension packages include:

- `assistant-extension`
- `conversational-extension`
- `download-extension`
- `llamacpp-extension`

---

## Decision

**Implement a TypeScript extension system where bundled JS modules communicate with the host through lifecycle and shared contracts defined in `@ax-studio/core`.**

For the current product, this ADR applies to bundled/trusted extensions. Third-party or remotely loaded extensions require additional signing, sandboxing, permissions, and review decisions before they should be considered supported.

---

## Rationale

1. **Separation of concerns** - Core chat behavior, local inference, and download management are complex enough to warrant their own module boundaries and test suites
2. **Independent build pipeline** - Extensions are compiled with rolldown separately from the main app; changes don't require a full Vite rebuild
3. **Shared contract via `@ax-studio/core`** - The extension API is versioned and published as an npm package, giving extensions a stable interface regardless of internal app changes
4. **Future extensibility** - Third-party extensions could follow the same contract later, after trust and signing requirements are defined

---

## Architecture

```
@ax-studio/core (SDK)
  `- ExtensionLifecycleAPI (register, onMount, onMessage, onToolCall, etc.)

extensions/
  |-- assistant-extension/       Built-in assistant behavior
  |-- conversational-extension/  Multi-turn chat + multi-agent orchestration
  |-- llamacpp-extension/        Local inference subprocess management
  `-- download-extension/        Model/asset download manager

Host App (web-app)
  `- ExtensionLoader -> loads bundled JS -> calls lifecycle hooks
```

Extensions:
- Should avoid direct host coupling outside registered contracts and mount points
- Communicate with Rust backend via the same Tauri IPC layer as the rest of the app
- Are loaded from the app data directory (allowing updates without full app reinstall in future)

## Requirements Implied by This Decision

- `@ax-studio/core` contracts must remain stable and covered by tests.
- Host/extension version compatibility must be explicit.
- Extension load failures must be contained and reported.
- Bundled extension tests must be part of the release test plan.
- Any future third-party extension model must include signing/integrity checks and a permission model.

---

## Consequences

**Positive:**

- Each extension has its own test suite and coverage gate
- Extensions can be swapped or disabled without touching host app code
- llamacpp-extension encapsulates all subprocess lifecycle complexity away from the UI
- Download and conversation behaviors can evolve without turning the web app into one monolithic feature module

**Negative:**

- Extension isolation adds indirection, so debugging requires tracing across the lifecycle API boundary
- The extension settings UI is currently hidden (known issue), so users cannot manage extensions from within the app
- Bundled extensions cannot be hot-reloaded during development without a full rebuild
- Contract drift between `core`, host app, and extensions can break runtime behavior unless covered by build and test lanes
- Third-party extensions would materially expand the security surface

---

## Alternatives Considered

- **Inline feature modules in web-app**: Rejected because it creates tight coupling, is harder to test in isolation, and makes the web-app bundle monolithic
- **Dynamically loaded remote extensions (CDN)**: Rejected for now because the security surface is too large without a proper sandboxing/signing mechanism; deferred to future consideration
- **Rust plugins only (Tauri plugin model)**: Rejected because Rust plugins are appropriate for OS-level capabilities but are too low-level for AI behavior logic that benefits from TypeScript's ecosystem

---

## Open Items

Extension settings visibility must be decided. If users are expected to manage installed extensions, the settings UI should be surfaced before release. If bundled extensions are internal, the UI should not imply third-party extension management.

No extension signing or integrity verification is defined. If third-party extensions are ever allowed, this becomes a security requirement.

The root test configuration currently includes core, web-app, llama.cpp extension, and scripts/testing. Release planning should confirm whether assistant, conversational, and download extension tests are included in a single required test lane.
