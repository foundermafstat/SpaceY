import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import type { FastifyRequest } from "fastify";
import { RequiresAdminPermissions } from "../security/admin-security.js";
import { AdminContentReleaseService } from "./content-release.service.js";

export class CloneContentReleaseDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/)
  version!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class PublishContentReleaseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

@Controller("content/releases")
export class AdminContentReleaseController {
  constructor(private readonly releases: AdminContentReleaseService) {}

  @Get()
  @RequiresAdminPermissions("content:read")
  async list() {
    return { releases: await this.releases.list() };
  }

  @Get(":releaseId/revisions")
  @RequiresAdminPermissions("content:read")
  history(@Param("releaseId", new ParseUUIDPipe({ version: "7" })) releaseId: string) {
    return this.releases.history(releaseId);
  }

  @Post(":releaseId/validate")
  @RequiresAdminPermissions("content:read")
  validate(@Param("releaseId", new ParseUUIDPipe({ version: "7" })) releaseId: string) {
    return this.releases.validate(releaseId);
  }

  @Post(":releaseId/clone")
  @RequiresAdminPermissions("content:write")
  clone(
    @Req() request: FastifyRequest,
    @Param("releaseId", new ParseUUIDPipe({ version: "7" })) releaseId: string,
    @Body() input: CloneContentReleaseDto,
  ) {
    return this.releases.clone(request, releaseId, input.version, input.reason);
  }

  @Post(":releaseId/rollback")
  @RequiresAdminPermissions("content:write")
  rollback(
    @Req() request: FastifyRequest,
    @Param("releaseId", new ParseUUIDPipe({ version: "7" })) releaseId: string,
    @Body() input: CloneContentReleaseDto,
  ) {
    return this.releases.rollback(request, releaseId, input.version, input.reason);
  }

  @Post(":releaseId/publish")
  @RequiresAdminPermissions("content:write")
  publish(
    @Req() request: FastifyRequest,
    @Param("releaseId", new ParseUUIDPipe({ version: "7" })) releaseId: string,
    @Body() input: PublishContentReleaseDto,
  ) {
    return this.releases.publish(request, releaseId, input.reason);
  }
}
