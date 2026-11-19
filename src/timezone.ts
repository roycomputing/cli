export function localTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone === "UTC" || zone.includes("/") ? zone : undefined;
  } catch {
    return undefined;
  }
}
