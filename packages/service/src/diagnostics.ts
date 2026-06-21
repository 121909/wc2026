import type { DiagnosticsEntry } from "@m3u-mixer/shared";

export class DiagnosticsLog {
  private readonly entries: DiagnosticsEntry[] = [];

  push(level: DiagnosticsEntry["level"], message: string): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      level,
      message
    });
    if (this.entries.length > 1000) {
      this.entries.splice(0, this.entries.length - 1000);
    }
  }

  tail(limit: number): DiagnosticsEntry[] {
    return this.entries.slice(-limit);
  }
}
