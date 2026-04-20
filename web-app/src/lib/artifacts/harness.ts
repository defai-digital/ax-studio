import { transformJSX } from './transform'

export type ArtifactType = 'html' | 'react' | 'svg' | 'chartjs' | 'vega'

// Permissive CSP for the srcdoc iframe — allows inline scripts and eval.
// WKWebView (Tauri/macOS) inherits the parent page's strict CSP inside srcdoc
// frames; this meta tag overrides it so vendor scripts and user code can run.
const IFRAME_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' blob: data:;">`

const ERROR_REPORTER = `
<script>
  var _po = location.ancestorOrigins && location.ancestorOrigins[0] ? location.ancestorOrigins[0] : '*';
  window.onerror = function(msg, src, line, col, err) {
    window.parent.postMessage(
      { type: 'artifact-error', message: String(msg), stack: err ? String(err.stack) : '' },
      _po
    );
  };
  window.addEventListener('unhandledrejection', function(e) {
    window.parent.postMessage(
      { type: 'artifact-error', message: String(e.reason), stack: '' },
      _po
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
const pendingVendorFetches = new Map<string, Promise<string>>()

async function fetchVendor(baseUrl: string, file: string): Promise<string> {
  const url = `${baseUrl}vendor/${file}`
  const cached = vendorCache.get(url)
  if (cached) return cached

  // Deduplicate concurrent fetches for the same URL
  const pending = pendingVendorFetches.get(url)
  if (pending) return pending

  const promise = (async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to load vendor script ${file} (HTTP ${res.status})`)
    const text = await res.text()
    vendorCache.set(url, text)
    return text
  })()

  pendingVendorFetches.set(url, promise)
  try {
    return await promise
  } finally {
    pendingVendorFetches.delete(url)
  }
}

