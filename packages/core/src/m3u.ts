import { normalizeChannelName, normalizeUrl } from "./normalize";

export type ParsedM3uEntry = {
  name: string;
  normalizedName: string;
  streamUrl: string;
  normalizedUrl: string;
  attributes: Record<string, string>;
};

function parseAttributes(line: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const matches = line.matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g);
  for (const match of matches) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function parseM3u(content: string): ParsedM3uEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: ParsedM3uEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.startsWith("#EXTINF")) {
      continue;
    }
    const nextLine = lines[index + 1];
    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }
    const commaIndex = line.indexOf(",");
    const name = (commaIndex >= 0 ? line.slice(commaIndex + 1) : line).trim();
    const attributes = parseAttributes(line);
    const streamUrl = new URL(nextLine).toString();
    entries.push({
      name,
      normalizedName: normalizeChannelName(name),
      streamUrl,
      normalizedUrl: normalizeUrl(streamUrl),
      attributes
    });
  }

  return entries;
}
