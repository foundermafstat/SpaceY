import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../common/api-error.js";
import { env } from "../config/env.js";

@Injectable()
export class CookieOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const origin = request.headers.origin;
    if (!origin && !env.productionLike) return true;
    if (typeof origin === "string" && env.corsOrigins.includes(origin)) return true;
    throw new ApiError("origin_forbidden", 403, "Request origin is not allowed.");
  }
}
