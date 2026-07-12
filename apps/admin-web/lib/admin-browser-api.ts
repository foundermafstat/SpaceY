export const ADMIN_CSRF_COOKIE = "__Host-spacey_admin_csrf";

export type WebAuthnAuthenticationChallenge = Readonly<{
  challengeId: string;
  expiresAt: string;
  publicKeyOptions: PublicKeyCredentialRequestOptionsJSON;
}>;

type PublicKeyCredentialDescriptorJSON = Readonly<{
  id: string;
  type: PublicKeyCredentialType;
  transports?: readonly AuthenticatorTransport[];
}>;

export type PublicKeyCredentialRequestOptionsJSON = Readonly<{
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: readonly PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
}>;

export type AuthenticationCredentialJSON = Readonly<{
  id: string;
  rawId: string;
  response: Readonly<{
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | null;
  }>;
  type: PublicKeyCredentialType;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment: AuthenticatorAttachment | null;
}>;

export function bytesToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

export function toPublicKeyRequestOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: base64UrlToBytes(credential.id),
      transports: credential.transports ? [...credential.transports] : undefined,
    })),
  };
}

export function serializeAuthenticationCredential(credential: PublicKeyCredential): AuthenticationCredentialJSON {
  if (!(credential.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("Unexpected WebAuthn response type");
  }

  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    response: {
      authenticatorData: bytesToBase64Url(credential.response.authenticatorData),
      clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
      signature: bytesToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle ? bytesToBase64Url(credential.response.userHandle) : null,
    },
    type: "public-key",
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment:
      credential.authenticatorAttachment === "platform" || credential.authenticatorAttachment === "cross-platform"
        ? credential.authenticatorAttachment
        : null,
  };
}

export function csrfTokenFromCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== ADMIN_CSRF_COOKIE) continue;
    const value = rawValue.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function safeAdminError(status: number, operation: "authentication" | "mutation"): string {
  if (status === 400) return "The submitted data is invalid. Review the fields and try again.";
  if (status === 401) {
    return operation === "authentication"
      ? "Authentication failed or the challenge expired."
      : "The administrator session expired. Sign in again.";
  }
  if (status === 403) return "The request was rejected by access, origin, or CSRF policy.";
  if (status === 409) return "The resource changed. Refresh its revision before retrying.";
  if (status === 429) return "Too many attempts. Wait before trying again.";
  if (status === 503) return "The private control plane is temporarily unavailable.";
  return "The operation could not be completed.";
}

async function postJson<T>(path: string, payload: unknown, operation: "authentication" | "mutation"): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  if (operation === "mutation") {
    const csrfToken = csrfTokenFromCookie(document.cookie);
    if (!csrfToken) throw new Error("The administrator session is missing its CSRF token. Sign in again.");
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(safeAdminError(response.status, operation));
  return response.json() as Promise<T>;
}

export type AdminContentRelease = Readonly<{
  id: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  configHash: string;
  schemaVersion: number;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: Readonly<{ missions: number; modules: number; enemies: number; dropTables: number }>;
}>;

export type ContentReleaseActionResult = Readonly<{
  releaseId: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  configHash?: string;
  correlationId: string;
}>;

export type ContentValidationResult = Readonly<{
  releaseId: string;
  valid: boolean;
  configHash: string;
  simulationVersion: string;
  violations: readonly Readonly<{ code: string; path: string; message: string }>[];
}>;

export function beginWebAuthnAuthentication(loginHint: string) {
  return postJson<WebAuthnAuthenticationChallenge>(
    "/internal/admin/v1/auth/webauthn/authentication/options",
    { loginHint },
    "authentication",
  );
}

export function finishWebAuthnAuthentication(challengeId: string, credential: AuthenticationCredentialJSON) {
  return postJson(
    "/internal/admin/v1/auth/webauthn/authentication/verify",
    { challengeId, credential },
    "authentication",
  );
}

export type AdminMutationResult = Readonly<{
  correlationId: string;
  revision: number;
  resourceId?: string;
  playerId?: string;
}>;

export function applyContentRevision(payload: unknown) {
  return postJson<AdminMutationResult>("/internal/admin/v1/mutations/content", payload, "mutation");
}

export function applyEconomyAdjustment(payload: unknown) {
  return postJson<AdminMutationResult>("/internal/admin/v1/mutations/economy/adjustments", payload, "mutation");
}

export function cloneContentRelease(releaseId: string, payload: unknown) {
  return postJson<ContentReleaseActionResult>(`/internal/admin/v1/content/releases/${releaseId}/clone`, payload, "mutation");
}

export function rollbackContentRelease(releaseId: string, payload: unknown) {
  return postJson<ContentReleaseActionResult>(`/internal/admin/v1/content/releases/${releaseId}/rollback`, payload, "mutation");
}

export function publishContentRelease(releaseId: string, payload: unknown) {
  return postJson<ContentReleaseActionResult>(`/internal/admin/v1/content/releases/${releaseId}/publish`, payload, "mutation");
}

export function validateContentRelease(releaseId: string) {
  return postJson<ContentValidationResult>(`/internal/admin/v1/content/releases/${releaseId}/validate`, {}, "mutation");
}

export function revokeCurrentAdminSession() {
  return postJson<Readonly<{ revoked: true }>>("/internal/admin/v1/session/logout", {}, "mutation");
}
