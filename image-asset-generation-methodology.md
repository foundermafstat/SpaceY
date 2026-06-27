# Image Asset Generation Methodology

This file is the source of truth for generated gameplay assets.

## Atlas Rules

- Keep runtime assets in `public/assets`.
- Prefer atlas plus manifest for generated sets.
- Keep ideal, light/heavy damage, debris, detached, overheated, shield-hit, smoke, and explosion states as separate frames or state folders.
- Do not bake engine flame into engine sprites. Thrust is runtime VFX.
- Keep weapon base and turret sprites separate.

## Current Sources

- Modules: `public/assets/modules/module-states-atlas.png`.
- Weapons: `public/assets/weapons/weapon-states-atlas.png`.
- Panels V3: `public/assets/panels-v3/panels/{ideal,damaged,heavyDamage,debris}`.
- Legacy panel state atlas: `public/assets/panels/panel-states-atlas.png`.
- Battle VFX: `public/assets/vfx/battle-vfx-atlas.png`.
- Hover/engine UI VFX: `public/assets/vfx/hover-vfx-atlas.png`.

## Validation

Run:

```bash
npm run validate:assets
```

The validator checks every atlas path referenced from `game/assets/moduleSprites.ts`, the restored legacy panel states atlas, and the required V3 panel state folders.
