import { transformJSX } from './artifact-transform'

export type ArtifactType = 'html' | 'react' | 'svg' | 'chartjs' | 'vega'

// Permissive CSP for the srcdoc iframe — allows inline scripts and eval.
// WKWebView (Tauri/macOS) inherits the parent page's strict CSP inside srcdoc
// frames; this meta tag overrides it so vendor scripts and user code can run.
const IFRAME_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' blob: data:;">`

const ERROR_REPORTER = `
<script>
  window.onerror = function(msg, src, line, col, err) {
    window.parent.postMessage(
      { type: 'artifact-error', message: String(msg), stack: err ? String(err.stack) : '' },
      '*'
    );
  };
  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage(
      { type: 'artifact-error', message: String(e.reason), stack: '' },
      '*'
    );
  });
</script>`.trim()

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
`.trim()

// ---------------------------------------------------------------------------
// Vendor script cache — fetched once, inlined directly in srcdoc HTML so that
// sandboxed iframes never need to make <script src="..."> requests (which
// fail in Tauri's WKWebView when the iframe has a null / opaque origin).
// ---------------------------------------------------------------------------
const vendorCache = new Map<string, string>()

async function fetchVendor(baseUrl: string, file: string): Promise<string> {
  const url = `${baseUrl}vendor/${file}`
  if (vendorCache.has(url)) return vendorCache.get(url)!
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load vendor script ${file} (HTTP ${res.status})`)
  const text = await res.text()
  vendorCache.set(url, text)
  return text
}

