import type { NextRequest } from "next/server";

const MAX_BODY_BYTES = 1_048_576;
const STATIC_ALLOWED_ROUTES = new Set([
  "POST auth/webauthn/authentication/options",
  "POST auth/webauthn/authentication/verify",
  "POST mutations/content",
  "POST mutations/economy/adjustments",
  "POST session/logout",
]);
const RELEASE_ROUTE = /^content\/releases\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(clone|validate|publish|rollback|revisions)$/i;

export function isAllowedAdminProxyRoute(method: string, route: string): boolean {
  if (STATIC_ALLOWED_ROUTES.has(`${method} ${route}`)) return true;
  if (method === "GET" && route === "content/releases") return true;
  const match = RELEASE_ROUTE.exec(route);
  if (!match) return false;
  return match[1] === "revisions" ? method === "GET" : method === "POST";
}

type RouteContext = Readonly<{ params: Promise<{ path: string[] }> }>;

function proxyConfiguration() {
  const baseUrl = process.env.ADMIN_API_BASE_URL;
  const expectedOrigin = process.env.ADMIN_WEB_ORIGIN;
  if (!baseUrl || !expectedOrigin) return null;

  try {
    const parsed = new URL(baseUrl);
    const origin = new URL(expectedOrigin);
    if (
      !new Set(["http:", "https:"]).has(parsed.protocol)
      || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
      || origin.origin !== expectedOrigin || origin.pathname !== "/" || origin.username || origin.password
    ) return null;
    return { baseUrl: parsed.origin, expectedOrigin: origin.origin };
  } catch {
    return null;
  }
}

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const route = path.join("/");
  if (!isAllowedAdminProxyRoute(request.method, route)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const config = proxyConfiguration();
  if (!config) {
    return Response.json({ error: "Private API unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const origin = request.headers.get("origin") ?? request.nextUrl.origin;
  if (origin !== config.expectedOrigin) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers({ origin });
  for (const name of ["content-type", "cookie", "x-csrf-token"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413, headers: { "cache-control": "no-store" } });
    }
  }

  try {
    const upstream = await fetch(`${config.baseUrl}/internal/admin/v1/${route}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const responseHeaders = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "retry-after", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Private API unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export const POST = proxy;
export const GET = proxy;
