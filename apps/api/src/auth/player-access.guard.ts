import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../common/api-error.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import { PlayerTokenService, type AccessTokenClaims } from "./player-token.service.js";

export type PlayerRequest = FastifyRequest & { player: AccessTokenClaims };

@Injectable()
export class PlayerAccessGuard implements CanActivate {
  constructor(
    private readonly tokens: PlayerTokenService,
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlayerRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError("access_token_missing", 401, "Access token is missing.");
    }
    const claims = await this.tokens.verifyAccessToken(authorization.slice(7));
    if (!await this.repository.isAccessSessionActive(claims.userId, claims.sessionId)) {
      throw new ApiError("access_token_revoked", 401, "Access token session is no longer active.");
    }
    request.player = claims;
    return true;
  }
}
