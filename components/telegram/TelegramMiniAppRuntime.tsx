"use client";

import { useEffect } from "react";

let runtimePromise: Promise<void> | null = null;

function publishState(name: string, value: string) {
  document.documentElement.dataset[name] = value;
}

function reportRuntimeError(action: string, error: unknown) {
  console.warn(`[SpaceY Telegram Mini App] ${action} failed`, error);
}

async function initializeTelegramMiniApp() {
  const {
    init,
    isTMA,
    miniApp,
    swipeBehavior,
    viewport
  } = await import("@tma.js/sdk-react");

  if (!isTMA()) {
    publishState("tmaState", "browser");
    return;
  }

  init();
  miniApp.mount.ifAvailable();
  miniApp.ready.ifAvailable();
  publishState("tmaState", "ready");

  const swipeMount = swipeBehavior.mount.ifAvailable();
  if (swipeMount.ok) {
    const disabled = swipeBehavior.disableVertical.ifAvailable();
    publishState("tmaVerticalSwipes", disabled.ok ? "disabled" : "unavailable");
  } else {
    publishState("tmaVerticalSwipes", "unsupported");
  }

  let viewportMounted = false;
  try {
    await viewport.mount();
    viewportMounted = true;
  } catch (error) {
    reportRuntimeError("viewport mount", error);
  }

  if (viewportMounted) {
    viewport.bindCssVars.ifAvailable();
    viewport.expand.ifAvailable();

    if (viewport.isFullscreen()) {
      publishState("tmaFullscreen", "active");
    } else {
      const fullscreenRequest = viewport.requestFullscreen.ifAvailable();
      if (fullscreenRequest.ok) {
        try {
          await fullscreenRequest.data;
          publishState("tmaFullscreen", "active");
        } catch (error) {
          publishState("tmaFullscreen", "failed");
          reportRuntimeError("fullscreen request", error);
        }
      } else {
        publishState("tmaFullscreen", "unsupported");
      }
    }
  }
}

export function TelegramMiniAppRuntime() {
  useEffect(() => {
    runtimePromise ??= initializeTelegramMiniApp().catch((error) => {
      publishState("tmaState", "error");
      reportRuntimeError("initialization", error);
    });
  }, []);

  return null;
}
