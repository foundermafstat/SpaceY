# SpaceY Image Asset Backlog

This backlog tracks what graphic assets are already available and what still needs generation. All future images must follow `image-asset-generation-methodology.md`.

## Current Asset Sources Checked

- `image-asset-generation-methodology.md`
- `design-doc.md`, section 18
- `design-doc2.md`, section 15
- `game/assets/moduleSprites.ts`
- `game/data/cabins.ts`
- `game/data/panels.ts`
- `game/data/modules.ts`
- `public/assets/generated/asset-catalog.json`
- `public/assets/cabins-v2/manifest.json`
- `public/assets/panels-v3/manifest.json`
- `public/assets/generated/ai/ai-generated-assets.json`

## Ready Or Present

- Runtime cabin set: 11 cabin sprites in `public/assets/cabins-v2/manifest.json`, each with `ideal`, `damaged`, `heavyDamage`, and `debris`.
- Runtime panel set: 14 panel sprites in `public/assets/panels-v3/manifest.json`, each with `ideal`, `damaged`, `heavyDamage`, and `debris`.
- Runtime base module atlas: `public/assets/modules/module-states-atlas.png`.
- Runtime weapon atlas: `public/assets/weapons/weapon-states-atlas.png`, with separate weapon base and turret rows.
- Runtime VFX atlas: `public/assets/vfx/battle-vfx-atlas.png`.
- Runtime hover/engine helper atlas: `public/assets/vfx/hover-vfx-atlas.png`.
- Backgrounds: 8 deep-space tiles and 8 planet images under `public/assets/backgrounds`.
- Generated catalog atlas: 90 design-doc assets in `public/assets/generated/asset-catalog.json`.
- Pilot mission elements: `drill`, `loot_magnet`, `cargo_container`, `tractor_beam`, and `scanner` in `public/assets/generated/pilot/mission-elements/manifest.json`.

## Generated But Not Fully Runtime-Integrated

These are present in the generated catalog, but should not be treated as complete runtime coverage until consuming code and manifests use them directly.

- Hull modules from `design-doc.md`: 22 variants.
- Armor modules from `design-doc.md`: 12 variants.
- Engine modules from `design-doc.md`: 12 variants.
- Weapon modules from `design-doc.md`: 14 weapons, split into base and turret assets.
- Energy modules from `design-doc.md`: 9 variants.
- Shield/defense modules from `design-doc.md`: 7 variants.

## Missing For MVP Mission System

These are required by `design-doc2.md` for mission gameplay but are not present as distinct runtime element assets.

### Cabins

- `twin_cockpit`
- `utility_cabin`

Existing generic cabin shapes can stand in temporarily, but these named MVP cabins need style-consistent final art if they become visible catalog items.

### Panels

- `light_hull_panel`
- `heavy_hull_panel`
- `cargo_panel`
- `weapon_mount_panel`
- `engine_mount_panel`
- `utility_mount_panel`
- `heat_sink_panel`
- `adapter_panel`
- `y_junction_panel`
- `shield_conductive_panel`

Current panels are shape-based and visually generic. Generate role-specific material overlays or separate role variants only when the panel role becomes visible to players.

### Functional Elements

Priority for the next generation batch:

1. `drill`
2. `loot_magnet`
3. `cargo_container`
4. `tractor_beam`
5. `repair_beam`
6. `scanner`
7. `reverse_thruster`
8. `flak_turret`
9. `emp_emitter`
10. `point_defense`
11. `battery`

Already represented in current runtime or generated catalog, but may need final normalized runtime entries:

- `ion_engine`
- `plasma_engine`
- `side_thruster`
- `autocannon`
- `laser`
- `shield_generator`
- `small_reactor`
- `heat_sink`

## Missing Or Partial VFX

Current runtime VFX covers basic projectiles, impacts, smoke, explosions, shell casing, and debris cluster. The design-doc VFX list still needs expanded coverage:

- engine glow sizes: small, medium, large
- engine glow colors: blue, orange, purple
- engine plume: short, medium, long
- engine ignition flash
- engine overdrive plume
- side thruster burst
- reverse thruster burst
- railgun beam line
- laser beam core and outer glow
- missile smoke trail
- EMP wave ring
- electric arc segment
- flak projectile
- laser burn mark
- plasma splash
- EMP hit electric noise
- missile impact flash
- shockwave ring
- small and large smoke puffs as separate animation frames
- burning debris chunks and metal fragments

## Missing Or Partial UI Assets

Current UI kits exist under `public/assets/ui`, but the design-doc gameplay UI list is only partially mapped to runtime surfaces:

- mobile joystick base
- mobile joystick handle
- hp bar frame
- shield bar frame
- energy bar frame
- heat bar frame
- module card frames by rarity: common, rare, epic, legendary
- grid cell states: empty, valid, invalid, selected
- socket icons: power, weapon, engine, structure
- warning icons: energy, mass

## Pilot Batch Generated

Generated first to lock the style before large-scale production:

1. `drill`
2. `loot_magnet`
3. `cargo_container`
4. `tractor_beam`
5. `scanner`

Each pilot asset needs:

- `ideal`
- `damaged`
- `heavyDamage`
- `debris`
- transparent final output
- normalized atlas entry
- manifest metadata with grid size, role, source path, and state paths

Output:

- `public/assets/generated/pilot/mission-elements/mission-elements-pilot-atlas.png`
- `public/assets/generated/pilot/mission-elements/manifest.json`
- `public/assets/generated/pilot/mission-elements/prompts.md`

## Per-Asset Prompt Template

Use the master prompt from `image-asset-generation-methodology.md`, then add:

```text
Asset-specific line: [asset_id], [grid size], [role], [recognizable gameplay function], same SpaceY style, same palette, same top-down orthographic camera.
```

Examples:

```text
Asset-specific line: drill, 1x1 utility element, compact industrial asteroid-drilling device with reinforced rotating drill head, readable as mining and close-range ram damage hardware.
```

```text
Asset-specific line: loot_magnet, 1x1 utility element, compact electromagnetic salvage collector with circular coil, small cyan field emitters, readable as a pickup-range device.
```
