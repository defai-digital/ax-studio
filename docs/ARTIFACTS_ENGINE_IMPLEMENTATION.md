# Artifacts Engine — Implementation Reference

> **Status**: Implemented (Phase 1–4 — HTML, SVG, React, Chart.js, Vega-Lite + inline editing + version history)
> **Date**: 2026-03-03
> **Branch**: `branch1`

---

## Table of Contents

1. [What Was Built](#1-what-was-built)
2. [Why We Built It](#2-why-we-built-it)
3. [OSS Reference — Lobe Chat](#3-oss-reference--lobe-chat)
4. [Architecture Overview](#4-architecture-overview)
5. [File-by-File Breakdown](#5-file-by-file-breakdown)
6. [Artifact Types & Fence Identifiers](#6-artifact-types--fence-identifiers)
7. [How Detection Works](#7-how-detection-works)
8. [How the Sandbox Works](#8-how-the-sandbox-works)
9. [How React Artifacts Work](#9-how-react-artifacts-work)
10. [How Chart.js Artifacts Work](#10-how-chartjs-artifacts-work)
11. [How Vega-Lite Artifacts Work](#11-how-vega-lite-artifacts-work)
12. [Vendor Resources](#12-vendor-resources)
13. [System Prompt Instruction](#13-system-prompt-instruction)
14. [Panel Integration](#14-panel-integration)
15. [Inline Source Editing](#15-inline-source-editing)
16. [Version History](#16-version-history)
17. [Bugs Fixed During Implementation](#17-bugs-fixed-during-implementation)
18. [Security Model](#18-security-model)
19. [What Is Not Yet Implemented](#19-what-is-not-yet-implemented)

---

## 1. What Was Built

The Artifacts Engine lets the AI model generate **self-contained, interactive, renderable outputs** that the user can preview directly inside Ax-Studio without copy-pasting into an external tool.

| Capability | Status |
|---|---|
| HTML page preview | ✅ Implemented |
| SVG graphic preview | ✅ Implemented |
| React component preview (JSX) | ✅ Implemented |
| Chart.js v4 chart preview | ✅ Implemented |
| Vega-Lite v5 chart preview | ✅ Implemented |
| Inline Code / Preview tab switcher | ✅ Implemented |
| Copy source button | ✅ Implemented |
| Pin to right-panel (side-by-side with chat) | ✅ Implemented |
| Error reporting from inside iframe | ✅ Implemented |
| Inline source editing with live Apply | ✅ Implemented |
| Per-thread version history with Restore | ✅ Implemented |
| Works with any model (local + cloud) | ✅ Implemented |
| Offline — no CDN dependency at runtime | ✅ Implemented |

---

## 2. Why We Built It

Before this feature, when a model generated a complete HTML page, an interactive React widget, or an SVG diagram, users saw a static code block. They had to manually copy the code and open it in a browser or external editor to see what it looked like.

**The friction**: copy → open browser → paste → refresh → iterate. This destroys the "conversation with AI" flow.

**The goal**: make AI-generated UIs as immediate as AI-generated text — you ask, you see it rendered, you iterate in the same window.

This is the same problem that Anthropic's Claude.ai Artifacts and Lobe Chat's Artifacts feature solved for web users. We implemented a native desktop equivalent for Ax-Studio.

---

## 3. OSS Reference — Lobe Chat

**Reference project**: [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat)
**Reference feature**: Artifacts support (released July 2024)
**Docs**: https://lobehub.com/docs/usage/features/artifacts

### What we took from Lobe Chat's approach

| Concept | Lobe Chat | Ax-Studio |
|---|---|---|
| Sandboxed iframe rendering | `<iframe sandbox srcdoc>` | Same approach |
| Code / Preview tab switcher | Tab UI per artifact block | Same UX pattern |
| Side panel pinning | Right-side expandable panel | 2-column grid layout |
| Artifact type detection | Language fence identifiers | Same — `artifact-html`, `artifact-react`, `artifact-svg` |
| React JSX transpilation | Babel Standalone in iframe | Babel Standalone, loaded from local vendor files |
| System prompt instruction | Tells model to use artifact fences | `ARTIFACT_FORMAT_INSTRUCTION` constant |

### What we did differently

| Topic | Lobe Chat | Ax-Studio |
|---|---|---|
| Runtime environment | Web browser / Next.js | Tauri 2 desktop app (WebView2 on Windows) |
| CDN scripts | Loaded from CDN in iframe | **Bundled locally** in `public/vendor/` — offline-first |
| React preprocessing | Handles ES module syntax at server | Client-side `preprocessReactSource()` strips imports/exports |
| Panel slot | Dedicated artifact panel UI | Reuses existing split-pane layout slot |
| Detection layer | Custom React rendering pipeline | Streamdown HAST `pre` override (same as Python CEE) |

---

## 4. Architecture Overview

```
User prompt
    │
    ▼
Model output (streaming text)
    │
    ▼
Streamdown markdown parser
    │   passNode: true → components receive raw HAST nodes
    ▼
pre override (RenderMarkdown.tsx)
    │
    ├── getArtifactInfo(node)         ← checks language-artifact-* class
    │       │
    │       ├── artifact detected?
    │       │       │
    │       │       └── ArtifactBlock ─── Code tab  ──► Streamdown syntax-highlighted JSX (children)
    │       │                        │
    │       │                        └── Preview tab ─► ArtifactPreview
    │       │                                               │
    │       │                                               └── buildHarness(type, source, baseUrl)
    │       │                                                       │
    │       │                                                       └── <iframe sandbox srcdoc={...}>
    │       │                                                               │
    │       │                                                               └── postMessage errors → parent
    │       │
    │       └── not artifact → getPythonCode() → PythonCodeBlock (existing CEE)
    │
    └── streaming? → skip all wrapping, pass children through unchanged
```

```
User clicks "Panel" in ArtifactBlock
    │
    ▼
useArtifactPanel.pinArtifact(threadId, type, source)
    │
    ▼
ThreadDetail reads pinnedArtifact from store
    │
    ▼
Layout switches: flex → grid-cols-2
    ├── left:  chat (messages + input)
    └── right: ArtifactPanel ──► ArtifactPreview (full height)
```

---

## 5. File-by-File Breakdown

### New files created

#### `web-app/src/lib/artifact-harness.ts`
**What**: Builds the `srcdoc` HTML string for each artifact type.
**Why**: Centralises all harness logic — detection layer (RenderMarkdown) and preview layer (ArtifactPreview) both call `buildHarness()` with the type and source, and get back a complete renderable HTML document.

| Export | Purpose |
|---|---|
| `ArtifactType` | Union type: `'html' \| 'react' \| 'svg' \| 'chartjs' \| 'vega'` |
| `buildHtmlHarness(source)` | Wraps HTML fragment (or full doc) in an error-reporting shell |
| `buildSvgHarness(source)` | Wraps SVG in a centered flexbox document |
| `buildReactHarness(source, baseUrl)` | Preprocesses JSX, loads vendor scripts, runs Babel transform |
| `buildChartJsHarness(source, baseUrl)` | `<canvas>` + Chart.js UMD; `eval()` to allow callback functions |
| `buildVegaHarness(source, baseUrl)` | `<div id="vis">` + Vega/Vega-Lite/Vega-Embed UMD; `JSON.parse` + `vegaEmbed` |
| `buildHarness(type, source, baseUrl?)` | Router — calls the right builder |
| `preprocessReactSource(source)` (internal) | Strips `import`/`export` syntax that breaks Babel-in-browser |

---

#### `web-app/src/hooks/useArtifactPanel.ts`
**What**: Zustand store tracking the pinned artifact and full version history per thread.
**Why**: Uses the same Zustand pattern as all other stores in the app (`useMemory`, `useThreads`, etc.). Per-thread keying means navigating to a different thread won't show a stale artifact.

```typescript
// ArtifactEntry shape
{ type: ArtifactType; source: string; version: number; timestamp: number }

// State shape
pinnedByThread:  Record<threadId, ArtifactEntry>
historyByThread: Record<threadId, ArtifactEntry[]>   // max 20 entries, newest first

// Actions
pinArtifact(threadId, type, source)     // increments version, pushes to history
clearArtifact(threadId)                 // closes the panel for that thread
getPinned(threadId)                     // selector
updateSource(threadId, newSource)       // edits pinned source, bumps version, pushes history
restoreVersion(threadId, entry)         // restores a history entry without pushing a duplicate
```

The `version` counter is critical: if you pin the same artifact twice (after asking the model to fix it), incrementing version forces the `<iframe key={version}>` to remount and re-render with the new content.

---

#### `web-app/src/components/ai-elements/ArtifactPreview.tsx`
**What**: The sandboxed `<iframe srcdoc>` that actually renders artifacts.
**Why**: Separated from `ArtifactBlock` so both inline preview and the side panel can reuse the same renderer.

Key decisions:
- `sandbox="allow-scripts allow-modals allow-forms allow-downloads"` — no `allow-same-origin`
- `referrerPolicy="no-referrer"` — iframe cannot fingerprint origin
- `postMessage` listener with `.source` check — only accepts messages from our own iframe, not from any other frame on the page
- `key={type}-${version}` — forces full DOM remount when artifact changes

---

#### `web-app/src/components/ai-elements/ArtifactBlock.tsx`
**What**: The inline component that wraps a Streamdown code block with Code/Preview tabs and a toolbar.
**Why**: Follows the exact same pattern as `PythonCodeBlock` — it receives `children` (already syntax-highlighted JSX from Streamdown) and wraps it with extra UI.

```
ArtifactBlock
├── Tab bar
│   ├── [HTML] badge
│   ├── [Code] tab  ──► children (Streamdown output, untouched)
│   └── [Preview] tab ──► ArtifactPreview (480px fixed height)
└── Toolbar
    ├── Copy button (navigator.clipboard, 1.5s feedback)
    └── Panel button ──► useArtifactPanel.pinArtifact()
```

Default tab is **Preview** (not Code) so users immediately see the rendered output.

---

#### `web-app/src/components/ai-elements/ArtifactPanel.tsx`
**What**: The full-height right-pane panel shown when an artifact is pinned.
**Why**: Provides an expanded view for extended work — the user can keep iterating in the chat on the left while viewing the full rendered artifact on the right.

Features:
- **Preview tab** — full-height sandboxed iframe
- **Source tab** — editable `<textarea>` (monospace) with Apply and Reset buttons; Apply calls `updateSource()` and switches back to Preview
- **History tab** — scrollable list of past versions with type badge, relative timestamp (`2 mins ago`), and Restore button; current version highlighted; Restore calls `restoreVersion()` and switches to Preview
- Copy button (copies current `pinned.source`)
- Close button → calls `clearArtifact(threadId)` → collapses back to single-column layout

---

### Modified files

#### `web-app/src/containers/RenderMarkdown.tsx`

Added:
1. `ARTIFACT_LANG_RE = /^language-artifact-(html|react|svg|chartjs|vega)$/i` — regex to match Streamdown's class names
2. `getArtifactInfo(preNode)` — extracts `{ type, source }` from a HAST pre node
3. In `preOverride`: checks artifact first (before Python), wraps with `ArtifactBlock` if matched

Detection is **skipped during streaming** (`!isStreaming` guard) — the same guard used for Python blocks. This prevents a partially-streamed `artifact-html` fence from trying to render an incomplete HTML document.

---

#### `web-app/src/lib/system-prompt.ts`

Added `ARTIFACT_FORMAT_INSTRUCTION` — a markdown-formatted instruction appended to every system message that teaches the model:
- When to create an artifact (complete, renderable, standalone output — not snippets)
- Which fence identifier to use for each output type
- Rules: React must define `function App()`, SVG must have `<svg>` root with `viewBox`, keep artifacts self-contained

Also included in `buildChatPromptInjection()` alongside the existing `DIAGRAM_FORMAT_INSTRUCTION` and `CODE_EXECUTION_INSTRUCTION`.

**Also fixed**: `max_output_tokens` base default raised from **1200 → 4096** because 1200 tokens was cutting model output off mid-artifact (observed: model truncated mid-JSX return statement).

---

#### `web-app/src/containers/MessageItem.tsx`

Added `threadId?: string` to `MessageItemProps` and threaded it through to `RenderMarkdown`.

**Why this was needed**: `ArtifactBlock`'s "Panel" button calls `pinArtifact(threadId, ...)`. Without `threadId`, the button was silently a no-op (guarded by `if (threadId)`). `MessageItem` is the component that has the thread context and must pass it down.

---

#### `web-app/src/routes/threads/$threadId.tsx`

Changes:
1. Import `ArtifactPanel` and `useArtifactPanel`
2. Add `ARTIFACT_FORMAT_INSTRUCTION` to both `systemMessage` strings (main pane + split pane)
3. Read `pinnedArtifact = useArtifactPanel(state => state.pinnedByThread[threadId])`
4. Pass `threadId` to all three `<MessageItem>` call sites
5. Layout change: when `pinnedArtifact` is set and no split-thread view is active, switch from single-column to `grid-cols-2`:
   - Left column: full chat pane (messages + input)
   - Right column: `<ArtifactPanel>` (full height)

---

#### `src-tauri/tauri.conf.json`

Added `"frame-src": "'self' blob: data:"` to the CSP. This allows `<iframe srcdoc>` frames (which are treated as `about:srcdoc` — covered by `'self'`).

The `script-src` was **not** extended with CDN URLs after switching to local vendor files.

---

### Vendor assets added

Located at `web-app/public/vendor/` — served from the app's own origin (`'self'`):

| File | Size | Source | Version | Purpose |
|---|---|---|---|---|
| `react.production.min.js` | 11 KB | jsDelivr → npm/react | 18.x | React runtime (global `React`) |
| `react-dom.production.min.js` | 129 KB | jsDelivr → npm/react-dom | 18.x | DOM renderer (global `ReactDOM`) |
| `babel.min.js` | 3.0 MB | jsDelivr → npm/@babel/standalone | 7.x | JSX → JS transpilation in iframe |
| `chart.umd.min.js` | 204 KB | jsDelivr → npm/chart.js | 4.x | Chart.js renderer (global `Chart`) |
| `vega.min.js` | 504 KB | jsDelivr → npm/vega | 5.x | Vega runtime (required by Vega-Lite) |
| `vega-lite.min.js` | 247 KB | jsDelivr → npm/vega-lite | 5.x | Vega-Lite compiler |
| `vega-embed.min.js` | 60 KB | jsDelivr → npm/vega-embed | 6.x | `vegaEmbed()` convenience API |

**Download commands**:
```bash
# React + Babel (Phase 1)
curl -fsSL "https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"          -o web-app/public/vendor/react.production.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"  -o web-app/public/vendor/react-dom.production.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"              -o web-app/public/vendor/babel.min.js

# Chart.js + Vega (Phase 3)
curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"              -o web-app/public/vendor/chart.umd.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/vega@5/build/vega.min.js"                      -o web-app/public/vendor/vega.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/vega-lite@5/build/vega-lite.min.js"            -o web-app/public/vendor/vega-lite.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/vega-embed@6/build/vega-embed.min.js"          -o web-app/public/vendor/vega-embed.min.js
```

**Why local instead of CDN**:
Tauri 2 on Windows uses WebView2 (Chromium-based). The Content-Security-Policy set in `tauri.conf.json` applies to the main window via response headers. However, `<iframe srcdoc sandbox>` frames with a null/opaque origin (sandboxed without `allow-same-origin`) do not reliably inherit `script-src` in WebView2 — CDN script loads were blocked. Loading from `window.location.origin/vendor/...` always matches `'self'` and is never blocked.

---

## 6. Artifact Types & Fence Identifiers

The model is instructed to use these exact fence identifiers:

| Output type | Fence | Detection class |
|---|---|---|
| HTML page or fragment | ` ```artifact-html ` | `language-artifact-html` |
| React component (JSX) | ` ```artifact-react ` | `language-artifact-react` |
| SVG graphic | ` ```artifact-svg ` | `language-artifact-svg` |
| Chart.js v4 chart config | ` ```artifact-chartjs ` | `language-artifact-chartjs` |
| Vega-Lite v5 spec | ` ```artifact-vega ` | `language-artifact-vega` |

### Example model output

````
Here's a tip calculator:

```artifact-react
function App() {
  const [bill, setBill] = React.useState(0);
  const [tip, setTip] = React.useState(15);
  const tipAmount = (tip / 100) * bill;
  const total = bill + tipAmount;
  return (
    <div style={{ padding: 20, fontFamily: 'system-ui' }}>
      <h2>Tip Calculator</h2>
      <label>Bill: <input type="number" value={bill} onChange={e => setBill(+e.target.value)} /></label>
      <label>Tip %: <input type="number" value={tip} onChange={e => setTip(+e.target.value)} /></label>
      <p>Tip: ${tipAmount.toFixed(2)}</p>
      <p><strong>Total: ${total.toFixed(2)}</strong></p>
    </div>
  );
}
```
````

---

## 7. How Detection Works

Detection happens inside the `pre` override registered with Streamdown in `RenderMarkdown.tsx`.

Streamdown uses `passNode: true` when calling `toJsxRuntime`, which means every custom component receives the raw **HAST (Hypertext Abstract Syntax Tree)** node as a prop in addition to the rendered children.

The HAST node for a fenced code block looks like:
```
{
  type: 'element',
  tagName: 'pre',
  children: [{
    type: 'element',
    tagName: 'code',
    properties: {
      className: ['language-artifact-react']   ← this is what we check
    },
    children: [{ type: 'text', value: '...source code...' }]
  }]
}
```

`getArtifactInfo()` walks this structure:
1. Checks `node.children[0].tagName === 'code'`
2. Reads `properties.className` array
3. Tests each class name against `/^language-artifact-(html|react|svg|chartjs|vega)$/i`
4. Extracts the artifact type from capture group 1
5. Extracts source text by recursively concatenating all `{ type: 'text', value }` nodes

If matched → returns `{ type, source }` → `ArtifactBlock` is rendered.
If not matched → falls through to Python detection → falls through to pass-through.

**Guard**: The entire check is skipped when `isStreaming === true`. This prevents partial renders of incomplete artifacts.

---

## 8. How the Sandbox Works

Every artifact renders inside:

```html
<iframe
  srcDoc={...}
  sandbox="allow-scripts allow-modals allow-forms allow-downloads"
  referrerPolicy="no-referrer"
/>
```

### Sandbox flags explained

| Flag | Effect |
|---|---|
| `allow-scripts` | JavaScript can execute inside the iframe |
| `allow-modals` | `alert()` / `confirm()` work (useful for demos) |
| `allow-forms` | Forms can be submitted (useful for UI demos) |
| `allow-downloads` | File download triggers work |
| *(omitted)* `allow-same-origin` | **Key omission** — gives the iframe a null/opaque origin |

### Security properties of null origin

Because `allow-same-origin` is absent, the iframe's origin is `null` (opaque). This means:

| What the iframe CAN do | What the iframe CANNOT do |
|---|---|
| Run JavaScript (allow-scripts) | Access `window.parent` DOM |
| Show alerts/modals | Read parent's `localStorage` or `sessionStorage` |
| Submit forms | Call `window.__TAURI_INTERNALS__` (Tauri IPC) |
| Load scripts from app origin ('self') | Access parent cookies |
| postMessage to parent | Navigate the top frame |

### Error propagation

The iframe reports runtime errors to the parent using `postMessage`:

```javascript
// Inside iframe (injected by ERROR_REPORTER)
window.onerror = function(msg, src, line, col, err) {
  window.parent.postMessage(
    { type: 'artifact-error', message: String(msg), stack: err?.stack },
    '*'
  );
};
```

`ArtifactPreview.tsx` listens:
```javascript
window.addEventListener('message', (event) => {
  if (event.source !== iframeRef.current?.contentWindow) return; // security check
  if (event.data?.type === 'artifact-error') {
    setError(event.data.message);
  }
});
```

The `event.source` check prevents malicious `postMessage` calls from other frames spoofing artifact errors.

---

## 9. How React Artifacts Work

React artifacts require three things:
1. **React 18 runtime** — `React`, `ReactDOM` as globals
2. **JSX transpilation** — convert `<div>` to `React.createElement("div", null)`
3. **Source preprocessing** — strip ES module syntax that Babel-in-browser can't handle

### Step 1: Source preprocessing (`preprocessReactSource`)

Models almost always generate ES module style code:
```jsx
import React, { useState } from 'react';   // ← breaks (React is a global)
export default function App() { ... }      // ← breaks (no module bundler)
```

`preprocessReactSource()` fixes this with a series of regex replacements **before** passing to the harness:

| Pattern | Transformed to |
|---|---|
| `import React from 'react'` | *(removed)* |
| `import { useState } from 'react'` | *(removed)* |
| `import anything from 'anywhere'` | *(removed)* |
| `export default function App()` | `function App()` |
| `export default class App` | `class App` |
| `export default SomeName` | `const App = SomeName;` |
| `export { Foo, Bar }` | *(removed)* |
| `export const Foo =` | `const Foo =` |

After preprocessing, the code is plain JavaScript + JSX with no module syntax.

### Step 2: JSX transpilation (Babel Standalone)

The preprocessed source is injected into a `<script type="text/babel">` tag. Babel Standalone (loaded from `vendor/babel.min.js`) automatically detects this script type and transforms it at runtime:

```
JSX source
    ↓ Babel.transform(..., { presets: ['react'] })
Plain JS with React.createElement calls
    ↓ eval'd by the browser
React component function in scope
    ↓ ReactDOM.createRoot().render(React.createElement(App))
Rendered DOM
```

### Step 3: App component resolution

After the user code runs, the harness looks for an `App` identifier:
```javascript
const AppComponent = (typeof App !== 'undefined' && App) || null;
if (!AppComponent) throw new Error('No App component found...');
ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(AppComponent)
);
```

This handles both:
- `function App() { ... }` — `App` is in scope
- `const MyCalc = ...; const App = MyCalc;` — still in scope

### Vendor script loading

Scripts load from the app's own origin (not CDN):

```html
<!-- dev:  http://localhost:1420/vendor/... -->
<!-- prod: tauri://localhost/vendor/...    -->
<script src="${baseUrl}vendor/react.production.min.js"></script>
<script src="${baseUrl}vendor/react-dom.production.min.js"></script>
<script src="${baseUrl}vendor/babel.min.js"></script>
```

`baseUrl = window.location.origin + '/'` is computed in `ArtifactPreview.tsx` and passed to `buildHarness()`.

---

## 10. How Chart.js Artifacts Work

Chart.js artifacts expect a **Chart.js v4 config object** as their source — a JSON-like object with `type`, `data`, and optional `options` properties.

### Why `eval()` instead of `JSON.parse()`

Chart.js config objects can contain JavaScript callback functions in `options` (e.g. `tooltip.callbacks.label`, `scales.y.ticks.callback`). These are valid JavaScript but not valid JSON. Using `JSON.parse()` would silently drop them.

Instead, `buildChartJsHarness()` uses:
```javascript
const config = eval('(' + source + ')');
```

The parentheses wrap forces the parser to treat the content as an expression (object literal), not a block statement. This is safe inside the sandboxed iframe because:
- The iframe has a null origin (no Tauri IPC access)
- `eval` only runs content the model generated — same trust level as `<script>` in HTML/React artifacts

### Harness structure

```html
<canvas id="chart"></canvas>
<script src="${baseUrl}vendor/chart.umd.min.js"></script>
<script>
  try {
    const config = eval('(' + source + ')');
    const canvas = document.getElementById('chart');
    new Chart(canvas, config);
  } catch (e) {
    // show error div + postMessage to parent
  }
</script>
```

### Example model output

````
```artifact-chartjs
{
  type: 'bar',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr'],
    datasets: [{
      label: 'Revenue ($k)',
      data: [42, 58, 73, 91],
      backgroundColor: 'rgba(99,102,241,0.8)'
    }]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true } }
  }
}
```
````

---

## 11. How Vega-Lite Artifacts Work

Vega-Lite artifacts expect a **Vega-Lite v5 JSON spec** as their source. Unlike Chart.js, Vega specs are pure JSON (no callbacks), so `JSON.parse()` is used.

### Harness structure

```html
<div id="vis"></div>
<script src="${baseUrl}vendor/vega.min.js"></script>
<script src="${baseUrl}vendor/vega-lite.min.js"></script>
<script src="${baseUrl}vendor/vega-embed.min.js"></script>
<script>
  try {
    const spec = JSON.parse(source);
    vegaEmbed('#vis', spec, { actions: false });
  } catch (e) {
    // show error div + postMessage to parent
  }
</script>
```

- `actions: false` hides the Vega-Embed toolbar (export/source/editor buttons) — keeps the UI clean inside the panel
- Vega-Embed handles the Vega → Vega-Lite compilation chain internally

### Example model output

````
```artifact-vega
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "mark": "point",
  "data": {
    "values": [
      {"x": 1, "y": 4, "category": "A"},
      {"x": 2, "y": 7, "category": "B"},
      {"x": 3, "y": 2, "category": "A"}
    ]
  },
  "encoding": {
    "x": {"field": "x", "type": "quantitative"},
    "y": {"field": "y", "type": "quantitative"},
    "color": {"field": "category", "type": "nominal"}
  }
}
```
````

---

## 12. Vendor Resources

### Why these specific packages

| Package | Why chosen |
|---|---|
| `react@18` UMD | React 18 has concurrent rendering, hooks, `createRoot` API. UMD build exposes global `React`. |
| `react-dom@18` UMD | Provides `ReactDOM.createRoot()` needed for React 18 rendering. UMD exposes global `ReactDOM`. |
| `@babel/standalone@7` | The only browser-side JSX transpiler that is well-maintained, accurate, and widely used. Sucrase was considered but has Node.js dependencies. |

### Why UMD (not ESM)

UMD (Universal Module Definition) bundles expose their exports as browser globals (`window.React`, `window.ReactDOM`, `window.Babel`). This is required because the iframe's `<script type="text/babel">` code references `React.useState`, `ReactDOM.createRoot`, etc. as globals — it is not an ES module.

ESM (`import React from 'react'`) doesn't work here because:
1. The srcdoc iframe is not a module context by default
2. Import maps in sandboxed iframes have limited support

### Where resources were sourced

- **jsDelivr** (`cdn.jsdelivr.net`): Used as the download source (reliable, fast, serves npm packages as UMD bundles)
- **npm registry**: The packages are published and maintained by Meta (React) and the Babel team

### Keeping vendor files updated

To update to newer versions:
```bash
# React 19 example (when ready)
curl -fsSL "https://cdn.jsdelivr.net/npm/react@19/umd/react.production.min.js" \
  -o web-app/public/vendor/react.production.min.js
curl -fsSL "https://cdn.jsdelivr.net/npm/react-dom@19/umd/react-dom.production.min.js" \
  -o web-app/public/vendor/react-dom.production.min.js
# Update harness script tags to reference react@19
```

---

## 13. System Prompt Instruction

`ARTIFACT_FORMAT_INSTRUCTION` in `web-app/src/lib/system-prompt.ts` is appended to every system message via `buildChatPromptInjection()`, alongside:
- `DIAGRAM_FORMAT_INSTRUCTION` (Mermaid engine)
- `CODE_EXECUTION_INSTRUCTION` (Python CEE)

### Full instruction text

```markdown
## Artifacts

When generating a **self-contained, renderable output** that the user can interact with
visually, wrap it in a fenced code block using one of these language identifiers:

| Output type         | Fence identifier        |
|---------------------|-------------------------|
| HTML page/component | ```artifact-html        |
| React component     | ```artifact-react       |
| SVG graphic         | ```artifact-svg         |
| Chart.js chart      | ```artifact-chartjs     |
| Vega-Lite chart     | ```artifact-vega        |

Rules:
- Use artifacts for complete, standalone outputs — landing pages, interactive demos,
  data visualizations, SVG illustrations.
- Do NOT use artifact fences for code examples, snippets, or partial code —
  only complete, immediately renderable output.
- React artifacts must define a function component named `App`.
- SVG artifacts must be a single `<svg>` element with a `viewBox` attribute.
- Chart.js artifacts must be a valid Chart.js v4 config object (JSON with `type` and `data`).
  Callback functions in `options` are allowed.
- Vega-Lite artifacts must be a valid Vega-Lite v5 JSON spec (with `$schema`, `data`, `mark`
  or `layer`/`hconcat`/`vconcat`).
- When asked to fix or update an artifact, always output the full updated version
  in a new artifact block.
- Keep artifacts self-contained — inline all styles, use no external imports beyond
  the available runtime (React 18, Chart.js 4, Vega-Lite 5, standard HTML/CSS/JS).
```

### Why this instruction style

The instruction uses a markdown table (same as `DIAGRAM_FORMAT_INSTRUCTION`) because:
1. Models parse structured tables more reliably than prose for "which identifier to use when"
2. Rules section uses bullet points for quick scanning
3. No ambiguity — "React artifacts must define `App`" eliminates the common failure mode where the model names the function differently

---

## 14. Panel Integration

### Layout logic in `$threadId.tsx`

The thread view has three possible layout states:

```
State 1: No split, no artifact panel
└── single flex column (full width chat)

State 2: Artifact panel pinned (no split thread)
└── grid-cols-2
    ├── left:  chat column (messages + input)
    └── right: ArtifactPanel (full height)

State 3: Split thread view (existing feature)
└── grid-cols-2
    ├── main pane
    └── SplitThreadPane (second chat thread)
```

States 2 and 3 are mutually exclusive — artifact panel only shows when no split thread is active.

### Data flow for pinning

```
User clicks Panel in ArtifactBlock
    │
    ▼
useArtifactPanel.pinArtifact(threadId, type, source)
    │  ← version incremented to force iframe remount
    ▼
Zustand store: pinnedByThread[threadId] = { type, source, version }
    │
    ▼
ThreadDetail re-renders (pinnedArtifact now truthy)
    │
    ▼
Layout: grid-cols-2 with ArtifactPanel in right slot
```

### Panel close

```
User clicks X in ArtifactPanel
    │
    ▼
useArtifactPanel.clearArtifact(threadId)
    │
    ▼
pinnedByThread[threadId] deleted
    │
    ▼
ThreadDetail re-renders: pinnedArtifact = null → back to single column
```

---

## 15. Inline Source Editing

The **Source tab** in `ArtifactPanel` lets users edit the artifact source directly in the panel without asking the model to regenerate it.

### How it works

```
User opens Source tab
    │
    ▼
<textarea> initialised with pinned.source
    │  (local state: editedSource)
    │
User edits text
    │
User clicks Apply
    │
    ▼
useArtifactPanel.updateSource(threadId, editedSource)
    │  → creates new ArtifactEntry: { ...prev, source: editedSource, version: prev.version+1, timestamp: now }
    │  → pushes entry to historyByThread[threadId]
    │  → updates pinnedByThread[threadId]
    ▼
setActiveTab('preview')
    │
    ▼
ArtifactPreview remounts (key={type}-${version} changed) → re-renders with new source
```

**Reset button**: reverts `editedSource` to the current `pinned.source` without touching the store.

**Apply disabled**: when `editedSource === pinned.source` (nothing changed), both Apply and Reset are disabled.

### State management

`editedSource` is local component state, initialised from `pinned.source`. A `useEffect` watches `pinned` — if the pinned artifact changes (e.g. the model produces a new one), `editedSource` is reset to the new source automatically.

---

## 16. Version History

The **History tab** in `ArtifactPanel` shows a chronological list of all artifact versions pinned or edited in the current thread.

### How history is built

Every write operation pushes to `historyByThread[threadId]`:

| Action | History effect |
|---|---|
| `pinArtifact()` | Prepends new entry, capped at 20 |
| `updateSource()` | Prepends edited entry, capped at 20 |
| `restoreVersion()` | **No push** — avoids creating duplicate entries when restoring |

### History tab UI

Each history entry shows:
- Version badge (`v3`, `v2`, …) — highlighted in primary colour if it is the current version
- Type badge (`HTML`, `React`, `Chart.js`, …)
- Relative timestamp (`just now`, `5 mins ago`, `2 hours ago`, …)
- **Restore** button (hidden on current version) → calls `restoreVersion(threadId, entry)` and switches to Preview

The current version entry shows a `Current` label in place of the Restore button.

### Restore flow

```
User clicks Restore on v2
    │
    ▼
useArtifactPanel.restoreVersion(threadId, entry)
    │  → overwrites pinnedByThread[threadId] with the entry (no history push)
    ▼
setActiveTab('preview')
    │
    ▼
ArtifactPreview remounts with restored source (version key changed)
```

---

## 17. Bugs Fixed During Implementation

### Bug 1 — Panel button was a no-op

**Symptom**: Clicking "Panel" in `ArtifactBlock` did nothing.

**Root cause**: `MessageItem` had no `threadId` prop. It was never passed down to `RenderMarkdown`, which then passed `undefined` to `ArtifactBlock`. The guard `if (threadId) { pinArtifact(...) }` silently did nothing.

**Fix**: Added `threadId?: string` to `MessageItemProps` in `MessageItem.tsx`, threaded it to `RenderMarkdown`, and added `threadId={threadId}` to all three `<MessageItem>` call sites in `$threadId.tsx` (split pane, main pane in split view, single pane).

---

### Bug 2 — React artifacts blank (CDN blocked)

**Symptom**: React artifact showed "Script error" in the error banner or blank white iframe.

**Root cause**: Tauri 2 on Windows (WebView2/Chromium) does not reliably propagate `script-src` CSP into `<iframe srcdoc sandbox>` frames with a null/opaque origin. Scripts from `cdn.jsdelivr.net` were blocked inside the iframe even though they were explicitly allowed in the parent's `script-src`.

**Fix**: Downloaded React 18, ReactDOM 18, and Babel standalone to `web-app/public/vendor/`. The harness now loads them from `window.location.origin/vendor/...`, which always matches `'self'` in `script-src` and is never blocked.

---

### Bug 3 — React artifacts showed broken JSX (ES module syntax)

**Symptom**: React artifact failed with `ReferenceError: exports is not defined` or `SyntaxError: Cannot use import statement`.

**Root cause**: Models trained on modern JavaScript almost always generate:
```jsx
import React, { useState } from 'react';
export default function App() { ... }
```
When Babel standalone transforms this in a non-module script context, it converts `export default` to `exports.default = ...`. But `exports` doesn't exist in a browser script context (that's a CommonJS/Node.js construct). Result: `ReferenceError`.

**Fix**: Added `preprocessReactSource()` in `artifact-harness.ts` — a series of regex replacements that run **before** harness generation. Strips all import/export syntax so the code is plain JavaScript + JSX by the time Babel sees it.

---

### Bug 4 — Model output truncated mid-artifact

**Symptom**: React component code block ended abruptly mid-JSX (e.g. mid `return (` statement).

**Root cause**: `max_output_tokens` default in `getOptimizedModelConfig()` was **1200 tokens**. A complete React component with state, computed values, styled JSX, and multiple handlers easily requires 800–1500 tokens. The local model (qwen3-30b-a3b-f8) was hitting the limit mid-generation.

**Fix**: Raised defaults in `system-prompt.ts`:

| Scenario | Before | After |
|---|---|---|
| Base | 1200 | 4096 |
| Long prompt (≥800 chars) | 1800 | 4096 |
| Very long prompt / attachments | 2048 | 6144 |
| Reasoning models | 4096 | 8192 |

---

## 18. Security Model

| Threat | Mitigation | Status |
|---|---|---|
| Artifact reads app localStorage | Null origin (no `allow-same-origin`) → storage inaccessible | ✅ Blocked |
| Artifact calls Tauri IPC (`window.__TAURI__`) | IPC only accessible from `tauri://localhost` origin; null-origin iframe cannot access it | ✅ Blocked |
| Artifact exfiltrates data via fetch | Null origin → fetch requests carry `Origin: null`; CORS blocks responses from real servers | ✅ Blocked |
| Artifact modifies parent DOM | `window.parent` is opaque from null-origin context | ✅ Blocked |
| Artifact spoofs postMessage errors | `event.source !== iframeRef.current?.contentWindow` check in listener | ✅ Blocked |
| Artifact navigates top frame | No `allow-top-navigation` in sandbox | ✅ Blocked |
| Artifact freezes UI with infinite loop | Iframe runs in separate JS context; parent UI stays responsive | ✅ Contained |
| Malicious vendor asset (supply chain) | Vendor files are pinned single-version downloads, no auto-update | ⚠️ Manual review on update |

---

## 19. What Is Not Yet Implemented

| Feature | Phase | Notes |
|---|---|---|
| Per-thread artifact enable/disable toggle | Future | Currently always-on |
| Artifact export (download as .html file) | Future | Save dialog via Tauri FS API |
| Full-document artifact view (new window) | Future | Open artifact in dedicated Tauri WebviewWindow |
| CodeMirror / Monaco editor in Source tab | Future | Currently a plain `<textarea>`; a proper code editor would add syntax highlighting and auto-indent |
| Collaborative artifact sharing | Future | Share a pinned artifact link between threads or users |
