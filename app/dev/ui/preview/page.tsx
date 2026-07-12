import { notFound } from "next/navigation";
import { UiPreview } from "@/components/dev/UiPreview";
import type { FixtureScenario } from "@/game/dev/fixtures";

export const dynamic = "force-dynamic";

const fixtureScenarios = new Set<FixtureScenario>(["default", "contracts", "build", "inventory", "damaged", "empty", "error", "loading"]);

export default async function DevelopmentUiPreview({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const requestedScenario = (await searchParams).scenario;
  const scenario = requestedScenario && fixtureScenarios.has(requestedScenario as FixtureScenario)
    ? requestedScenario as FixtureScenario
    : "default";
  return <UiPreview scenario={scenario} />;
}
