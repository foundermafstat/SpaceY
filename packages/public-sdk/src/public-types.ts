import type { components, operations } from "./generated/schema.js";

export type PublicApiError = components["schemas"]["ApiError"];
export type PublicCatalog = components["schemas"]["PublicCatalog"];
export type PublicLeaderboardEntry = components["schemas"]["LeaderboardEntry"];
export type PublicProfile = components["schemas"]["PublicProfile"];
export type PublicAggregateStats = components["schemas"]["PublicAggregateStats"];
export type PublicWebhookEnvelope = components["schemas"]["SignedWebhookEnvelope"];
export type PublicWebhookEventType = PublicWebhookEnvelope["type"];

export type PublicOAuthClientCredentials =
  operations["createPublicAccessToken"]["requestBody"]["content"]["application/x-www-form-urlencoded"];

export type PublicOAuthToken =
  operations["createPublicAccessToken"]["responses"][200]["content"]["application/json"];
