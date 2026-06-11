# Refactoring Phase 2 Inventory

Status: Final for Phase 2
Date: 2026-05-11
Branch: slim/remove-dead-features-clean

## Objective

Phase 2 inventories duplication, dead-code candidates, and refactor risks before
changing production behavior. The goal is to keep future cleanup small,
test-driven, and reversible.

## Commands Run

- `rg -n "TODO|FIXME|dead|deprecated|legacy|unused|duplicate|duplicated|console\\.log|debugger" web-app/src core/src extensions src-tauri`
- `yarn dlx ts-prune --project web-app/tsconfig.json`
- `yarn dlx ts-prune --project core/tsconfig.json`
- `yarn dlx knip --production --reporter compact`

## High-Confidence Refactor Targets

1. Attachment duplicate filtering

   Evidence:
   - `web-app/src/hooks/chat/use-image-attachment-handler.ts`
   - `web-app/src/hooks/chat/use-document-attachment-handler.ts`
   - `web-app/src/containers/ProjectFiles.tsx`

   The same pattern appears in three places:
   - Build a set of existing attachment identity values.
   - Split incoming attachments into `new` and `duplicates`.
   - Show a duplicate warning.

   Recommended Phase 3 action:
   - Add a small shared helper for partitioning duplicate attachments.
   - Cover the helper with unit tests.
   - Keep caller-specific toast copy in each UI/hook to avoid over-generalizing.

2. Thread/project store behavior

   Evidence:
   - `web-app/src/hooks/threads/useThreadManagement.ts`
   - `web-app/src/hooks/threads/useThreads.ts`

   Phase 1 added tests for project thread deletion, metadata propagation, and
   active-thread cleanup. These are good guardrails for later store cleanup, but
   the store should not be split or abstracted until there is a concrete behavior
   change or a repeated pattern to remove.

## Medium-Confidence Cleanup Candidates

1. Web app unused exports reported by Knip

   Examples:
   - UI component subparts in `web-app/src/components/ui/*`
   - schema exports in `web-app/src/schemas/*`
   - route/service class exports in `web-app/src/services/*`

   Risk:
   Many of these are public UI-kit exports, generated route surfaces, or
   test-only/type-only APIs. Removing them without call-site verification could
   create regressions for extension code, tests, or future UI composition.

   Recommendation:
   Treat each as a targeted cleanup item only after `rg` confirms no dynamic,
   barrel, test, or external usage.

2. Core package unused exports reported by `ts-prune`

   Evidence:
   `core/src/browser/index.ts`, `core/src/types/*`, and extension engine types
   are heavily reported.

   Risk:
   `core` is a public API package for extensions. Static unused-export tools do
   not understand external package consumers.

   Recommendation:
   Do not remove core exports during this refactor unless there is an explicit
   deprecation/removal requirement.

## Low-Confidence / Do Not Remove Yet

1. Legacy compatibility code

   Evidence:
   - `src-tauri/src/core/filesystem/akidb.rs`
   - `web-app/src/lib/service.ts`
   - `web-app/src/services/mcp/tauri.ts`
   - `core/src/types/model/modelEntity.ts`
   - `core/src/types/message/messageEntity.ts`

   These paths appear intentional: migration support, backward-compatible
   payload handling, and deprecated fields kept for existing persisted data.

   Recommendation:
   Keep them until the product has an explicit migration/removal policy.

2. Extension and plugin build outputs

   Evidence:
   Knip reports extension entrypoints, Rollup/Rolldown configs, generated plugin
   `dist-js` files, and guest-js files as unused.

   Risk:
   These are build/publish artifacts, not app import graph nodes.

   Recommendation:
   Do not delete them in this cleanup track. Review package publishing rules
   separately if artifact policy changes.

## Recommended Next Phase

Phase 3 should start with the attachment duplicate-filter helper because it is:

- Small and isolated.
- Repeated in real production paths.
- Easy to protect with unit tests.
- Unlikely to affect architecture or public APIs.

Suggested Phase 3 scope:

1. Add `web-app/src/lib/attachments/dedupe.ts`.
2. Add focused unit tests for identity-by-name and identity-by-path behavior.
3. Replace duplicate partitioning in image attachments, document attachments,
   and project files.
4. Run `yarn lint`, targeted tests, `yarn test`, and module gate.
