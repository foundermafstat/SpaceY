import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { correlationIdForRequest } from "../mutations/admin-mutations.js";
import { getAdminPrincipal } from "../security/admin-security.js";
import { AdminContentReleaseRepository } from "./content-release.repository.js";

@Injectable()
export class AdminContentReleaseService {
  constructor(private readonly releases: AdminContentReleaseRepository) {}

  list() {
    return this.releases.list();
  }

  history(releaseId: string) {
    return this.releases.history(releaseId);
  }

  validate(releaseId: string) {
    return this.releases.validate(releaseId);
  }

  clone(request: FastifyRequest, releaseId: string, version: string, reason: string) {
    return this.releases.clone(
      releaseId,
      version,
      reason,
      correlationIdForRequest(request.id),
      getAdminPrincipal(request),
      "content.release.cloned",
    );
  }

  rollback(request: FastifyRequest, releaseId: string, version: string, reason: string) {
    return this.releases.clone(
      releaseId,
      version,
      reason,
      correlationIdForRequest(request.id),
      getAdminPrincipal(request),
      "content.release.rollback-created",
    );
  }

  publish(request: FastifyRequest, releaseId: string, reason: string) {
    return this.releases.publish(
      releaseId,
      reason,
      correlationIdForRequest(request.id),
      getAdminPrincipal(request),
    );
  }
}
