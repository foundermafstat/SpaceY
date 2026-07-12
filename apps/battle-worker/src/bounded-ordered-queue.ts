export class BoundedOrderedQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly capacity: number,
    private readonly onError: (error: unknown) => void,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Queue capacity must be a positive integer.");
  }

  get size(): number {
    return this.pending;
  }

  get hasCapacity(): boolean {
    return this.pending < this.capacity;
  }

  enqueue(task: () => void | Promise<void>): boolean {
    if (this.pending >= this.capacity) return false;
    this.pending += 1;
    const run = this.tail.then(task);
    this.tail = run
      .catch((error) => this.onError(error))
      .finally(() => { this.pending -= 1; });
    return true;
  }

  async drain(): Promise<void> {
    for (;;) {
      const tail = this.tail;
      await tail;
      if (tail === this.tail && this.pending === 0) return;
    }
  }
}
