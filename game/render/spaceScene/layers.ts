import { Container } from "@/game/render/three/three2d";

export function createLayerSet<const T extends readonly string[]>(keys: T): Record<T[number], Container> {
  return Object.fromEntries(keys.map((key) => [key, new Container()])) as Record<T[number], Container>;
}

export function addLayers<const T extends readonly string[]>(
  parent: Container,
  layers: Record<T[number], Container>,
  order: T
) {
  parent.addChild(...order.map((key) => layers[key as T[number]]));
}
