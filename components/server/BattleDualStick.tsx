"use client";

import { useEffect, useRef, type PointerEvent } from "react";

export type BattleStickVector = { x: number; y: number; active: boolean };

export function BattleDualStick({
  onAim,
  onMove,
  resetKey,
}: {
  onAim: (vector: BattleStickVector) => void;
  onMove: (vector: BattleStickVector) => void;
  resetKey: string;
}) {
  const moveResetRef = useRef<() => void>(() => undefined);
  const aimResetRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const reset = () => {
      moveResetRef.current();
      aimResetRef.current();
    };
    const visibilityChange = () => {
      if (document.hidden) reset();
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, []);

  useEffect(() => {
    moveResetRef.current();
    aimResetRef.current();
  }, [resetKey]);

  return (
    <div className="battle-dual-stick" aria-label="Touch battle controls">
      <BattleStick label="Move" onInput={onMove} resetRef={moveResetRef} />
      <BattleStick label="Aim and fire" onInput={onAim} resetRef={aimResetRef} variant="fire" />
    </div>
  );
}

function BattleStick({
  label,
  onInput,
  resetRef,
  variant = "move",
}: {
  label: string;
  onInput: (vector: BattleStickVector) => void;
  resetRef: { current: () => void };
  variant?: "move" | "fire";
}) {
  const knobRef = useRef<HTMLSpanElement>(null);
  const activePointerRef = useRef<number | null>(null);

  const reset = () => {
    activePointerRef.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate3d(0, 0, 0)";
    onInput({ x: 0, y: 0, active: false });
  };
  resetRef.current = reset;

  const update = (event: PointerEvent<HTMLButtonElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34);
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(rawX, rawY);
    const scale = magnitude > radius ? radius / magnitude : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    if (knobRef.current) knobRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    onInput({ x: x / radius, y: y / radius, active: true });
  };

  return (
    <button
      aria-label={label}
      className={`battle-stick battle-stick--${variant}`}
      onPointerDown={(event) => {
        activePointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={update}
      onLostPointerCapture={reset}
      onPointerUp={(event) => {
        if (activePointerRef.current !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        reset();
      }}
      onPointerCancel={reset}
      type="button"
    >
      <span className="battle-stick__label">{label}</span>
      <span aria-hidden="true" className="battle-stick__knob" ref={knobRef} />
    </button>
  );
}
