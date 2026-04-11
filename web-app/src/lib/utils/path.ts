/**
 * Determines if the given path is a root directory.
 *
 * On Windows, this checks for drive roots such as `C:\` or `D:\`.
 * On Mac/Linux, this checks if the path is `/`.
 *
 * @param selectedNewPath - The path to check.
 * @returns `true` if the path is a root directory, otherwise `false`.
 */
export const isRootDir = (selectedNewPath: string) => {
  // Windows root: C:\, D:\, etc.
  if (IS_WINDOWS) {
    return /^[a-zA-Z]:\\?$/.test(selectedNewPath)
  }
  // Linux/Mac: only block the actual filesystem root
  const normalized =
    selectedNewPath.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return normalized === '/'
}
