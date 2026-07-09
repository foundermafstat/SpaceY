export const SPACE_TILE_SCALE = 0.8;

export const SPACE_TILE_SRCS = [
  "/assets/backgrounds/deep-space-tile-01.webp",
  "/assets/backgrounds/deep-space-tile-02.webp",
  "/assets/backgrounds/deep-space-tile-03.webp",
  "/assets/backgrounds/deep-space-tile-04.webp",
  "/assets/backgrounds/deep-space-tile-05.webp",
  "/assets/backgrounds/deep-space-tile-06.webp",
  "/assets/backgrounds/deep-space-tile-07.webp",
  "/assets/backgrounds/deep-space-tile-08.webp"
] as const;

export const PLANET_SRCS = [
  "/assets/backgrounds/planets/planet-ice.webp",
  "/assets/backgrounds/planets/planet-lava.webp",
  "/assets/backgrounds/planets/planet-purple.webp",
  "/assets/backgrounds/planets/planet-cyan.webp",
  "/assets/backgrounds/planets/planet-desert.webp",
  "/assets/backgrounds/planets/planet-toxic.webp",
  "/assets/backgrounds/planets/planet-metal.webp",
  "/assets/backgrounds/planets/planet-storm.webp"
] as const;

export function pickSpaceTileSource(rng: () => number = Math.random) {
  return SPACE_TILE_SRCS[Math.floor(rng() * SPACE_TILE_SRCS.length)];
}

export function pickPlanetSources(count: number, rng: () => number = Math.random) {
  return [...PLANET_SRCS].sort(() => rng() - 0.5).slice(0, count);
}
