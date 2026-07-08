# SpaceY Full Design Asset Coverage

Methodology: `image-asset-generation-methodology.md`

## New Full-Design Outputs

- Panels: 10 role-specific ship construction panels.
- MVP elements: 4 accepted sheets (`reverse_thruster`, `battery`, `twin_cockpit`, `utility_cabin`).
- Active multipart weapons: 15 assets, each split into `base_mount`, `turret_body`, `barrel`, and `active_subpart` across 4 states.
- Engines: 12 engine modules, no baked active thrust flame.
- VFX: 48 engine/projectile/impact/explosion/debris sprites.
- UI: 20 gameplay UI sprites.
- Backgrounds: 10 parallax/background layers.

## Reused Existing Generated Catalogs

- Frames: `public/assets/generated/frame-catalog-atlas.json`.
- Hull, armor, energy, shield/defense, and legacy weapon catalog: `public/assets/generated/asset-catalog.json`.

## Key Files

- Aggregate manifest: `public/assets/generated/full-design/manifest.json`
- Panels atlas: `public/assets/generated/full-design/panels/panels-full-design-atlas.png`
- Weapons atlas: `public/assets/generated/full-design/weapons/weapons-multipart-atlas.png`
- Engines atlas: `public/assets/generated/full-design/engines/engines-atlas.png`
- VFX atlas: `public/assets/generated/full-design/vfx/vfx-full-design-atlas.png`
- UI atlas: `public/assets/generated/full-design/ui/ui-full-design-atlas.png`

## Notes

- Weapon source sheets are multipart by design so the runtime can rotate turrets and offset barrels during recoil.
- Engine source sprites remain hardware-only; thrust, plume, burst, and glow effects are separate VFX.
- Rejected source sheets are preserved under `rejected/` folders and are not referenced by final manifests.
