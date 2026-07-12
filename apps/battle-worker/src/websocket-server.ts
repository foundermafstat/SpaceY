import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  WebSocket,
  WebSocketServer,
  type RawData
} from "ws";

import {
  BATTLE_PROTOCOL_VERSION,
  type BattleClientMessage,
  type BattleProtocolCodec,
  type BattleServerMessage
} from "@spacey/protocol";
import { battleWorkerMetrics } from "@spacey/observability";

import type { BattleGateway } from "./gateway.js";
import type { BattleConnection, BattleWorkerLogger } from "./ports.js";
import type { BattleWorkerReadiness } from "./readiness.js";

export type BattleWorkerServerConfig = {
  host: string;
  port: number;
  battlePath: string;
  allowedOrigins: ReadonlySet<string>;
  maxConnections: number;
  maxPayloadBytes: number;
  heartbeatIntervalMs: number;
};

export class BattleWorkerServer {
  private readonly httpServer: HttpServer;
  private readonly websocketServer: WebSocketServer;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    private readonly config: BattleWorkerServerConfig,
    private readonly gateway: BattleGateway,
    private readonly codec: BattleProtocolCodec,
    private readonly readiness: BattleWorkerReadiness,
    private readonly logger: BattleWorkerLogger
  ) {
    this.httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });
    this.httpServer.requestTimeout = 10_000;
    this.httpServer.headersTimeout = 10_000;
    this.httpServer.keepAliveTimeout = 5_000;
    this.websocketServer = new WebSocketServer({
      noServer: true,
      clientTracking: true,
      perMessageDeflate: false,
      maxPayload: config.maxPayloadBytes,
      handleProtocols: (protocols: Set<string>) => protocols.has(BATTLE_PROTOCOL_VERSION)
        ? BATTLE_PROTOCOL_VERSION
        : false
    });
    this.httpServer.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
    this.heartbeat = setInterval(() => this.checkHeartbeats(), config.heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  get connectionCount(): number {
    return this.websocketServer.clients.size;
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.httpServer.once("error", onError);
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer.off("error", onError);
        resolve();
      });
    });
  }

  beginDrain(): void {
    this.draining = true;
    this.readiness.beginDrain();
  }

  async drain(timeoutMs: number): Promise<void> {
    this.beginDrain();
    const deadline = Date.now() + timeoutMs;
    while (this.websocketServer.clients.size > 0 && Date.now() < deadline) {
      await delay(100);
    }
    for (const client of this.websocketServer.clients) client.close(1012, "worker draining");
    await delay(Math.min(250, timeoutMs));
    for (const client of this.websocketServer.clients) client.terminate();
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await new Promise<void>((resolve) => this.websocketServer.close(() => resolve()));
    if (!this.httpServer.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((error) => error ? reject(error) : resolve());
    });
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: import("node:http").ServerResponse
  ): Promise<void> {
    const path = safePathname(request.url);
    if (request.method === "GET" && path === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && path === "/ready") {
      const ready = await this.readiness.check();
      writeJson(response, ready ? 200 : 503, { status: ready ? "ready" : "unavailable" });
      return;
    }
    writeJson(response, 404, { status: "not_found" });
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    try {
      if (this.draining || this.connectionCount >= this.config.maxConnections) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      if (safePathname(request.url) !== this.config.battlePath) {
        rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      const origin = request.headers.origin;
      if (!origin || !this.config.allowedOrigins.has(origin)) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (!await this.readiness.check()) {
        rejectUpgrade(socket, 503, "Service Unavailable");
        return;
      }
      const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
      const rawTicket = extractTicket(protocols);
      if (!protocols.includes(BATTLE_PROTOCOL_VERSION) || !rawTicket) {
        rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const authorization = await this.gateway.authorize(rawTicket, BATTLE_PROTOCOL_VERSION);
      if (!authorization.authorized) {
        rejectUpgrade(socket, authorization.httpStatus, authorization.httpStatus === 426 ? "Upgrade Required" : "Unauthorized");
        return;
      }

      this.websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
        const connection = new WsBattleConnection(websocket, this.codec, this.logger);
        void this.gateway.attach(authorization.claims, connection).catch((error) => {
          this.logger.error("Battle connection attach failed", {
            errorName: error instanceof Error ? error.name : "UnknownError"
          });
          connection.close(1011, "battle connection failed");
        });
      });
    } catch (error) {
      this.logger.error("Battle WebSocket upgrade failed", {
        errorName: error instanceof Error ? error.name : "UnknownError"
      });
      rejectUpgrade(socket, 503, "Service Unavailable");
    }
  }

  private checkHeartbeats(): void {
    for (const client of this.websocketServer.clients) {
      const tracked = client as WebSocket & { isAlive?: boolean };
      if (tracked.isAlive === false) {
        tracked.terminate();
        continue;
      }
      tracked.isAlive = false;
      tracked.once("pong", () => {
        tracked.isAlive = true;
      });
      tracked.ping();
    }
  }
}

const OUTBOUND_HIGH_WATER_BYTES = 512 * 1_024;
const MAX_RELIABLE_QUEUE_MESSAGES = 2_048;
const MAX_RELIABLE_QUEUE_BYTES = 4 * 1_024 * 1_024;
const OUTBOUND_RETRY_MS = 10;

