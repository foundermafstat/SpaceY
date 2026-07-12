import { Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ADMIN_STRONG_AUTHENTICATION, type AdminStrongAuthenticationPort } from "./auth/admin-auth.port.js";
import { ADMIN_SESSION_COOKIE } from "./auth/postgres-admin-session-authenticator.js";
import { ADMIN_CSRF_COOKIE } from "./security/admin-csrf.guard.js";
import { getAdminPrincipal } from "./security/admin-security.js";

@Controller("session")
export class SessionController {
  constructor(
    @Inject(ADMIN_STRONG_AUTHENTICATION) private readonly authentication: AdminStrongAuthenticationPort,
  ) {}

  @Get()
  current(@Req() request: FastifyRequest) {
    return { principal: getAdminPrincipal(request) };
  }

  @Post("logout")
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const principal = getAdminPrincipal(request);
    await this.authentication.revokeSessionFamily(principal.adminId, principal.sessionId);
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/", secure: true, sameSite: "strict" });
    reply.clearCookie(ADMIN_CSRF_COOKIE, { path: "/", secure: true, sameSite: "strict" });
    return { revoked: true };
  }
}
