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

export const PLANET_GLOW_COLORS = [
  0x9ceaff,
  0xff6a2a,
  0xb16cff,
  0x46f5ff,
  0xffc56a,
  0x9cff4f,
  0x79b7ff,
  0x7fc8ff
] as const;

type Range = readonly [number, number];

export type HomePlanetLayout = {
  alpha: Range;
  driftSpeed: Range;
  driftXFactor: Range;
  driftYFactor: Range;
  edgeOffset: Range;
  heightFactor: Range;
  maxWidthFactor: number;
  spinSpeed: Range;
  widthFactor: Range;
  yFactor: Range;
};

export const HOME_PLANET_LAYOUTS: readonly HomePlanetLayout[] = [
  {
    alpha: [0.64, 0.78],
    driftSpeed: [0.012, 0.022],
    driftXFactor: [0.014, 0.028],
    driftYFactor: [0.008, 0.018],
    edgeOffset: [0.05, 0.14],
    heightFactor: [0.42, 0.52],
    maxWidthFactor: 0.82,
    spinSpeed: [0.0007, 0.0016],
    widthFactor: [0.58, 0.68],
    yFactor: [0.48, 0.68]
  },
  {
    alpha: [0.42, 0.58],
    driftSpeed: [0.018, 0.032],
    driftXFactor: [0.018, 0.038],
    driftYFactor: [0.012, 0.026],
    edgeOffset: [0.12, 0.24],
    heightFactor: [0.16, 0.24],
    maxWidthFactor: 0.34,
    spinSpeed: [0.0012, 0.0028],
    widthFactor: [0.18, 0.25],
    yFactor: [0.14, 0.38]
  }
] as const;

export type CosmicGlowConfig = {
  alpha: Range;
  color: number;
  driftSpeed: Range;
  driftXFactor: Range;
  driftYFactor: Range;
  pulseSpeed: Range;
  radiusX: Range;
  radiusY: Range;
  rotationSpeed: Range;
  xFactor: Range;
  yFactor: Range;
};

export const HOME_COSMIC_GLOW_CONFIGS: readonly CosmicGlowConfig[] = [
  {
    alpha: [0.035, 0.062],
    color: 0x2cecff,
    driftSpeed: [0.01, 0.018],
    driftXFactor: [0.012, 0.024],
    driftYFactor: [0.008, 0.016],
    pulseSpeed: [0.09, 0.15],
    radiusX: [360, 540],
    radiusY: [170, 290],
    rotationSpeed: [0.012, 0.026],
    xFactor: [0.04, 0.22],
    yFactor: [0.16, 0.38]
  },
  {
    alpha: [0.032, 0.056],
    color: 0x8b5cff,
    driftSpeed: [0.012, 0.022],
    driftXFactor: [0.014, 0.03],
    driftYFactor: [0.01, 0.02],
    pulseSpeed: [0.08, 0.13],
    radiusX: [420, 640],
    radiusY: [210, 340],
    rotationSpeed: [0.01, 0.02],
    xFactor: [0.62, 0.9],
    yFactor: [0.08, 0.3]
  },
  {
    alpha: [0.026, 0.048],
    color: 0xffa24a,
    driftSpeed: [0.008, 0.016],
    driftXFactor: [0.01, 0.02],
    driftYFactor: [0.008, 0.018],
    pulseSpeed: [0.06, 0.11],
    radiusX: [320, 520],
    radiusY: [160, 260],
    rotationSpeed: [0.014, 0.028],
    xFactor: [0.24, 0.48],
    yFactor: [0.66, 0.92]
  },
  {
    alpha: [0.024, 0.044],
    color: 0x4dffcf,
    driftSpeed: [0.014, 0.024],
    driftXFactor: [0.014, 0.028],
    driftYFactor: [0.01, 0.02],
    pulseSpeed: [0.1, 0.16],
    radiusX: [300, 480],
    radiusY: [140, 240],
    rotationSpeed: [0.012, 0.024],
    xFactor: [0.72, 0.96],
    yFactor: [0.58, 0.84]
  }
] as const;

export function pickSpaceTileSource(rng: () => number = Math.random) {
  return SPACE_TILE_SRCS[Math.floor(rng() * SPACE_TILE_SRCS.length)];
}

export function pickPlanetSources(count: number, rng: () => number = Math.random) {
  return [...PLANET_SRCS].sort(() => rng() - 0.5).slice(0, count);
}
