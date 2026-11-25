export function localTimezone(): string | undefined {
  // Bun on Windows can ignore TZ when choosing its default timezone.
  for (const timeZone of [process.env.TZ, undefined]) {
    try {
      const zone = Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().timeZone;
      if (zone === "UTC" || zone.includes("/")) {
        return zone;
      }
    } catch {
      // Fall back to the system timezone if Intl does not recognize the override.
    }
  }
  return undefined;
}
