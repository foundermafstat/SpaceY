import type { BootstrapResponseDto, InventoryItemDto, ShipBuildPartDto } from "@spacey/contracts";

export type FixtureScenario = "default" | "contracts" | "build" | "inventory" | "damaged" | "empty" | "error" | "loading";

const now = "2026-07-12T10:00:00.000Z";
const contentVersion = "2026.07.ui-sandbox";
const buildId = "fixture-build-contract-breaker";
const revisionId = "fixture-revision-1";

const installedDefinitions = [
  ["starter-core", 0, 0],
  ["small_reactor", 0, -1],
  ["hull_block", -1, 0],
  ["hull_block", 1, 0],
  ["starter-blaster", -2, 0],
  ["autocannon", 2, 0],
  ["starter-shield", 0, 1],
  ["starter-engine", -1, 1],
  ["ion_engine", 1, 1],
  ["starter-thruster", 0, 2],
] as const;

const installedParts: ShipBuildPartDto[] = installedDefinitions.map(([definitionId, gridX, gridY], index) => ({
  inventoryItemId: `fixture-installed-${index + 1}`,
  definitionId,
  gridX,
  gridY,
  rotation: 0,
}));

export function createFixtureBootstrap(scenario: FixtureScenario = "default"): BootstrapResponseDto {
  const inventory = [
    ...installedParts.map((part, index) => fixtureItem(part.inventoryItemId, part.definitionId, "installed", 10000, revisionId, index)),
    fixtureItem("fixture-available-laser", "laser_turret", "available", 10000, null, 20),
    fixtureItem("fixture-available-hull", "hull_block", "available", 10000, null, 21),
    fixtureItem("fixture-damaged-shield", "shield_generator", "damaged", scenario === "damaged" ? 3150 : 7250, null, 22),
    fixtureItem("fixture-destroyed-engine", "ion_engine", "destroyed", 0, null, 23),
  ];

  return {
    serverTime: now,
    profile: {
      id: "fixture-player",
      telegramUserId: "9000000001",
      displayName: "SpaceY UI Developer",
      avatarUrl: null,
      locale: "en",
      createdAt: now,
    },
    wallet: { credits: 12840, scrap: 376, alloy: 48, dataShards: 12 },
    activeBuild: scenario === "empty" ? null : {
      id: buildId,
      activeRevision: {
        id: revisionId,
        buildId,
        revision: 1,
        name: scenario === "error" ? "Contract Breaker With An Intentionally Long Development Name" : "Contract Breaker",
        parts: installedParts,
        createdAt: now,
      },
      updatedAt: now,
    },
    inventory,
    contentRelease: { id: "fixture-content", version: contentVersion, publishedAt: now },
    missions: [
      fixtureMission("starter-scout", "Starter Scout", "salvage", "green", "Clear all 4 rival salvagers", 4, 90, 300, 12),
      fixtureMission("convoy-guard", "Convoy Guard", "escort", "yellow", "Protect the convoy for 60 seconds", 60, 120, 450, 18),
      fixtureMission("salvage-sweep", "Salvage Sweep", "mining", "green", "Collect 5 scrap caches", 5, 120, 380, 24),
      fixtureMission("ranked-duel", "Ranked Duel", "intercept", "yellow", "Destroy the opposing ship", 1, 180, 0, 0),
    ],
    activeGameplay: [],
    capabilities: { pvpMatchmaking: true, repair: true },
  };
}

function fixtureMission(
  id: string,
  name: string,
  type: "salvage" | "escort" | "mining" | "intercept",
  risk: "green" | "yellow",
  label: string,
  target: number,
  durationSeconds: number,
  credits: number,
  scrap: number,
) {
  return {
    id,
    contentVersion,
    name,
    type,
    risk,
    briefing: `${name} fixture briefing for responsive UI development.`,
    durationSeconds,
    objective: { type: objectiveType(id), target, label },
    rewardPreview: credits ? { credits, scrap } : {},
  } as const;
}

function objectiveType(id: string): "destroy_all" | "collect_scrap" | "protect_target" {
  if (id === "convoy-guard") return "protect_target";
  if (id === "salvage-sweep") return "collect_scrap";
  return "destroy_all";
}

function fixtureItem(
  id: string,
  definitionId: string,
  state: InventoryItemDto["state"],
  durability: number,
  installedBuildRevisionId: string | null,
  index: number,
): InventoryItemDto {
  const category = categoryFor(definitionId);
  return {
    id,
    definitionId,
    contentVersion,
    rarity: index % 7 === 0 ? "uncommon" : "common",
    state,
    durability,
    category,
    shape: { cells: [[0, 0]] },
    stats: { hp: 100 + index * 5, mass: 12 + index, powerDraw: category === "power" ? 0 : 8 },
    visualKey: definitionId,
    installedBuildRevisionId,
    createdAt: now,
  };
}

function categoryFor(definitionId: string) {
  if (definitionId.includes("engine") || definitionId.includes("thruster")) return "engines";
  if (definitionId.includes("blaster") || definitionId.includes("cannon") || definitionId.includes("laser")) return "weapons";
  if (definitionId.includes("reactor") || definitionId.includes("shield")) return "power";
  return "structure";
}
