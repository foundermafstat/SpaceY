"use client";

import type { BattleConnectionDto, MissionCatalogItemDto } from "@spacey/contracts";
import { BattleActionFlag } from "@spacey/protocol";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { BattleDualStick, type BattleStickVector } from "@/components/server/BattleDualStick";
import type { ReceivedBattlePresentationEvent } from "@/game/server/battle-canvas-renderer";
import { BattleInputController } from "@/game/server/battle-input-controller";
import {
  createBattlePresentationRenderer,
  type BattlePresentationRenderer,
} from "@/game/server/battle-presentation-renderer";
import { BattleSnapshotBuffer } from "@/game/server/battle-snapshot-buffer";
import { encodeBattleClientMessage } from "@/game/server/battle-protobuf";
import {
  MAX_BATTLE_SOCKET_BUFFERED_BYTES,
  useBattleSocket,
  type BattleEventMessage,
  type BattleEndedMessage,
} from "@/game/server/use-battle-socket";

const INPUT_INTERVAL_MS = 1000 / 30;

export function AuthoritativeBattle({
  connection,
  mission,
  requestReconnect,
  onEnded,
}: {
  connection: BattleConnectionDto;
  mission?: MissionCatalogItemDto;
  requestReconnect?: () => Promise<BattleConnectionDto>;
  onEnded: (result: BattleEndedMessage) => void;
}) {
  const presentation = mission ?? {
    type: connection.mode === "pvp" ? "PVP" : "PVE",
    name: connection.mode === "pvp" ? "Ranked Duel" : "Mission Attempt",
    objective: {
      label: connection.mode === "pvp" ? "Destroy opponent" : "Complete objective",
      target: 1,
    },
  };
  const presentationHostRef = useRef<HTMLDivElement>(null);
  const snapshotsRef = useRef(new BattleSnapshotBuffer());
  const eventsRef = useRef<ReceivedBattlePresentationEvent[]>([]);
  const inputControllerRef = useRef(new BattleInputController());
  const acceptEvent = useCallback((event: BattleEventMessage) => {
    eventsRef.current = [
      ...eventsRef.current.slice(-127),
      { event, receivedAt: performance.now() },
    ];
  }, []);
  const {
    connectionState,
    endedRef,
    hud,
    liveRef,
    sessionMessage,
    setSessionMessage,
    socketRef,
  } = useBattleSocket({
    connection,
    inputController: inputControllerRef.current,
    onEnded,
    onEvent: acceptEvent,
    requestReconnect,
    snapshots: snapshotsRef.current,
    target: presentation.objective.target,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent, pressed: boolean) => {
      if (inputControllerRef.current.setKey(event.key, pressed)) event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => onKey(event, true);
    const keyup = (event: KeyboardEvent) => onKey(event, false);
    const resetInput = () => inputControllerRef.current.resetTransient();
    const visibilityChange = () => {
      if (document.hidden) resetInput();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", resetInput);
    document.addEventListener("visibilitychange", visibilityChange);

    const interval = window.setInterval(() => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || endedRef.current || !liveRef.current) return;
      if (socket.bufferedAmount > MAX_BATTLE_SOCKET_BUFFERED_BYTES) {
        setSessionMessage("Network is congested; pausing new input until the socket drains.");
        return;
      }
      const command = inputControllerRef.current.sample(performance.now());
      if (command === "buffer_full") {
        setSessionMessage("Input acknowledgement buffer is full; waiting for the server snapshot.");
        return;
      }
      if (command) socket.send(encodeBattleClientMessage({ type: "input.command", command }));
    }, INPUT_INTERVAL_MS);

    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", resetInput);
      document.removeEventListener("visibilitychange", visibilityChange);
      window.clearInterval(interval);
      resetInput();
    };
  }, [endedRef, liveRef, setSessionMessage, socketRef]);

  useEffect(() => {
    let renderer: BattlePresentationRenderer | null = null;
    let cancelled = false;
    let frame = 0;
    eventsRef.current = [];
    const draw = (now: number) => {
      if (renderer) {
        eventsRef.current = eventsRef.current.filter(({ receivedAt }) => now - receivedAt <= 1_000);
        renderer.draw(snapshotsRef.current, eventsRef.current, now);
      }
      frame = requestAnimationFrame(draw);
    };
    const initialize = async () => {
      const host = presentationHostRef.current;
      if (!host) return;
      const nextRenderer = await createBattlePresentationRenderer(host);
      if (cancelled) {
        nextRenderer.destroy();
        return;
      }
      renderer = nextRenderer;
      frame = requestAnimationFrame(draw);
    };
    void initialize().catch((error: unknown) => {
      setSessionMessage(error instanceof Error
        ? `Battle presentation unavailable: ${error.message}`
        : "Battle presentation unavailable.");
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      renderer?.destroy();
    };
  }, [connection.sessionId, setSessionMessage]);

  const setPointerInput = (event: ReactPointerEvent<HTMLDivElement>, active: boolean) => {
    const host = event.currentTarget;
    if (active) host.setPointerCapture(event.pointerId);
    else if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    inputControllerRef.current.setMove(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      (event.clientY - rect.top) / rect.height * 2 - 1,
      active,
    );
  };

  const setMoveStick = useCallback((vector: BattleStickVector) => {
    inputControllerRef.current.setMove(vector.x, vector.y, vector.active);
  }, []);

  const setAimStick = useCallback((vector: BattleStickVector) => {
    inputControllerRef.current.setAim(vector.x, vector.y, vector.active);
  }, []);

  const setActionFromPointer = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    flag: number,
    active: boolean,
  ) => {
    if (active) event.currentTarget.setPointerCapture(event.pointerId);
    else if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    inputControllerRef.current.setAction(flag, active);
  }, []);

  const progress = hud.target > 0 ? clamp(hud.progress / hud.target, 0, 1) : 0;
  const hull = hud.hullMax > 0 ? clamp(hud.hull / hud.hullMax, 0, 1) : 0;

  return (
    <div className="authoritative-battle">
      <div
        aria-label="Server authoritative battle renderer"
        className="authoritative-battle__canvas"
        onPointerDown={(event) => setPointerInput(event, true)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setPointerInput(event, true);
        }}
        onPointerUp={(event) => setPointerInput(event, false)}
        onPointerCancel={(event) => setPointerInput(event, false)}
        ref={presentationHostRef}
        role="img"
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
        <div className="authoritative-battle__telemetry" aria-label="Ship systems telemetry">
          <span data-alert={hud.brownout}>Energy <strong>{formatPercent(hud.energy, hud.energyMax)}</strong></span>
          <span data-alert={hud.overheated}>Heat <strong>{formatPercent(hud.heat, hud.heatMax)}</strong></span>
          <span>Shield <strong>{formatPercent(hud.shield, hud.shieldMax)}</strong></span>
        </div>
        <small>{sessionMessage}</small>
      </div>
      <div className="authoritative-battle__controls" aria-label="Battle controls">
        <span>Drag to steer · WASD · Space/Shift/Q/E</span>
        <button
          className="button primary"
          onPointerDown={(event) => setActionFromPointer(event, BattleActionFlag.FirePrimary, true)}
          onPointerUp={(event) => setActionFromPointer(event, BattleActionFlag.FirePrimary, false)}
          onPointerCancel={(event) => setActionFromPointer(event, BattleActionFlag.FirePrimary, false)}
          onLostPointerCapture={() => inputControllerRef.current.setAction(BattleActionFlag.FirePrimary, false)}
          type="button"
        >
          Weapon 1
        </button>
        <button
          className="button secondary"
          onPointerDown={(event) => setActionFromPointer(event, BattleActionFlag.FireSecondary, true)}
          onPointerUp={(event) => setActionFromPointer(event, BattleActionFlag.FireSecondary, false)}
          onPointerCancel={(event) => setActionFromPointer(event, BattleActionFlag.FireSecondary, false)}
          onLostPointerCapture={() => inputControllerRef.current.setAction(BattleActionFlag.FireSecondary, false)}
          type="button"
        >
          Weapon 2
        </button>
      </div>
      <BattleDualStick onAim={setAimStick} onMove={setMoveStick} resetKey={connectionState} />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number, maximum: number) {
  return maximum > 0 ? `${Math.round(clamp(value / maximum, 0, 1) * 100)}%` : "—";
}
