import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { getAdminPrincipal } from "./security/admin-security.js";

@Controller("session")
export class SessionController {
  @Get()
  current(@Req() request: FastifyRequest) {
    return { principal: getAdminPrincipal(request) };
  }
}
