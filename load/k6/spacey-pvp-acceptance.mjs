import http from "k6/http";
import ws from "k6/ws";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

import {
  ServerEnvelopeField,
  encodeInputCommand,
  encodeSessionResume,
  exactArrayBuffer,
  serverEnvelopeField,
} from "./battle-protobuf.mjs";

const PROTOCOL = "spacey-battle-v1";
const CONFIG = loadConfig(__ENV);

const apiIssueMs = new Trend("spacey_api_issue_ms", true);
const wsConnectMs = new Trend("spacey_ws_connect_ms", true);
const snapshotGapMs = new Trend("spacey_snapshot_gap_ms", true);
const rewardFinalizationMs = new Trend("spacey_reward_finalization_ms", true);
const wsConnectSuccess = new Rate("spacey_ws_connect_success");
const snapshotSuccess = new Rate("spacey_snapshot_success");
const reconnectSuccess = new Rate("spacey_reconnect_success");
const rewardExactlyOnce = new Rate("spacey_reward_exactly_once");
const battleEnded = new Rate("spacey_battle_ended");
const protocolErrors = new Counter("spacey_protocol_errors");
const inputCommands = new Counter("spacey_input_commands");

export const options = {
  discardResponseBodies: false,
  scenarios: {
    pvp_duels: {
      executor: "ramping-vus",
      exec: "pvpParticipant",
      startVUs: 0,
      stages: CONFIG.stages,
      gracefulRampDown: CONFIG.gracefulRampDown,
    },
  },
  thresholds: {
    spacey_api_issue_ms: ["p(95)<250"],
    spacey_ws_connect_ms: ["p(95)<2000"],
    spacey_snapshot_gap_ms: ["p(95)<250"],
    spacey_reward_finalization_ms: ["p(95)<1000"],
    spacey_ws_connect_success: ["rate>0.995"],
    spacey_snapshot_success: ["rate>0.99"],
    spacey_reconnect_success: ["rate>0.99"],
    spacey_reward_exactly_once: ["rate==1"],
    spacey_battle_ended: ["rate==1"],
    spacey_protocol_errors: ["count==0"],
    checks: ["rate>0.99"],
  },
};

export function pvpParticipant() {
  const lease = acquireLease();
  const chaos = selectChaos(__VU, __ITER, CONFIG);
  let result = runSocket(lease, 0, chaos);

  if (result.deliberateDisconnect) {
    const resumed = acquireReconnect(lease);
    result = runSocket(resumed, result.lastSequence, "none");
    reconnectSuccess.add(result.opened && result.snapshotSeen);
  }

  battleEnded.add(result.ended);
  if (result.ended) verifyFinalization(lease);
}

export function teardown() {
  const response = http.post(
    `${CONFIG.brokerUrl}/v1/load/pvp/runs/${encodeURIComponent(CONFIG.runId)}:close`,
    JSON.stringify({ environment: CONFIG.environment, profile: CONFIG.profile }),
    { ...brokerParams(), timeout: `${CONFIG.runCloseTimeoutSeconds}s` },
  );
  if (response.status !== 200) fail(`Broker run close failed with HTTP ${response.status}.`);
  const summary = parseJson(response);
  const exactPairs = summary.environment === CONFIG.environment
    && summary.runId === CONFIG.runId
    && summary.profile === CONFIG.profile
    && summary.state === "closed"
    && summary.peakConcurrentLoadParticipants >= CONFIG.connections
    && summary.peakConcurrentPairedDuels >= CONFIG.connections / 2
    && Number.isInteger(summary.participantLeaseCount)
    && summary.participantLeaseCount > 0
    && summary.participantLeaseCount % 2 === 0
    && summary.uniqueParticipantLeaseCount === summary.participantLeaseCount
    && summary.pairCount * 2 === summary.participantLeaseCount
    && summary.side0LeaseCount === summary.pairCount
    && summary.side1LeaseCount === summary.pairCount
    && summary.battleEndedParticipantCount === summary.participantLeaseCount
    && summary.finalizedDuelCount === summary.pairCount
    && summary.unpairedParticipantCount === 0
    && summary.duplicateRewardCount === 0;
  if (!exactPairs) fail("Broker run summary did not prove complete two-sided pairing and finalization.");
}

