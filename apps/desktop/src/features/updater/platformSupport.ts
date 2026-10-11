export function isWindowsDesktopUpdaterSupported(
  isTauriRuntime: boolean,
  userAgent: string,
): boolean {
  return isTauriRuntime && /Windows NT|Windows/i.test(userAgent);
}
