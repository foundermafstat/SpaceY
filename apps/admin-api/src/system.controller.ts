import { Controller, Get, Inject, Injectable, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { PostgresAdminSessionAuthenticator } from "./auth/postgres-admin-session-authenticator.js";
import { PostgresAdminStrongAuthentication } from "./auth/postgres-admin-strong-authentication.js";
import { PostgresAdminRecoveryAuthentication } from "./auth/postgres-admin-recovery-authentication.js";
import { ADMIN_AUTH_RATE_LIMITER, type AdminAuthRateLimiter } from "./auth/admin-auth-rate-limiter.js";
import { ADMIN_DATABASE, type AdminDatabase } from "./persistence/admin-database.js";
import { PublicAdminRoute } from "./security/admin-security.js";

export const ADMIN_READINESS = Symbol("spacey.admin-readiness");

export type AdminReadiness = Readonly<{
  ready: boolean;
  checks: Readonly<Record<string, boolean>>;
}>;

export interface AdminReadinessProbe {
  check(): Promise<AdminReadiness>;
}

@Injectable()
export class PostgresAdminReadinessProbe implements AdminReadinessProbe {
  constructor(
    @Inject(ADMIN_DATABASE) private readonly database: AdminDatabase,
    private readonly sessionAuthenticator: PostgresAdminSessionAuthenticator,
    private readonly strongAuthentication: PostgresAdminStrongAuthentication,
    private readonly recoveryAuthentication: PostgresAdminRecoveryAuthentication,
    @Inject(ADMIN_AUTH_RATE_LIMITER) private readonly rateLimiter: AdminAuthRateLimiter,
  ) {}

  async check(): Promise<AdminReadiness> {
    let persistence = false;
    let webauthnSession = false;
    let totpRecovery = false;
    let valkey = false;
    try {
      const result = await this.database.query<{ persistence_ready: boolean }>(
        `SELECT
           to_regclass('public.content_definition_revisions') IS NOT NULL
           AND to_regclass('public.admin_audit_logs') IS NOT NULL
           AND to_regclass('public.admin_webauthn_challenges') IS NOT NULL
           AND to_regprocedure(
             'public.spacey_admin_adjust_wallet(uuid,uuid,uuid,public.wallet_currency,bigint,text,uuid,jsonb)'
           ) IS NOT NULL
           AND has_table_privilege(current_user, 'public.content_definition_revisions', 'SELECT,INSERT')
           AND has_table_privilege(current_user, 'public.admin_audit_logs', 'SELECT,INSERT')
           AND has_function_privilege(
             current_user,
             'public.spacey_admin_adjust_wallet(uuid,uuid,uuid,public.wallet_currency,bigint,text,uuid,jsonb)',
             'EXECUTE'
           ) AS persistence_ready`,
      );
      persistence = result.rows[0]?.persistence_ready === true;
      webauthnSession = persistence
        && await this.sessionAuthenticator.probe()
        && await this.strongAuthentication.probe();
      totpRecovery = persistence && await this.recoveryAuthentication.probe();
      valkey = await this.rateLimiter.probe();
    } catch {
      // Readiness is deliberately fail-closed; detailed DB errors stay in service logs.
    }
    return {
      ready: persistence && webauthnSession && totpRecovery && valkey,
      checks: { persistence, webauthn: webauthnSession, session: webauthnSession, totpRecovery, valkey },
    };
  }
}

@Controller()
export class SystemController {
  constructor(@Inject(ADMIN_READINESS) private readonly readiness: AdminReadinessProbe) {}

  @Get("health")
  @PublicAdminRoute()
  health() {
    return { status: "ok", service: "admin-api" };
  }

  @Get("ready")
  @PublicAdminRoute()
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.readiness.check();
    if (!result.ready) reply.status(503);
    return result;
  }
}
