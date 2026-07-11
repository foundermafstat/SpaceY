import { Controller, Get, Inject, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import { PublicApiGuard, PublicScopes } from "./public-api.guard.js";

@Controller("public/v1")
@UseGuards(PublicApiGuard)
export class PublicController {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository) {}

  @Get("catalog")
  @PublicScopes("catalog:read")
  catalog() {
    return this.repository.getPublicCatalog();
  }

  @Get("leaderboards")
  @PublicScopes("leaderboards:read")
  leaderboard(@Query("limit") rawLimit?: string) {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(rawLimit);
    return this.repository.getPublicLeaderboard(limit);
  }

  @Get("profiles/:userId")
  @PublicScopes("profiles:read")
  async profile(@Param("userId") rawUserId: string) {
    const profile = await this.repository.getPublicProfile(z.string().uuid().parse(rawUserId));
    if (!profile) throw new NotFoundException();
    return profile;
  }

  @Get("stats")
  @PublicScopes("stats:read")
  stats() {
    return this.repository.getPublicAggregateStats();
  }
}
