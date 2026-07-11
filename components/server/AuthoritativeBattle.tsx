"use client";

import type { BattleConnectionDto, MissionCatalogItemDto } from "@spacey/contracts";
import {
  BATTLE_PROTOCOL_VERSION,
  BattleActionFlag,
  INPUT_AXIS_SCALE,
  type BattleEntitySnapshot,
  type BattleServerMessage,
  type BattleSnapshot
} from "@spacey/protocol";
import { useEffect, useRef, useState } from "react";
import { reconnectMissionAttempt } from "@/game/server/api-client";
import {
  decodeBattleServerMessage,
  encodeBattleClientMessage
} from "@/game/server/battle-protobuf";

type BattleEndedMessage = Extract<BattleServerMessage, { type: "battle.ended" }>;
type ConnectionState = "connecting" | "live" | "reconnecting" | "ended" | "error";

type ReceivedSnapshot = {
  receivedAt: number;
  snapshot: BattleSnapshot;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  pointerX: number;
  pointerY: number;
  pointerActive: boolean;
};

const EMPTY_INPUT: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  pointerX: 0,
  pointerY: 0,
  pointerActive: false
};

const INTERPOLATION_DELAY_MS = 100;
const INPUT_INTERVAL_MS = 1000 / 30;

export function AuthoritativeBattle({
  connection,
  mission,
  requestReconnect,
  onEnded
}: {
  connection: BattleConnectionDto;
  mission?: MissionCatalogItemDto;
  requestReconnect?: () => Promise<BattleConnectionDto>;
  onEnded: (result: BattleEndedMessage) => void;
}) {
  const presentation = mission ?? {
    type: "PVP",
    name: "Ranked Duel",
    objective: { label: "Destroy opponent", target: 1 }
  };
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotsRef = useRef<ReceivedSnapshot[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<InputState>({ ...EMPTY_INPUT });
  const sequenceRef = useRef(0);
  const lastAcknowledgedSequenceRef = useRef(0);
  const latestServerTickRef = useRef(0);
  const endedRef = useRef(false);
  const liveRef = useRef(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [sessionMessage, setSessionMessage] = useState("Awaiting authoritative snapshot…");
  const [hud, setHud] = useState({ tick: 0, progress: 0, target: presentation.objective.target, hull: 0, hullMax: 0 });

  useEffect(() => {
    if (connection.protocolVersion !== BATTLE_PROTOCOL_VERSION) {
      setConnectionState("error");
      setSessionMessage(`Unsupported battle protocol: ${connection.protocolVersion}`);
      return;
    }

    let stopped = false;
    let fatal = false;
    let reconnectAttempts = 0;
    let reconnectDeadline = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let decodeQueue = Promise.resolve();

    const acceptSnapshot = (snapshot: BattleSnapshot) => {
      latestServerTickRef.current = snapshot.tick;
      lastAcknowledgedSequenceRef.current = Math.max(
        lastAcknowledgedSequenceRef.current,
        snapshot.lastProcessedInputSequence
      );
      sequenceRef.current = Math.max(sequenceRef.current, snapshot.lastProcessedInputSequence);
      const receivedAt = performance.now();
      snapshotsRef.current = [...snapshotsRef.current.slice(-11), { receivedAt, snapshot }];
      const player = snapshot.entities.find((entity) => entity.kind === "player");
      setHud({
        tick: snapshot.tick,
        progress: snapshot.objective.progress,
        target: snapshot.objective.target,
        hull: player?.hull ?? 0,
        hullMax: player?.hullMax ?? 0
      });
    };

    const handleMessage = (message: BattleServerMessage, socket: WebSocket) => {
      if (message.type === "battle.initial") {
        if (message.protocolVersion !== BATTLE_PROTOCOL_VERSION) {
          fatal = true;
          socket.close(4400, "protocol mismatch");
          throw new Error(`Battle worker selected unsupported protocol ${message.protocolVersion}.`);
        }
        reconnectAttempts = 0;
        reconnectDeadline = 0;
        setConnectionState("live");
        liveRef.current = true;
        setSessionMessage(message.mode === "pvp" && message.participant
          ? `Live · server authoritative PvP · side ${message.participant.side + 1}`
          : "Live · server authoritative");
        acceptSnapshot(message.snapshot);
        return;
      }
      if (message.type === "battle.snapshot") {
        acceptSnapshot(message.snapshot);
        return;
      }
      if (message.type === "battle.event") {
        setSessionMessage(formatEvent(message.eventType));
        return;
      }
      if (message.type === "battle.ended") {
        endedRef.current = true;
        setConnectionState("ended");
        setSessionMessage("Result finalized by battle worker");
        onEnded(message);
        socket.close(1000, "battle ended");
        return;
      }
      if (message.type === "session.error") {
        setSessionMessage(message.message);
        if (!message.retryable) {
          fatal = true;
          setConnectionState("error");
          socket.close(4400, message.code);
        }
      }
    };

    const scheduleReconnect = () => {
      if (stopped || fatal || endedRef.current || reconnectTimer) return;
      reconnectDeadline ||= Date.now() + 60_000;
      if (Date.now() >= reconnectDeadline) {
        fatal = true;
        setConnectionState("error");
        setSessionMessage("The 60 second reconnect window expired.");
        return;
      }
      setConnectionState("reconnecting");
      setSessionMessage("Reconnecting to authoritative session…");
      const delay = Math.min(5_000, 500 * 2 ** Math.min(reconnectAttempts, 4));
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        const reconnectRequest = requestReconnect
          ?? (connection.mode === "pve" ? () => reconnectMissionAttempt(connection.attemptId) : null);
        if (!reconnectRequest) {
          fatal = true;
          setConnectionState("error");
          setSessionMessage("PvP reconnect requires a fresh participant ticket.");
          return;
        }
        void reconnectRequest().then(connect).catch((error: unknown) => {
          if (stopped || endedRef.current) return;
          setSessionMessage(error instanceof Error ? error.message : "Reconnect ticket unavailable.");
          scheduleReconnect();
        });
      }, delay);
    };

    const connect = (nextConnection: BattleConnectionDto) => {
      if (stopped || endedRef.current) return;
      if (nextConnection.protocolVersion !== BATTLE_PROTOCOL_VERSION) {
        fatal = true;
        setConnectionState("error");
        setSessionMessage("Battle protocol mismatch.");
        return;
      }
      liveRef.current = false;

      const socket = new WebSocket(nextConnection.websocketUrl, [
        BATTLE_PROTOCOL_VERSION,
        `ticket.${nextConnection.ticket}`
      ]);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        socket.send(encodeBattleClientMessage({
          type: "session.resume",
          lastAcknowledgedInputSequence: lastAcknowledgedSequenceRef.current
        }));
      };
      socket.onmessage = (event) => {
        decodeQueue = decodeQueue.then(async () => {
          const bytes = await readBinaryMessage(event.data);
          const message = decodeBattleServerMessage(bytes);
          if (!stopped && socket === socketRef.current) handleMessage(message, socket);
        }).catch((error: unknown) => {
          if (stopped) return;
          fatal = true;
          setConnectionState("error");
          setSessionMessage(error instanceof Error ? error.message : "Invalid battle message.");
          socket.close(4400, "invalid protobuf payload");
        });
      };
      socket.onerror = () => {
        if (!stopped) setSessionMessage("Battle stream interrupted.");
      };
      socket.onclose = () => {
        if (socket === socketRef.current) {
          liveRef.current = false;
          socketRef.current = null;
          scheduleReconnect();
        }
      };
    };

    const connectTimer = window.setTimeout(() => connect(connection), 0);
    return () => {
      stopped = true;
      window.clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      liveRef.current = false;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "battle view closed");
    };
  }, [connection, onEnded, requestReconnect]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") inputRef.current.up = pressed;
      else if (key === "s" || key === "arrowdown") inputRef.current.down = pressed;
      else if (key === "a" || key === "arrowleft") inputRef.current.left = pressed;
      else if (key === "d" || key === "arrowright") inputRef.current.right = pressed;
      else if (key === " ") inputRef.current.fire = pressed;
      else return;
      event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => onKey(event, true);
    const keyup = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);

    const interval = window.setInterval(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || endedRef.current || !liveRef.current) return;
      const input = inputRef.current;
      const keyboardX = Number(input.right) - Number(input.left);
      const keyboardY = Number(input.down) - Number(input.up);
      const moveX = input.pointerActive ? input.pointerX : keyboardX;
      const moveY = input.pointerActive ? input.pointerY : keyboardY;
      const magnitude = Math.hypot(moveX, moveY);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const command = {
        seq: ++sequenceRef.current,
        targetTick: latestServerTickRef.current + 1,
        moveX: Math.round(moveX * scale * INPUT_AXIS_SCALE),
        moveY: Math.round(moveY * scale * INPUT_AXIS_SCALE),
        aimX: Math.round(moveX * scale * INPUT_AXIS_SCALE),
        aimY: Math.round(moveY * scale * INPUT_AXIS_SCALE),
        actionFlags: input.fire ? BattleActionFlag.FirePrimary : 0
      };
      socket.send(encodeBattleClientMessage({ type: "input.command", command }));
    }, INPUT_INTERVAL_MS);

    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.clearInterval(interval);
      inputRef.current = { ...EMPTY_INPUT };
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (canvas) drawBattleFrame(canvas, snapshotsRef.current, now);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const setPointerInput = (event: React.PointerEvent<HTMLCanvasElement>, active: boolean) => {
    const canvas = event.currentTarget;
    if (active) canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = (event.clientY - rect.top) / rect.height * 2 - 1;
    inputRef.current.pointerX = clamp(x, -1, 1);
    inputRef.current.pointerY = clamp(y, -1, 1);
    inputRef.current.pointerActive = active;
  };

  const progress = hud.target > 0 ? clamp(hud.progress / hud.target, 0, 1) : 0;
  const hull = hud.hullMax > 0 ? clamp(hud.hull / hud.hullMax, 0, 1) : 0;

  return (
    <div className="authoritative-battle">
      <canvas
        aria-label="Server authoritative battle renderer"
        className="authoritative-battle__canvas"
        onPointerDown={(event) => setPointerInput(event, true)}
        onPointerMove={(event) => {
          if (inputRef.current.pointerActive) setPointerInput(event, true);
        }}
        onPointerUp={(event) => setPointerInput(event, false)}
        onPointerCancel={(event) => setPointerInput(event, false)}
        ref={canvasRef}
      />
      <div className="authoritative-battle__hud panel">
        <div>
          <span className="eyebrow">{presentation.type} · tick {hud.tick}</span>
          <strong>{presentation.name}</strong>
        </div>
        <span className="authoritative-battle__live" data-state={connectionState}>{connectionState}</span>
        <div className="authoritative-battle__metric">
          <span>{presentation.objective.label}</span>
          <strong>{hud.progress} / {hud.target}</strong>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="authoritative-battle__metric">
          <span>Hull integrity</span>
          <strong>{hud.hull} / {hud.hullMax}</strong>
          <i style={{ width: `${hull * 100}%` }} />
        </div>
        <small>{sessionMessage}</small>
      </div>
      <div className="authoritative-battle__controls" aria-label="Battle controls">
        <span>Drag to steer · WASD</span>
        <button
          className="button primary"
          onPointerDown={() => { inputRef.current.fire = true; }}
          onPointerUp={() => { inputRef.current.fire = false; }}
          onPointerCancel={() => { inputRef.current.fire = false; }}
          type="button"
        >
          Fire
        </button>
      </div>
    </div>
  );
}

