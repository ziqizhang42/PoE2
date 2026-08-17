const COMPACT_NUMBER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Average throughput through the most recently completed search depth. */
export function calculateNodesPerSecond(nodes: number, elapsedMs: number): number | null {
  if (!Number.isFinite(nodes) || nodes < 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return null;
  }

  return Math.round((nodes * 1_000) / elapsedMs);
}

export function formatNodesPerSecond(nodesPerSecond: number): string {
  return COMPACT_NUMBER.format(nodesPerSecond);
}
