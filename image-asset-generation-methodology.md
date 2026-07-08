# Image Asset Generation Methodology

This file is the source of truth for generated gameplay assets.

## Style Lock

All generated gameplay image assets must use this same visual contract:

- top-down strict orthographic 2D sci-fi mobile game asset
- dark graphite/titanium modular spaceship hardware
- beveled layered metal, readable silhouettes, clean game-scale details
- controlled cyan/blue emissive accents; orange only for hot engines, explosions, or damage
- consistent soft top-left lighting baked into the part
- no perspective camera, no isometric tilt, no scene background, no text, no logos, no watermark
- transparent runtime output, with generous padding and clean alpha edges
- source generation may use a flat chroma-key background only for later alpha removal

Do not change this style between batches unless the whole asset line is intentionally replaced.

## Master Prompt

Use this as the base prompt for every generated ship part, panel, cabin, weapon, and utility element. Replace only the bracketed asset-specific fields.

```text
Use case: stylized-concept
Asset type: SpaceY top-down modular spaceship game asset
Primary request: [asset id and function], [grid size], [role in ship build]
Style/medium: premium 2D sci-fi mobile game sprite, strict top-down orthographic view, no perspective, no isometric tilt
Subject: dark graphite and titanium modular spaceship component with beveled layered armor plates, readable silhouette, standardized connector sockets, small technical greebles, restrained cyan emissive accents
Composition/framing: centered component, aligned to grid, full part visible, generous padding, no crop, no rotation unless requested
Lighting/mood: consistent soft top-left light, subtle ambient occlusion, no cast shadow outside the object
Color palette: dark graphite, gunmetal, titanium edges, muted cyan/blue emissions; use orange/white only for heat, damage, or explosive VFX
Materials/textures: hard-surface metal, machined panels, bolts, vents, seams, slight wear, no organic shapes
Output constraints: transparent final asset or perfectly flat chroma-key source for alpha removal, no background, no environment, no text, no watermark
Avoid: perspective, 3D camera angle, painterly blur, plastic toy look, overbright neon, noisy tiny detail, baked engine flame, baked projectile, baked explosion, UI frame, labels
```

## State Prompt Add-ons

Use the same asset silhouette and proportions for every state.

- `ideal`: intact clean hardware, minor wear only.
- `damaged` or `lightDamage`: same part, small scorch marks, scratches, dents, a few dimmed emissive lines.
- `heavyDamage`: same part, cracked armor, exposed internal metal, strong scorch marks, broken lights.
- `debris`: destroyed readable remnant of the same part, fragmented metal but still within the same grid footprint.

## Asset-Specific Rules

- Panels and cabins are whole-component sprites with exact grid dimensions.
- Panels V3 must be generated as standalone tetris/polyomino ship hull elements per panel id; do not build final runtime panels from a repeated material tile. The pattern mask may only enforce transparent empty cells and exact runtime dimensions.
- Cabins must be generated as standalone tetris/polyomino command bridge elements with raised cockpit geometry, visible blue glass canopies, portholes, and crew/bridge cues. They must remain strict top-down assets and must not read as generic hull panels.
- Functional elements use one sprite per element unless they need separate moving parts.
- Weapons must be split into base and turret/barrel sprites. Generate four states for both base and turret.
- Engine base assets must not include active thrust flame. Generate thrust, ignition, overdrive, smoke, and burst as VFX.
- Mining/drill tools in top-down view must protrude from a side edge as visible hardware; do not embed the drill cone as a centered decorative detail inside the module.
- Reactor, shield, battery, scanner, drill, tractor, repair, and cargo elements must read as gameplay devices, not generic hull plates.
- Projectile, impact, shield-hit, smoke, explosion, debris, and engine thrust images are VFX assets, not module source art.
- UI art follows the same industrial SpaceY palette but belongs in `public/assets/ui`, not gameplay atlases.

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
- Cabins V2: `public/assets/cabins-v2/cabins/{ideal,damaged,heavyDamage,debris}`.
- Legacy panel state atlas: `public/assets/panels/panel-states-atlas.png`.
- Battle VFX: `public/assets/vfx/battle-vfx-atlas.png`.
- Hover/engine UI VFX: `public/assets/vfx/hover-vfx-atlas.png`.
- Generated catalog: `public/assets/generated/asset-catalog.json` and `public/assets/generated/module-catalog-states-atlas.png`.
- AI-generated normalized sets: `public/assets/generated/ai/ai-generated-assets.json`.

## Generation Workflow

1. Check `image-asset-generation-backlog.md` before creating new images.
2. Generate a small pilot batch first when a new category is added.
3. Keep the same master prompt and add only the asset-specific line.
4. Save source sheets separately from runtime output.
5. Remove chroma key or normalize alpha before runtime use.
6. Pack final assets into an atlas plus manifest.
7. Verify paths against consuming code before marking an item as ready.

## Validation

Run:

```bash
npm run validate:assets
```

The validator checks every atlas path referenced from `game/assets/moduleSprites.ts`, the restored legacy panel states atlas, the required V3 panel state folders, and the required V2 cabin state folders.