// ---------------------------------------------------------------------------
// HTML harness (no vendor scripts needed)
// ---------------------------------------------------------------------------
export function buildHtmlHarness(source: string): string {
  const trimmed = source.trim()
  const isFullDoc = /^<!DOCTYPE\s+html/i.test(trimmed) || /^<html/i.test(trimmed)

  if (isFullDoc) {
    const bodyClose = trimmed.lastIndexOf('</body>')
    if (bodyClose !== -1) {
      return trimmed.slice(0, bodyClose) + '\n' + ERROR_REPORTER + '\n' + trimmed.slice(bodyClose)
    }
    return trimmed + '\n' + ERROR_REPORTER
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${IFRAME_CSP}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>${BASE_STYLES}</style>
</head>
<body>
${trimmed}
</body>
</html>`
}

// ---------------------------------------------------------------------------
// SVG harness (no vendor scripts needed)
// ---------------------------------------------------------------------------
export function buildSvgHarness(source: string): string {
  const trimmed = source.trim()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    ${BASE_STYLES}
    html, body { height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    svg { max-width: 100%; max-height: 100vh; }
  </style>
</head>
<body>
${trimmed}
${ERROR_REPORTER}
</body>
</html>`
}

// ---------------------------------------------------------------------------
// React harness
//
// `transformedSource` must already be plain JS (no JSX) — call transformJSX()
// in the main thread before passing it here.
// `reactJs` and `reactDomJs` are the raw file contents inlined as <script>
// blocks so no network request is needed inside the sandboxed iframe.
// ---------------------------------------------------------------------------

/**
 * Strips ES module syntax that breaks non-module execution.
 */
export function preprocessReactSource(source: string): string {
  return source
    // Remove: import ... from 'react'
    .replace(/^import\s+.*?\s+from\s+['"]react['"]\s*;?\s*$/gm, '')
    // Remove: import ... from 'react-dom'
    .replace(/^import\s+.*?\s+from\s+['"]react-dom[^'"]*['"]\s*;?\s*$/gm, '')
    // Remove: any other import statements
    .replace(/^import\s+.*?\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    // Convert: export default function App(...) → function App(...)
    .replace(/\bexport\s+default\s+function\s+(\w+)/g, 'function $1')
    // Convert: export default class App → class App
    .replace(/\bexport\s+default\s+class\s+(\w+)/g, 'class $1')
    // Convert: export default <identifier> → const App = <identifier>
    .replace(/\bexport\s+default\s+(\w+)\s*;?/g, 'const App = $1;')
    // Remove: export { ... }
    .replace(/\bexport\s*\{[^}]*\}\s*;?/g, '')
    // Strip export modifier from export const/let/var/function/class
    .replace(/\bexport\s+(const|let|var|function|class)\s/g, '$1 ')
}

const ERR_STYLE = 'color:#dc2626;background:#fef2f2;padding:1rem;font-family:monospace;font-size:0.8rem;white-space:pre-wrap;border-radius:6px;margin:1rem;border:1px solid #fca5a5'

function buildReactHarnessInline(
  transformedSource: string,
  reactJs: string,
  reactDomJs: string,
): string {
  const escaped = transformedSource.replace(/<\/script>/gi, '<\\/script>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>${BASE_STYLES}</style>
  <script>${reactJs}<\/script>
  <script>${reactDomJs}<\/script>
</head>
<body>
  <div id="root"></div>
  <script>
(function() {
  var ERR = '${ERR_STYLE}';
  function showErr(msg) {
    var el = document.createElement('div');
    el.style.cssText = ERR;
    el.textContent = msg;
    var root = document.getElementById('root');
    if (root) root.replaceWith(el); else document.body.appendChild(el);
    window.parent.postMessage({ type: 'artifact-error', message: msg }, '*');
  }

  if (typeof React === 'undefined') { showErr('React failed to initialize'); return; }
  if (typeof ReactDOM === 'undefined') { showErr('ReactDOM failed to initialize'); return; }

  // Expose destructured React hooks as locals so user code can call them without import
  var useState = React.useState, useEffect = React.useEffect,
      useCallback = React.useCallback, useMemo = React.useMemo,
      useRef = React.useRef, useContext = React.useContext,
      useReducer = React.useReducer, createContext = React.createContext,
      forwardRef = React.forwardRef, memo = React.memo,
      Fragment = React.Fragment, Children = React.Children,
      cloneElement = React.cloneElement, createElement = React.createElement,
      isValidElement = React.isValidElement;

  // Run user code + mount — all in one try so App function declarations are in scope
  try {
${escaped}

    var AppComponent = (typeof App === 'function') ? App : null;
    if (!AppComponent) {
      showErr('No App component found.\\n\\nRename your root component to App:\\n\\n  function App() {\\n    return <div>Hello</div>;\\n  }');
      return;
    }
    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement(AppComponent)
    );
  } catch (e) {
    showErr(String(e && e.message ? e.message : e));
  }
})();
  <\/script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Chart.js harness
// ---------------------------------------------------------------------------
function buildChartJsHarnessInline(source: string, chartJs: string): string {
  const escaped = source.replace(/<\/script>/gi, '<\\/script>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${IFRAME_CSP}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>
    ${BASE_STYLES}
    html, body { height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    canvas { max-width: 100%; max-height: 100vh; }
  </style>
  <script>${chartJs}<\/script>
</head>
<body>
  <canvas id="chart"></canvas>
  <script>
try {
  var config = eval('(' + ${JSON.stringify(escaped)} + ')');
  var canvas = document.getElementById('chart');
  new Chart(canvas, config);
} catch (e) {
  var el = document.createElement('div');
  el.style.cssText = '${ERR_STYLE}';
  el.textContent = String(e.message);
  document.getElementById('chart').replaceWith(el);
  window.parent.postMessage({ type: 'artifact-error', message: String(e.message), stack: String(e.stack) }, '*');
}
  <\/script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Vega harness
// ---------------------------------------------------------------------------
function buildVegaHarnessInline(source: string, vegaJs: string, vegaLiteJs: string, vegaEmbedJs: string): string {
  const escaped = source.replace(/<\/script>/gi, '<\\/script>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${IFRAME_CSP}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>
    ${BASE_STYLES}
    html, body { height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    #vis { width: 100%; }
  </style>
  <script>${vegaJs}<\/script>
  <script>${vegaLiteJs}<\/script>
  <script>${vegaEmbedJs}<\/script>
</head>
<body>
  <div id="vis"></div>
  <script>
(function() {
  function showErr(msg) {
    var el = document.createElement('div');
    el.style.cssText = '${ERR_STYLE}';
    el.textContent = msg;
    var vis = document.getElementById('vis');
    if (vis) vis.replaceWith(el); else document.body.appendChild(el);
    window.parent.postMessage({ type: 'artifact-error', message: msg }, '*');
  }

  var spec;
  try {
    spec = JSON.parse(${JSON.stringify(escaped)});
  } catch (e) {
    showErr('Invalid JSON in Vega-Lite spec: ' + String(e.message));
    return;
  }

  // Ensure $schema is present so Vega-Lite uses the correct version defaults
  if (!spec.$schema) {
    spec.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
  }

  // Fix "Duplicate scale or projection name: undefined":
  // This error occurs in layered/concat specs when two views share a channel
  // whose scale name resolves to undefined. Adding explicit resolve config
  // forces Vega-Lite to give each layer its own named scales.
  if (spec.layer && !spec.resolve) {
    spec.resolve = { scale: { x: 'shared', y: 'shared', color: 'shared' } };
  }

  vegaEmbed('#vis', spec, { actions: false, renderer: 'svg' })
    .catch(function(err) {
      var msg = err && err.message ? err.message : String(err);
      // "Duplicate scale" often means the spec's layer/encoding has a conflict —
      // try flattening to independent scales as a fallback
      if (msg.indexOf('Duplicate scale') !== -1 && spec.layer) {
        spec.resolve = { scale: { x: 'independent', y: 'independent', color: 'independent' } };
        vegaEmbed('#vis', spec, { actions: false, renderer: 'svg' })
          .catch(function(err2) {
            showErr('Vega error: ' + (err2 && err2.message ? err2.message : String(err2)));
          });
      } else {
        showErr('Vega error: ' + msg);
      }
    });
})();
  <\/script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronous build — only works for html and svg (no vendor scripts needed).
 * @deprecated Use buildHarnessAsync for all types.
 */
export function buildHarness(type: ArtifactType, source: string, _baseUrl?: string): string {
  switch (type) {
    case 'html': return buildHtmlHarness(source)
    case 'svg': return buildSvgHarness(source)
    default:
      // Fallback for callers that haven't migrated: return a placeholder
      return buildHtmlHarness(
        `<p style="padding:1rem;font-family:monospace;color:#888">Loading ${type} artifact…</p>`
      )
  }
}

/**
 * Async build — fetches vendor scripts (cached after first call) and inlines
 * them directly in the srcdoc HTML so no <script src=""> is needed inside the
 * sandboxed iframe. JSX is transformed in the main thread.
 */
export async function buildHarnessAsync(
  type: ArtifactType,
  source: string,
  baseUrl: string,
): Promise<string> {
  switch (type) {
    case 'html': return buildHtmlHarness(source)
    case 'svg': return buildSvgHarness(source)

    case 'react': {
      const processed = preprocessReactSource(source)
      const [transformedSource, reactJs, reactDomJs] = await Promise.all([
        transformJSX(processed, baseUrl),
        fetchVendor(baseUrl, 'react.production.min.js'),
        fetchVendor(baseUrl, 'react-dom.production.min.js'),
      ])
      return buildReactHarnessInline(transformedSource, reactJs, reactDomJs)
    }

    case 'chartjs': {
      const chartJs = await fetchVendor(baseUrl, 'chart.umd.min.js')
      return buildChartJsHarnessInline(source, chartJs)
    }

    case 'vega': {
      const [vegaJs, vegaLiteJs, vegaEmbedJs] = await Promise.all([
        fetchVendor(baseUrl, 'vega.min.js'),
        fetchVendor(baseUrl, 'vega-lite.min.js'),
        fetchVendor(baseUrl, 'vega-embed.min.js'),
      ])
      return buildVegaHarnessInline(source, vegaJs, vegaLiteJs, vegaEmbedJs)
    }
  }
}

