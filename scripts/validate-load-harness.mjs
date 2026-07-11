import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  encodeInputCommand,
  encodeSessionResume,
  exactArrayBuffer,
  serverEnvelopeField,
} from "../load/k6/battle-protobuf.mjs";

assert.deepEqual([...encodeSessionResume(0)], [10, 2, 8, 0]);
assert.deepEqual([...encodeInputCommand(1, 1)], [18, 15, 8, 1, 16, 0, 24, 0, 32, 0, 40, 208, 15, 48, 0, 56, 1]);
assert.equal(serverEnvelopeField(Uint8Array.from([18, 0])), 2);
assert.equal(new Uint8Array(exactArrayBuffer(Uint8Array.from([34, 0])))[0], 34);

const harness = readFileSync(new URL("../load/k6/spacey-pvp-acceptance.mjs", import.meta.url), "utf8");
for (const requiredGuard of [
  "STAGING_ONLY_I_ACCEPT_COST",
  "SPACEY_LOAD_DENY_HOSTS",
  "participantCount !== 2",
  "p(95)<250",
  "p(95)<2000",
  "p(95)<1000",
  "1000 / 30",
]) {
  assert.match(harness, new RegExp(requiredGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

process.stdout.write("k6 harness static and protobuf fixture validation passed.\n");
