import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ADMIN_AUTHENTICATION_ROUTE, PUBLIC_ADMIN_ROUTE } from "./admin-security.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const ADMIN_CSRF_COOKIE = "__Host-spacey_admin_csrf";

export function isValidAdminCsrf(method: string, header: unknown, cookie: unknown) {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  if (typeof header !== "string" || typeof cookie !== "string" || header.length < 32 || cookie.length < 32) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(cookie);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AdminCsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ADMIN_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_AUTHENTICATION_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!isValidAdminCsrf(request.method, request.headers["x-csrf-token"], request.cookies[ADMIN_CSRF_COOKIE])) {
      throw new ForbiddenException("Admin CSRF validation failed");
    }
    return true;
  }
}
