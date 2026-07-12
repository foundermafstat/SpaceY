export function isCheckpointTick(sessionId: string, tick: number, intervalTicks: number): boolean {
  if (intervalTicks <= 0) return false;
  return tick % intervalTicks === checkpointOffset(sessionId, intervalTicks);
}

export function checkpointOffset(sessionId: string, intervalTicks: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % intervalTicks;
}
