import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ADMIN_MUTATION_UNIT_OF_WORK } from "./audit/admin-mutation.port.js";
import { AdminAuthController, AdminRecoveryAuthController } from "./auth/admin-auth.controller.js";
import { ADMIN_RECOVERY_AUTHENTICATION, ADMIN_STRONG_AUTHENTICATION } from "./auth/admin-auth.port.js";
import { ADMIN_AUTH_RATE_LIMITER, createAdminAuthRateLimiter } from "./auth/admin-auth-rate-limiter.js";
import { ADMIN_SECRET_CIPHER, createAdminSecretCipher } from "./auth/admin-secret-cipher.js";
import { PostgresAdminRecoveryAuthentication } from "./auth/postgres-admin-recovery-authentication.js";
import { PostgresAdminSessionAuthenticator } from "./auth/postgres-admin-session-authenticator.js";
import { PostgresAdminStrongAuthentication } from "./auth/postgres-admin-strong-authentication.js";
import { ADMIN_WEBAUTHN_SERVER, SimpleWebAuthnServer } from "./auth/webauthn-server.js";
import { loadAdminApiConfig } from "./config.js";
import { AdminMutationsController } from "./mutations/admin-mutations.controller.js";
import { AdminMutationService } from "./mutations/admin-mutations.js";
import {
  ADMIN_API_CONFIG,
  ADMIN_DATABASE,
  PostgresAdminDatabase,
} from "./persistence/admin-database.js";
import { PostgresAdminMutationUnitOfWork } from "./persistence/postgres-admin-mutation-unit-of-work.js";
import {
  ADMIN_SESSION_AUTHENTICATOR,
  AdminAccessGuard,
} from "./security/admin-security.js";
import { ADMIN_ALLOWED_ORIGINS, PrivateOriginGuard } from "./security/private-origin.guard.js";
import { SessionController } from "./session.controller.js";
import { AdminCsrfGuard } from "./security/admin-csrf.guard.js";
import { ADMIN_READINESS, PostgresAdminReadinessProbe, SystemController } from "./system.controller.js";

const config = loadAdminApiConfig();
const secretCipher = createAdminSecretCipher(process.env);
const authRateLimiter = createAdminAuthRateLimiter(config, process.env);

@Module({
  controllers: [SystemController, AdminAuthController, AdminRecoveryAuthController, SessionController, AdminMutationsController],
  providers: [
    { provide: ADMIN_API_CONFIG, useValue: config },
    PostgresAdminDatabase,
    { provide: ADMIN_DATABASE, useExisting: PostgresAdminDatabase },
    PostgresAdminSessionAuthenticator,
    PostgresAdminStrongAuthentication,
    PostgresAdminRecoveryAuthentication,
    SimpleWebAuthnServer,
    PostgresAdminMutationUnitOfWork,
    AdminMutationService,
    { provide: ADMIN_ALLOWED_ORIGINS, useValue: config.allowedOrigins },
    { provide: ADMIN_SESSION_AUTHENTICATOR, useExisting: PostgresAdminSessionAuthenticator },
    { provide: ADMIN_STRONG_AUTHENTICATION, useExisting: PostgresAdminStrongAuthentication },
    { provide: ADMIN_RECOVERY_AUTHENTICATION, useExisting: PostgresAdminRecoveryAuthentication },
    { provide: ADMIN_SECRET_CIPHER, useValue: secretCipher },
    { provide: ADMIN_AUTH_RATE_LIMITER, useValue: authRateLimiter },
    { provide: ADMIN_WEBAUTHN_SERVER, useExisting: SimpleWebAuthnServer },
    { provide: ADMIN_MUTATION_UNIT_OF_WORK, useExisting: PostgresAdminMutationUnitOfWork },
    { provide: ADMIN_READINESS, useClass: PostgresAdminReadinessProbe },
    { provide: APP_GUARD, useClass: PrivateOriginGuard },
    { provide: APP_GUARD, useClass: AdminCsrfGuard },
    { provide: APP_GUARD, useClass: AdminAccessGuard },
  ],
})
export class AppModule {}
