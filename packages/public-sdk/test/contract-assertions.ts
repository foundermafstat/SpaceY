import type { PublicPaths, SpaceYPublicClient } from "../src/client.js";

type Assert<T extends true> = T;

type _IncludesCatalog = Assert<
  "/public/v1/catalog" extends keyof PublicPaths ? true : false
>;

type _ExcludesPlayerGameplay = Assert<
  "/api/v1/mission-attempts" extends keyof PublicPaths ? false : true
>;

type _ExcludesAdmin = Assert<
  "/admin/v1/content-releases" extends keyof PublicPaths ? false : true
>;

declare const publicClient: SpaceYPublicClient;
publicClient.GET("/public/v1/catalog");

// @ts-expect-error Gameplay routes are intentionally unavailable in the public SDK.
publicClient.POST("/api/v1/mission-attempts", { body: {} });
