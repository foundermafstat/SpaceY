import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../common/api-error.js";
import { PlayerTokenService, type AccessTokenClaims } from "./player-token.service.js";

export type PlayerRequest = FastifyRequest & { player: AccessTokenClaims };

@Injectable()
export class PlayerAccessGuard implements CanActivate {
  constructor(private readonly tokens: PlayerTokenService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlayerRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError("access_token_missing", 401, "Access token is missing.");
    }
    request.player = await this.tokens.verifyAccessToken(authorization.slice(7));
    return true;
  }
}
