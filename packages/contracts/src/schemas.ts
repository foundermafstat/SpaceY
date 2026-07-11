export type JsonSchema = Readonly<Record<string, unknown>>;

const entityId = { type: "string", minLength: 1 } as const;
const isoTimestamp = { type: "string", format: "date-time" } as const;

export const contractSchemas = {
  ApiError: {
    $id: "spacey.contracts.ApiError",
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "correlationId"],
        properties: {
          code: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1 },
          correlationId: { type: "string", minLength: 1 },
          details: { type: "object", additionalProperties: true }
        }
      }
    }
  },
  TelegramAuthRequest: {
    $id: "spacey.contracts.TelegramAuthRequest",
    type: "object",
    additionalProperties: false,
    required: ["initData"],
    properties: {
      initData: { type: "string", minLength: 1, maxLength: 16384 }
    }
  },
  AuthSession: {
    $id: "spacey.contracts.AuthSession",
    type: "object",
    additionalProperties: false,
    required: ["accessToken", "accessTokenExpiresInSeconds", "refreshSessionExpiresAt", "profile"],
    properties: {
      accessToken: { type: "string", minLength: 1 },
      accessTokenExpiresInSeconds: { type: "integer", minimum: 1 },
      refreshSessionExpiresAt: isoTimestamp,
      profile: { $ref: "spacey.contracts.PlayerProfile" }
    }
  },
  PlayerProfile: {
    $id: "spacey.contracts.PlayerProfile",
    type: "object",
    additionalProperties: false,
    required: ["id", "telegramUserId", "displayName", "avatarUrl", "locale", "createdAt"],
    properties: {
      id: entityId,
      telegramUserId: { type: "string", pattern: "^[0-9]+$" },
      displayName: { type: "string", minLength: 1, maxLength: 128 },
      avatarUrl: { oneOf: [{ type: "string", format: "uri" }, { type: "null" }] },
      locale: { type: "string", minLength: 2, maxLength: 16 },
      createdAt: isoTimestamp
    }
  },
  PrivacyPreferences: {
    $id: "spacey.contracts.PrivacyPreferences",
    type: "object",
    additionalProperties: false,
    required: ["profilePublic", "analyticsConsent", "analyticsConsentUpdatedAt", "updatedAt"],
    properties: {
      profilePublic: { type: "boolean" },
      analyticsConsent: { type: "boolean" },
      analyticsConsentUpdatedAt: { oneOf: [isoTimestamp, { type: "null" }] },
      updatedAt: isoTimestamp
    }
  },
  UpdatePrivacyPreferencesRequest: {
    $id: "spacey.contracts.UpdatePrivacyPreferencesRequest",
    type: "object",
    additionalProperties: false,
    required: ["profilePublic", "analyticsConsent"],
    properties: {
      profilePublic: { type: "boolean" },
      analyticsConsent: { type: "boolean" }
    }
  },
  CreatePrivacyRequest: {
    $id: "spacey.contracts.CreatePrivacyRequest",
    type: "object",
    additionalProperties: false,
    required: ["type", "idempotencyKey"],
    properties: {
      type: { enum: ["export", "delete"] },
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 }
    }
  },
  PrivacyRequest: {
    $id: "spacey.contracts.PrivacyRequest",
    type: "object",
    additionalProperties: false,
    required: [
      "id", "type", "status", "requestedAt", "processingStartedAt", "completedAt",
      "failedAt", "failureCode", "retentionUntil", "exportArtifact"
    ],
    properties: {
      id: entityId,
      type: { enum: ["export", "delete"] },
      status: { enum: ["pending", "processing", "completed", "failed"] },
      requestedAt: isoTimestamp,
      processingStartedAt: { oneOf: [isoTimestamp, { type: "null" }] },
      completedAt: { oneOf: [isoTimestamp, { type: "null" }] },
      failedAt: { oneOf: [isoTimestamp, { type: "null" }] },
      failureCode: { oneOf: [{ type: "string", minLength: 1, maxLength: 128 }, { type: "null" }] },
      retentionUntil: isoTimestamp,
      exportArtifact: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["state", "contentType", "contentSha256", "sizeBytes", "expiresAt"],
            properties: {
              state: { const: "stored_encrypted" },
              contentType: { const: "application/json" },
              contentSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
              sizeBytes: { type: "integer", minimum: 0 },
              expiresAt: isoTimestamp
            }
          }
        ]
      }
    }
  },
  PrivacyExportDownload: {
    $id: "spacey.contracts.PrivacyExportDownload",
    type: "object",
    additionalProperties: false,
    required: ["url", "expiresAt"],
    properties: {
      url: { type: "string", format: "uri", pattern: "^https://" },
      expiresAt: isoTimestamp
    }
  },
  CreateMissionAttemptRequest: {
    $id: "spacey.contracts.CreateMissionAttemptRequest",
    type: "object",
    additionalProperties: false,
    required: ["missionId", "shipBuildRevisionId", "idempotencyKey"],
    properties: {
      missionId: entityId,
      shipBuildRevisionId: entityId,
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 }
    }
  },
  CreateMatchmakingTicketRequest: {
    $id: "spacey.contracts.CreateMatchmakingTicketRequest",
    type: "object",
    additionalProperties: false,
    required: ["shipBuildRevisionId", "queue", "idempotencyKey"],
    properties: {
      shipBuildRevisionId: entityId,
      queue: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" },
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 }
    }
  },
  MatchmakingTicket: {
    $id: "spacey.contracts.MatchmakingTicket",
    type: "object",
    additionalProperties: false,
    required: ["id", "queue", "region", "mmr", "status", "createdAt", "expiresAt", "match"],
    properties: {
      id: entityId,
      queue: { type: "string", minLength: 1, maxLength: 64 },
      region: { type: "string", minLength: 1, maxLength: 32 },
      mmr: { type: "integer", minimum: 0 },
      status: { enum: ["queued", "matched", "completed", "cancelled", "expired", "failed"] },
      createdAt: isoTimestamp,
      expiresAt: isoTimestamp,
      match: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["matchId", "sessionId", "attemptId", "runtimeState", "connection"],
            properties: {
              matchId: entityId,
              sessionId: entityId,
              attemptId: entityId,
              runtimeState: { enum: ["duel_protocol_unavailable", "ready"] },
              connection: { type: "null" }
            }
          }
        ]
      }
    }
  },
  BattleConnection: {
    $id: "spacey.contracts.BattleConnection",
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "attemptId", "mode", "websocketUrl", "ticket", "ticketExpiresAt", "protocolVersion"],
    properties: {
      sessionId: entityId,
      attemptId: entityId,
      mode: { enum: ["pve", "pvp"] },
      websocketUrl: { type: "string", format: "uri" },
      ticket: { type: "string", minLength: 1 },
      ticketExpiresAt: isoTimestamp,
      protocolVersion: { type: "string", minLength: 1 }
    }
  },
  PvpBattleParticipantConnection: {
    $id: "spacey.contracts.PvpBattleParticipantConnection",
    type: "object",
    additionalProperties: false,
    required: ["sessionId", "attemptId", "mode", "websocketUrl", "ticket", "ticketExpiresAt", "protocolVersion", "matchId", "participantId", "side"],
    properties: {
      sessionId: entityId,
      attemptId: entityId,
      mode: { const: "pvp" },
      websocketUrl: { type: "string", format: "uri" },
      ticket: { type: "string", minLength: 1 },
      ticketExpiresAt: isoTimestamp,
      protocolVersion: { type: "string", minLength: 1 },
      matchId: entityId,
      participantId: entityId,
      side: { enum: [0, 1] }
    }
  },
  ApplyShipBuildCommandsRequest: {
    $id: "spacey.contracts.ApplyShipBuildCommandsRequest",
    type: "object",
    additionalProperties: false,
    required: ["expectedRevision", "idempotencyKey", "commands"],
    properties: {
      expectedRevision: { type: "integer", minimum: 1 },
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
      commands: {
        type: "array",
        minItems: 1,
        maxItems: 128,
        items: { type: "object", required: ["type"], properties: { type: { enum: ["rename", "install", "move", "remove"] } } }
      }
    }
  }
} as const satisfies Record<string, JsonSchema>;

export type ContractSchemaName = keyof typeof contractSchemas;
