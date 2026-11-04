/**
 * On macOS, unsigned/ad-hoc signed .app packages cannot be silently updated by Squirrel.Mac.
 * Treating macOS like portable Windows releases tells the user a new version exists and gives
 * them a link to the release DMG without triggering signature rejection errors.
 */
export function isPortableRelease(platform = process.platform, isPortableEnv = !!process.env.PORTABLE_EXECUTABLE_DIR): boolean {
  return platform === "darwin" || isPortableEnv;
}
