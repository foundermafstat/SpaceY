import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import type { StoreReplayRequest } from "./ports.js";

export type EncodedReplay = {
  body: Uint8Array;
  checksumSha256: string;
  uncompressedBytes: number;
};

export function encodeReplay(request: StoreReplayRequest): EncodedReplay {
  const orderedInputs = request.kind === "pve"
    ? [...request.inputs].sort((left, right) => left.seq - right.seq).map((input) => ({ input }))
    : [...request.inputs]
      .sort((left, right) => left.input.targetTick - right.input.targetTick
        || left.userId.localeCompare(right.userId)
        || left.input.seq - right.input.seq)
      .map(({ userId, input }) => ({ userId, input }));
  const lines = [
    JSON.stringify({
      record: "header",
      formatVersion: 1,
      kind: request.kind,
      completedAtMs: request.completedAtMs,
      simulationConfig: request.simulationConfig
    }),
    ...orderedInputs.map((input) => JSON.stringify({ record: "input", ...input })),
    JSON.stringify({ record: "checkpoint", checkpoint: request.finalCheckpoint }),
    JSON.stringify({ record: "outcome", outcome: request.outcome })
  ];
  const source = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  const body = gzipSync(source, { level: 9 });
  return {
    body,
    checksumSha256: createHash("sha256").update(body).digest("hex"),
    uncompressedBytes: source.byteLength
  };
}
