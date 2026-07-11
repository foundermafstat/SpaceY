"use client";

import { type FormEvent, useState } from "react";
import {
  beginWebAuthnAuthentication,
  finishWebAuthnAuthentication,
  serializeAuthenticationCredential,
  toPublicKeyRequestOptions,
} from "../../lib/admin-browser-api";

function webAuthnFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Authentication was cancelled, timed out, or user verification failed.";
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "This origin is not allowed to use the configured security key.";
  }
  if (error instanceof Error) return error.message;
  return "Authentication could not be completed.";
}

export function AdminLoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) {
        throw new Error("WebAuthn requires a secure browser context and a supported authenticator.");
      }

      const form = new FormData(event.currentTarget);
      const loginHint = String(form.get("loginHint") ?? "").trim();
      const challenge = await beginWebAuthnAuthentication(loginHint);
      const credential = await navigator.credentials.get({
        publicKey: toPublicKeyRequestOptions(challenge.publicKeyOptions),
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new Error("The authenticator did not return a public-key credential.");
      }

      await finishWebAuthnAuthentication(
        challenge.challengeId,
        serializeAuthenticationCredential(credential),
      );
      window.location.assign("/");
    } catch (caught) {
      setError(webAuthnFailure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-form login-form" onSubmit={authenticate}>
      <label htmlFor="login-hint">Administrator email</label>
      <input
        id="login-hint"
        name="loginHint"
        type="email"
        autoComplete="username webauthn"
        maxLength={320}
        required
        disabled={pending}
      />
      <button type="submit" disabled={pending}>
        {pending ? "Waiting for security key…" : "Continue with WebAuthn"}
      </button>
      <p className="form-note">User verification is required. Recovery credentials are handled outside the primary login screen.</p>
      <p className="form-error" role="alert" aria-live="polite">{error ?? ""}</p>
    </form>
  );
}
