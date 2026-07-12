import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import { PLATFORM_REPOSITORY, type PlatformRepository, type PublicApiPrincipal } from "../platform/platform.repository.js";
import { PublicQuotaService } from "./public-quota.service.js";
import { PublicTokenService } from "./public-token.service.js";

const PUBLIC_SCOPES = "spacey.public.scopes";
export const PublicScopes = (...scopes: string[]) => SetMetadata(PUBLIC_SCOPES, scopes);
export type PublicApiRequest = FastifyRequest & { publicApi: PublicApiPrincipal };

@Injectable()
export class PublicApiGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly tokens: PublicTokenService,
    private readonly quotas: PublicQuotaService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PublicApiRequest>();
    const authorization = request.headers.authorization;
    const rawKey = request.headers["x-api-key"];
    let principal = authorization?.startsWith("Bearer ")
      ? await this.verifyLiveBearer(authorization.slice(7))
      : typeof rawKey === "string"
        ? await this.repository.authenticatePublicApiKey(this.tokens.hashCredential(rawKey))
        : null;
    if (!principal && !env.productionLike && env.PUBLIC_API_DEV_KEY && typeof rawKey === "string") {
      const left = Buffer.from(this.tokens.hashCredential(rawKey));
      const right = Buffer.from(this.tokens.hashCredential(env.PUBLIC_API_DEV_KEY));
      if (left.length === right.length && timingSafeEqual(left, right)) {
        principal = {
          clientId: "development",
          scopes: ["catalog:read", "leaderboards:read", "profiles:read", "stats:read"],
          rateLimitPerMinute: 60,
        };
      }
    }
    if (!principal) throw new ApiError("api_key_invalid", 401, "API key is invalid.");
    const required = this.reflector.getAllAndOverride<string[]>(PUBLIC_SCOPES, [context.getHandler(), context.getClass()]) ?? [];
    if (required.some((scope) => !principal!.scopes.includes(scope))) {
      throw new ApiError("api_scope_forbidden", 403, "API key does not have the required scope.");
    }
    await this.quotas.consume(principal.clientId, principal.rateLimitPerMinute);
    request.publicApi = principal;
    return true;
  }

  private async verifyLiveBearer(token: string): Promise<PublicApiPrincipal | null> {
    const claims = await this.tokens.verify(token);
    const current = await this.repository.getActivePublicClient(claims.clientId);
    if (!current && !env.productionLike && claims.clientId === env.PUBLIC_OAUTH_DEV_CLIENT_ID) return claims;
    if (!current) return null;
    return {
      clientId: current.clientId,
      scopes: claims.scopes.filter((scope) => current.scopes.includes(scope)),
      rateLimitPerMinute: Math.min(claims.rateLimitPerMinute, current.rateLimitPerMinute),
    };
  }
}
