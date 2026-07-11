import { Body, Controller, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RequiresAdminPermissions } from "../security/admin-security.js";
import { AdminMutationService, ContentMutationDto, EconomyAdjustmentDto } from "./admin-mutations.js";

@Controller("mutations")
export class AdminMutationsController {
  constructor(private readonly mutations: AdminMutationService) {}

  @Post("content")
  @RequiresAdminPermissions("content:write")
  mutateContent(@Req() request: FastifyRequest, @Body() input: ContentMutationDto) {
    return this.mutations.mutateContent(request, input);
  }

  @Post("economy/adjustments")
  @RequiresAdminPermissions("economy:adjust")
  adjustEconomy(@Req() request: FastifyRequest, @Body() input: EconomyAdjustmentDto) {
    return this.mutations.adjustEconomy(request, input);
  }
}