function acquireLease() {
  const response = http.post(
    `${CONFIG.brokerUrl}/v1/load/pvp/participants:lease`,
    JSON.stringify({
      runId: CONFIG.runId,
      environment: CONFIG.environment,
      brokerMode: CONFIG.brokerMode,
      vu: __VU,
      iteration: __ITER,
      protocolVersion: PROTOCOL,
    }),
    brokerParams(),
  );
  if (!check(response, { "broker leased a paired participant": (value) => value.status === 200 })) {
    fail(`Participant lease failed with HTTP ${response.status}.`);
  }
  return validateLease(parseJson(response), null);
}

function acquireReconnect(previous) {
  const response = http.post(
    `${CONFIG.brokerUrl}/v1/load/pvp/participants/${encodeURIComponent(previous.leaseId)}:reconnect`,
    JSON.stringify({ runId: CONFIG.runId, participantId: previous.participantId }),
    brokerParams(),
  );
  if (!check(response, { "broker issued a fresh reconnect ticket": (value) => value.status === 200 })) {
    reconnectSuccess.add(false);
    fail(`Reconnect ticket failed with HTTP ${response.status}.`);
  }
  const lease = validateLease(parseJson(response), previous);
  if (lease.ticket === previous.ticket) fail("Broker reused a one-time WebSocket ticket.");
  return lease;
}

function runSocket(lease, lastSequence, chaos) {
  let opened = false;
  let ended = false;
  let deliberateDisconnect = false;
  let snapshotSeen = false;
  let lastSnapshotAt = 0;
  let sequence = lastSequence;
  const connectStartedAt = Date.now();

  ws.connect(lease.websocketUrl, {
    headers: {
      Origin: CONFIG.origin,
      "Sec-WebSocket-Protocol": `${PROTOCOL}, ticket.${lease.ticket}`,
    },
    tags: { run_id: CONFIG.runId, environment: CONFIG.environment, mode: "pvp" },
  }, (socket) => {
    socket.on("open", () => {
      opened = true;
      wsConnectMs.add(Date.now() - connectStartedAt);
      wsConnectSuccess.add(true);
      if (lastSequence > 0) socket.sendBinary(exactArrayBuffer(encodeSessionResume(lastSequence)));
    });

    socket.on("binaryMessage", (frame) => {
      let field;
      try {
        field = serverEnvelopeField(frame);
      } catch (_error) {
        protocolErrors.add(1);
        return;
      }
      if (field === ServerEnvelopeField.snapshot) {
        const now = Date.now();
        if (lastSnapshotAt > 0) snapshotGapMs.add(now - lastSnapshotAt);
        lastSnapshotAt = now;
        snapshotSeen = true;
      } else if (field === ServerEnvelopeField.ended) {
        ended = true;
        socket.close(1000, "authoritative battle ended");
      } else if (field === ServerEnvelopeField.error) {
        protocolErrors.add(1);
      }
    });

    socket.on("error", () => {
      if (!opened) wsConnectSuccess.add(false);
    });

    socket.setInterval(() => {
      sequence += 1;
      const command = encodeInputCommand(sequence, sequence % 3 === 0 ? 1 : 0);
      if (chaos === "drop" && sequence % CONFIG.chaosEvery === 0) return;
      if (chaos === "reorder" && sequence % CONFIG.chaosEvery === 0) {
        const newer = encodeInputCommand(sequence + 1, 1);
        socket.sendBinary(exactArrayBuffer(newer));
        socket.sendBinary(exactArrayBuffer(command));
        sequence += 1;
        inputCommands.add(2);
        return;
      }
      socket.sendBinary(exactArrayBuffer(command));
      inputCommands.add(1);
      if (chaos === "duplicate" && sequence % CONFIG.chaosEvery === 0) {
        socket.sendBinary(exactArrayBuffer(command));
        inputCommands.add(1);
      }
    }, 1000 / 30);

    if (chaos === "disconnect") {
      socket.setTimeout(() => {
        deliberateDisconnect = true;
        socket.close(4000, "staging chaos reconnect");
      }, CONFIG.disconnectAfterSeconds * 1000);
    }
    socket.setTimeout(() => socket.close(4001, "load session deadline"), CONFIG.sessionDeadlineSeconds * 1000);
  });

  if (!opened) wsConnectSuccess.add(false);
  snapshotSuccess.add(snapshotSeen);
  return { opened, ended, deliberateDisconnect, snapshotSeen, lastSequence: sequence };
}

