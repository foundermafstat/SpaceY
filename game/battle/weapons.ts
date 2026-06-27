import type { Sprite } from "pixi.js";
import { getFrame, getModule, getTransformedCells } from "@/game/ship/build";
import type { ShipBuild, WeaponDef } from "@/game/types";
import type { Vec } from "@/game/battle/math";

export type WeaponState = {
  weapon: WeaponDef;
  cooldown: number;
  mount: Vec;
  turret?: Sprite;
};

export function collectWeapons(build: ShipBuild, turrets: Map<string, Sprite>): WeaponState[] {
  const frame = getFrame(build.frameId);
  const centerX = (frame.size.width - 1) / 2;
  const centerY = (frame.size.height - 1) / 2;
  const weapons: WeaponState[] = [];

  build.modules.forEach((installed) => {
    const module = getModule(installed.moduleId);
    if (!module.weapon) return;
    const cells = getTransformedCells(module, installed.position, installed.rotation);
    const mountCell = cells.reduce(
      (acc, cell) => ({ x: acc.x + cell.x / cells.length, y: acc.y + cell.y / cells.length }),
      { x: 0, y: 0 }
    );
    weapons.push({
      weapon: module.weapon,
      cooldown: Math.random() * 0.8,
      mount: {
        x: (mountCell.x - centerX) * 20,
        y: (mountCell.y - centerY) * 20
      },
      turret: turrets.get(installed.instanceId)
    });
  });

  return weapons;
}

export function rotateTurretToTarget(weaponState: WeaponState, ownerRotation: number, ownerPos: Vec, targetPos: Vec) {
  if (!weaponState.turret) return;
  const targetAngle = Math.atan2(targetPos.y - ownerPos.y, targetPos.x - ownerPos.x);
  weaponState.turret.rotation = targetAngle - ownerRotation + Math.PI / 2;
}
