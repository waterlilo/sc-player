export function isMac(platform?: string): boolean {
  if (platform) return platform === "darwin";
  const g = globalThis as unknown as { process?: { platform?: string }; sky?: { platform?: string }; window?: { sky?: { platform?: string } }; navigator?: { userAgent?: string } };
  if (g.process?.platform) return g.process.platform === "darwin";
  if (g.sky?.platform) return g.sky.platform === "darwin";
  if (g.window?.sky?.platform) return g.window.sky.platform === "darwin";
  if (g.navigator?.userAgent) return /Macintosh|Mac OS X/.test(g.navigator.userAgent);
  return false;
}
