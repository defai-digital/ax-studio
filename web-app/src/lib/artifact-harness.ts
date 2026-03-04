export type ArtifactType = 'html' | 'react' | 'svg' | 'chartjs' | 'vega'

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
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${BASE_STYLES}</style>
</head>
<body>
${trimmed}
${ERROR_REPORTER}
</body>
</html>`
}

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

/**
 * Strips ES module syntax that breaks Babel-in-browser non-module execution.
 *
 * Models typically generate `import React from 'react'` and
 * `export default function App()` — neither works when Babel transforms to
 * CommonJS in a browser context without a module bundler.
 */
function preprocessReactSource(source: string): string {
  return source
    // Remove: import ... from 'react' (React is a global in the harness)
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

/**
 * Builds a self-contained React harness that loads React 18 + Babel from
 * bundled vendor files served from the app's own origin.
 *
 * `baseUrl` should be `window.location.origin + '/'`:
 *   dev:  "http://localhost:1420/"
 *   prod: "tauri://localhost/"
 *
 * Files must exist at public/vendor/:
 *   react.production.min.js
 *   react-dom.production.min.js
 *   babel.min.js
 */
export function buildReactHarness(source: string, baseUrl: string): string {
  const processedSource = preprocessReactSource(source)
  const escapedSource = processedSource.replace(/<\/script>/gi, '<\\/script>')

  const vendor = (file: string) => `${baseUrl}vendor/${file}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    ${BASE_STYLES}
    #__err { color: #dc2626; background: #fef2f2; padding: 1rem; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; border-radius: 6px; margin: 1rem; }
  </style>
  <script src="${vendor('react.production.min.js')}"></script>
  <script src="${vendor('react-dom.production.min.js')}"></script>
  <script src="${vendor('babel.min.js')}"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
// Make all common React APIs available as globals so models can use
// destructured hooks (useState, useEffect, etc.) without imports.
const {
  useState, useEffect, useCallback, useMemo, useRef,
  useContext, useReducer, createContext, forwardRef, memo,
  Fragment, Children, cloneElement, createElement, isValidElement,
} = React;

try {
${escapedSource}

  const AppComponent = (typeof App !== 'undefined' && App) || null;
  if (!AppComponent) {
    throw new Error(
      'No App component found.\\n\\nDefine a function named App:\\n\\n  function App() {\\n    return <div>Hello</div>;\\n  }'
    );
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(AppComponent)
  );
} catch (e) {
  const el = document.createElement('div');
  el.id = '__err';
  el.textContent = String(e.message);
  document.getElementById('root').replaceWith(el);
  window.parent.postMessage({ type: 'artifact-error', message: String(e.message), stack: String(e.stack) }, '*');
}
  </script>
  ${ERROR_REPORTER}
</body>
</html>`
}

export function buildChartJsHarness(source: string, baseUrl: string): string {
  const escaped = source.replace(/<\/script>/gi, '<\\/script>')
  const vendor = (file: string) => `${baseUrl}vendor/${file}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    ${BASE_STYLES}
    html, body { height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    canvas { max-width: 100%; max-height: 100vh; }
    #__err { color: #dc2626; background: #fef2f2; padding: 1rem; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; border-radius: 6px; margin: 1rem; }
  </style>
</head>
<body>
  <canvas id="chart"></canvas>
  ${ERROR_REPORTER}
  <script src="${vendor('chart.umd.min.js')}"></script>
  <script>
try {
  const config = eval('(' + ${JSON.stringify(escaped)} + ')');
  const canvas = document.getElementById('chart');
  new Chart(canvas, config);
} catch (e) {
  const el = document.createElement('div');
  el.id = '__err';
  el.textContent = String(e.message);
  document.getElementById('chart').replaceWith(el);
  window.parent.postMessage({ type: 'artifact-error', message: String(e.message), stack: String(e.stack) }, '*');
}
  </script>
</body>
</html>`
}

export function buildVegaHarness(source: string, baseUrl: string): string {
  const escaped = source.replace(/<\/script>/gi, '<\\/script>')
  const vendor = (file: string) => `${baseUrl}vendor/${file}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    ${BASE_STYLES}
    html, body { height: 100%; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    #vis { width: 100%; }
    #__err { color: #dc2626; background: #fef2f2; padding: 1rem; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; border-radius: 6px; margin: 1rem; }
  </style>
</head>
<body>
  <div id="vis"></div>
  ${ERROR_REPORTER}
  <script src="${vendor('vega.min.js')}"></script>
  <script src="${vendor('vega-lite.min.js')}"></script>
  <script src="${vendor('vega-embed.min.js')}"></script>
  <script>
try {
  const spec = JSON.parse(${JSON.stringify(escaped)});
  vegaEmbed('#vis', spec, { actions: false });
} catch (e) {
  const el = document.createElement('div');
  el.id = '__err';
  el.textContent = String(e.message);
  document.getElementById('vis').replaceWith(el);
  window.parent.postMessage({ type: 'artifact-error', message: String(e.message), stack: String(e.stack) }, '*');
}
  </script>
</body>
</html>`
}

export function buildHarness(type: ArtifactType, source: string, baseUrl?: string): string {
  const base = baseUrl ?? window.location.origin + '/'
  switch (type) {
    case 'html': return buildHtmlHarness(source)
    case 'svg': return buildSvgHarness(source)
    case 'react': return buildReactHarness(source, base)
    case 'chartjs': return buildChartJsHarness(source, base)
    case 'vega': return buildVegaHarness(source, base)
  }
}
