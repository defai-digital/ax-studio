# Artifacts Engine — Status Summary

> **Branch**: `branch1`
> **Last updated**: 2026-03-03
> **Full reference**: [ARTIFACTS_ENGINE_IMPLEMENTATION.md](./ARTIFACTS_ENGINE_IMPLEMENTATION.md)

---

## Implementation Status

| What | Status |
|---|---|
| `artifact-html` / `artifact-react` / `artifact-svg` fence detection | ✅ Done |
| `artifact-chartjs` (Chart.js v4) fence detection + renderer | ✅ Done |
| `artifact-vega` (Vega-Lite v5) fence detection + renderer | ✅ Done |
| Inline Code/Preview tabs with copy + pin-to-panel button | ✅ Done |
| Sandboxed `<iframe srcdoc>` renderer with postMessage error overlay | ✅ Done |
| React 18 + Babel Standalone from local `public/vendor/` | ✅ Done |
| Chart.js 4 UMD from local `public/vendor/chart.umd.min.js` | ✅ Done |
| Vega 5 + Vega-Lite 5 + Vega-Embed 6 from local `public/vendor/` | ✅ Done |
| ES module syntax stripping (`preprocessReactSource`) | ✅ Done |
| Per-thread artifact panel (2-col layout) | ✅ Done |
| System prompt `ARTIFACT_FORMAT_INSTRUCTION` injected on every chat | ✅ Done |
| `max_output_tokens` raised 1200→4096 to prevent truncation | ✅ Done |
| **Source tab** — editable textarea with Apply / Reset in panel | ✅ Done |
| **History tab** — per-thread version list with Restore in panel | ✅ Done |
| All 4 bugs fixed (panel no-op, CDN blocked, ES imports, truncation) | ✅ Done |
| `docs/ARTIFACTS_ENGINE_IMPLEMENTATION.md` reference doc | ✅ Done |

---

## Bugs Fixed

| # | Symptom | Root Cause | Fix |
|---|---|---|---|
| 1 | Clicking "Panel" did nothing | `MessageItem` had no `threadId` prop → `pinArtifact()` guard always blocked | Added `threadId?: string` to `MessageItemProps`; passed through to `RenderMarkdown` and all `<MessageItem>` call sites |
| 2 | React artifacts showed script error (blank) | Tauri WebView2 on Windows doesn't propagate `script-src` CSP into null-origin srcdoc iframes — CDN scripts were blocked | Downloaded React 18, ReactDOM 18, Babel Standalone to `public/vendor/`; harness loads from `window.location.origin/vendor/...` |
| 3 | React artifacts broke with ES module syntax | Models emit `import`/`export default`; Babel's CommonJS transform needs `exports` object which doesn't exist in browser non-module context | Added `preprocessReactSource()` — strips all `import` statements, converts `export default function App` → `function App` |
| 4 | Model output truncated mid-artifact | `max_output_tokens` default was 1200 — too low for a complete React component | Raised base to 4096; 6144 for long prompts/attachments; 8192 for reasoning models |

---

## Pending (Future)

| Item | Notes |
|---|---|
| CodeMirror / Monaco in Source tab | Currently a plain `<textarea>`; a proper editor would add syntax highlighting + auto-indent |
| Artifact export as `.html` via Tauri FS API | Save dialog |
| Per-thread artifact enable/disable toggle | Currently always-on |
| Full-document artifact view (new window) | Dedicated Tauri WebviewWindow |

---

## Key Files

| File | Role |
|---|---|
| `web-app/src/lib/artifact-harness.ts` | srcdoc builders for html / svg / react / chartjs / vega |
| `web-app/src/hooks/useArtifactPanel.ts` | Zustand store — `pinnedByThread`, `historyByThread`, `updateSource`, `restoreVersion` |
| `web-app/src/components/ai-elements/ArtifactBlock.tsx` | Inline Code/Preview tabs + toolbar |
| `web-app/src/components/ai-elements/ArtifactPreview.tsx` | Sandboxed iframe with postMessage error handling |
| `web-app/src/components/ai-elements/ArtifactPanel.tsx` | Right-pane panel with Preview / Source / History tabs |
| `web-app/src/containers/RenderMarkdown.tsx` | Artifact fence detection via HAST node inspection |
| `web-app/src/lib/system-prompt.ts` | `ARTIFACT_FORMAT_INSTRUCTION` + `max_output_tokens` tuning |
| `web-app/src/routes/threads/$threadId.tsx` | 2-col grid layout when artifact pinned |
| `web-app/public/vendor/` | React 18, ReactDOM 18, Babel 7, Chart.js 4, Vega 5, Vega-Lite 5, Vega-Embed 6 (~4 MB total) |
| `src-tauri/tauri.conf.json` | CSP: `frame-src 'self' blob: data:` |
