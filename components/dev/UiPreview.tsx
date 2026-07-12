"use client";

import { useMemo } from "react";
import { HangarSurface, type HangarSection } from "@/app/hangar/page";
import { ServerBoundaryStatus } from "@/components/server/ServerBoundaryStatus";
import { FixtureServerSessionProvider } from "@/game/dev/fixture-session-provider";
import { createFixtureBootstrap, type FixtureScenario } from "@/game/dev/fixtures";

export function UiPreview({ scenario }: { scenario: FixtureScenario }) {
  const bootstrap = useMemo(() => createFixtureBootstrap(scenario), [scenario]);
  const initialSection: HangarSection = scenario === "build" ? "build" : scenario === "inventory" || scenario === "damaged" ? "inventory" : "contracts";
  const initialDrawerOpen = scenario === "contracts" || scenario === "build" || scenario === "inventory" || scenario === "damaged";

  if (scenario === "loading") return <ServerBoundaryStatus message={null} status="starting" />;

  return (
    <FixtureServerSessionProvider initialBootstrap={bootstrap}>
      <HangarSurface
        initialDrawerOpen={initialDrawerOpen}
        initialSection={initialSection}
        initialServerMessage={scenario === "error" ? "Fixture server rejected this command. This long message is used to test wrapping and safe-area layout." : null}
        initialServerMessageIsError={scenario === "error"}
        sandbox
      />
    </FixtureServerSessionProvider>
  );
}
