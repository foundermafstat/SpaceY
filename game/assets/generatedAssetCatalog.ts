import assetCatalog from "@/public/assets/generated/asset-catalog.json";
import aiGeneratedAssets from "@/public/assets/generated/ai/ai-generated-assets.json";
import frameCatalog from "@/public/assets/generated/frame-catalog-atlas.json";
import moduleCatalog from "@/public/assets/generated/module-catalog-states-atlas.json";

export const generatedAssetCatalog = assetCatalog;
export const generatedAiAssets = aiGeneratedAssets;
export const generatedModuleCatalog = moduleCatalog;
export const generatedFrameCatalog = frameCatalog;
export const generatedVfxCatalog = assetCatalog.vfx;

export type GeneratedModuleAssetId = keyof typeof moduleCatalog.assets;
export type GeneratedFrameAssetId = keyof typeof frameCatalog.assets;
export type GeneratedVfxAssetId = keyof typeof assetCatalog.vfx.assets;
