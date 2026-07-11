import { createHash, createHmac, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";
import type { PublicApiPrincipal } from "../platform/platform.repository.js";

@Injectable()
export class PublicTokenService {
  private readonly signingSecret = new TextEncoder().encode(
    env.PUBLIC_OAUTH_TOKEN_SECRET ?? randomBytes(32).toString("base64url")
  );

  hashCredential(value: string) {
    return env.PUBLIC_API_KEY_PEPPER
      ? createHmac("sha256", env.PUBLIC_API_KEY_PEPPER).update(value).digest("hex")
      : createHash("sha256").update(value).digest("hex");
  }

  async sign(principal: PublicApiPrincipal, scopes: string[]) {
    return new SignJWT({ typ: "public_access", scopes, rpm: principal.rateLimitPerMinute })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("spacey-api")
      .setAudience("spacey-public-api")
      .setSubject(principal.clientId)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(this.signingSecret);
  }

  async verify(token: string): Promise<PublicApiPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.signingSecret, {
        algorithms: ["HS256"],
        issuer: "spacey-api",
        audience: "spacey-public-api"
      });
      if (
        payload.typ !== "public_access" ||
        typeof payload.sub !== "string" ||
        !Array.isArray(payload.scopes) ||
        !payload.scopes.every((scope) => typeof scope === "string") ||
        !Number.isInteger(payload.rpm)
      ) throw new Error("invalid claims");
      return { clientId: payload.sub, scopes: payload.scopes as string[], rateLimitPerMinute: payload.rpm as number };
    } catch {
      throw new ApiError("public_token_invalid", 401, "Public API access token is invalid or expired.");
    }
  }
}
