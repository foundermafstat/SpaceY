import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { ADMIN_DATABASE, type AdminDatabase } from "../persistence/admin-database.js";
import {
  ADMIN_ROLES,
  type AdminPermission,
  type AdminPrincipal,
  type AdminRole,
  type AdminSessionAuthenticator,
} from "../security/admin-security.js";

export const ADMIN_SESSION_COOKIE = "__Host-spacey_admin_session";

const ROLE_PRIORITY: readonly AdminRole[] = [
  "SuperAdmin",
  "ContentEditor",
  "EconomyOperator",
  "Moderator",
  "Support",
  "Analyst",
  "Auditor",
];

const ADMIN_PERMISSIONS = new Set<AdminPermission>([
  "content:read",
  "content:write",
  "economy:read",
  "economy:adjust",
  "players:read",
  "players:moderate",
  "support:write",
  "analytics:read",
  "audit:read",
  "admins:manage",
]);

type AdminSessionRow = Readonly<{
  session_id: string;
  admin_id: string;
  authentication_method: "WEBAUTHN" | "TOTP_RECOVERY";
  webauthn_credential_id: string | null;
  credential_revoked_at: Date | null;
  role_key: string | null;
  role_permissions: string[] | null;
}>;

function isAdminRole(value: string | null): value is AdminRole {
  return value !== null && (ADMIN_ROLES as readonly string[]).includes(value);
}

function isAdminPermission(value: string): value is AdminPermission {
  return ADMIN_PERMISSIONS.has(value as AdminPermission);
}

export function hashAdminSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function principalFromSessionRows(rows: readonly AdminSessionRow[]): AdminPrincipal | null {
  const first = rows[0];
  if (!first) return null;

  if (first.authentication_method === "WEBAUTHN") {
    if (!first.webauthn_credential_id || first.credential_revoked_at) return null;
  }

  const assignedRoles = new Set(rows.map((row) => row.role_key).filter(isAdminRole));
  const role = ROLE_PRIORITY.find((candidate) => assignedRoles.has(candidate));
  if (!role) return null;

  const permissions = [...new Set(rows.flatMap((row) => row.role_permissions ?? []).filter(isAdminPermission))];
  return {
    adminId: first.admin_id,
    sessionId: first.session_id,
    role,
    permissions,
    authenticationMethod: first.authentication_method === "WEBAUTHN" ? "webauthn" : "totp-recovery",
  };
}

@Injectable()
export class PostgresAdminSessionAuthenticator implements AdminSessionAuthenticator {
  constructor(@Inject(ADMIN_DATABASE) private readonly database: AdminDatabase) {}

  async authenticate(request: FastifyRequest): Promise<AdminPrincipal | null> {
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
    const token = cookies?.[ADMIN_SESSION_COOKIE];
    if (!token || token.length < 32 || token.length > 512) return null;

    return this.authenticateToken(token);
  }

  async authenticateToken(token: string): Promise<AdminPrincipal | null> {
    const result = await this.database.query<AdminSessionRow>(
      `SELECT
         s.id AS session_id,
         u.id AS admin_id,
         s.authentication_method,
         s.webauthn_credential_id,
         c.revoked_at AS credential_revoked_at,
         r.key AS role_key,
         r.permissions AS role_permissions
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       LEFT JOIN webauthn_credentials c ON c.id = s.webauthn_credential_id
       LEFT JOIN admin_user_roles assignment ON assignment.admin_user_id = u.id
       LEFT JOIN admin_roles r ON r.id = assignment.admin_role_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.status = 'ACTIVE'`,
      [hashAdminSessionToken(token)],
    );

    return principalFromSessionRows(result.rows);
  }

  async probe(): Promise<boolean> {
    await this.database.query(
      `SELECT s.id, u.id, c.id, r.id
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       LEFT JOIN webauthn_credentials c ON c.id = s.webauthn_credential_id
       LEFT JOIN admin_user_roles assignment ON assignment.admin_user_id = u.id
       LEFT JOIN admin_roles r ON r.id = assignment.admin_role_id
       LIMIT 0`,
    );
    return true;
  }
}
