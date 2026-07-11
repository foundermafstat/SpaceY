"use client";

import { useEffect, useState } from "react";
import { ServerBoundaryStatus } from "@/components/server/ServerBoundaryStatus";
import {
  ServerSessionProvider,
  type TelegramLaunchContext
} from "@/game/server/session-context";

let runtimePromise: Promise<TelegramLaunchContext> | null = null;

function publishState(name: string, value: string) {
  document.documentElement.dataset[name] = value;
}

function reportRuntimeError(action: string, error: unknown) {
  console.warn(`[SpaceY Telegram Mini App] ${action} failed`, error);
}

async function initializeTelegramMiniApp(): Promise<TelegramLaunchContext> {
  const {
    init,
    isTMA,
    miniApp,
    retrieveRawInitData,
    swipeBehavior,
    viewport
  } = await import("@tma.js/sdk-react");

  if (!isTMA()) {
    publishState("tmaState", "browser");
    return { isTelegram: false, initData: null };
  }

  init();
  const rawInitData = retrieveRawInitData() ?? null;
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

  return { isTelegram: true, initData: rawInitData };
}

export function TelegramMiniAppRuntime({ children }: { children: React.ReactNode }) {
  const [launch, setLaunch] = useState<TelegramLaunchContext | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    runtimePromise ??= initializeTelegramMiniApp();
    void runtimePromise.then((context) => {
      if (active) setLaunch(context);
    }).catch((error: unknown) => {
      runtimePromise = null;
      publishState("tmaState", "error");
      reportRuntimeError("initialization", error);
      if (active) setRuntimeError("Telegram Mini App initialization failed.");
    });
    return () => {
      active = false;
    };
  }, [retryKey]);

  if (runtimeError) {
    return (
      <ServerBoundaryStatus
        message={runtimeError}
        onRetry={() => {
          setRuntimeError(null);
          setRetryKey((value) => value + 1);
        }}
        status="error"
      />
    );
  }
  if (!launch) return <ServerBoundaryStatus message={null} status="starting" />;
  return <ServerSessionProvider launch={launch}>{children}</ServerSessionProvider>;
}
