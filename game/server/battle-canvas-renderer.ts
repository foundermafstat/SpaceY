import type { BattleEntitySnapshot, BattleServerMessage } from "@spacey/protocol";
import type { BattleSnapshotBuffer } from "./battle-snapshot-buffer";

export type ReceivedBattlePresentationEvent = {
  event: Extract<BattleServerMessage, { type: "battle.event" }>;
  receivedAt: number;
};

export function drawBattleFrame(
  canvas: HTMLCanvasElement,
  snapshots: BattleSnapshotBuffer,
  events: readonly ReceivedBattlePresentationEvent[],
  now: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssWidth = width / dpr;
  const cssHeight = height / dpr;
  drawBackground(context, cssWidth, cssHeight, now);
  const entities = snapshots.interpolatedEntities(now);
  if (entities.length === 0) return;
  const snapshot = snapshots.latestSnapshot();
  if (!snapshot) return;
  const padding = 24;
  const scale = Math.max(0.000001, Math.min(
    (cssWidth - padding * 2) / snapshot.arenaWidthMilli,
    (cssHeight - padding * 2) / snapshot.arenaHeightMilli,
  ));
  const cameraX = snapshot.arenaWidthMilli / 2;
  const cameraY = snapshot.arenaHeightMilli / 2;
  for (const entity of entities) {
    drawEntity(context, entity, cssWidth / 2, cssHeight / 2, cameraX, cameraY, scale);
  }
  drawEvents(context, entities, events, now, cssWidth / 2, cssHeight / 2, cameraX, cameraY, scale);
}

function drawEvents(
  context: CanvasRenderingContext2D,
  entities: readonly BattleEntitySnapshot[],
  events: readonly ReceivedBattlePresentationEvent[],
  now: number,
  centerX: number,
  centerY: number,
  cameraX: number,
  cameraY: number,
  scale: number,
) {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  for (const item of events) {
    const age = now - item.receivedAt;
    if (age < 0 || age > 1_000) continue;
    const alpha = 1 - age / 1_000;
    const hue = presentationHue(item.event.eventType);
    const phase = ((item.event.eventId * 1103515245 + 12345) >>> 0) / 0xffffffff;
    for (const entityId of item.event.entityIds) {
      const entity = byId.get(entityId);
      if (!entity) continue;
      const x = centerX + (entity.xMilli - cameraX) * scale;
      const y = centerY + (entity.yMilli - cameraY) * scale;
      context.save();
      context.globalAlpha = alpha;
      context.strokeStyle = hue;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 16 + age * 0.035 + phase * 5, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
}

function presentationHue(eventType: string) {
  if (eventType.includes("shield")) return "#49d7ff";
  if (eventType.includes("detach")) return "#ffc857";
  if (eventType.includes("damage") || eventType.includes("hit")) return "#ff557e";
  return "#53e7a4";
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, now: number) {
  const gradient = context.createRadialGradient(
    width / 2,
    height / 2,
    10,
    width / 2,
    height / 2,
    Math.max(width, height),
  );
  gradient.addColorStop(0, "#0a1b2a");
  gradient.addColorStop(1, "#02050c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(73, 215, 255, 0.06)";
  context.lineWidth = 1;
  const grid = 42;
  const offset = (now * 0.003) % grid;
  for (let x = offset; x < width; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = offset; y < height; y += grid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawEntity(
  context: CanvasRenderingContext2D,
  entity: BattleEntitySnapshot,
  centerX: number,
  centerY: number,
  cameraX: number,
  cameraY: number,
  scale: number,
) {
  const x = centerX + (entity.xMilli - cameraX) * scale;
  const y = centerY + (entity.yMilli - cameraY) * scale;
  const radius = entity.kind === "player" ? 14 : entity.kind === "enemy" ? 11 : entity.kind === "projectile" ? 3 : 8;
  context.save();
  context.translate(x, y);
  context.rotate(entity.rotationMilliRadians / 1000);
  context.fillStyle = entity.kind === "player"
    ? "#49d7ff"
    : entity.kind === "enemy"
      ? "#ff557e"
      : entity.kind === "projectile"
        ? "#ffc857"
        : "#53e7a4";
  context.shadowColor = context.fillStyle;
  context.shadowBlur = entity.kind === "projectile" ? 12 : 18;
  context.beginPath();
  if (entity.kind === "player") {
    context.moveTo(radius, 0);
    context.lineTo(-radius * 0.75, radius * 0.65);
    context.lineTo(-radius * 0.45, 0);
    context.lineTo(-radius * 0.75, -radius * 0.65);
  } else {
    context.arc(0, 0, radius, 0, Math.PI * 2);
  }
  context.closePath();
  context.fill();
  context.restore();

  if (entity.hullMax > 0 && entity.kind !== "projectile") {
    const ratio = clamp(entity.hull / entity.hullMax, 0, 1);
    context.fillStyle = "rgba(3, 8, 18, 0.9)";
    context.fillRect(x - 15, y + radius + 6, 30, 3);
    context.fillStyle = ratio > 0.35 ? "#53e7a4" : "#ff557e";
    context.fillRect(x - 15, y + radius + 6, 30 * ratio, 3);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
