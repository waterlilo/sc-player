/**
 * Builds that can't replace themselves are only told a new version exists (with a link to the release):
 * - a portable Windows .exe;
 * - macOS — the app isn't signed with an Apple certificate, and Squirrel.Mac refuses unsigned updates;
 * - Linux, except an AppImage (a .deb belongs to the package manager).
 */
export function isPortableRelease(platform = process.platform, isPortableEnv = !!process.env.PORTABLE_EXECUTABLE_DIR, isAppImage = !!process.env.APPIMAGE): boolean {
  return platform === "darwin" || isPortableEnv || (platform === "linux" && !isAppImage);
}
