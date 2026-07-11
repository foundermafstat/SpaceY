import type { AdminPrincipal } from "../security/admin-security.js";

export type WebAuthnChallenge = Readonly<{
  challengeId: string;
  publicKeyOptions: object;
  expiresAt: string;
}>;

export type WebAuthnAssertion = Readonly<{
  challengeId: string;
  credential: Record<string, unknown>;
}>;

export type AdminAuthenticationResult = Readonly<{
  principal: AdminPrincipal;
  sessionToken: string;
  expiresAt: string;
}>;

export interface AdminStrongAuthenticationPort {
  beginWebAuthnRegistration(adminId: string): Promise<WebAuthnChallenge>;
  finishWebAuthnRegistration(adminId: string, assertion: WebAuthnAssertion): Promise<void>;
  beginWebAuthnAuthentication(loginHint?: string): Promise<WebAuthnChallenge>;
  finishWebAuthnAuthentication(assertion: WebAuthnAssertion): Promise<AdminAuthenticationResult>;
  revokeSessionFamily(adminId: string, sessionId: string): Promise<void>;
}

export const ADMIN_STRONG_AUTHENTICATION = Symbol("spacey.admin-strong-authentication");

export type AdminRecoveryAuthenticationCommand = Readonly<{
  loginHint: string;
  credential: string;
  correlationId: string;
}>;

export interface AdminRecoveryAuthenticationPort {
  verifyTotp(command: AdminRecoveryAuthenticationCommand): Promise<AdminAuthenticationResult>;
  verifyRecoveryCode(command: AdminRecoveryAuthenticationCommand): Promise<AdminAuthenticationResult>;
  probe(): Promise<boolean>;
}

export const ADMIN_RECOVERY_AUTHENTICATION = Symbol("spacey.admin-recovery-authentication");
