"use client";

import type { LegacyBuildImportProposalDto } from "@spacey/contracts";

const LEGACY_STORAGE_KEY = "starframe-arena-ship";
const IMPORT_MARKER_KEY = "spacey:legacy-build-v3-proposal:v1";
const MAX_LEGACY_PAYLOAD_BYTES = 256_000;

export function readLegacyBuildV3Proposal(): LegacyBuildImportProposalDto | null {
  try {
    if (localStorage.getItem(IMPORT_MARKER_KEY) === "accepted") return null;
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_LEGACY_PAYLOAD_BYTES) return null;
    const persisted = JSON.parse(raw) as unknown;
    if (!isRecord(persisted) || persisted.version !== 3 || !isRecord(persisted.state)) return null;
    const build = persisted.state.build;
    if (!isRecord(build) || build.schemaVersion !== 3 || !isIdentifier(build.frameId)) return null;

    const sourceBuildId = isIdentifier(build.id) ? build.id : `legacy-${build.frameId}`.slice(0, 128);
    const cabinPosition = readPosition(build.cabinPosition);
    const elements = readParts(build.elements, "elementId", "element");
    return {
      schemaVersion: 3,
      sourceBuildId,
      name: typeof build.name === "string" && build.name.length > 0 ? build.name.slice(0, 64) : "Legacy ship",
      frameId: build.frameId,
      ...(isIdentifier(build.cabinId) && cabinPosition ? {
        cabin: {
          definitionId: build.cabinId,
          gridX: cabinPosition.x,
          gridY: cabinPosition.y,
          rotation: readRotation(build.cabinRotation) ?? 0
        }
      } : {}),
      parts: [
        ...readParts(build.panels, "panelId", "panel"),
        ...(elements.length > 0 ? elements : readParts(build.modules, "moduleId", "module"))
      ].slice(0, 256)
    };
  } catch {
    return null;
  }
}

export function markLegacyBuildV3ProposalAccepted() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.setItem(IMPORT_MARKER_KEY, "accepted");
  } catch {
    // Private browsing and disabled storage must not block the server session.
  }
}

function readParts(
  value: unknown,
  definitionKey: "panelId" | "moduleId" | "elementId",
  kind: "panel" | "module" | "element"
): LegacyBuildImportProposalDto["parts"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 128).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const position = readPosition(candidate.position);
    const rotation = readRotation(candidate.rotation);
    const definitionId = candidate[definitionKey];
    if (
      !isIdentifier(candidate.instanceId)
      || !isIdentifier(definitionId)
      || !position
      || rotation === null
    ) return [];
    return [{
      sourceInstanceId: candidate.instanceId,
      kind,
      definitionId,
      gridX: position.x,
      gridY: position.y,
      rotation
    }];
  });
}

function readPosition(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y)) return null;
  const x = value.x as number;
  const y = value.y as number;
  if (x < -64 || x > 64 || y < -64 || y > 64) return null;
  return { x, y };
}

function readRotation(value: unknown): 0 | 90 | 180 | 270 | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}
