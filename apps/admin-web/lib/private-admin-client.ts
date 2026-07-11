import "server-only";
import { cookies } from "next/headers";
import type { AdminPermission } from "./navigation";

export type AdminSession = Readonly<{
  adminId: string;
  sessionId: string;
  role: string;
  permissions: readonly AdminPermission[];
  authenticationMethod: "webauthn" | "totp-recovery";
}>;

type SessionResponse = Readonly<{ principal: AdminSession }>;

export type AdminSessionState =
  | Readonly<{ status: "authenticated"; session: AdminSession }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "unavailable" }>;

function privateApiConfiguration() {
  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const origin = process.env.ADMIN_WEB_ORIGIN;
  if (!baseUrl || !origin) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), origin };
}

/**
 * Server-only boundary for the private Admin API. Browser components must never
 * call the private ingress directly. Replace the response types here with the
 * generated private-spec client when that specification is published internally.
 */
export async function getAdminSessionState(): Promise<AdminSessionState> {
  const config = privateApiConfiguration();
  if (!config) return { status: "unavailable" };

  const cookieStore = await cookies();
  try {
    const response = await fetch(`${config.baseUrl}/internal/admin/v1/session`, {
      cache: "no-store",
      headers: {
        cookie: cookieStore.toString(),
        origin: config.origin,
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (response.status === 401 || response.status === 403) return { status: "unauthenticated" };
    if (!response.ok) return { status: "unavailable" };
    return { status: "authenticated", session: ((await response.json()) as SessionResponse).principal };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getCurrentAdminSession(): Promise<AdminSession | null> {
  const state = await getAdminSessionState();
  return state.status === "authenticated" ? state.session : null;
}
