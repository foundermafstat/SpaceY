import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PlayerAccessGuard, type PlayerRequest } from "../auth/player-access.guard.js";
import { PrivacyService } from "./privacy.service.js";

const privacyPreferencesSchema = z.object({
  profilePublic: z.boolean(),
  analyticsConsent: z.boolean()
}).strict();

const privacyRequestSchema = z.object({
  type: z.enum(["export", "delete"]),
  idempotencyKey: z.string().min(16).max(128)
}).strict();

const requestIdSchema = z.string().uuid();

@Controller("api/v1/privacy")
@UseGuards(PlayerAccessGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("preferences")
  getPreferences(@Req() request: PlayerRequest) {
    return this.privacy.getPreferences(request.player.userId);
  }

  @Put("preferences")
  updatePreferences(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.privacy.updatePreferences(request.player.userId, privacyPreferencesSchema.parse(body));
  }

  @Post("requests")
  @HttpCode(202)
  createRequest(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.privacy.createRequest(request.player.userId, privacyRequestSchema.parse(body));
  }

  @Get("requests/:requestId")
  getRequest(@Req() request: PlayerRequest, @Param("requestId") requestId: string) {
    return this.privacy.getRequest(request.player.userId, requestIdSchema.parse(requestId));
  }

  @Post("requests/:requestId/download")
  @HttpCode(200)
  createDownload(@Req() request: PlayerRequest, @Param("requestId") requestId: string) {
    return this.privacy.createDownload(request.player.userId, requestIdSchema.parse(requestId));
  }
}
