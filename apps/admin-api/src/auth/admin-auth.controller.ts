import { Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
import { IsEmail, IsObject, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { correlationIdForRequest } from "../mutations/admin-mutations.js";
import { ADMIN_CSRF_COOKIE } from "../security/admin-csrf.guard.js";
import { AdminAuthenticationRoute, getAdminPrincipal } from "../security/admin-security.js";
import {
  ADMIN_RECOVERY_AUTHENTICATION,
  ADMIN_STRONG_AUTHENTICATION,
  type AdminAuthenticationResult,
  type AdminRecoveryAuthenticationPort,
  type AdminStrongAuthenticationPort,
} from "./admin-auth.port.js";
import { ADMIN_AUTH_RATE_LIMITER, type AdminAuthRateLimiter } from "./admin-auth-rate-limiter.js";
import { ADMIN_SESSION_COOKIE } from "./postgres-admin-session-authenticator.js";

export class BeginWebAuthnAuthenticationDto {
  @IsEmail()
  @MaxLength(320)
  loginHint!: string;
}

export class FinishWebAuthnDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  credential!: Record<string, unknown>;
}

export class TotpRecoveryDto {
  @IsEmail()
  @MaxLength(320)
  loginHint!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class RecoveryCodeDto {
  @IsEmail()
  @MaxLength(320)
  loginHint!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  recoveryCode!: string;
}

export function writeAdminSessionCookies(reply: FastifyReply, result: AdminAuthenticationResult) {
  const expiresAt = new Date(result.expiresAt);
  reply.setCookie(ADMIN_SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  const csrfToken = randomBytes(32).toString("base64url");
  reply.setCookie(ADMIN_CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  return { principal: result.principal, csrfToken, expiresAt: result.expiresAt };
}

@Controller("auth/webauthn")
export class AdminAuthController {
  constructor(
    @Inject(ADMIN_STRONG_AUTHENTICATION) private readonly authentication: AdminStrongAuthenticationPort,
    @Inject(ADMIN_AUTH_RATE_LIMITER) private readonly rateLimiter: AdminAuthRateLimiter,
  ) {}

  @Post("authentication/options")
  @AdminAuthenticationRoute()
  async beginAuthentication(@Req() request: FastifyRequest, @Body() input: BeginWebAuthnAuthenticationDto) {
    await this.rateLimiter.consume(request.ip, `webauthn-options:${input.loginHint}`);
    return this.authentication.beginWebAuthnAuthentication(input.loginHint);
  }

  @Post("authentication/verify")
  @AdminAuthenticationRoute()
  async finishAuthentication(
    @Body() input: FinishWebAuthnDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimiter.consume(request.ip, `webauthn-verify:${input.challengeId}`);
    const result = await this.authentication.finishWebAuthnAuthentication(input);
    return writeAdminSessionCookies(reply, result);
  }

  @Post("registration/options")
  async beginRegistration(@Req() request: FastifyRequest) {
    const adminId = getAdminPrincipal(request).adminId;
    await this.rateLimiter.consume(request.ip, `webauthn-registration-options:${adminId}`);
    return this.authentication.beginWebAuthnRegistration(adminId);
  }

  @Post("registration/verify")
  async finishRegistration(@Req() request: FastifyRequest, @Body() input: FinishWebAuthnDto) {
    const adminId = getAdminPrincipal(request).adminId;
    await this.rateLimiter.consume(request.ip, `webauthn-registration-verify:${adminId}`);
    await this.authentication.finishWebAuthnRegistration(adminId, input);
    return { registered: true };
  }
}

@Controller("auth/recovery")
export class AdminRecoveryAuthController {
  constructor(
    @Inject(ADMIN_RECOVERY_AUTHENTICATION) private readonly recovery: AdminRecoveryAuthenticationPort,
    @Inject(ADMIN_AUTH_RATE_LIMITER) private readonly rateLimiter: AdminAuthRateLimiter,
  ) {}

  @Post("totp")
  @AdminAuthenticationRoute()
  async totp(
    @Req() request: FastifyRequest,
    @Body() input: TotpRecoveryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimiter.consume(request.ip, `totp:${input.loginHint}`);
    const result = await this.recovery.verifyTotp({
      loginHint: input.loginHint,
      credential: input.code,
      correlationId: correlationIdForRequest(request.id),
    });
    return writeAdminSessionCookies(reply, result);
  }

  @Post("code")
  @AdminAuthenticationRoute()
  async recoveryCode(
    @Req() request: FastifyRequest,
    @Body() input: RecoveryCodeDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimiter.consume(request.ip, `recovery-code:${input.loginHint}`);
    const result = await this.recovery.verifyRecoveryCode({
      loginHint: input.loginHint,
      credential: input.recoveryCode,
      correlationId: correlationIdForRequest(request.id),
    });
    return writeAdminSessionCookies(reply, result);
  }
}