function verifyFinalization(lease) {
  const deadline = Date.now() + CONFIG.resultWaitSeconds * 1000;
  while (Date.now() < deadline) {
    const response = http.get(
      `${CONFIG.brokerUrl}/v1/load/pvp/duels/${encodeURIComponent(lease.duelId)}/result?participantId=${encodeURIComponent(lease.participantId)}`,
      brokerParams(),
    );
    if (response.status === 200) {
      const result = parseJson(response);
      if (result.state === "finalized") {
        const participants = Array.isArray(result.participants) ? result.participants : [];
        const participantIds = new Set(participants.map((participant) => participant.participantId));
        const sides = participants.map((participant) => participant.side).sort();
        const pairProven = result.environment === CONFIG.environment
          && result.runId === CONFIG.runId
          && result.pairId === lease.pairId
          && result.duelId === lease.duelId
          && participants.length === 2
          && participantIds.size === 2
          && participantIds.has(lease.participantId)
          && participantIds.has(lease.opponentParticipantId)
          && sides[0] === 0
          && sides[1] === 1
          && participants.every((participant) => participant.finalized === true);
        const exact = pairProven
          && result.resultCount === 1
          && result.participantsFinalized === 2
          && result.duplicateRewardCount === 0;
        rewardExactlyOnce.add(exact);
        if (!exact) {
          protocolErrors.add(1);
          fail("Authoritative observer did not prove one paired, two-sided, exactly-once finalization.");
        }
        if (!Number.isFinite(result.finalizationDurationMs) || result.finalizationDurationMs < 0) {
          fail("Broker returned an invalid authoritative finalization duration.");
        }
        rewardFinalizationMs.add(result.finalizationDurationMs);
        return;
      }
    }
    sleep(0.2);
  }
  rewardExactlyOnce.add(false);
  protocolErrors.add(1);
  fail("Authoritative finalization was not observed before the deadline.");
}

function validateLease(value, previous) {
  if (!value || value.environment !== CONFIG.environment || value.runId !== CONFIG.runId) {
    fail("Broker environment/run identity mismatch.");
  }
  if (value.brokerMode !== CONFIG.brokerMode || value.participantCount !== 2 || value.pairReady !== true) {
    fail("Broker did not prove a two-participant duel lease.");
  }
  for (const key of ["leaseId", "opponentLeaseId", "pairId", "duelId", "participantId", "opponentParticipantId", "ticket", "ticketExpiresAt", "websocketUrl"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) fail(`Invalid lease field: ${key}.`);
  }
  if (value.opponentLeaseId === value.leaseId) fail("Broker returned the same lease on both sides.");
  if ((value.side !== 0 && value.side !== 1) || !/^[A-Za-z0-9_-]{16,4096}$/.test(value.ticket)) {
    fail("Invalid participant side or ticket format.");
  }
  if ((value.opponentSide !== 0 && value.opponentSide !== 1) || value.opponentSide === value.side) {
    fail("Broker did not prove opposite sides for the paired duel.");
  }
  if (value.opponentParticipantId === value.participantId) fail("Broker returned the same participant on both sides.");
  const expiresAt = Date.parse(value.ticketExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 45_000) {
    fail("Ticket is expired or is not a short-lived ticket.");
  }
  const wsUrl = checkedUrl(value.websocketUrl, "wss:");
  assertAllowedHost(wsUrl.hostname);
  if (previous && (
    value.pairId !== previous.pairId
    || value.duelId !== previous.duelId
    || value.opponentLeaseId !== previous.opponentLeaseId
    || value.participantId !== previous.participantId
    || value.opponentParticipantId !== previous.opponentParticipantId
    || value.side !== previous.side
    || value.opponentSide !== previous.opponentSide
  )) {
    fail("Reconnect lease changed participant identity.");
  }
  if (!Number.isFinite(value.apiIssueDurationMs) || value.apiIssueDurationMs < 0) {
    fail("Broker omitted direct first-party API timing.");
  }
  apiIssueMs.add(value.apiIssueDurationMs);
  return value;
}

