import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { AuthSessionDto, RefreshSessionResponseDto } from "@spacey/contracts";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import { PlayerTokenService } from "./player-token.service.js";
import { TelegramInitDataVerifier } from "./telegram-init-data.verifier.js";

type ClientContext = { ip?: string; userAgent?: string };

@Injectable()
export class AuthService {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly telegramVerifier: TelegramInitDataVerifier,
    private readonly tokens: PlayerTokenService
  ) {}

  async authenticateTelegram(rawInitData: string, client: ClientContext) {
    const verified = this.telegramVerifier.verify(rawInitData);
    const profile = await this.repository.authenticateTelegram(verified);
    const session = await this.issueInitialSession(profile.id, client);
    return { response: { ...session.response, profile } satisfies AuthSessionDto, refreshToken: session.refreshToken };
  }

  async authenticateDevelopment(client: ClientContext) {
    if (!env.ALLOW_BROWSER_AUTH || env.productionLike) {
      throw new ApiError("development_auth_forbidden", 404, "Route not found.");
    }
    const now = new Date();
    const profile = await this.repository.authenticateTelegram({
      initDataHash: `development:${randomUUID()}`,
      authDate: now,
      replayExpiresAt: new Date(now.getTime() + 60_000),
      identity: {
        telegramUserId: "9000000001",
        username: "spacey_dev",
        firstName: "SpaceY",
        lastName: "Developer",
        languageCode: "en",
        isPremium: false,
        photoUrl: null
      }
    });
    const session = await this.issueInitialSession(profile.id, client);
    return { response: { ...session.response, profile } satisfies AuthSessionDto, refreshToken: session.refreshToken };
  }

  async refresh(rawRefreshToken: string | undefined, client: ClientContext) {
    if (!rawRefreshToken) throw new ApiError("refresh_token_missing", 401, "Refresh token is missing.");
    const nextToken = this.tokens.createRefreshToken();
    const nextExpiresAt = this.refreshExpiresAt();
    const result = await this.repository.rotateRefreshSession({
      currentTokenHash: this.tokens.hashRefreshToken(rawRefreshToken),
      nextTokenHash: this.tokens.hashRefreshToken(nextToken),
      nextExpiresAt,
      ipHash: this.tokens.hashClientValue(client.ip),
      userAgentHash: this.tokens.hashClientValue(client.userAgent)
    });
    if (result.kind === "reuse") {
      throw new ApiError("refresh_token_reuse", 401, "Refresh token reuse was detected; the token family was revoked.");
    }
    if (result.kind === "invalid") throw new ApiError("refresh_token_invalid", 401, "Refresh token is invalid or expired.");
    const accessToken = await this.tokens.signAccessToken({
      userId: result.session.userId,
      sessionId: result.session.id
    });
    return {
      response: {
        accessToken,
        accessTokenExpiresInSeconds: env.PLAYER_ACCESS_TOKEN_TTL_SECONDS,
        refreshSessionExpiresAt: result.session.expiresAt.toISOString()
      } satisfies RefreshSessionResponseDto,
      refreshToken: nextToken
    };
  }

  async logout(rawRefreshToken: string | undefined) {
    if (rawRefreshToken) await this.repository.revokeRefreshSession(this.tokens.hashRefreshToken(rawRefreshToken));
  }

  async logoutAll(userId: string) {
    await this.repository.revokeAllRefreshSessions(userId);
  }

  private async issueInitialSession(userId: string, client: ClientContext) {
    const refreshToken = this.tokens.createRefreshToken();
    const session = await this.repository.createRefreshSession({
      userId,
      refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: this.refreshExpiresAt(),
      ipHash: this.tokens.hashClientValue(client.ip),
      userAgentHash: this.tokens.hashClientValue(client.userAgent),
      maxActiveSessions: env.PLAYER_MAX_ACTIVE_SESSIONS
    });
    const accessToken = await this.tokens.signAccessToken({ userId, sessionId: session.id });
    return {
      refreshToken,
      response: {
        accessToken,
        accessTokenExpiresInSeconds: env.PLAYER_ACCESS_TOKEN_TTL_SECONDS,
        refreshSessionExpiresAt: session.expiresAt.toISOString()
      }
    };
  }

  private refreshExpiresAt() {
    return new Date(Date.now() + env.PLAYER_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
