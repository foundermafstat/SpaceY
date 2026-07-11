import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PlayerAccessGuard, type PlayerRequest } from "../auth/player-access.guard.js";
import { MatchmakingService } from "./matchmaking.service.js";

const id = z.string().uuid();
const createTicketSchema = z.object({
  shipBuildRevisionId: z.string().uuid(),
  queue: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  idempotencyKey: z.string().min(16).max(128),
});

@Controller("api/v1/pvp/matchmaking-tickets")
@UseGuards(PlayerAccessGuard)
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Post()
  @HttpCode(202)
  create(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.matchmaking.create(request.player.userId, createTicketSchema.parse(body));
  }

  @Get(":ticketId")
  async status(@Req() request: PlayerRequest, @Param("ticketId") ticketId: string) {
    const ticket = await this.matchmaking.get(request.player.userId, id.parse(ticketId));
    if (!ticket) throw new NotFoundException();
    return ticket;
  }

  @Post(":ticketId/cancel")
  @HttpCode(200)
  async cancel(@Req() request: PlayerRequest, @Param("ticketId") ticketId: string) {
    const ticket = await this.matchmaking.cancel(request.player.userId, id.parse(ticketId));
    if (!ticket) throw new NotFoundException();
    return ticket;
  }

  @Post(":ticketId/connection")
  async connection(@Req() request: PlayerRequest, @Param("ticketId") ticketId: string) {
    const connection = await this.matchmaking.connection(request.player.userId, id.parse(ticketId));
    if (!connection) throw new NotFoundException();
    return connection;
  }
}
