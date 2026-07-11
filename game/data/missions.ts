import type { MissionDef, MissionId } from "@/game/mission/types";

export const missionIds = [
  "credit-sweep",
  "cargo-escort",
  "meteorite-drilling"
] as const satisfies readonly MissionId[];

export const missionDefs = [
  {
    id: "credit-sweep",
    name: "Credit Sweep",
    type: "salvage",
    risk: "green",
    briefing:
      "Recover valuable containers from an abandoned trade route before rival salvagers arrive.",
    durationSec: 90,
    objective: {
      type: "destroy_all",
      target: 4,
      label: "Clear 4 rival salvagers"
    },
    hardRequirements: {},
    recommendations: {
      cargoCapacity: 4,
      speed: 300,
      shield: 10
    },
    hazards: ["Drifting debris", "Unstable battery crates", "Light pirate scouts"],
    enemyKinds: ["Pirate scout"],
    rewards: {
      credits: 300,
      scrap: 12,
      alloy: 1,
      bonuses: [{ kind: "common-panel-chance", label: "Chance for a common panel" }]
    }
  },
  {
    id: "cargo-escort",
    name: "Cargo Escort",
    type: "escort",
    risk: "green",
    briefing:
      "Protect a fragile client shipment along its route and keep attackers away until extraction.",
    durationSec: 120,
    objective: {
      type: "survive_seconds",
      target: 120,
      label: "Protect the cargo for 120 seconds"
    },
    hardRequirements: {
      requiredTags: ["escort-beacon"]
    },
    recommendations: {
      pointDefense: 25,
      shield: 30,
      acceleration: 0.4
    },
    hazards: ["Missile pirates", "Fast drones", "Fragile cargo"],
    enemyKinds: ["Missile pirate", "Attack drone"],
    rewards: {
      credits: 700,
      scrap: 12,
      dataShards: 2,
      bonuses: []
    }
  },
  {
    id: "meteorite-drilling",
    name: "Meteorite Drilling",
    type: "mining",
    risk: "green",
    briefing:
      "Hold position against a volatile meteorite while the drilling cycle extracts its rare ore.",
    durationSec: 45,
    objective: {
      type: "survive_seconds",
      target: 45,
      label: "Hold drilling position for 45 seconds"
    },
    hardRequirements: {
      requiredTags: ["mining-tool"]
    },
    recommendations: {
      miningPower: 50,
      heatStability: 45,
      cargoCapacity: 6,
      pointDefense: 15
    },
    hazards: ["Rock fragments", "Heat spikes", "Mining drones"],
    enemyKinds: ["Mining drone"],
    rewards: {
      credits: 500,
      scrap: 12,
      alloy: 5,
      bonuses: [
        { kind: "rare-connector-chance", label: "Chance for a rare connector" }
      ]
    }
  }
] as const satisfies readonly MissionDef[];

export const missionById: Readonly<Record<MissionId, MissionDef>> = {
  "credit-sweep": missionDefs[0],
  "cargo-escort": missionDefs[1],
  "meteorite-drilling": missionDefs[2]
};

export function isMissionId(value: unknown): value is MissionId {
  return typeof value === "string" && (missionIds as readonly string[]).includes(value);
}

export function getMissionById(id: MissionId): MissionDef {
  return missionById[id];
}

export default missionDefs;