// ---------------------------------------------------------------------------
// HTML harness (no vendor scripts needed)
// ---------------------------------------------------------------------------
export function buildHtmlHarness(source: string): string {
  const trimmed = source.trim()
  const isFullDoc = /^<!DOCTYPE\s+html/i.test(trimmed) || /^<html/i.test(trimmed)

  if (isFullDoc) {
    // Inject IFRAME_CSP as the very first child of <head> (before any scripts or
    // stylesheets) so WKWebView's CSP is overridden before any resource loads.
    let doc = trimmed
    const headOpenMatch = doc.match(/<head[^>]*>/i)
    if (headOpenMatch && headOpenMatch.index !== undefined) {
      const insertAt = headOpenMatch.index + headOpenMatch[0].length
      doc = doc.slice(0, insertAt) + '\n  ' + IFRAME_CSP + doc.slice(insertAt)
    } else {
      // No <head> tag at all — inject after <html> open or after <!DOCTYPE>
      doc = doc.replace(/(<html[^>]*>)/i, `$1\n<head>\n  ${IFRAME_CSP}\n</head>`)
    }
    // Inject error reporter before </body>
    const bodyClose = doc.lastIndexOf('</body>')
    if (bodyClose !== -1) {
      return doc.slice(0, bodyClose) + '\n' + ERROR_REPORTER + '\n' + doc.slice(bodyClose)
    }
    return doc + '\n' + ERROR_REPORTER
  }

  return `<!DOCTYPE html>
<html lang="en" style="background:#fff;color-scheme:light;">
<head>
  <meta charset="utf-8">
  ${IFRAME_CSP}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>${BASE_STYLES} html{background:#fff;color-scheme:light;} body{background:#fff;}</style>
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
 * Fixes string literals that were accidentally split across multiple lines by
 * the model. A newline inside a JS string literal is ALWAYS a syntax error, so
 * it is always safe to join the broken line with the next one.
 *
 * Processes line-by-line to avoid false positives from apostrophes in comments
 * (e.g. `// player doesn't overshoot`) and JSX text (`I'm`).
 * Only attempts to join when a line ends with an unmatched quote that isn't
 * inside a `//` comment.
 */
function joinMultilineStrings(source: string): string {
  const lines = source.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Check for unclosed double-quoted string at end of line (not inside a // comment)
    const dqMatch = findUnclosedQuote(line, '"')
    if (dqMatch !== -1 && i + 1 < lines.length) {
      // Join with the next line and re-check (cascaded wraps)
      lines[i + 1] = line + ' ' + lines[i + 1].trimStart()
      i++
      continue
    }

    // Check for unclosed single-quoted string at end of line (not inside a // comment)
    const sqMatch = findUnclosedQuote(line, "'")
    if (sqMatch !== -1 && i + 1 < lines.length) {
      lines[i + 1] = line + ' ' + lines[i + 1].trimStart()
      i++
      continue
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

/**
 * Returns the position of an unclosed target-quote at the end of a line,
 * or -1 if no unclosed string of that type is found.
 *
 * Tracks ALL string types (single, double, backtick) so a `'` inside `"it's"`
 * is correctly recognized as being inside a double-quoted string.
 * Skips `//` comments and uses a JSX heuristic for apostrophes in text.
 */
function findUnclosedQuote(line: string, quote: string): number {
  let inString: string | null = null // Current string delimiter (' or " or `)
  let escaped = false
  let openPos = -1 // Position where the unclosed target-quote opened

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      escaped = true
      continue
    }

    // Skip // comments (only outside strings)
    if (!inString && ch === '/' && i + 1 < line.length && line[i + 1] === '/') {
      break // Everything after // is a comment — no real strings here
    }

    // Track ALL string types so cross-quote context is correct
    if (!inString && (ch === '"' || ch === "'" || ch === '`')) {
      inString = ch
      if (ch === quote) openPos = i
    } else if (inString && ch === inString) {
      inString = null
      if (ch === quote) openPos = -1 // Target quote was properly closed
    }
  }

  // Only report if the unclosed string is of the target quote type
  if (inString !== quote || openPos === -1) {
    return -1
  }

  // Heuristic: if text after the opening quote contains JSX tag markers
  // (< or >), it's likely an apostrophe in JSX text, not a real string.
  // e.g. <p>I'm happy</p> — the ' in I'm is not a string delimiter.
  const afterQuote = line.slice(openPos + 1)
  if (afterQuote.includes('>') || afterQuote.includes('<')) {
    return -1
  }

  return openPos
}

/**
 * Fix PascalCase JavaScript keywords and JSX HTML tags that small models produce.
 *
 * Small LLMs often generate `Const`, `Function`, `Return` instead of lowercase
 * keywords, and `<Div>`, `<Button>` instead of `<div>`, `<button>`. In JSX,
 * capitalized tags are interpreted as component references (which don't exist),
 * and PascalCase keywords are syntax errors.
 */
function fixPascalCaseKeywordsAndTags(source: string): string {
  // --- Fix JS keywords: Const → const, Function → function, etc. ---
  // Only fix at word boundaries to avoid mangling identifiers like "Constructor"
  const JS_KEYWORDS: Record<string, string> = {
    Const: 'const', Let: 'let', Var: 'var',
    Function: 'function', Return: 'return',
    If: 'if', Else: 'else', For: 'for', While: 'while',
    Switch: 'switch', Case: 'case', Break: 'break', Continue: 'continue',
    Throw: 'throw', Try: 'try', Catch: 'catch', Finally: 'finally',
    New: 'new', Delete: 'delete', Typeof: 'typeof', Instanceof: 'instanceof',
    Void: 'void', In: 'in', Of: 'of',
    True: 'true', False: 'false', Null: 'null', Undefined: 'undefined',
    Class: 'class', Extends: 'extends', Super: 'super', This: 'this',
    Import: 'import', Export: 'export', Default: 'default', From: 'from',
    Async: 'async', Await: 'await', Yield: 'yield',
  }
  // Build one regex: \b(Const|Let|Var|...)\b
  const kwPattern = new RegExp(
    `\\b(${Object.keys(JS_KEYWORDS).join('|')})\\b`,
    'g'
  )
  let result = source.replace(kwPattern, (m) => JS_KEYWORDS[m] ?? m)

  // --- Fix JSX HTML tags: <Div> → <div>, </Button> → </button>, etc. ---
  // Standard HTML elements that models capitalize. Only fix known safe tags
  // to avoid lowercasing actual component names like <MyComponent>.
  const HTML_TAGS = new Set([
    'Div', 'Span', 'P', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'Ul', 'Ol', 'Li', 'Table', 'Tr', 'Td', 'Th', 'Thead', 'Tbody',
    'Form', 'Input', 'Button', 'Textarea', 'Select', 'Option', 'Label',
    'Img', 'Video', 'Audio', 'Canvas', 'Svg', 'Path',
    'Header', 'Footer', 'Nav', 'Main', 'Section', 'Article', 'Aside',
    'Strong', 'Em', 'Code', 'Pre', 'Br', 'Hr',
  ])
  // Match opening/closing JSX tags: <Div, </Div, <Button, </Button, <H1, </H1
  // Build a regex from the known tag set to avoid matching real component names
  const tagAlternation = [...HTML_TAGS].join('|')
  const tagPattern = new RegExp(`<(\\/?)(${tagAlternation})(\\s|>|\\/)`, 'g')
  result = result.replace(
    tagPattern,
    (_match, slash: string, tag: string, after: string) =>
      `<${slash}${tag.toLowerCase()}${after}`
  )

  // --- Fix common React hook casing: UseState → useState, UseEffect → useEffect ---
  result = result
    .replace(/\bUseState\b/g, 'useState')
    .replace(/\bUseEffect\b/g, 'useEffect')
    .replace(/\bUseCallback\b/g, 'useCallback')
    .replace(/\bUseMemo\b/g, 'useMemo')
    .replace(/\bUseRef\b/g, 'useRef')
    .replace(/\bUseContext\b/g, 'useContext')
    .replace(/\bUseReducer\b/g, 'useReducer')
    .replace(/\bSetState\b/g, 'setState')

  // --- Fix PascalCase JSX attributes: ClassName → className, OnClick → onClick ---
  result = result
    .replace(/\bClassName\b/g, 'className')
    .replace(/\bOnClick\b/g, 'onClick')
    .replace(/\bOnChange\b/g, 'onChange')
    .replace(/\bOnSubmit\b/g, 'onSubmit')
    .replace(/\bOnKeyDown\b/g, 'onKeyDown')
    .replace(/\bOnKeyUp\b/g, 'onKeyUp')
    .replace(/\bOnMouseOver\b/g, 'onMouseOver')
    .replace(/\bOnMouseOut\b/g, 'onMouseOut')
    .replace(/\bOnFocus\b/g, 'onFocus')
    .replace(/\bOnBlur\b/g, 'onBlur')
    .replace(/\bHtmlFor\b/g, 'htmlFor')
    .replace(/\bTabIndex\b/g, 'tabIndex')

  // --- Fix common global references: Document → document, Console → console ---
  result = result
    .replace(/\bDocument\b/g, 'document')
    .replace(/\bConsole\b/g, 'console')
    .replace(/\bWindow\b/g, 'window')

  return result
}

/**
 * Strips ES module syntax that breaks non-module execution.
 *
 * Uses a line-based state machine to handle multiline imports like:
 *   import {
 *     useState,
 *     useEffect
 *   } from 'react';
 */
export function preprocessReactSource(source: string): string {
  const joined = joinMultilineStrings(source)

  // --- Phase 0: Fix PascalCase keywords/tags from small models ---
  const caseFixed = fixPascalCaseKeywordsAndTags(joined)

  // --- Phase 1: Remove import statements (including multiline) ---
  const lines = caseFixed.split('\n')
  const output: string[] = []
  let inMultilineImport = false

  for (const line of lines) {
    const trimmed = line.trimStart()

    // If we're inside a multiline import, skip lines until `from '...'`
    if (inMultilineImport) {
      if (/\bfrom\s+['"][^'"]+['"]\s*;?\s*$/.test(trimmed)) {
        inMultilineImport = false // closing line of multiline import
      }
      continue // skip this line (part of import)
    }

    // Single-line import: import ... from '...'
    if (/^\s*import\s+.*?\s+from\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) {
      continue
    }
    // Side-effect import: import '...'
    if (/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(line)) {
      continue
    }
    // Start of multiline import: `import {` or `import type {` without `from` on same line
    if (/^\s*import\s+(?:type\s+)?\{/.test(line) && !/\bfrom\s+['"]/.test(line)) {
      inMultilineImport = true
      continue
    }
    // Catch-all: any remaining `import` at line start that isn't dynamic import()
    // This handles edge cases like indented imports or unusual formatting
    if (/^\s*import\s+[^(]/.test(trimmed) && /\bfrom\s+['"]/.test(trimmed)) {
      continue
    }

    output.push(line)
  }

  return output.join('\n')
    // --- Phase 2: Strip export syntax ---
    // Convert: export default function App(...) → function App(...)
    .replace(/\bexport\s+default\s+function\s+(\w+)/g, 'function $1')
    // Convert: export default class App → class App
    .replace(/\bexport\s+default\s+class\s+(\w+)/g, 'class $1')
    // Convert: export default <identifier> → const App = <identifier>
    // Skip when identifier is already "App" to avoid "const App = App" self-reference
    .replace(/\bexport\s+default\s+(\w+)\s*;?/g, (_, name) => name === 'App' ? '' : `const App = ${name};`)
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
  tailwindJs: string,
): string {
  const escaped = transformedSource.replace(/<\/script>/gi, '<\\/script>')

  return `<!DOCTYPE html>
<html lang="en" style="background:#fff;color-scheme:light;">
<head>
  <meta charset="utf-8">
  ${IFRAME_CSP}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${ERROR_REPORTER}
  <style>${BASE_STYLES} html,body{height:100%;background:#fff;color-scheme:light;} #root{min-height:100%;}</style>
  <script>${tailwindJs}${"<"}/script>
  <script>${reactJs}${"<"}/script>
  <script>${reactDomJs}${"<"}/script>
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
    window.parent.postMessage({ type: 'artifact-error', message: msg }, _po);
  }

  if (typeof React === 'undefined') { showErr('React failed to initialize'); return; }
  if (typeof ReactDOM === 'undefined') { showErr('ReactDOM failed to initialize'); return; }

  // Expose destructured React hooks and APIs as locals so user code can call them without import
  var useState = React.useState, useEffect = React.useEffect,
      useCallback = React.useCallback, useMemo = React.useMemo,
      useRef = React.useRef, useContext = React.useContext,
      useReducer = React.useReducer, createContext = React.createContext,
      forwardRef = React.forwardRef, memo = React.memo,
      Fragment = React.Fragment, Children = React.Children,
      cloneElement = React.cloneElement, createElement = React.createElement,
      isValidElement = React.isValidElement,
      Suspense = React.Suspense, lazy = React.lazy,
      useId = React.useId, useTransition = React.useTransition,
      useDeferredValue = React.useDeferredValue,
      startTransition = React.startTransition,
      createPortal = ReactDOM.createPortal;

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
  ${"<"}/script>
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
    html, body { height: 100%; background: #fff; color-scheme: light; }
    body { display: flex; align-items: center; justify-content: center; padding: 16px; }
    canvas { max-width: 100%; max-height: 90vh; }
  </style>
  <script>${chartJs}${"<"}/script>
</head>
<body>
  <canvas id="chart"></canvas>
  <script>
(function() {
  var ERR = '${ERR_STYLE}';
  function showErr(msg) {
    var el = document.createElement('div');
    el.style.cssText = ERR;
    el.textContent = msg;
    var canvas = document.getElementById('chart');
    if (canvas) canvas.replaceWith(el); else document.body.appendChild(el);
    window.parent.postMessage({ type: 'artifact-error', message: msg }, _po);
  }

  function isValidConfig(c) {
    return c && typeof c === 'object' && typeof c.type === 'string' && c.data && typeof c.data === 'object';
  }

  function extractConfig(source) {
    // Strategy 1: JSON.parse — safe for the overwhelming majority of
    // Chart.js configs which are pure JSON objects.
    try {
      var c0 = JSON.parse(source);
      if (isValidConfig(c0)) return c0;
    } catch(e) { console.warn('[Chart] JSON.parse failed:', e.message); }

    // Strategy 2: Fall back to a scoped Function evaluation for configs
    // that contain JS-only features (comments, function callbacks, trailing
    // commas). This runs inside the sandboxed iframe and the runtime has no
    // access to the outer app.
    try {
      var c1 = (new Function('return (' + source + ')'))();
      if (isValidConfig(c1)) return c1;
    } catch(e) { console.warn('[Chart] Function eval failed:', e.message); }

    // Strategy 3: Strip imports/exports/assignments, then try Function again
    var cleaned = source
      .replace(/^\\/\\/.*$/gm, '')
      .replace(/^\\/\\*[\\s\\S]*?\\*\\//gm, '')
      .replace(/^import\\b[^(].*$/gm, '')
      .replace(/^export\\s+default\\s+/gm, '')
      .replace(/^export\\s+(const|let|var)\\s+/gm, '$1 ')
      .replace(/^(const|let|var)\\s+\\w+\\s*=\\s*/gm, '')
      .replace(/;\\s*$/gm, '')
      .trim();
    if (cleaned) {
      try {
        var c2 = (new Function('return (' + cleaned + ')'))();
        if (isValidConfig(c2)) return c2;
      } catch(e) { console.warn('[Chart] Cleaned eval failed:', e.message); }
    }

    return null;
  }

  var source = ${JSON.stringify(escaped)};
  try {
    var config = extractConfig(source);
    if (!config) {
      showErr('Could not parse Chart.js config.\\nExpected an object like: { type: "bar", data: { labels: [...], datasets: [...] } }');
      return;
    }
    new Chart(document.getElementById('chart'), config);
  } catch (e) {
    showErr(String(e.message));
  }
})();
  ${"<"}/script>
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
    html { background: #fff; color-scheme: light; }
    body { background: #fff; min-height: 100%; padding: 16px; overflow: auto; }
    #vis { width: 100%; }
  </style>
  <script>${vegaJs}${"<"}/script>
  <script>${vegaLiteJs}${"<"}/script>
  <script>${vegaEmbedJs}${"<"}/script>
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
    window.parent.postMessage({ type: 'artifact-error', message: msg }, _po);
  }

  var spec;
  try {
    spec = JSON.parse(${JSON.stringify(escaped)});
  } catch (e) {
    showErr('Invalid JSON in Vega-Lite spec: ' + String(e.message));
    return;
  }

  // --- normalizeSpec: fix common LLM mistakes before vegaEmbed() ---

  // Rule 1: Convert invalid "views" array to "vconcat" (Vega-Lite v5)
  if (spec.views && !spec.layer && !spec.hconcat && !spec.vconcat && !spec.concat) {
    spec.vconcat = spec.views;
    delete spec.views;
  }

  // Rule 2: Inherit parent mark into layer/concat children missing it
  function inheritMark(parent, key) {
    if (!Array.isArray(parent[key]) || !parent.mark) return;
    var parentMark = parent.mark;
    var anyMissing = false;
    parent[key].forEach(function(sub) {
      if (!sub.mark) { sub.mark = parentMark; anyMissing = true; }
    });
    if (anyMissing) delete parent.mark;
  }
  inheritMark(spec, 'layer');
  inheritMark(spec, 'vconcat');
  inheritMark(spec, 'hconcat');
  inheritMark(spec, 'concat');

  // Rule 3: Remove invalid encoding type values (let Vega-Lite auto-infer)
  var VALID_ENC_TYPES = { quantitative: 1, temporal: 1, ordinal: 1, nominal: 1 };
  function fixEncoding(enc) {
    if (!enc || typeof enc !== 'object') return;
    for (var ch in enc) {
      if (enc[ch] && typeof enc[ch] === 'object' && enc[ch].type && !VALID_ENC_TYPES[enc[ch].type]) {
        delete enc[ch].type;
      }
    }
  }
  fixEncoding(spec.encoding);
  ['layer', 'vconcat', 'hconcat', 'concat'].forEach(function(key) {
    if (Array.isArray(spec[key])) {
      spec[key].forEach(function(sub) { fixEncoding(sub.encoding); });
    }
  });

  // Rule 4: Migrate v4 select "multi" → v5 "point" with toggle
  if (Array.isArray(spec.params)) {
    spec.params.forEach(function(p) {
      if (p.select && p.select.type === 'multi') {
        p.select.type = 'point';
        if (p.select.toggle === undefined) p.select.toggle = true;
      }
    });
  }

  // Rule 5: Propagate root data to vconcat/hconcat/concat children missing it
  // (skip layer — Vega-Lite auto-inherits data in layers)
  ['vconcat', 'hconcat', 'concat'].forEach(function(key) {
    if (spec.data && Array.isArray(spec[key])) {
      spec[key].forEach(function(sub) {
        if (!sub.data) sub.data = spec.data;
      });
    }
  });

  // Rule 6: Fix object mark missing type
  if (spec.mark && typeof spec.mark === 'object' && !spec.mark.type) {
    spec.mark.type = 'point';
  }

  // --- end normalizeSpec ---

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
  ${"<"}/script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
      const [transformedSource, reactJs, reactDomJs, tailwindJs] = await Promise.all([
        transformJSX(processed, baseUrl),
        fetchVendor(baseUrl, 'react.production.min.js'),
        fetchVendor(baseUrl, 'react-dom.production.min.js'),
        fetchVendor(baseUrl, 'tailwind.min.js'),
      ])
      return buildReactHarnessInline(transformedSource, reactJs, reactDomJs, tailwindJs)
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

