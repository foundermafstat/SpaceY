import { getModule, getPanel, getTransformedCells } from "@/game/ship/build";
import { calculateShipStatsV2 } from "@/game/ship/statsV2";
import { buildShipTopology } from "@/game/ship/topology";
import type {
  GridCell,
  RuntimePartState,
  ShipBuild,
  ShipStatsV2,
  ShipTopologyGraph,
  WeaponDef
} from "@/game/types";

export type RuntimeWeapon = {
  partId: string;
  weapon: WeaponDef;
  mount: GridCell;
  cooldown: number;
};

export type RuntimeEngine = {
  partId: string;
  mount: GridCell;
  thrust: number;
  maneuverThrust: number;
  direction: "rear" | "side";
};

export type RuntimeShield = {
  partId: string;
  capacity: number;
  regen: number;
};

export type RuntimeEnergyState = {
  storage: number;
  output: number;
  demand: number;
};

export type RuntimeHeatState = {
  heat: number;
  generation: number;
  dissipation: number;
};

export type ShipRuntime = {
  buildId: string;
  parts: RuntimePartState[];
  weapons: RuntimeWeapon[];
  engines: RuntimeEngine[];
  shields: RuntimeShield[];
  energy: RuntimeEnergyState;
  heat: RuntimeHeatState;
  shieldPool: number;
  stats: ShipStatsV2;
  topology: ShipTopologyGraph;
};

export function createShipRuntime(
  build: ShipBuild,
  stats: ShipStatsV2 = calculateShipStatsV2(build),
  topology: ShipTopologyGraph = buildShipTopology(build)
): ShipRuntime {
  const parts: RuntimePartState[] = [];
  const weapons: RuntimeWeapon[] = [];
  const engines: RuntimeEngine[] = [];
  const shields: RuntimeShield[] = [];

  topology.nodes
    .filter((node) => node.kind === "cabin")
    .forEach((node) => {
      parts.push({
        id: node.id,
        kind: "cabin",
        hp: stats.structureHp,
        maxHp: stats.structureHp,
        gridCells: node.cells,
        disabled: false,
        detached: false,
        networks: node.networkTypes
      });
    });

  for (const installed of build.panels ?? []) {
    const panel = getPanel(installed.panelId);
    const gridCells = getTransformedCells(panel, installed.position, installed.rotation);
    parts.push({
      id: `panel:${installed.instanceId}`,
      kind: "panel",
      hp: panel.hp,
      maxHp: panel.hp,
      gridCells,
      disabled: false,
      detached: false,
      networks: panel.networks
    });
  }

  for (const installed of build.modules) {
    const module = getModule(installed.moduleId);
    if (build.cabinId && module.type === "core") continue;
    const gridCells = getTransformedCells(module, installed.position, installed.rotation);
    const partId = `element:${installed.instanceId}`;
    parts.push({
      id: partId,
      kind: "element",
      hp: module.hp,
      maxHp: module.hp,
      gridCells,
      disabled: false,
      detached: false,
      networks: topology.nodes.find((node) => node.id === partId)?.networkTypes ?? []
    });
    if (module.weapon) {
      weapons.push({ partId, weapon: module.weapon, mount: installed.position, cooldown: 0 });
    }
    if (module.type === "engine") {
      engines.push({
        partId,
        mount: installed.position,
        thrust: module.thrust ?? 0,
        maneuverThrust: module.maneuverThrust ?? 0,
        direction: module.id === "side_thruster" ? "side" : "rear"
      });
    }
    if (module.shield) {
      shields.push({ partId, capacity: module.shield.capacity, regen: module.shield.regen });
    }
  }

  return {
    buildId: build.id,
    parts,
    weapons,
    engines,
    shields,
    energy: {
      storage: stats.powerStorage,
      output: stats.powerOutput,
      demand: stats.powerDemand
    },
    heat: {
      heat: stats.heat,
      generation: stats.heatGeneration,
      dissipation: stats.heatDissipation
    },
    shieldPool: stats.shieldCapacity,
    stats,
    topology
  };
}

export function damageRuntimePart(runtime: ShipRuntime, partId: string, amount: number): ShipRuntime {
  return {
    ...runtime,
    parts: runtime.parts.map((part) => {
      if (part.id !== partId) return part;
      const hp = Math.max(0, part.hp - amount);
      return {
        ...part,
        hp,
        disabled: hp <= 0,
        detached: hp <= 0 && part.kind !== "cabin"
      };
    })
  };
}
