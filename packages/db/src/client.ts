import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/client.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString.trim()) {
    throw new Error("A PostgreSQL connection string is required");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export type SpaceYPrismaClient = ReturnType<typeof createPrismaClient>;
