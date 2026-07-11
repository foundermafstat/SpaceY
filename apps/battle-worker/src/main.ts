import { pathToFileURL } from "node:url";
import { captureException } from "@spacey/observability";

import { BattleGateway } from "./gateway.js";
import { AuthoritativeSessionManager } from "./authoritative-session-manager.js";
import { DuelSessionManager } from "./duel-session-manager.js";
import { FixedTickLoop } from "./fixed-tick-loop.js";
import { JsonBattleWorkerLogger, systemClock } from "./logger.js";
import { PostgresBattleFinalizer } from "./postgres-finalizer.js";
import { ProtobufBattleCodec } from "./protobuf-codec.js";
import { BattleWorkerReadiness } from "./readiness.js";
import { S3ReplayStorage } from "./s3-replay-storage.js";
import { BattleSessionManager } from "./session-manager.js";
import {
  createValkeyClient,
  pingValkey,
  ValkeyBattleCheckpointStore,
  ValkeyBattleInputJournal,
  ValkeyBattleSessionDefinitionStore,
  ValkeyBattleSessionRouter,
  ValkeyBattleTicketValidator
} from "./valkey.js";
import { BattleWorkerServer } from "./websocket-server.js";
import { loadBattleWorkerEnv } from "./env.js";

export async function runBattleWorker(): Promise<void> {
  const env = loadBattleWorkerEnv();
  const logger = new JsonBattleWorkerLogger();
  const redis = createValkeyClient(env.VALKEY_URL);
  const finalizer = new PostgresBattleFinalizer(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const replayStorage = new S3ReplayStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    retentionDays: env.REPLAY_RETENTION_DAYS,
    serverSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION,
    kmsKeyId: env.S3_KMS_KEY_ID
  });
  const checkpoints = new ValkeyBattleCheckpointStore(redis, env.BATTLE_STATE_TTL_SECONDS);
  const definitions = new ValkeyBattleSessionDefinitionStore(redis);
  const inputJournal = new ValkeyBattleInputJournal(redis, env.BATTLE_STATE_TTL_SECONDS);
  const router = new ValkeyBattleSessionRouter(redis);
  const infrastructure = {
    lifecycle: finalizer,
    definitions,
    inputJournal,
    router,
    replayStorage,
    routeLease: {
      workerId: env.workerId,
      endpoint: env.BATTLE_WORKER_PUBLIC_URL
    },
    routeTtlSeconds: env.BATTLE_ROUTE_TTL_SECONDS
  };
  const pveSessions = new BattleSessionManager(
    checkpoints,
    finalizer,
    systemClock,
    logger,
    infrastructure
  );
  const duelSessions = new DuelSessionManager(checkpoints, finalizer, systemClock, logger, infrastructure);
  const sessions = new AuthoritativeSessionManager(pveSessions, duelSessions);
  const gateway = new BattleGateway(new ValkeyBattleTicketValidator(redis), sessions, logger);
  const codec = await ProtobufBattleCodec.create();
  const readiness = new BattleWorkerReadiness([
    { name: "valkey", ping: () => pingValkey(redis) },
    { name: "postgres", ping: () => finalizer.ping() },
    { name: "replay-storage", ping: () => replayStorage.ping() }
  ], logger);
  const server = new BattleWorkerServer({
    host: env.BATTLE_WORKER_HOST,
    port: env.BATTLE_WORKER_PORT,
    battlePath: env.BATTLE_WS_PATH,
    allowedOrigins: env.allowedOrigins,
    maxConnections: env.BATTLE_MAX_CONNECTIONS,
    maxPayloadBytes: env.BATTLE_MAX_PAYLOAD_BYTES,
    heartbeatIntervalMs: env.BATTLE_HEARTBEAT_INTERVAL_MS
  }, gateway, codec, readiness, logger);
  const loop = new FixedTickLoop(sessions, systemClock, logger);

  if (redis.status === "wait") await redis.connect();
  await server.listen();
  loop.start();
  logger.info("Battle worker listening", {
    host: env.BATTLE_WORKER_HOST,
    port: env.BATTLE_WORKER_PORT,
    workerId: env.workerId
  });

  let shuttingDown: Promise<void> | null = null;
  const shutdown = (exitCode: number, reason: string) => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      logger.info("Battle worker draining", { reason });
      server.beginDrain();
      await server.drain(env.BATTLE_DRAIN_TIMEOUT_MS);
      loop.stop();
      await sessions.flushCheckpoints();
      await server.close();
      replayStorage.destroy();
      await Promise.allSettled([
        finalizer.close(),
        redis.status === "ready" ? redis.quit() : redis.disconnect()
      ]);
      logger.info("Battle worker stopped", { reason });
      process.exitCode = exitCode;
    })();
    return shuttingDown;
  };

  process.once("SIGTERM", () => void shutdown(0, "SIGTERM"));
  process.once("SIGINT", () => void shutdown(0, "SIGINT"));
  process.once("uncaughtException", (error) => {
    captureException(error, { service: "battle-worker", operation: "uncaughtException" });
    logger.error("Uncaught battle worker exception", { errorName: error.name });
    void shutdown(1, "uncaughtException");
  });
  process.once("unhandledRejection", (reason) => {
    captureException(reason, { service: "battle-worker", operation: "unhandledRejection" });
    logger.error("Unhandled battle worker rejection", {
      errorName: reason instanceof Error ? reason.name : "UnknownError"
    });
    void shutdown(1, "unhandledRejection");
  });
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  runBattleWorker().catch((error) => {
    captureException(error, { service: "battle-worker", operation: "startup" });
    const logger = new JsonBattleWorkerLogger();
    logger.error("Battle worker failed to start", {
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
    process.exitCode = 1;
  });
}
