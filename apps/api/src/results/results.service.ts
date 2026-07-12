import { Inject, Injectable } from "@nestjs/common";
import type { CommitRepairRequestDto, CreateRepairQuoteRequestDto } from "@spacey/contracts";
import { PLATFORM_REPOSITORY, type PlatformRepository } from "../platform/platform.repository.js";

@Injectable()
export class ResultsService {
  constructor(@Inject(PLATFORM_REPOSITORY) private readonly repository: PlatformRepository) {}

  get(userId: string, resultId: string) {
    return this.repository.getBattleResult(userId, resultId);
  }

  list(userId: string, cursor: string | null, limit: number) {
    return this.repository.listBattleResults(userId, cursor, limit);
  }

  quoteRepair(userId: string, input: CreateRepairQuoteRequestDto) {
    return this.repository.createRepairQuote(userId, input);
  }

  commitRepair(userId: string, input: CommitRepairRequestDto) {
    return this.repository.commitRepair(userId, input);
  }
}
