import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuthService } from "./auth.service.js";
import { CookieOriginGuard } from "./cookie-origin.guard.js";
import { PlayerAccessGuard, type PlayerRequest } from "./player-access.guard.js";

const telegramAuthSchema = z.object({ initData: z.string().min(1).max(16_384) });
const refreshCookieName = env.productionLike ? "__Secure-spacey_refresh" : "spacey_refresh";
const refreshCookiePath = "/api/v1/auth";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("telegram")
  @HttpCode(200)
  @UseGuards(CookieOriginGuard)
  async telegram(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.authenticateTelegram(telegramAuthSchema.parse(body).initData, this.clientContext(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return result.response;
  }

  @Post("development")
  @HttpCode(200)
  @UseGuards(CookieOriginGuard)
  async development(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.authenticateDevelopment(this.clientContext(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return result.response;
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(CookieOriginGuard)
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.refresh(request.cookies[refreshCookieName], this.clientContext(request));
    this.setRefreshCookie(reply, result.refreshToken);
    return result.response;
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(CookieOriginGuard)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(request.cookies[refreshCookieName]);
    reply.clearCookie(refreshCookieName, { path: refreshCookiePath });
    return { ok: true };
  }

  @Post("logout-all")
  @HttpCode(200)
  @UseGuards(CookieOriginGuard, PlayerAccessGuard)
  async logoutAll(@Req() request: PlayerRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logoutAll(request.player.userId);
    reply.clearCookie(refreshCookieName, { path: refreshCookiePath });
    return { ok: true };
  }

  private setRefreshCookie(reply: FastifyReply, token: string) {
    reply.setCookie(refreshCookieName, token, {
      httpOnly: true,
      secure: env.productionLike,
      sameSite: "strict",
      path: refreshCookiePath,
      maxAge: env.PLAYER_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
    });
  }

  private clientContext(request: FastifyRequest) {
    const userAgent = request.headers["user-agent"];
    return { ip: request.ip, userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent };
  }
}
