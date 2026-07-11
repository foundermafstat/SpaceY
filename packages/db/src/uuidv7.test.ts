import assert from "node:assert/strict";
import test from "node:test";

import { createUuidV7, isUuidV7 } from "./uuidv7.js";

test("createUuidV7 encodes the RFC 9562 timestamp, version, and variant", () => {
  const id = createUuidV7(0x0123456789ab);

  assert.match(id, /^01234567-89ab-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(isUuidV7(id), true);
});

test("createUuidV7 rejects invalid timestamps", () => {
  assert.throws(() => createUuidV7(-1), RangeError);
  assert.throws(() => createUuidV7(Number.NaN), RangeError);
  assert.equal(isUuidV7("00000000-0000-4000-8000-000000000000"), false);
});
