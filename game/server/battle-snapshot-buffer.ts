import type { BattleEntitySnapshot, BattleSnapshot } from "@spacey/protocol";

export const BATTLE_INTERPOLATION_DELAY_MS = 100;
export const MAX_BUFFERED_BATTLE_SNAPSHOTS = 12;

export type ReceivedBattleSnapshot = {
  receivedAt: number;
  snapshot: BattleSnapshot;
};

export class BattleSnapshotBuffer {
  private received: ReceivedBattleSnapshot[] = [];

  push(snapshot: BattleSnapshot, receivedAt: number): void {
    this.received = [
      ...this.received.slice(-(MAX_BUFFERED_BATTLE_SNAPSHOTS - 1)),
      { receivedAt, snapshot },
    ];
  }

  clear(): void {
    this.received = [];
  }

  latestSnapshot(): BattleSnapshot | null {
    return this.received.at(-1)?.snapshot ?? null;
  }

  interpolatedEntities(now: number): BattleEntitySnapshot[] {
    if (this.received.length === 0) return [];
    const { older, newer, alpha } = interpolationPair(
      this.received,
      now - BATTLE_INTERPOLATION_DELAY_MS,
    );
    const newerById = new Map(newer.snapshot.entities.map((entity) => [entity.id, entity]));
    const entities = older.snapshot.entities.map((entity) => interpolateEntity(
      entity,
      newerById.get(entity.id) ?? entity,
      alpha,
    ));
    const existingIds = new Set(entities.map((entity) => entity.id));
    for (const entity of newer.snapshot.entities) {
      if (!existingIds.has(entity.id)) entities.push(entity);
    }
    return entities;
  }
}

function interpolationPair(received: ReceivedBattleSnapshot[], targetTime: number) {
  let older = received[0]!;
  let newer = received[received.length - 1]!;
  for (let index = 1; index < received.length; index += 1) {
    const candidate = received[index]!;
    if (candidate.receivedAt >= targetTime) {
      newer = candidate;
      older = received[index - 1] ?? candidate;
      break;
    }
    older = candidate;
  }
  const span = newer.receivedAt - older.receivedAt;
  const alpha = span > 0 ? clamp((targetTime - older.receivedAt) / span, 0, 1) : 1;
  return { older, newer, alpha };
}

function interpolateEntity(
  previous: BattleEntitySnapshot,
  next: BattleEntitySnapshot,
  alpha: number,
): BattleEntitySnapshot {
  return {
    ...next,
    xMilli: lerp(previous.xMilli, next.xMilli, alpha),
    yMilli: lerp(previous.yMilli, next.yMilli, alpha),
    rotationMilliRadians: interpolateAngleMilliRadians(
      previous.rotationMilliRadians,
      next.rotationMilliRadians,
      alpha,
    ),
  };
}

function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

function interpolateAngleMilliRadians(from: number, to: number, alpha: number) {
  const fullTurn = Math.PI * 2 * 1_000;
  const halfTurn = fullTurn / 2;
  const delta = ((to - from + halfTurn) % fullTurn + fullTurn) % fullTurn - halfTurn;
  return from + delta * alpha;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
