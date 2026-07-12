export const PUBLIC_API_SCOPES = [
  "catalog:read",
  "leaderboards:read",
  "profiles:read",
  "stats:read",
] as const;

export type PublicApiScope = typeof PUBLIC_API_SCOPES[number];

export const PUBLIC_WEBHOOK_EVENT_TYPES = [
  "content.release.published",
  "leaderboard.updated",
  "season.started",
  "season.ended",
  "aggregate.stats.updated",
] as const;

export type PublicWebhookEventType = typeof PUBLIC_WEBHOOK_EVENT_TYPES[number];

export type DeveloperApiKeyView = Readonly<{
  id: string;
  keyPrefix: string;
  name: string;
  scopes: PublicApiScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}>;

export type DeveloperWebhookView = Readonly<{
  id: string;
  url: string;
  eventTypes: PublicWebhookEventType[];
  status: "active" | "paused" | "revoked";
  previousSecretValidUntil: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type DeveloperApiClientView = Readonly<{
  id: string;
  clientId: string;
  name: string;
  status: "active" | "suspended" | "revoked";
  scopes: PublicApiScope[];
  rateLimitPerMinute: number;
  previousOAuthSecretValidUntil: string | null;
  createdAt: string;
  updatedAt: string;
  apiKeys: DeveloperApiKeyView[];
  webhooks: DeveloperWebhookView[];
}>;

export type CreateDeveloperClientRecord = Readonly<{
  id: string;
  clientId: string;
  clientSecretHash: string;
  name: string;
  scopes: PublicApiScope[];
  rateLimitPerMinute: number;
}>;

export type CreateDeveloperApiKeyRecord = Readonly<{
  id: string;
  apiClientId: string;
  keyPrefix: string;
  secretHash: string;
  name: string;
  scopes: PublicApiScope[];
  expiresAt: Date | null;
}>;

export type CreateDeveloperWebhookRecord = Readonly<{
  id: string;
  apiClientId: string;
  url: string;
  secretHash: string;
  eventTypes: PublicWebhookEventType[];
}>;
