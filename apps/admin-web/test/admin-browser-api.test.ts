import assert from "node:assert/strict";
import test from "node:test";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  csrfTokenFromCookie,
  safeAdminError,
  toPublicKeyRequestOptions,
} from "../lib/admin-browser-api";

function bufferFromSource(value: BufferSource): Buffer {
  return ArrayBuffer.isView(value)
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : Buffer.from(value);
}

test("WebAuthn request options decode challenge and credential identifiers", () => {
  const challenge = Uint8Array.from([0, 255, 16, 32]).buffer;
  const credentialId = Uint8Array.from([1, 2, 3, 254]).buffer;
  const options = toPublicKeyRequestOptions({
    challenge: bytesToBase64Url(challenge),
    rpId: "admin.spacey.test",
    userVerification: "required",
    allowCredentials: [{ id: bytesToBase64Url(credentialId), type: "public-key", transports: ["internal"] }],
  });

  assert.deepEqual(bufferFromSource(options.challenge), Buffer.from(challenge));
  assert.deepEqual(bufferFromSource(options.allowCredentials?.[0]?.id ?? new ArrayBuffer(0)), Buffer.from(credentialId));
  assert.deepEqual(Buffer.from(base64UrlToBytes(bytesToBase64Url(challenge))), Buffer.from(challenge));
});

test("CSRF lookup requires the exact host-only cookie name", () => {
  assert.equal(csrfTokenFromCookie("other=1; __Host-spacey_admin_csrf=abc%2Fdef; session=2"), "abc/def");
  assert.equal(csrfTokenFromCookie("spacey_admin_csrf=wrong"), null);
  assert.equal(csrfTokenFromCookie("__Host-spacey_admin_csrf=%E0%A4%A"), null);
});

test("error copy is status-based and does not expose response bodies", () => {
  assert.match(safeAdminError(401, "authentication"), /Authentication failed/u);
  assert.match(safeAdminError(403, "mutation"), /CSRF/u);
  assert.equal(safeAdminError(500, "mutation"), "The operation could not be completed.");
});
