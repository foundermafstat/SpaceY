import createClient, {
  mergeHeaders,
  type Client,
  type ClientOptions,
  type HeadersOptions,
  type Middleware,
} from "openapi-fetch";

import type { paths } from "./generated/schema.js";

const DEFAULT_PUBLIC_API_URL = "https://api.spacey.aima.space";

export type PublicPaths = Pick<
  paths,
  Extract<keyof paths, `/public/v1/${string}`>
>;

export type SpaceYPublicClient = Client<PublicPaths>;

type CredentialOptions =
  | { apiKey: string; accessToken?: never }
  | { apiKey?: never; accessToken: string }
  | { apiKey?: never; accessToken?: never };

export type SpaceYPublicClientOptions = CredentialOptions & {
  /** Absolute API origin. Plain HTTP is accepted only for loopback development. */
  baseUrl?: string;
  /** Optional fetch implementation for supported runtimes and tests. */
  fetch?: ClientOptions["fetch"];
  /** Non-authentication headers applied to every request. */
  headers?: HeadersOptions;
};

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);

  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("SpaceY API baseUrl must not contain credentials, query, or fragment");
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("SpaceY API baseUrl must use HTTPS (HTTP is loopback-only)");
  }

  return url.toString().replace(/\/$/, "");
}

function requireCredentialValue(name: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

const publicRequestMiddleware: Middleware = {
  async onRequest({ request, schemaPath }) {
    const headers = new Headers(request.headers);
    if (schemaPath !== "/public/v1/oauth/token") {
      if (headers.has("authorization") && headers.has("x-api-key")) {
        throw new TypeError("A public API request must use exactly one credential scheme");
      }
      return request;
    }

    headers.delete("Authorization");
    headers.delete("X-API-Key");
    if (!headers.get("content-type")?.includes("application/json")) {
      return new Request(request, { headers });
    }

    const body = (await request.clone().json()) as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        form.set(key, String(value));
      }
    }

    headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    return new Request(request, { body: form, headers });
  },
};

/**
 * Creates a generated, path-typed client limited to the partner-facing
 * `/public/v1` surface. The SDK never stores or refreshes credentials.
 */
export function createSpaceYPublicClient(
  options: SpaceYPublicClientOptions = {},
): SpaceYPublicClient {
  const apiKey = requireCredentialValue("apiKey", options.apiKey);
  const accessToken = requireCredentialValue("accessToken", options.accessToken);

  if (apiKey && accessToken) {
    throw new TypeError("Provide either apiKey or accessToken, not both");
  }

  const headers = mergeHeaders(options.headers);
  if (headers.has("authorization") || headers.has("x-api-key")) {
    throw new TypeError("Pass credentials through apiKey or accessToken, not headers");
  }
  if (apiKey) {
    headers.set("X-API-Key", apiKey);
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const client = createClient<PublicPaths>({
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_PUBLIC_API_URL),
    credentials: "omit",
    fetch: options.fetch,
    headers,
  });
  client.use(publicRequestMiddleware);
  return client;
}
