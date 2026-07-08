# Mission Elements Pilot Prompt Set

Methodology source: `image-asset-generation-methodology.md`

Shared prompt base:

```text
Use case: stylized-concept
Asset type: SpaceY top-down modular spaceship game asset source sheet
Style/medium: premium 2D sci-fi mobile game sprite, strict top-down orthographic view, no perspective camera, no isometric tilt.
Subject: dark graphite and titanium modular spaceship component with beveled layered armor plates, standardized connector sockets, small technical greebles, restrained cyan emissive accents, hard-surface metal, machined panels, bolts, vents, seams, slight wear, no organic shapes.
Composition/framing: create a 2x2 source sheet of the same asset in four states. Top-left ideal, top-right damaged, bottom-left heavyDamage, bottom-right debris. No labels, no text, no divider lines. Each quadrant contains one centered component, full part visible, generous padding, no crop, same silhouette and proportions across states.
Lighting/mood: consistent soft top-left light, subtle ambient occlusion only on the object, no cast shadow outside the object.
Color palette: dark graphite, gunmetal, titanium edges, muted cyan/blue emissions; use orange/white only for damage scorch or exposed hot metal.
Transparent workflow source: create on a perfectly flat solid #00ff00 chroma-key background for background removal. Do not use #00ff00 anywhere in the subject.
Avoid: perspective, 3D camera angle, isometric tilt, painterly blur, plastic toy look, overbright neon, noisy tiny detail, baked engine flame, baked projectile, baked explosion, UI frame, labels, watermark, text.
```

Asset-specific lines:

```text
drill: 1x1 utility element for asteroid mining and close-range ram damage. Compact square modular machinery body inside the 1x1 grid footprint, with a clearly visible tapered drill cone / auger bit protruding horizontally from the right side edge of the body. Do not place the drill cone in the center of the module.
loot_magnet: 1x1 utility element, compact electromagnetic salvage collector with circular coil and cyan field emitters, readable as pickup-range and loot attraction hardware.
cargo_container: 1x1 utility element, compact armored modular cargo pod with reinforced storage doors and latch hardware, readable as ship cargo storage.
tractor_beam: 1x1 utility element, compact gravitic tractor beam emitter with reinforced projector dish and focusing rings, readable as towing and object-pulling hardware. Hardware only; no active beam.
scanner: 1x1 utility element, compact deep-space sensor scanner with antenna fins, lens array, and cyan sensor core, readable as detection and survey hardware. Hardware only; no scan wave or UI reticle.
```