function brokerParams() {
  return {
    timeout: "20s",
    headers: {
      Authorization: `Bearer ${CONFIG.brokerToken}`,
      "Content-Type": "application/json",
      "X-SpaceY-Load-Run": CONFIG.runId,
    },
    tags: { name: "staging-ticket-broker", run_id: CONFIG.runId },
  };
}

function parseJson(response) {
  try {
    return response.json();
  } catch (_error) {
    fail("Staging broker returned non-JSON data.");
  }
}

function selectChaos(vu, iteration, config) {
  if (config.chaosProfile === "none") return "none";
  const bucket = ((vu * 31) + iteration) % 100;
  if (bucket < config.disconnectPercent) return "disconnect";
  if (bucket < config.disconnectPercent + config.duplicatePercent) return "duplicate";
  if (bucket < config.disconnectPercent + config.duplicatePercent + config.reorderPercent) return "reorder";
  if (bucket < config.disconnectPercent + config.duplicatePercent + config.reorderPercent + config.dropPercent) return "drop";
  return "none";
}

function loadConfig(env) {
  if (env.SPACEY_LOAD_CONFIRM !== "STAGING_ONLY_I_ACCEPT_COST") throw new Error("Missing staging load confirmation.");
  const environment = required(env, "SPACEY_LOAD_ENVIRONMENT");
  if (!/^(staging|preprod|loadtest)$/.test(environment)) throw new Error("Production environment is forbidden.");
  const profile = required(env, "SPACEY_LOAD_PROFILE");
  const profileConnections = new Map([
    ["smoke", 2],
    ["step100", 100],
    ["step500", 500],
    ["step1000", 1000],
    ["acceptance", 10_000],
  ]);
  const expectedConnections = profileConnections.get(profile);
  if (!expectedConnections) throw new Error("Invalid SPACEY_LOAD_PROFILE.");
  const connections = integer(env, "SPACEY_LOAD_CONNECTIONS", expectedConnections, 2, 10_000);
  if (connections !== expectedConnections) throw new Error(`${profile} requires exactly ${expectedConnections} connections.`);
  const allowedHosts = csv(required(env, "SPACEY_LOAD_ALLOWED_HOSTS"));
  const deniedHosts = new Set(["spacey.aima.space", ...csv(required(env, "SPACEY_LOAD_DENY_HOSTS"))]);
  for (const host of allowedHosts) if (deniedHosts.has(host)) throw new Error(`Production-denied host: ${host}.`);
  const brokerUrl = checkedUrl(required(env, "SPACEY_LOAD_BROKER_URL"), "https:");
  const origin = checkedUrl(required(env, "SPACEY_LOAD_ORIGIN"), "https:");
  if (!allowedHosts.has(brokerUrl.hostname) || !allowedHosts.has(origin.hostname)) throw new Error("Broker/origin host is not allowlisted.");
  const brokerToken = required(env, "SPACEY_LOAD_BROKER_TOKEN");
  if (brokerToken.length < 32) throw new Error("Broker token must contain at least 32 characters.");
  const runId = required(env, "SPACEY_LOAD_RUN_ID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(runId)) throw new Error("Invalid load run id.");
  const brokerMode = required(env, "SPACEY_LOAD_BROKER_MODE");
  if (brokerMode !== "matchmaking" && brokerMode !== "preissued") throw new Error("Invalid broker mode.");
  const chaosProfile = env.SPACEY_LOAD_CHAOS ?? "mixed";
  if (chaosProfile !== "mixed" && chaosProfile !== "none") throw new Error("Invalid chaos profile.");
  const rampDuration = duration(env.SPACEY_LOAD_RAMP_DURATION ?? "10m");
  const plateauDuration = duration(env.SPACEY_LOAD_PLATEAU_DURATION ?? "15m");
  const rampDownDuration = duration(env.SPACEY_LOAD_RAMP_DOWN_DURATION ?? "5m");
  const smokeStepDuration = duration(env.SPACEY_LOAD_SMOKE_STEP_DURATION ?? "2m");
  const tierStepDuration = duration(env.SPACEY_LOAD_TIER_STEP_DURATION ?? "3m");
  const gracefulRampDown = duration(env.SPACEY_LOAD_GRACEFUL_RAMP_DOWN ?? "3m");
  if (profile === "acceptance") {
    durationAtLeast(smokeStepDuration, 120_000, "SPACEY_LOAD_SMOKE_STEP_DURATION");
    durationAtLeast(tierStepDuration, 180_000, "SPACEY_LOAD_TIER_STEP_DURATION");
    durationAtLeast(rampDuration, 600_000, "SPACEY_LOAD_RAMP_DURATION");
    durationAtLeast(plateauDuration, 900_000, "SPACEY_LOAD_PLATEAU_DURATION");
    durationAtLeast(rampDownDuration, 300_000, "SPACEY_LOAD_RAMP_DOWN_DURATION");
    durationAtLeast(gracefulRampDown, 180_000, "SPACEY_LOAD_GRACEFUL_RAMP_DOWN");
  }
  const stages = profile === "acceptance"
    ? [
      { duration: smokeStepDuration, target: 2 },
      { duration: tierStepDuration, target: 100 },
      { duration: tierStepDuration, target: 500 },
      { duration: tierStepDuration, target: 1000 },
      { duration: rampDuration, target: 10000 },
      { duration: plateauDuration, target: 10000 },
      { duration: rampDownDuration, target: 0 },
    ]
    : [
      { duration: smokeStepDuration, target: connections },
      { duration: plateauDuration, target: connections },
      { duration: rampDownDuration, target: 0 },
    ];
  const config = {
    environment, profile, connections, allowedHosts, deniedHosts,
    brokerUrl: brokerUrl.href.replace(/\/$/, ""), origin: origin.origin, brokerToken, runId, brokerMode, chaosProfile,
    stages,
    gracefulRampDown,
    runCloseTimeoutSeconds: integer(env, "SPACEY_LOAD_RUN_CLOSE_TIMEOUT_SECONDS", 180, 30, 600),
    disconnectAfterSeconds: integer(env, "SPACEY_LOAD_DISCONNECT_AFTER_SECONDS", 10, 2, 120),
    sessionDeadlineSeconds: integer(env, "SPACEY_LOAD_SESSION_DEADLINE_SECONDS", 180, 30, 900),
    resultWaitSeconds: integer(env, "SPACEY_LOAD_RESULT_WAIT_SECONDS", 5, 1, 30),
    chaosEvery: integer(env, "SPACEY_LOAD_CHAOS_EVERY", 30, 2, 300),
    disconnectPercent: integer(env, "SPACEY_LOAD_DISCONNECT_PERCENT", 5, 0, 25),
    duplicatePercent: integer(env, "SPACEY_LOAD_DUPLICATE_PERCENT", 5, 0, 25),
    reorderPercent: integer(env, "SPACEY_LOAD_REORDER_PERCENT", 5, 0, 25),
    dropPercent: integer(env, "SPACEY_LOAD_DROP_PERCENT", 5, 0, 25),
  };
  if (config.disconnectPercent + config.duplicatePercent + config.reorderPercent + config.dropPercent > 50) {
    throw new Error("Chaos allocation may not exceed 50% of participants.");
  }
  return config;
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing ${name}.`);
  return value.trim();
}

function integer(env, name, fallback, minimum, maximum) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}

function duration(value) {
  if (!/^\d+(ms|s|m|h)$/.test(value)) throw new Error(`Invalid k6 duration: ${value}.`);
  return value;
}

function durationAtLeast(value, minimumMs, name) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid ${name}.`);
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  if (Number(match[1]) * multipliers[match[2]] < minimumMs) throw new Error(`${name} is too short for acceptance.`);
}

function csv(value) {
  const values = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) throw new Error("Host list must not be empty.");
  return new Set(values);
}

function checkedUrl(value, protocol) {
  const parsed = new URL(value);
  if (parsed.protocol !== protocol || parsed.username || parsed.password) throw new Error(`Only credential-free ${protocol} URLs are accepted.`);
  return parsed;
}

function assertAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  if (!CONFIG.allowedHosts.has(host) || CONFIG.deniedHosts.has(host)) fail(`Target host is forbidden: ${host}.`);
}
