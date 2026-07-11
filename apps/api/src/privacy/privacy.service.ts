import { Inject, Injectable } from "@nestjs/common";
import type { CreatePrivacyRequestDto, UpdatePrivacyPreferencesRequestDto } from "@spacey/contracts";
import { ApiError } from "../common/api-error.js";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";
import {
  PRIVACY_EXPORT_DOWNLOAD_SIGNER,
  type PrivacyExportDownloadSigner,
} from "./privacy-export-download.js";

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository,
    @Inject(PRIVACY_EXPORT_DOWNLOAD_SIGNER) private readonly downloadSigner: PrivacyExportDownloadSigner,
  ) {}

  async getPreferences(userId: string) {
    const preferences = await this.repository.getPrivacyPreferences(userId);
    if (!preferences) throw new ApiError("player_not_found", 404, "Player not found.");
    return preferences;
  }

  updatePreferences(userId: string, input: UpdatePrivacyPreferencesRequestDto) {
    return this.repository.updatePrivacyPreferences(userId, input);
  }

  createRequest(userId: string, input: CreatePrivacyRequestDto) {
    return this.repository.createPrivacyRequest(userId, input);
  }

  async getRequest(userId: string, requestId: string) {
    const request = await this.repository.getPrivacyRequest(userId, requestId);
    if (!request) throw new ApiError("privacy_request_not_found", 404, "Privacy request not found.");
    return request;
  }

  async createDownload(userId: string, requestId: string) {
    const target = await this.repository.getPrivacyExportDownloadTarget(userId, requestId);
    if (!target || target.artifactExpiresAt <= new Date()) {
      throw new ApiError("privacy_export_not_downloadable", 404, "Privacy export is not available for download.");
    }
    const signed = await this.downloadSigner.sign(target);
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
