import {
  BattleActionFlag,
  INPUT_AXIS_SCALE,
  type BattleInputCommand,
  type BattleSnapshot,
} from "@spacey/protocol";
import { BattleInputBuffer } from "./battle-input-buffer.ts";

export const BATTLE_INPUT_HEARTBEAT_MS = 500;

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  actionFlags: number;
  moveX: number;
  moveY: number;
  moveActive: boolean;
  aimX: number;
  aimY: number;
  aimActive: boolean;
};

const EMPTY_INPUT: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  actionFlags: 0,
  moveX: 0,
  moveY: 0,
  moveActive: false,
  aimX: 0,
  aimY: 0,
  aimActive: false,
};

export class BattleInputController {
  private input: InputState = { ...EMPTY_INPUT };
  private readonly buffer = new BattleInputBuffer();
  private sequence = 0;
  private lastAcknowledgedSequence = 0;
  private latestServerTick = 0;
  private lastSentSignature = "";
  private lastSentAt = 0;

  acceptSnapshot(snapshot: BattleSnapshot): void {
    this.latestServerTick = snapshot.tick;
    this.lastAcknowledgedSequence = Math.max(
      this.lastAcknowledgedSequence,
      snapshot.lastProcessedInputSequence,
    );
    this.sequence = Math.max(this.sequence, snapshot.lastProcessedInputSequence);
    this.buffer.acknowledge(snapshot.lastProcessedInputSequence);
  }

  resumeSequence(): number {
    return this.lastAcknowledgedSequence;
  }

  pending(): readonly BattleInputCommand[] {
    return this.buffer.pending();
  }

  resetTransient(): void {
    this.input = { ...EMPTY_INPUT };
    this.lastSentSignature = "";
  }

  setKey(key: string, pressed: boolean): boolean {
    const normalized = key.toLowerCase();
    if (normalized === "w" || normalized === "arrowup") this.input.up = pressed;
    else if (normalized === "s" || normalized === "arrowdown") this.input.down = pressed;
    else if (normalized === "a" || normalized === "arrowleft") this.input.left = pressed;
    else if (normalized === "d" || normalized === "arrowright") this.input.right = pressed;
    else if (normalized === " ") this.setAction(BattleActionFlag.FirePrimary, pressed);
    else if (normalized === "shift") this.setAction(BattleActionFlag.FireSecondary, pressed);
    else if (normalized === "q") this.setAction(BattleActionFlag.AbilityOne, pressed);
    else if (normalized === "e") this.setAction(BattleActionFlag.AbilityTwo, pressed);
    else return false;
    return true;
  }

  setMove(x: number, y: number, active: boolean): void {
    this.input.moveX = clamp(x, -1, 1);
    this.input.moveY = clamp(y, -1, 1);
    this.input.moveActive = active;
  }

  setAim(x: number, y: number, active: boolean): void {
    this.input.aimX = clamp(x, -1, 1);
    this.input.aimY = clamp(y, -1, 1);
    this.input.aimActive = active;
  }

  setFire(active: boolean): void {
    this.setAction(BattleActionFlag.FirePrimary, active);
  }

  setAction(flag: number, active: boolean): void {
    if (active) this.input.actionFlags |= flag;
    else this.input.actionFlags &= ~flag;
  }

  sample(now: number): BattleInputCommand | "buffer_full" | null {
    const keyboardX = Number(this.input.right) - Number(this.input.left);
    const keyboardY = Number(this.input.down) - Number(this.input.up);
    const moveX = this.input.moveActive ? this.input.moveX : keyboardX;
    const moveY = this.input.moveActive ? this.input.moveY : keyboardY;
    const move = normalizedVector(moveX, moveY);
    const aim = normalizedVector(
      this.input.aimActive ? this.input.aimX : moveX,
      this.input.aimActive ? this.input.aimY : moveY,
    );
    const actionFlags = this.input.actionFlags
      | (this.input.aimActive ? BattleActionFlag.FirePrimary : 0);
    const signature = `${move.x}:${move.y}:${aim.x}:${aim.y}:${actionFlags}`;
    if (signature === this.lastSentSignature && now - this.lastSentAt < BATTLE_INPUT_HEARTBEAT_MS) {
      return null;
    }
    const command: BattleInputCommand = {
      seq: this.sequence + 1,
      targetTick: this.latestServerTick + 1,
      moveX: move.x,
      moveY: move.y,
      aimX: aim.x,
      aimY: aim.y,
      actionFlags,
    };
    if (!this.buffer.push(command)) return "buffer_full";
    this.sequence = command.seq;
    this.lastSentSignature = signature;
    this.lastSentAt = now;
    return command;
  }
}

function normalizedVector(x: number, y: number) {
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return {
    x: Math.round(x * scale * INPUT_AXIS_SCALE),
    y: Math.round(y * scale * INPUT_AXIS_SCALE),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
