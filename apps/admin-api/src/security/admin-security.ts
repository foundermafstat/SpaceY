import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const ADMIN_ROLES = [
  "SuperAdmin",
  "ContentEditor",
  "EconomyOperator",
  "Moderator",
  "Support",
  "Analyst",
  "Auditor",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminPermission =
  | "content:read"
  | "content:write"
  | "economy:read"
  | "economy:adjust"
  | "players:read"
  | "players:moderate"
  | "support:write"
  | "analytics:read"
  | "audit:read"
  | "admins:manage";

const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  SuperAdmin: ["content:read", "content:write", "economy:read", "economy:adjust", "players:read", "players:moderate", "support:write", "analytics:read", "audit:read", "admins:manage"],
  ContentEditor: ["content:read", "content:write"],
  EconomyOperator: ["economy:read", "economy:adjust", "players:read"],
  Moderator: ["players:read", "players:moderate"],
  Support: ["players:read", "support:write"],
  Analyst: ["content:read", "economy:read", "analytics:read"],
  Auditor: ["content:read", "economy:read", "players:read", "analytics:read", "audit:read"],
};

export type AdminPrincipal = Readonly<{
  adminId: string;
  sessionId: string;
  role: AdminRole;
  permissions: readonly AdminPermission[];
  authenticationMethod: "webauthn" | "totp-recovery";
}>;

type AdminRequest = FastifyRequest & { adminPrincipal?: AdminPrincipal };

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasEveryPermission(
  principal: Pick<AdminPrincipal, "role" | "permissions">,
  required: readonly AdminPermission[],
): boolean {
  const granted = new Set([...permissionsForRole(principal.role), ...principal.permissions]);
  return required.every((permission) => granted.has(permission));
}

export const PUBLIC_ADMIN_ROUTE = Symbol("spacey.public-admin-route");
export const ADMIN_AUTHENTICATION_ROUTE = Symbol("spacey.admin-authentication-route");
export const REQUIRED_ADMIN_PERMISSIONS = Symbol("spacey.admin-permissions");

export const PublicAdminRoute = () => SetMetadata(PUBLIC_ADMIN_ROUTE, true);
export const AdminAuthenticationRoute = () => SetMetadata(ADMIN_AUTHENTICATION_ROUTE, true);
export const RequiresAdminPermissions = (...permissions: AdminPermission[]) => SetMetadata(REQUIRED_ADMIN_PERMISSIONS, permissions);

export const ADMIN_SESSION_AUTHENTICATOR = Symbol("spacey.admin-session-authenticator");

export interface AdminSessionAuthenticator {
  authenticate(request: FastifyRequest): Promise<AdminPrincipal | null>;
}

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ADMIN_SESSION_AUTHENTICATOR) private readonly authenticator: AdminSessionAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ADMIN_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_AUTHENTICATION_ROUTE, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const principal = await this.authenticator.authenticate(request);
    if (!principal) throw new UnauthorizedException();

    const required = this.reflector.getAllAndOverride<AdminPermission[]>(REQUIRED_ADMIN_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (!hasEveryPermission(principal, required)) return false;

    request.adminPrincipal = principal;
    return true;
  }
}

export function getAdminPrincipal(request: FastifyRequest): AdminPrincipal {
  const principal = (request as AdminRequest).adminPrincipal;
  if (!principal) throw new UnauthorizedException();
  return principal;
}
