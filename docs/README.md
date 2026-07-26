# AX Studio documentation

Canonical public documentation for this repository. Prefer linking here from
`README.md` and contributor guides rather than duplicating content.

## Layout

| Path | Purpose |
| --- | --- |
| [`legal/`](legal/) | Privacy notice and terms of use (user-facing legal) |
| [`release/`](release/) | Shipping: electron-builder release runbook, electron-updater feed |
| [`architecture/`](architecture/) | How the codebase is organized and key subsystems |
| [`images/`](images/) | Diagrams and media used by docs / README |

## Start here

| Audience | Read |
| --- | --- |
| End users / installers | Root [`README.md`](../README.md), then [`release/release.md`](release/release.md) for packaged artifacts |
| Contributors | [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`architecture/conventions.md`](architecture/conventions.md) |
| Release operators | [`release/release.md`](release/release.md) |
| Product / architects | PRDs and ADRs under local **`.internal/prd/`** and **`.internal/adr/`** |
| Legal / store listing | [`legal/privacy.md`](legal/privacy.md), [`legal/terms.md`](legal/terms.md) |

## Product requirements and ADRs

All PRDs live under **`.internal/prd/`**. All ADRs live under **`.internal/adr/`**.
Neither is published in the public `docs/` tree (local design space, gitignored).

## What does *not* belong here

- PRDs (use `.internal/prd/`)
- ADRs (use `.internal/adr/`)
- One-off review dumps, gap analyses, or stability HTML snapshots (use CI
  artifacts or short-lived `.internal/reports/`)
- Unchecked implementation checklists for abandoned plans
- Large unused brand assets
- Package-specific contributor notes (keep those next to the package:
  `web-app/CONTRIBUTING.md`, `core/CONTRIBUTING.md`, etc.)

## Conventions for new docs

1. Put the file in the most specific folder above; do not dump flat into `docs/`.
2. Link from this index when the doc is a stable entry point.
3. Prefer short, current runbooks over historical checklists.
4. Use relative links that stay valid inside `docs/`.
5. If content is speculative, label status clearly (`Draft`, `Accepted`, `Superseded`).
6. New PRDs go to `.internal/prd/`; new ADRs go to `.internal/adr/` — never under `docs/`.

## Repository root (do not reorganize lightly)

The monorepo root intentionally stays flat for Yarn workspaces + Electron:

- **Committed:** `package.json`, `yarn.lock`, `vitest.config.ts`, `Makefile`, `mlx.version`, `README.md`, `LICENSE`, `NOTICE`, package dirs (`core/`, `web-app/`, `electron/`, `extensions/`, `scripts/`, `docs/`).
- **Generated / local (gitignored):** `node_modules/`, `coverage/`, `report/`, `.internal/`.

Moving packages under `apps/` or `packages/` would break CI, Makefile, and Electron resource paths. Prefer documenting over reshaping.
