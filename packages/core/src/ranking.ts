import type { ChannelCandidate, ChannelGroup, ProbeResult } from "@m3u-mixer/shared";

function compareProbe(a: ProbeResult, b: ProbeResult): number {
  if (a.available !== b.available) {
    return a.available ? -1 : 1;
  }
  if (a.continuousAvailableSeconds !== b.continuousAvailableSeconds) {
    return b.continuousAvailableSeconds - a.continuousAvailableSeconds;
  }
  if (a.successRate24h !== b.successRate24h) {
    return b.successRate24h - a.successRate24h;
  }
  const latencyA = a.startupLatencyMs ?? Number.MAX_SAFE_INTEGER;
  const latencyB = b.startupLatencyMs ?? Number.MAX_SAFE_INTEGER;
  if (latencyA !== latencyB) {
    return latencyA - latencyB;
  }
  return 0;
}

export function sortCandidates(candidates: ChannelCandidate[]): ChannelCandidate[] {
  return [...candidates].sort((left, right) => {
    const probeOrder = compareProbe(left.probe, right.probe);
    if (probeOrder !== 0) {
      return probeOrder;
    }
    return left.streamUrl.localeCompare(right.streamUrl);
  });
}

export function sortGroups(groups: ChannelGroup[]): ChannelGroup[] {
  return [...groups].sort((left, right) => {
    if (left.aggregateHealth.available !== right.aggregateHealth.available) {
      return left.aggregateHealth.available ? -1 : 1;
    }
    if (left.aggregateHealth.continuousAvailableSeconds !== right.aggregateHealth.continuousAvailableSeconds) {
      return right.aggregateHealth.continuousAvailableSeconds - left.aggregateHealth.continuousAvailableSeconds;
    }
    if (left.aggregateHealth.successRate24h !== right.aggregateHealth.successRate24h) {
      return right.aggregateHealth.successRate24h - left.aggregateHealth.successRate24h;
    }
    const latencyLeft = left.aggregateHealth.bestStartupLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const latencyRight = right.aggregateHealth.bestStartupLatencyMs ?? Number.MAX_SAFE_INTEGER;
    if (latencyLeft !== latencyRight) {
      return latencyLeft - latencyRight;
    }
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}
