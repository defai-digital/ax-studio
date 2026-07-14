# ADR-009: Local Engine Backends (In-Process Default, Sidecar Optional)

Status: Accepted  
Date: 2026-07-14  
Related: [ax-engine LOCAL-ENGINE-CLIENTS](https://github.com/defai-digital/ax-engine/blob/main/docs/LOCAL-ENGINE-CLIENTS.md)

## Context

AX Studio runs MLX inference by linking `ax-engine-sdk` into the Tauri host and
routing the `mlx` provider through Tauri IPC (`mlx-ipc-fetch`). AX Code instead
spawns a managed `ax-engine serve` process and uses OpenAI-compatible HTTP.

We evaluated forcing one model on both products. Process isolation, packaging,
and host language differ enough that a single execution backend would be a
regression for at least one product.

## Decision

1. **Default backend for AX Studio is `in_process`** (current behavior).
2. **Canonical cross-product wire format for out-of-process chat remains OpenAI-compatible HTTP `/v1/*`.**
3. Studio code exposes a **`LocalEngineBackend` abstraction** so a future
   `sidecar_http` path can be added without rewriting the chat transport.
4. Studio **does not** introduce Go or gRPC as the primary engine bridge.
5. Lifecycle reporting uses the shared phases from ax-engine
   `docs/LOCAL-ENGINE-CLIENTS.md`:
   `unavailable | missing_dependency | missing_model | starting | ready | degraded | error`.

## Consequences

- Chat latency and lifecycle for desktop MLX stay optimal.
- Shared vocabulary with AX Code improves support and debugging.
- Optional sidecar is an explicit future feature, not a silent rewrite of `mlx`.
- Engine SDK git pins remain deliberate integration changes.

## Implementation notes

- TypeScript surface: `web-app/src/lib/local-engine/`
- Existing IPC façade: `web-app/src/lib/mlx-ipc-fetch.ts` (implementation detail of in-process backend)
- Rust worker remains the authority for load/unload/generate