export class WsBattleConnection implements BattleConnection {
  readonly id = randomUUID();
  private readonly messageHandlers = new Set<(message: BattleClientMessage) => void | Promise<void>>();
  private readonly closeHandlers = new Set<() => void | Promise<void>>();
  private readonly bufferedMessages: BattleClientMessage[] = [];
  private inboundChain: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly reliableOutbound: Uint8Array[] = [];
  private reliableOutboundBytes = 0;
  private pendingSnapshot: Uint8Array | null = null;
  private outboundInFlight = false;
  private outboundTimer: NodeJS.Timeout | null = null;
  private requestedClose: { code: number; reason: string } | null = null;

  constructor(
    private readonly socket: WebSocket,
    private readonly codec: BattleProtocolCodec,
    private readonly logger: BattleWorkerLogger
  ) {
    battleWorkerMetrics.websocketOpened(this.id);
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    socket.on("message", (data: RawData, isBinary: boolean) => {
      this.inboundChain = this.inboundChain
        .then(() => this.dispatchRaw(data, isBinary))
        .catch((error) => {
          this.logger.warn("Battle WebSocket message rejected", {
            errorName: error instanceof Error ? error.name : "UnknownError"
          });
          this.close(1003, "invalid binary battle message");
        });
    });
    socket.once("close", () => {
      this.closed = true;
      if (this.outboundTimer) clearTimeout(this.outboundTimer);
      this.outboundTimer = null;
      this.reliableOutbound.length = 0;
      this.reliableOutboundBytes = 0;
      this.pendingSnapshot = null;
      battleWorkerMetrics.websocketClosed(this.id);
      for (const handler of this.closeHandlers) void handler();
      this.closeHandlers.clear();
      this.messageHandlers.clear();
    });
    socket.on("error", (error: Error) => {
      this.logger.warn("Battle WebSocket transport error", { errorName: error.name });
    });
  }

  send(message: BattleServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN || this.requestedClose) return;
    const payload = this.codec.encodeServer(message);
    if (message.type === "battle.snapshot") {
      if (this.pendingSnapshot) recordSnapshotDrop();
      this.pendingSnapshot = payload;
      this.drainOutbound();
      return;
    }
    if (this.reliableOutbound.length >= MAX_RELIABLE_QUEUE_MESSAGES
      || this.reliableOutboundBytes + payload.byteLength > MAX_RELIABLE_QUEUE_BYTES) {
      this.logger.warn("Reliable battle WebSocket queue overflow");
      this.pendingSnapshot = null;
      this.socket.close(1013, "slow battle client");
      return;
    }
    this.reliableOutbound.push(payload);
    this.reliableOutboundBytes += payload.byteLength;
    this.drainOutbound();
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING) return;
    this.requestedClose ??= { code, reason };
    if (this.pendingSnapshot) {
      this.pendingSnapshot = null;
      recordSnapshotDrop();
    }
    this.drainOutbound();
  }

  onMessage(handler: (message: BattleClientMessage) => void | Promise<void>): () => void {
    this.messageHandlers.add(handler);
    const pending = this.bufferedMessages.splice(0);
    for (const message of pending) {
      this.inboundChain = this.inboundChain.then(() => handler(message));
    }
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: () => void | Promise<void>): () => void {
    if (this.closed) queueMicrotask(() => void handler());
    else this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private async dispatchRaw(data: RawData, isBinary: boolean): Promise<void> {
    if (!isBinary) throw new Error("Text WebSocket frames are not supported.");
    const message = this.codec.decodeClient(toUint8Array(data));
    if (this.messageHandlers.size === 0) {
      if (this.bufferedMessages.length >= 32) throw new Error("Pre-authentication message buffer overflow.");
      this.bufferedMessages.push(message);
      return;
    }
    for (const handler of this.messageHandlers) await handler(message);
  }

  private drainOutbound(): void {
    if (this.closed || this.outboundInFlight || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount >= OUTBOUND_HIGH_WATER_BYTES) {
      this.scheduleOutboundDrain();
      return;
    }
    const reliable = this.reliableOutbound.shift();
    const payload = reliable ?? this.takePendingSnapshot();
    if (!payload) {
      if (this.requestedClose) this.socket.close(this.requestedClose.code, this.requestedClose.reason);
      return;
    }
    if (reliable) this.reliableOutboundBytes -= payload.byteLength;
    this.outboundInFlight = true;
    this.socket.send(payload, { binary: true }, (error?: Error) => {
      this.outboundInFlight = false;
      if (error) {
        this.logger.warn("Battle WebSocket outbound send failed", { errorName: error.name });
        this.socket.close(1011, "battle transport failed");
        return;
      }
      this.drainOutbound();
    });
  }

  private takePendingSnapshot(): Uint8Array | null {
    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = null;
    return snapshot;
  }

  private scheduleOutboundDrain(): void {
    if (this.outboundTimer) return;
    this.outboundTimer = setTimeout(() => {
      this.outboundTimer = null;
      this.drainOutbound();
    }, OUTBOUND_RETRY_MS);
    this.outboundTimer.unref?.();
  }
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

function parseProtocols(value: string | string[] | undefined): string[] {
  const serialized = Array.isArray(value) ? value.join(",") : value ?? "";
  return serialized.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function extractTicket(protocols: string[]): string | null {
  const candidates = protocols.filter((protocol) => protocol.startsWith("ticket."));
  if (candidates.length !== 1) return null;
  const ticket = candidates[0]?.slice("ticket.".length) ?? "";
  return /^[A-Za-z0-9_-]{16,4096}$/.test(ticket) ? ticket : null;
}

function safePathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://battle-worker.local").pathname;
  } catch {
    return "/invalid";
  }
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
}

function writeJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(serialized);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function recordSnapshotDrop(): void {
  (battleWorkerMetrics as typeof battleWorkerMetrics & { snapshotDropped?: () => void }).snapshotDropped?.();
}
