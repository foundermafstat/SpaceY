import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PlayerAccessGuard, type PlayerRequest } from "../auth/player-access.guard.js";
import { ResultsService } from "./results.service.js";

const uuid = z.string().uuid();
const idempotencyKey = z.string().min(16).max(128);
const repairQuoteSchema = z.object({ inventoryItemId: uuid, idempotencyKey }).strict();
const commitRepairSchema = z.object({ quoteId: uuid, idempotencyKey }).strict();

@Controller("api/v1")
@UseGuards(PlayerAccessGuard)
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get("battle-results/:resultId")
  async getResult(@Req() request: PlayerRequest, @Param("resultId") resultId: string) {
    const result = await this.results.get(request.player.userId, uuid.parse(resultId));
    if (!result) throw new NotFoundException();
    return result;
  }

  @Get("battle-results")
  listResults(
    @Req() request: PlayerRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedCursor = cursor ? uuid.parse(cursor) : null;
    const parsedLimit = limit === undefined ? 20 : z.coerce.number().int().min(1).max(50).parse(limit);
    return this.results.list(request.player.userId, parsedCursor, parsedLimit);
  }

  @Post("repairs/quotes")
  quoteRepair(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.results.quoteRepair(request.player.userId, repairQuoteSchema.parse(body));
  }

  @Post("repairs")
  commitRepair(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.results.commitRepair(request.player.userId, commitRepairSchema.parse(body));
  }
}
