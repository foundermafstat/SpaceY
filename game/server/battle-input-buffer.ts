import type { BattleInputCommand } from "@spacey/protocol";

export const MAX_UNACKNOWLEDGED_INPUTS = 256;

export class BattleInputBuffer {
  private commands: BattleInputCommand[] = [];

  get size(): number {
    return this.commands.length;
  }

  push(command: BattleInputCommand): boolean {
    if (this.commands.length >= MAX_UNACKNOWLEDGED_INPUTS) return false;
    const previous = this.commands.at(-1);
    if (previous && command.seq <= previous.seq) {
      throw new Error("Battle input sequences must be strictly increasing.");
    }
    this.commands.push(command);
    return true;
  }

  acknowledge(sequence: number): void {
    if (this.commands.length === 0 || sequence < this.commands[0]!.seq) return;
    const firstPending = this.commands.findIndex((command) => command.seq > sequence);
    this.commands = firstPending === -1 ? [] : this.commands.slice(firstPending);
  }

  pending(): readonly BattleInputCommand[] {
    return this.commands;
  }
}
