/** Shared rule for persisted evidence and clickable public source links. */
export function officialJudicialUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/(?:^|\.)(?:[a-z0-9-]+\.)+(?:jus|gov|mp|leg)\.br$/i.test(url.hostname)) return null;
    return url.href;
  } catch {return null;}
}
