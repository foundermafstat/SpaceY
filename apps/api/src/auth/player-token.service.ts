import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";

export type AccessTokenClaims = { userId: string; sessionId: string };

@Injectable()
export class PlayerTokenService {
  private readonly accessSecret = new TextEncoder().encode(
    env.PLAYER_ACCESS_TOKEN_SECRET ?? randomBytes(32).toString("base64url")
  );
  private readonly refreshPepper = env.REFRESH_TOKEN_PEPPER ?? randomBytes(32).toString("base64url");

  createRefreshToken() {
    return randomBytes(32).toString("base64url");
  }

  hashRefreshToken(token: string) {
    return createHmac("sha256", this.refreshPepper).update(token).digest("hex");
  }

  hashClientValue(value: string | undefined) {
    if (!value) return null;
    return createHmac("sha256", this.refreshPepper).update(value).digest("hex");
  }

  async signAccessToken(claims: AccessTokenClaims) {
    return new SignJWT({ sid: claims.sessionId, typ: "player_access" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("spacey-api")
      .setAudience("spacey-game")
      .setSubject(claims.userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${env.PLAYER_ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.accessSecret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret, {
        algorithms: ["HS256"],
        issuer: "spacey-api",
        audience: "spacey-game"
      });
      if (payload.typ !== "player_access" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
        throw new Error("invalid claims");
      }
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new ApiError("access_token_invalid", 401, "Access token is invalid or expired.");
    }
  }
}
