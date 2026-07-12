"use client";

import { useState } from "react";
import type { FixtureScenario } from "@/game/dev/fixtures";

const viewports = {
  "360 × 800": [360, 800],
  "390 × 844": [390, 844],
  "430 × 932": [430, 932],
  "932 × 430": [932, 430],
} as const;

const scenarios: FixtureScenario[] = ["default", "contracts", "build", "inventory", "damaged", "empty", "error", "loading"];

export function UiSandbox() {
  const [viewport, setViewport] = useState<keyof typeof viewports>("390 × 844");
  const [scenario, setScenario] = useState<FixtureScenario>("default");
  const [resetKey, setResetKey] = useState(0);
  const [width, height] = viewports[viewport];
  const previewUrl = `/dev/ui/preview?scenario=${encodeURIComponent(scenario)}&reset=${resetKey}`;

  return (
    <main className="ui-sandbox-shell">
      <header className="ui-sandbox-toolbar">
        <strong>SpaceY UI Sandbox</strong>
        <label>
          Viewport
          <select onChange={(event) => setViewport(event.target.value as keyof typeof viewports)} value={viewport}>
            {Object.keys(viewports).map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Fixture
          <select onChange={(event) => { setScenario(event.target.value as FixtureScenario); setResetKey((value) => value + 1); }} value={scenario}>
            {scenarios.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <button onClick={() => setResetKey((value) => value + 1)} type="button">Reset UI</button>
        <a className="ui-sandbox-link" href="/dev/ui-kit">UI Catalog</a>
        <span>Same Hangar component · local fixture source</span>
      </header>
      <div className="ui-sandbox-stage">
        <iframe
          className="ui-sandbox-device"
          height={height}
          key={previewUrl}
          src={previewUrl}
          title="SpaceY production Hangar preview"
          width={width}
        />
      </div>
    </main>
  );
}
