import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { isIP } from "node:net";
import { z } from "zod";
import { PlayerAccessGuard, type PlayerRequest } from "../auth/player-access.guard.js";
import {
  PUBLIC_API_SCOPES,
  PUBLIC_WEBHOOK_EVENT_TYPES,
} from "./developer-api.types.js";
import { DeveloperApiService } from "./developer-api.service.js";

const uuidSchema = z.string().uuid();
const scopeSchema = z.enum(PUBLIC_API_SCOPES);
const eventTypeSchema = z.enum(PUBLIC_WEBHOOK_EVENT_TYPES);
const overlapSchema = z.object({
  overlapSeconds: z.number().int().min(60).max(86_400).default(3_600),
}).strict();
const createClientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(scopeSchema).min(1).max(PUBLIC_API_SCOPES.length).refine(unique),
}).strict();
const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(scopeSchema).min(1).max(PUBLIC_API_SCOPES.length).refine(unique),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(90),
}).strict();
const createWebhookSchema = z.object({
  url: z.string().url().max(2048).refine(isSafeWebhookUrl, "Webhook URL must be a public HTTPS URL."),
  eventTypes: z.array(eventTypeSchema).min(1).max(PUBLIC_WEBHOOK_EVENT_TYPES.length).refine(unique),
}).strict();

@Controller("api/v1/developer/clients")
@UseGuards(PlayerAccessGuard)
export class DeveloperApiController {
  constructor(private readonly developerApi: DeveloperApiService) {}

  @Get()
  list(@Req() request: PlayerRequest) {
    return this.developerApi.list(request.player.userId);
  }

  @Post()
  create(@Req() request: PlayerRequest, @Body() body: unknown) {
    return this.developerApi.createClient(request.player.userId, createClientSchema.parse(body));
  }

  @Post(":apiClientId/oauth-secret/rotate")
  @HttpCode(200)
  rotateOAuthSecret(@Req() request: PlayerRequest, @Param("apiClientId") rawClientId: string, @Body() body: unknown) {
    return this.developerApi.rotateOAuthSecret(
      request.player.userId,
      uuidSchema.parse(rawClientId),
      overlapSchema.parse(body).overlapSeconds,
    );
  }

  @Post(":apiClientId/revoke")
  @HttpCode(200)
  revokeClient(@Req() request: PlayerRequest, @Param("apiClientId") rawClientId: string) {
    return this.developerApi.revokeClient(request.player.userId, uuidSchema.parse(rawClientId));
  }

  @Post(":apiClientId/keys")
  createKey(@Req() request: PlayerRequest, @Param("apiClientId") rawClientId: string, @Body() body: unknown) {
    return this.developerApi.createApiKey(
      request.player.userId,
      uuidSchema.parse(rawClientId),
      createKeySchema.parse(body),
    );
  }

  @Post(":apiClientId/keys/:apiKeyId/rotate")
  @HttpCode(200)
  rotateKey(
    @Req() request: PlayerRequest,
    @Param("apiClientId") rawClientId: string,
    @Param("apiKeyId") rawKeyId: string,
    @Body() body: unknown,
  ) {
    return this.developerApi.rotateApiKey(
      request.player.userId,
      uuidSchema.parse(rawClientId),
      uuidSchema.parse(rawKeyId),
      overlapSchema.parse(body).overlapSeconds,
    );
  }

  @Post(":apiClientId/keys/:apiKeyId/revoke")
  @HttpCode(200)
  revokeKey(
    @Req() request: PlayerRequest,
    @Param("apiClientId") rawClientId: string,
    @Param("apiKeyId") rawKeyId: string,
  ) {
    return this.developerApi.revokeApiKey(request.player.userId, uuidSchema.parse(rawClientId), uuidSchema.parse(rawKeyId));
  }

  @Post(":apiClientId/webhooks")
  createWebhook(@Req() request: PlayerRequest, @Param("apiClientId") rawClientId: string, @Body() body: unknown) {
    return this.developerApi.createWebhook(
      request.player.userId,
      uuidSchema.parse(rawClientId),
      createWebhookSchema.parse(body),
    );
  }

  @Post(":apiClientId/webhooks/:webhookId/rotate")
  @HttpCode(200)
  rotateWebhook(
    @Req() request: PlayerRequest,
    @Param("apiClientId") rawClientId: string,
    @Param("webhookId") rawWebhookId: string,
    @Body() body: unknown,
  ) {
    return this.developerApi.rotateWebhookSecret(
      request.player.userId,
      uuidSchema.parse(rawClientId),
      uuidSchema.parse(rawWebhookId),
      overlapSchema.parse(body).overlapSeconds,
    );
  }

  @Post(":apiClientId/webhooks/:webhookId/revoke")
  @HttpCode(200)
  revokeWebhook(
    @Req() request: PlayerRequest,
    @Param("apiClientId") rawClientId: string,
    @Param("webhookId") rawWebhookId: string,
  ) {
    return this.developerApi.revokeWebhook(request.player.userId, uuidSchema.parse(rawClientId), uuidSchema.parse(rawWebhookId));
  }
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function isSafeWebhookUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return isIP(host.replace(/^\[|\]$/g, "")) === 0 && host !== "localhost" && !host.endsWith(".local");
}
