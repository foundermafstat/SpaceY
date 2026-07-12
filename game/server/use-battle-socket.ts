"use client";

import type { BattleConnectionDto } from "@spacey/contracts";
import {
  BATTLE_PROTOCOL_VERSION,
  type BattleServerMessage,
  type BattleSnapshot,
} from "@spacey/protocol";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { reconnectMissionAttempt } from "./api-client";
import type { BattleInputController } from "./battle-input-controller";
import type { BattleSnapshotBuffer } from "./battle-snapshot-buffer";
import { decodeBattleServerMessage, encodeBattleClientMessage } from "./battle-protobuf";

export type BattleEndedMessage = Extract<BattleServerMessage, { type: "battle.ended" }>;
export type BattleEventMessage = Extract<BattleServerMessage, { type: "battle.event" }>;
export type BattleConnectionState = "connecting" | "live" | "reconnecting" | "ended" | "error";
export const MAX_BATTLE_SOCKET_BUFFERED_BYTES = 256 * 1024;
export type BattleHudState = {
  tick: number;
  progress: number;
  target: number;
  hull: number;
  hullMax: number;
  energy: number;
  energyMax: number;
  heat: number;
  heatMax: number;
  shield: number;
  shieldMax: number;
  brownout: boolean;
  overheated: boolean;
};

function emptyHud(target: number): BattleHudState {
  return {
    tick: 0,
    progress: 0,
    target,
    hull: 0,
    hullMax: 0,
    energy: 0,
    energyMax: 0,
    heat: 0,
    heatMax: 0,
    shield: 0,
    shieldMax: 0,
    brownout: false,
    overheated: false,
  };
}

export function useBattleSocket({
  connection,
  inputController,
  onEnded,
  onEvent,
  requestReconnect,
  snapshots,
  target,
}: {
  connection: BattleConnectionDto;
  inputController: BattleInputController;
  onEnded: (result: BattleEndedMessage) => void;
  onEvent?: (event: BattleEventMessage) => void;
  requestReconnect?: () => Promise<BattleConnectionDto>;
  snapshots: BattleSnapshotBuffer;
  target: number;
}): {
  connectionState: BattleConnectionState;
  endedRef: MutableRefObject<boolean>;
  hud: BattleHudState;
  liveRef: MutableRefObject<boolean>;
  sessionMessage: string;
  setSessionMessage: Dispatch<SetStateAction<string>>;
  socketRef: MutableRefObject<WebSocket | null>;
} {
  const socketRef = useRef<WebSocket | null>(null);
  const endedRef = useRef(false);
  const liveRef = useRef(false);
  const [connectionState, setConnectionState] = useState<BattleConnectionState>("connecting");
  const [sessionMessage, setSessionMessage] = useState("Awaiting authoritative snapshot…");
  const [hud, setHud] = useState<BattleHudState>(() => emptyHud(target));

  useEffect(() => {
    endedRef.current = false;
    liveRef.current = false;
    snapshots.clear();
    setHud(emptyHud(target));
    setConnectionState("connecting");
    setSessionMessage("Awaiting authoritative snapshot…");
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
      inputController.acceptSnapshot(snapshot);
      snapshots.push(snapshot, performance.now());
      const player = snapshot.entities.find((entity) => entity.kind === "player");
      const systems = player?.shipSystems;
      setHud({
        tick: snapshot.tick,
        progress: snapshot.objective.progress,
        target: snapshot.objective.target,
        hull: player?.hull ?? 0,
        hullMax: player?.hullMax ?? 0,
        energy: systems?.energy ?? 0,
        energyMax: systems?.energyMax ?? 0,
        heat: systems?.heat ?? 0,
        heatMax: systems?.heatMax ?? 0,
        shield: systems?.shield ?? 0,
        shieldMax: systems?.shieldMax ?? 0,
        brownout: systems?.brownout ?? false,
        overheated: systems?.overheated ?? false,
      });
    };

    const resendUnacknowledgedInputs = (socket: WebSocket) => {
      for (const command of inputController.pending()) {
        if (socket.bufferedAmount > MAX_BATTLE_SOCKET_BUFFERED_BYTES) {
          return false;
        }
        socket.send(encodeBattleClientMessage({ type: "input.command", command }));
      }
      return true;
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
        if (!resendUnacknowledgedInputs(socket)) {
          liveRef.current = false;
          setSessionMessage("Reconnect input stream is congested; retrying with a fresh ticket.");
          socket.close(1013, "client backpressure");
        }
        return;
      }
      if (message.type === "battle.snapshot") {
        acceptSnapshot(message.snapshot);
        return;
      }
      if (message.type === "battle.event") {
        onEvent?.(message);
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
      inputController.resetTransient();
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
      inputController.resetTransient();
      const socket = new WebSocket(nextConnection.websocketUrl, [
        BATTLE_PROTOCOL_VERSION,
        `ticket.${nextConnection.ticket}`,
      ]);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        socket.send(encodeBattleClientMessage({
          type: "session.resume",
          lastAcknowledgedInputSequence: inputController.resumeSequence(),
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
      inputController.resetTransient();
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "battle view closed");
    };
  }, [connection, inputController, onEnded, onEvent, requestReconnect, snapshots, target]);

  return {
    connectionState,
    endedRef,
    hud,
    liveRef,
    sessionMessage,
    setSessionMessage,
    socketRef,
  };
}

async function readBinaryMessage(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new Error("Battle worker sent a non-binary payload.");
}

function formatEvent(eventType: string) {
  return eventType.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}
