import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { PUBLIC_ADMIN_ROUTE } from "./admin-security.js";

export const ADMIN_ALLOWED_ORIGINS = Symbol("spacey.admin-allowed-origins");

export function isAllowedAdminOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (!origin || origin === "null") return false;
  try {
    return allowedOrigins.includes(new URL(origin).origin) && new URL(origin).origin === origin;
  } catch {
    return false;
  }
}

@Injectable()
export class PrivateOriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ADMIN_ALLOWED_ORIGINS) private readonly allowedOrigins: readonly string[],
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ADMIN_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isAllowedAdminOrigin(request.headers.origin, this.allowedOrigins)) {
      throw new ForbiddenException("Admin origin is not allowed");
    }
    return true;
  }
}
