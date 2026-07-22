const extensionFailureToastShown = new Set<string>()

export function resetExtensionFailureToastState() {
  extensionFailureToastShown.clear()
}

export function takeExtensionFailureToast(name: string): boolean {
  if (extensionFailureToastShown.has(name)) return false
  extensionFailureToastShown.add(name)
  return true
}
