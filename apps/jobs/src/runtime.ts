import type { Worker } from "bullmq";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { captureException } from "@spacey/observability";
import type { OutboxRepository, JobDispatcher } from "./ports.js";
import { OutboxPump } from "./outbox-pump.js";

export class JobsRuntime {
  private stopping = false;
  private pollTimer?: NodeJS.Timeout;
  private healthServer?: Server;

  constructor(
    private readonly pump: OutboxPump,
    private readonly repository: OutboxRepository,
    private readonly dispatcher: JobDispatcher,
    private readonly worker: Worker,
    private readonly pollIntervalMs: number,
    private readonly readinessDependencies: readonly Readonly<{ ping(): Promise<void> }>[] = [],
    private readonly maintenanceScheduler?: Readonly<{ start(): void; stop(): Promise<void> }>,
    private readonly shutdownDependencies: readonly Readonly<{ close(): Promise<void> }>[] = [],
  ) {}

  async startHealthServer(port: number, host: string): Promise<void> {
    this.healthServer = createServer(async (request, response) => {
      if (request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok", service: "jobs" }));
        return;
      }
      if (request.url === "/ready") {
        try {
          await Promise.all([
            this.repository.ping(),
            this.dispatcher.ready(),
            ...this.readinessDependencies.map((dependency) => dependency.ping()),
          ]);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ready: true }));
        } catch {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({ ready: false }));
        }
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      this.healthServer?.once("error", reject);
      this.healthServer?.listen(port, host, resolve);
    });
  }

  startPolling(): void {
    this.maintenanceScheduler?.start();
    const poll = async () => {
      if (this.stopping) return;
      try {
        const processed = await this.pump.runBatch();
        this.pollTimer = setTimeout(poll, processed > 0 ? 0 : this.pollIntervalMs);
      } catch (error) {
        captureException(error, { service: "jobs", operation: "outbox-poll" });
        this.pollTimer = setTimeout(poll, this.pollIntervalMs);
      }
    };
    void poll();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.healthServer) await new Promise<void>((resolve, reject) => this.healthServer?.close((error) => error ? reject(error) : resolve()));
    await this.maintenanceScheduler?.stop();
    await this.worker.close();
    await Promise.all(this.shutdownDependencies.map((dependency) => dependency.close()));
    await this.dispatcher.close();
    await this.repository.close();
  }
}
