import assert from "node:assert/strict";
import test from "node:test";

import { createSpaceYPublicClient } from "../dist/index.js";

test("public client sends a scoped API key to a typed public path", async () => {
  let captured;
  const client = createSpaceYPublicClient({
    baseUrl: "http://127.0.0.1:7800/",
    apiKey: "public-key",
    fetch: async (request) => {
      captured = request;
      return Response.json({ contentRelease: {}, missions: [] });
    },
  });

  const result = await client.GET("/public/v1/catalog");

  assert.equal(result.response.status, 200);
  assert.equal(captured.url, "http://127.0.0.1:7800/public/v1/catalog");
  assert.equal(captured.headers.get("x-api-key"), "public-key");
  assert.equal(captured.headers.has("authorization"), false);
  assert.equal(captured.credentials, "omit");
});

test("public client uses an in-memory OAuth access token without persistence", async () => {
  let captured;
  const client = createSpaceYPublicClient({
    accessToken: "scoped-token",
    fetch: async (request) => {
      captured = request;
      return Response.json({
        generatedAt: "2026-07-11T00:00:00.000Z",
        consentedPlayers: 0,
        completedBattles: 0,
        completedPvpMatches: 0,
        publishedContentVersion: "2026.07.11",
      });
    },
  });

  await client.GET("/public/v1/stats");

  assert.equal(captured.headers.get("authorization"), "Bearer scoped-token");
  assert.equal(captured.headers.has("x-api-key"), false);
});

test("public client serializes OAuth client credentials as the contracted form body", async () => {
  let captured;
  const client = createSpaceYPublicClient({
    baseUrl: "http://localhost:7800",
    apiKey: "not-sent-to-token-endpoint",
    fetch: async (request) => {
      captured = request;
      return Response.json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 600,
        scope: "catalog:read",
      });
    },
  });

  await client.POST("/public/v1/oauth/token", {
    body: {
      grant_type: "client_credentials",
      client_id: "partner",
      client_secret: "secret",
      scope: "catalog:read",
    },
  });

  assert.match(captured.headers.get("content-type"), /^application\/x-www-form-urlencoded/);
  assert.equal(captured.headers.has("x-api-key"), false);
  assert.equal(
    await captured.text(),
    "grant_type=client_credentials&client_id=partner&client_secret=secret&scope=catalog%3Aread",
  );
});

test("public client fails closed for ambiguous or insecure credentials", () => {
  assert.throws(
    () =>
      createSpaceYPublicClient({
        apiKey: "key",
        accessToken: "token",
      }),
    /either apiKey or accessToken/,
  );
  assert.throws(
    () => createSpaceYPublicClient({ apiKey: " " }),
    /must not be empty/,
  );
  assert.throws(
    () => createSpaceYPublicClient({ headers: { Authorization: "Bearer bypass" } }),
    /through apiKey or accessToken/,
  );
  assert.throws(
    () => createSpaceYPublicClient({ baseUrl: "http://api.example.com" }),
    /must use HTTPS/,
  );
  assert.throws(
    () => createSpaceYPublicClient({ baseUrl: "https://user:pass@api.example.com" }),
    /must not contain credentials/,
  );
});
