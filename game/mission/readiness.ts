import { getModule, getPanel } from "@/game/ship/build";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import type { ShipBuild, ShipStatsV2 } from "@/game/types";
import type {
  MissionCapability,
  MissionCapabilitySnapshot,
  MissionDef,
  MissionReadiness,
  MissionReadinessIssue
} from "@/game/mission/types";

const capabilityOrder: MissionCapability[] = [
  "dps",
  "shield",
  "speed",
  "acceleration",
  "heatStability",
  "cargoCapacity",
  "miningPower",
  "pointDefense"
];

const capabilityLabels: Record<MissionCapability, string> = {
  dps: "Damage output",
  shield: "Shield capacity",
  speed: "Top speed",
  acceleration: "Acceleration",
  heatStability: "Heat stability",
  cargoCapacity: "Cargo capacity",
  miningPower: "Mining power",
  pointDefense: "Point defense"
};

const capabilitySuggestions: Record<MissionCapability, string> = {
  dps: "Add or upgrade weapon modules.",
  shield: "Install a shield generator.",
  speed: "Add thrust or reduce ship mass.",
  acceleration: "Add engines or reduce ship mass.",
  heatStability: "Reduce heat load or add heat-dissipation hardware.",
  cargoCapacity: "Install cargo-capacity hardware.",
  miningPower: "Install a Drill or Mining Laser.",
  pointDefense: "Install point-defense equipment."
};

const requiredTagLabels: Record<string, string> = {
  "escort-beacon": "Escort Beacon",
  "mining-tool": "Mining Tool"
};

const requiredTagSuggestions: Record<string, string> = {
  "escort-beacon": "Install an Escort Beacon.",
  "mining-tool": "Install a Drill or Mining Laser."
};

export function evaluateMissionReadiness(build: ShipBuild, mission: MissionDef): MissionReadiness {
  const shipStats = calculateShipStatsV2(build);
  const stats = getMissionCapabilitySnapshot(shipStats);
  const installedTags = getInstalledTags(build);
  const blockers = getRequirementIssues(mission, installedTags);
  const { warnings, hints, coverage } = getRecommendationIssues(mission, stats);
  const score = getReadinessScore(coverage, blockers.length > 0);
  const issues = [...blockers, ...warnings, ...hints];
  const recommendedChanges = Array.from(
    new Set(
      issues.flatMap((issue) =>
        issue.severity !== "hint" && issue.suggestedChange ? [issue.suggestedChange] : []
      )
    )
  );

  return {
    score,
    canLaunch: blockers.length === 0,
    blockers,
    warnings,
    hints,
    issues,
    recommendedChanges,
    stats,
    installedTags: [...installedTags].sort()
  };
}

function getInstalledTags(build: ShipBuild): Set<string> {
  const tags = new Set<string>();

  build.modules.forEach((installed) => {
    getModule(installed.moduleId).tags.forEach((tag) => tags.add(tag));
  });
  (build.panels ?? []).forEach((installed) => {
    getPanel(installed.panelId).tags.forEach((tag) => tags.add(tag));
  });

  return tags;
}

function getMissionCapabilitySnapshot(stats: ShipStatsV2): MissionCapabilitySnapshot {
  return {
    dps: stats.dps,
    shield: stats.shieldCapacity,
    speed: stats.maxSpeed,
    acceleration: stats.acceleration,
    heatStability: Math.max(0, stats.heatDissipation - stats.heatGeneration),
    cargoCapacity: 0,
    miningPower: 0,
    pointDefense: 0
  };
}

function getRequirementIssues(mission: MissionDef, installedTags: Set<string>) {
  return (mission.hardRequirements.requiredTags ?? []).flatMap<MissionReadinessIssue>((tag) => {
    if (installedTags.has(tag)) return [];
    const label = requiredTagLabels[tag] ?? humanize(tag);
    return [
      {
        code: `missing-tag:${tag}`,
        severity: "blocker",
        kind: "hard-requirement",
        label,
        message: `${label} is required for this contract.`,
        tag,
        suggestedChange: requiredTagSuggestions[tag] ?? `Install equipment tagged ${label}.`
      }
    ];
  });
}

function getRecommendationIssues(mission: MissionDef, stats: MissionCapabilitySnapshot) {
  const warnings: MissionReadinessIssue[] = [];
  const hints: MissionReadinessIssue[] = [];
  const coverage: number[] = [];

  capabilityOrder.forEach((capability) => {
    const required = mission.recommendations[capability];
    if (required === undefined || required <= 0) return;

    const actual = stats[capability];
    const ratio = Math.min(1, Math.max(0, actual / required));
    const isMet = actual >= required;
    const label = capabilityLabels[capability];
    const message = `${label}: ${formatStat(actual)} / ${formatStat(required)}`;
    const issue: MissionReadinessIssue = {
      code: `${isMet ? "met" : "below"}-recommendation:${capability}`,
      severity: isMet ? "hint" : "warning",
      kind: "recommendation",
      label,
      message,
      capability,
      actual,
      required,
      suggestedChange: isMet ? undefined : capabilitySuggestions[capability]
    };

    coverage.push(ratio);
    (isMet ? hints : warnings).push(issue);
  });

  return { warnings, hints, coverage };
}

function getReadinessScore(coverage: number[], hasBlockers: boolean) {
  const average = coverage.length > 0
    ? coverage.reduce((sum, value) => sum + value, 0) / coverage.length
    : 1;
  const score = Math.round(average * 100);
  return hasBlockers ? Math.min(49, score) : score;
}

function humanize(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStat(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
