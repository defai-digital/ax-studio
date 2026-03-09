import {
  defaultRehypePlugins as vendorDefaultRehypePlugins,
  Streamdown as VendorStreamdown,
} from 'streamdown'

// AX-owned markdown entrypoints isolate vendor-specific imports so the
// underlying renderer can be swapped without touching the rest of the app.
export const AXMarkdown = VendorStreamdown
export const axDefaultRehypePlugins = vendorDefaultRehypePlugins

