import assert from "node:assert/strict";
import test from "node:test";
import type { MissionSimulationConfig } from "@spacey/simulation";
import type { BattleTicketStore } from "../battle/battle-ticket.store.js";
import type { PlatformRepository } from "../platform/platform.repository.js";
import { GameService } from "./game.service.js";

test("creating a PvE attempt does not issue an unused connection ticket", async () => {
  let ticketStoreCalls = 0;
  const repository = {
    async createMissionAttempt() {
      return {
        sessionId: "01900000-0000-7000-8000-000000000201",
        attemptId: "01900000-0000-7000-8000-000000000202",
        mode: "pve" as const,
        simulationConfig: {} as MissionSimulationConfig,
        previousTicketHash: "a".repeat(64),
        ticketVersion: 0,
      };
    },
    async getMissionAttemptStatus() {
      return {
        sessionId: "01900000-0000-7000-8000-000000000201",
        attemptId: "01900000-0000-7000-8000-000000000202",
        status: "queued" as const,
        resultId: null,
        reconnect: { permitted: true, deadlineAt: null, lastAcknowledgedInputSequence: 0 },
      };
    },
  } as unknown as PlatformRepository;
  const tickets = {
    async issueDefinition() { ticketStoreCalls += 1; },
    async rotatePveTicket() { ticketStoreCalls += 1; },
  } as unknown as BattleTicketStore;
  const service = new GameService(repository, tickets);

  const attempt = await service.createMissionAttempt("player", {
    missionId: "starter-scout",
    shipBuildRevisionId: "01900000-0000-7000-8000-000000000203",
    idempotencyKey: "mission-create-0001",
  });

  assert.equal(ticketStoreCalls, 0);
  assert.deepEqual(Object.keys(attempt).sort(), [
    "attemptId",
    "reconnect",
    "resultId",
    "sessionId",
    "status",
  ]);
  assert.equal("ticket" in attempt, false);
});

test("PvE connection DTO does not expose simulation config or internal ticket metadata", async () => {
  let rotatedVersion = 0;
  const repository = {
    async renewMissionAttemptTicket() {
      return {
        sessionId: "01900000-0000-7000-8000-000000000201",
        attemptId: "01900000-0000-7000-8000-000000000202",
        mode: "pve" as const,
        simulationConfig: {} as MissionSimulationConfig,
        previousTicketHash: "a".repeat(64),
        ticketVersion: 7,
      };
    },
  } as unknown as PlatformRepository;
  const tickets = {
    async issueDefinition() {},
    async rotatePveTicket(input: { ticketVersion: number }) {
      rotatedVersion = input.ticketVersion;
    },
  } as unknown as BattleTicketStore;
  const service = new GameService(repository, tickets);

  const connection = await service.reconnectMissionAttempt("player", "01900000-0000-7000-8000-000000000202");
  assert.ok(connection);
  assert.equal(rotatedVersion, 7);
  assert.equal("simulationConfig" in connection, false);
  assert.equal("previousTicketHash" in connection, false);
  assert.equal("ticketVersion" in connection, false);
});

test("abandoning a PvE attempt revokes its outstanding ticket", async () => {
  const attemptId = "01900000-0000-7000-8000-000000000202";
  let revokedAttemptId: string | null = null;
  const repository = {
    async abandonMissionAttempt() {
      return {
        sessionId: "01900000-0000-7000-8000-000000000201",
        attemptId,
        status: "failed" as const,
        resultId: null,
        reconnect: { permitted: false, deadlineAt: null, lastAcknowledgedInputSequence: 0 },
      };
    },
  } as unknown as PlatformRepository;
  const tickets = {
    async revokeAttempt(value: string) { revokedAttemptId = value; },
  } as unknown as BattleTicketStore;

  const service = new GameService(repository, tickets);
  await service.abandonMissionAttempt("player", attemptId);
  assert.equal(revokedAttemptId, attemptId);
});
