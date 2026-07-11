import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PlayerAccessGuard, type PlayerRequest } from "../auth/player-access.guard.js";
import { GameService } from "./game.service.js";

const id = z.string().uuid();
const buildCommandsSchema = z.object({
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(16).max(128),
  commands: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("rename"), name: z.string().min(1).max(64) }),
    z.object({ type: z.literal("install"), inventoryItemId: z.string().uuid(), gridX: z.number().int(), gridY: z.number().int(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }),
    z.object({ type: z.literal("move"), inventoryItemId: z.string().uuid(), gridX: z.number().int(), gridY: z.number().int(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }),
    z.object({ type: z.literal("remove"), inventoryItemId: z.string().uuid() })
  ])).min(1).max(128)
});
const missionAttemptSchema = z.object({
  missionId: z.string().min(1).max(128),
  shipBuildRevisionId: z.string().uuid(),
  idempotencyKey: z.string().min(16).max(128)
});
const legacyPart = z.object({
  sourceInstanceId: z.string().min(1).max(128),
  kind: z.enum(["panel", "module", "element"]),
  definitionId: z.string().min(1).max(128),
  gridX: z.number().int(),
  gridY: z.number().int(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
});
const legacyBuildSchema = z.object({
  schemaVersion: z.literal(3),
  sourceBuildId: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  frameId: z.string().min(1).max(128),
  cabin: z.object({
    definitionId: z.string().min(1).max(128),
    gridX: z.number().int(),
    gridY: z.number().int(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
  }).optional(),
  parts: z.array(legacyPart).max(256)
});

@Controller("api/v1")
@UseGuards(PlayerAccessGuard)
export class GameController {
  constructor(private readonly game: GameService) {}

  @Get("bootstrap")
  bootstrap(@Req() request: PlayerRequest) {
    return this.game.bootstrap(request.player.userId);
  }

  @Put("builds/:buildId/commands")
  applyBuildCommands(@Req() request: PlayerRequest, @Param("buildId") buildId: string, @Body() body: unknown) {
    return this.game.applyBuildCommands(request.player.userId, id.parse(buildId), buildCommandsSchema.parse(body));
  }

  @Post("builds/legacy-import-proposals")
  @HttpCode(200)
  importLegacyBuild(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.game.importLegacyBuild(request.player.userId, legacyBuildSchema.parse(body));
  }

  @Post("mission-attempts")
  createMissionAttempt(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.game.createMissionAttempt(request.player.userId, missionAttemptSchema.parse(body));
  }

  @Post("mission-attempts/:attemptId/reconnect")
  async reconnectMissionAttempt(@Req() request: PlayerRequest, @Param("attemptId") attemptId: string) {
    const connection = await this.game.reconnectMissionAttempt(request.player.userId, id.parse(attemptId));
    if (!connection) throw new NotFoundException();
    return connection;
  }

  @Get("mission-attempts/:attemptId")
  async getMissionAttempt(@Req() request: PlayerRequest, @Param("attemptId") attemptId: string) {
    const status = await this.game.getAttemptStatus(request.player.userId, id.parse(attemptId));
    if (!status) throw new NotFoundException();
    return status;
  }
}
