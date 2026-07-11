import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import { PublicTokenService } from "./public-token.service.js";

const clientCredentialsSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1).max(128),
  client_secret: z.string().min(16).max(512),
  scope: z.string().max(1024).optional()
});

@Controller("public/v1/oauth")
export class PublicAuthController {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    private readonly tokens: PublicTokenService
  ) {}

  @Post("token")
  @HttpCode(200)
  async token(@Body() body: unknown) {
    const input = clientCredentialsSchema.parse(body);
    let principal = await this.repository.authenticatePublicClient(
      input.client_id,
      this.tokens.hashCredential(input.client_secret)
    );
    if (
      !principal && !env.productionLike &&
      input.client_id === env.PUBLIC_OAUTH_DEV_CLIENT_ID &&
      input.client_secret === env.PUBLIC_OAUTH_DEV_CLIENT_SECRET
    ) {
      principal = {
        clientId: input.client_id,
        scopes: ["catalog:read", "leaderboards:read", "profiles:read", "stats:read"],
        rateLimitPerMinute: 60,
      };
    }
    if (!principal) throw new ApiError("invalid_client", 401, "Client credentials are invalid.");
    const requested = input.scope?.split(/\s+/).filter(Boolean) ?? principal.scopes;
    if (requested.some((scope) => !principal!.scopes.includes(scope))) {
      throw new ApiError("invalid_scope", 400, "Requested scope is not allowed.");
    }
    return {
      access_token: await this.tokens.sign(principal, requested),
      token_type: "Bearer",
      expires_in: 600,
      scope: requested.join(" ")
    };
  }
}
