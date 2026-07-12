import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { createUuidV7 } from "@spacey/db";
import { ApiError } from "../common/api-error.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import type { PublicApiScope, PublicWebhookEventType } from "./developer-api.types.js";
import { PublicTokenService } from "./public-token.service.js";

const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

@Injectable()
export class DeveloperApiService {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly tokens: PublicTokenService,
  ) {}

  list(userId: string) {
    return this.repository.listDeveloperApiClients(userId);
  }

  async createClient(userId: string, input: { name: string; scopes: PublicApiScope[] }) {
    const clientId = randomCredential("spc", 18);
    const oauthClientSecret = randomCredential("spsec", 32);
    const client = await this.repository.createDeveloperApiClient(userId, {
      id: createUuidV7(),
      clientId,
      clientSecretHash: this.tokens.hashCredential(oauthClientSecret),
      name: input.name,
      scopes: input.scopes,
      rateLimitPerMinute: DEFAULT_RATE_LIMIT_PER_MINUTE,
    });
    return { client, oauthClientSecret };
  }

  async rotateOAuthSecret(userId: string, apiClientId: string, overlapSeconds: number) {
    const oauthClientSecret = randomCredential("spsec", 32);
    const previousSecretExpiresAt = overlapExpiry(overlapSeconds);
    const client = await this.repository.rotateDeveloperOAuthSecret(
      userId,
      apiClientId,
      this.tokens.hashCredential(oauthClientSecret),
      previousSecretExpiresAt,
    );
    if (!client) throw notFound("api_client_not_found", "API client not found.");
    return { client, oauthClientSecret, previousSecretExpiresAt: previousSecretExpiresAt.toISOString() };
  }

  async revokeClient(userId: string, apiClientId: string) {
    if (!await this.repository.revokeDeveloperApiClient(userId, apiClientId)) {
      throw notFound("api_client_not_found", "API client not found.");
    }
    return { ok: true } as const;
  }

  async createApiKey(userId: string, apiClientId: string, input: {
    name: string;
    scopes: PublicApiScope[];
    expiresInDays: number | null;
  }) {
    const apiKey = randomCredential("spk", 32);
    const keyPrefix = apiKey.slice(0, 16);
    const client = await this.repository.createDeveloperApiKey(userId, {
      id: createUuidV7(),
      apiClientId,
      keyPrefix,
      secretHash: this.tokens.hashCredential(apiKey),
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresInDays === null
        ? null
        : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1_000),
    });
    if (!client) throw notFound("api_client_not_found", "API client not found or scopes are not allowed.");
    return { client, apiKey, keyPrefix };
  }

  async rotateApiKey(userId: string, apiClientId: string, apiKeyId: string, overlapSeconds: number) {
    const current = (await this.repository.listDeveloperApiClients(userId))
      .find((client) => client.id === apiClientId);
    const previous = current?.apiKeys.find((key) => key.id === apiKeyId && !key.revokedAt);
    if (!current || !previous) throw notFound("api_key_not_found", "API key not found.");

    const apiKey = randomCredential("spk", 32);
    const keyPrefix = apiKey.slice(0, 16);
    const previousKeyExpiresAt = overlapExpiry(overlapSeconds);
    const client = await this.repository.rotateDeveloperApiKey(userId, apiClientId, apiKeyId, {
      id: createUuidV7(),
      apiClientId,
      keyPrefix,
      secretHash: this.tokens.hashCredential(apiKey),
      name: previous.name,
      scopes: previous.scopes,
      expiresAt: null,
    }, previousKeyExpiresAt);
    if (!client) throw notFound("api_key_not_found", "API key not found.");
    return { client, apiKey, keyPrefix, previousKeyExpiresAt: previousKeyExpiresAt.toISOString() };
  }

  async revokeApiKey(userId: string, apiClientId: string, apiKeyId: string) {
    if (!await this.repository.revokeDeveloperApiKey(userId, apiClientId, apiKeyId)) {
      throw notFound("api_key_not_found", "API key not found.");
    }
    return { ok: true } as const;
  }

  async createWebhook(userId: string, apiClientId: string, input: {
    url: string;
    eventTypes: PublicWebhookEventType[];
  }) {
    const webhookSecret = randomCredential("spwh", 32);
    const client = await this.repository.createDeveloperWebhook(userId, {
      id: createUuidV7(),
      apiClientId,
      url: input.url,
      secretHash: webhookSecretHash(webhookSecret),
      eventTypes: input.eventTypes,
    });
    if (!client) throw notFound("api_client_not_found", "API client not found.");
    return { client, webhookSecret };
  }

  async rotateWebhookSecret(userId: string, apiClientId: string, webhookId: string, overlapSeconds: number) {
    const webhookSecret = randomCredential("spwh", 32);
    const previousSecretExpiresAt = overlapExpiry(overlapSeconds);
    const client = await this.repository.rotateDeveloperWebhookSecret(
      userId,
      apiClientId,
      webhookId,
      webhookSecretHash(webhookSecret),
      previousSecretExpiresAt,
    );
    if (!client) throw notFound("webhook_not_found", "Webhook subscription not found.");
    return { client, webhookSecret, previousSecretExpiresAt: previousSecretExpiresAt.toISOString() };
  }

  async revokeWebhook(userId: string, apiClientId: string, webhookId: string) {
    if (!await this.repository.revokeDeveloperWebhook(userId, apiClientId, webhookId)) {
      throw notFound("webhook_not_found", "Webhook subscription not found.");
    }
    return { ok: true } as const;
  }
}

function randomCredential(prefix: string, bytes: number) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

function webhookSecretHash(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function overlapExpiry(seconds: number) {
  return new Date(Date.now() + seconds * 1_000);
}

function notFound(code: string, message: string) {
  return new ApiError(code, 404, message);
}
