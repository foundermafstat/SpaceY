# `@spacey/public-sdk`

Typed, render-agnostic client for SpaceY `/public/v1` HTTP endpoints. Types are generated from `specs/player-public.openapi.yaml`; the client deliberately excludes player gameplay routes and Admin API.

```sh
pnpm add @spacey/public-sdk
```

```ts
import { createSpaceYPublicClient } from "@spacey/public-sdk";

const client = createSpaceYPublicClient({ apiKey: process.env.SPACEY_API_KEY });
const { data, error } = await client.GET("/public/v1/catalog");
```

OAuth2 Client Credentials is encoded according to the OpenAPI form contract:

```ts
const unauthenticated = createSpaceYPublicClient();
const result = await unauthenticated.POST("/public/v1/oauth/token", {
  body: {
    grant_type: "client_credentials",
    client_id: process.env.SPACEY_CLIENT_ID!,
    client_secret: process.env.SPACEY_CLIENT_SECRET!,
    scope: "catalog:read stats:read",
  },
});
```

Use exactly one credential: `apiKey` for scoped API keys or `accessToken` for OAuth2 Client Credentials tokens. Credentials are never persisted by the SDK. Consumer code must handle documented `error` responses and partner quotas.

API keys and OAuth client secrets are server-side credentials. Never embed them in the Telegram Mini App or another browser bundle; a browser may receive only a short-lived scoped access token through an approved backend flow.

## Contract lifecycle

- `pnpm --filter @spacey/public-sdk generate` refreshes committed generated types.
- `pnpm --filter @spacey/public-sdk check:generated` fails when the OpenAPI contract and committed types differ.
- CI checks OpenAPI compatibility, generated output, compilation and client behavior.
- `/public/v1` is major version 1. Breaking changes require a new major URL. The previous major remains supported for at least 12 months after a successor is announced.
- Release notes for contract and SDK changes are recorded in `CHANGELOG.md`.

The package is configured for public-registry distribution, but releases must be produced by an approved registry/signing pipeline rather than developer machines. The current `UNLICENSED` marker follows the proprietary canonical contract and must be replaced only after legal approval of SDK terms.
