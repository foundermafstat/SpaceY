export type JsonSchema = Readonly<Record<string, unknown>>;

const entityId = { type: "string", minLength: 1 } as const;
const isoTimestamp = { type: "string", format: "date-time" } as const;
const walletProperties = {
  credits: { type: "integer", minimum: 0 },
  scrap: { type: "integer", minimum: 0 },
  alloy: { type: "integer", minimum: 0 },
  dataShards: { type: "integer", minimum: 0 }
} as const;

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
  Wallet: {
    $id: "spacey.contracts.Wallet",
    type: "object",
    additionalProperties: false,
    required: ["credits", "scrap", "alloy", "dataShards"],
    properties: walletProperties
  },
  InventoryItem: {
    $id: "spacey.contracts.InventoryItem",
    type: "object",
    additionalProperties: false,
    required: [
      "id", "definitionId", "contentVersion", "rarity", "state", "durability",
      "category", "shape", "stats", "visualKey", "installedBuildRevisionId", "createdAt"
    ],
    properties: {
      id: entityId,
      definitionId: { type: "string", minLength: 1 },
      contentVersion: { type: "string", minLength: 1 },
      rarity: { enum: ["common", "uncommon", "superRare"] },
      state: { enum: ["available", "installed", "damaged", "destroyed"] },
      durability: { type: "integer", minimum: 0, maximum: 10000 },
      category: { type: "string", minLength: 1 },
      shape: {
        type: "object",
        additionalProperties: false,
        required: ["cells"],
        properties: {
          cells: {
            type: "array",
            minItems: 1,
            items: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "integer" }
            }
          }
        }
      },
      stats: { type: "object", additionalProperties: true },
      visualKey: { type: "string", minLength: 1 },
      installedBuildRevisionId: { oneOf: [entityId, { type: "null" }] },
      createdAt: isoTimestamp
    }
  },
  Progression: {
    $id: "spacey.contracts.Progression",
    type: "object",
    additionalProperties: false,
    required: ["level", "experience", "researchNodeIds", "seasonId", "seasonRating"],
    properties: {
      level: { type: "integer", minimum: 1 },
      experience: { type: "integer", minimum: 0 },
      researchNodeIds: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
      seasonId: { oneOf: [entityId, { type: "null" }] },
      seasonRating: { oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }] }
    }
  },
  CreateRepairQuoteRequest: {
    $id: "spacey.contracts.CreateRepairQuoteRequest",
    type: "object",
    additionalProperties: false,
    required: ["inventoryItemId", "idempotencyKey"],
    properties: {
      inventoryItemId: entityId,
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 }
    }
  },
  CommitRepairRequest: {
    $id: "spacey.contracts.CommitRepairRequest",
    type: "object",
    additionalProperties: false,
    required: ["quoteId", "idempotencyKey"],
    properties: {
      quoteId: entityId,
      idempotencyKey: { type: "string", minLength: 16, maxLength: 128 }
    }
  },
  RepairQuote: {
    $id: "spacey.contracts.RepairQuote",
    type: "object",
    additionalProperties: false,
    required: [
      "id", "inventoryItemId", "definitionId", "durabilityBefore", "durabilityAfter",
      "currency", "cost", "expiresAt"
    ],
    properties: {
      id: entityId,
      inventoryItemId: entityId,
      definitionId: { type: "string", minLength: 1 },
      durabilityBefore: { type: "integer", minimum: 1, maximum: 9999 },
      durabilityAfter: { const: 10000 },
      currency: { const: "credits" },
      cost: { type: "integer", minimum: 1 },
      expiresAt: isoTimestamp
    }
  },
  BattleResult: {
    $id: "spacey.contracts.BattleResult",
    type: "object",
    additionalProperties: false,
    required: [
      "id", "attemptId", "mode", "outcome", "reason", "mission", "durationTicks",
      "finalStateHash", "rewards", "grantedItems", "experience", "walletAfter",
      "progressionAfter", "moduleDamage", "mmr", "replayStatus", "finalizedAt"
    ],
    properties: {
      id: entityId,
      attemptId: entityId,
      mode: { enum: ["pve", "pvp"] },
      outcome: { enum: ["victory", "defeat", "forfeit", "draw"] },
      reason: { type: "string", minLength: 1 },
      mission: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: { id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 } }
      },
      durationTicks: { type: "integer", minimum: 0 },
      finalStateHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      rewards: { type: "object", additionalProperties: false, properties: walletProperties },
      grantedItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["inventoryItemId", "definitionId", "rarity"],
          properties: {
            inventoryItemId: entityId,
            definitionId: { type: "string", minLength: 1 },
            rarity: { enum: ["common", "uncommon", "superRare"] }
          }
        }
      },
      experience: { type: "integer", minimum: 0 },
      walletAfter: { $ref: "spacey.contracts.Wallet" },
      progressionAfter: { $ref: "spacey.contracts.Progression" },
      moduleDamage: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "inventoryItemId", "definitionId", "durabilityBefore", "durabilityAfter",
            "damage", "state"
          ],
          properties: {
            inventoryItemId: entityId,
            definitionId: { type: "string", minLength: 1 },
            simulationModuleId: { type: "string", minLength: 1, maxLength: 128 },
            hpBefore: { type: "integer", minimum: 1, maximum: 1000000 },
            hpAfter: { type: "integer", minimum: 0, maximum: 1000000 },
            hpLoss: { type: "integer", minimum: 1, maximum: 1000000 },
            detached: { type: "boolean" },
            durabilityBefore: { type: "integer", minimum: 1, maximum: 10000 },
            durabilityAfter: { type: "integer", minimum: 0, maximum: 9999 },
            damage: { type: "integer", minimum: 1, maximum: 10000 },
            state: { enum: ["available", "installed", "damaged", "destroyed"] }
          }
        }
      },
      mmr: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["before", "after"],
            properties: {
              before: { type: "integer", minimum: 0 },
              after: { type: "integer", minimum: 0 }
            }
          }
        ]
      },
      replayStatus: { enum: ["pending", "available", "failed"] },
      finalizedAt: isoTimestamp
    }
  },
  BattleResultPage: {
    $id: "spacey.contracts.BattleResultPage",
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: { $ref: "spacey.contracts.BattleResult" } },
      nextCursor: { oneOf: [entityId, { type: "null" }] }
    }
  },
  RepairResult: {
    $id: "spacey.contracts.RepairResult",
    type: "object",
    additionalProperties: false,
    required: ["quoteId", "inventoryItem", "walletAfter", "ledgerEntryId", "repairedAt"],
    properties: {
      quoteId: entityId,
      inventoryItem: { $ref: "spacey.contracts.InventoryItem" },
      walletAfter: { $ref: "spacey.contracts.Wallet" },
      ledgerEntryId: entityId,
      repairedAt: isoTimestamp
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
