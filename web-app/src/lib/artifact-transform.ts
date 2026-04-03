/**
 * JSX → plain JS transformation using @babel/standalone.
 *
 * Babel is loaded lazily into the MAIN thread (not inside a sandboxed srcdoc
 * iframe) so it can be fetched via a normal <script> tag without sandbox
 * restrictions. The result is plain JS that the iframe runs without needing
 * Babel at all.
 */

let babelLoadPromise: Promise<void> | null = null

function loadBabel(baseUrl: string): Promise<void> {
  // Already loaded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Babel) return (babelLoadPromise = Promise.resolve())
  // Already loading
  if (babelLoadPromise) return babelLoadPromise

  babelLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${baseUrl}vendor/babel.min.js`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Babel — check /vendor/babel.min.js'))
    document.head.appendChild(script)
  })
  return babelLoadPromise
}

/**
 * Transform JSX source to plain JavaScript.
 * Loads Babel on first call and reuses it thereafter.
 */
export async function transformJSX(source: string, baseUrl: string): Promise<string> {
  await loadBabel(baseUrl)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Babel = (window as any).Babel
  const result = Babel.transform(source, {
    presets: [
      'react',
      // 'env' transforms modern JS (optional chaining, nullish coalescing, class fields, etc.)
      // to ES5 so it runs in the sandboxed iframe without syntax errors.
      // The bundled babel.min.js already includes preset-env — no bundle size increase.
      ['env', { targets: { esmodules: true }, modules: false }],
    ],
    filename: 'artifact.jsx',
  })
  return result.code as string
}