async function readBinaryMessage(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new Error("Battle worker sent a non-binary payload.");
}

function drawBattleFrame(canvas: HTMLCanvasElement, received: ReceivedSnapshot[], now: number) {
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
  if (received.length === 0) return;

  const { older, newer, alpha } = interpolationPair(received, now - INTERPOLATION_DELAY_MS);
  const newerById = new Map(newer.snapshot.entities.map((entity) => [entity.id, entity]));
  const entities = older.snapshot.entities.map((entity) => {
    const next = newerById.get(entity.id) ?? entity;
    return interpolateEntity(entity, next, alpha);
  });
  for (const entity of newer.snapshot.entities) {
    if (!entities.some((candidate) => candidate.id === entity.id)) entities.push(entity);
  }

  let worldRadius = 24_000;
  for (const entity of entities) {
    worldRadius = Math.max(worldRadius, Math.abs(entity.xMilli) + 5_000, Math.abs(entity.yMilli) + 5_000);
  }
  const scale = Math.min(cssWidth, cssHeight) * 0.43 / worldRadius;
  for (const entity of entities) drawEntity(context, entity, cssWidth / 2, cssHeight / 2, scale);
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, now: number) {
  const gradient = context.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.max(width, height));
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
  scale: number
) {
  const x = centerX + entity.xMilli * scale;
  const y = centerY + entity.yMilli * scale;
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

function interpolationPair(received: ReceivedSnapshot[], targetTime: number) {
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
  alpha: number
): BattleEntitySnapshot {
  return {
    ...next,
    xMilli: lerp(previous.xMilli, next.xMilli, alpha),
    yMilli: lerp(previous.yMilli, next.yMilli, alpha),
    rotationMilliRadians: lerp(previous.rotationMilliRadians, next.rotationMilliRadians, alpha)
  };
}

function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatEvent(eventType: string) {
  return eventType.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
