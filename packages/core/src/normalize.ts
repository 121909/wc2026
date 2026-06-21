export function normalizeChannelName(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  return url.toString();
}
