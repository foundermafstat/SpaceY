"use client";

import type {
  BootstrapResponseDto,
  ShipBuildCommandDto,
  ShipBuildDto
} from "@spacey/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ServerBoundaryStatus } from "@/components/server/ServerBoundaryStatus";
import {
  authenticateDevelopment,
  authenticateTelegram,
  applyShipBuildCommands,
  clearAccessToken,
  getBootstrap,
  refreshAccessToken,
  ServerApiError,
  submitLegacyBuildV3Proposal
} from "@/game/server/api-client";
import {
  markLegacyBuildV3ProposalAccepted,
  readLegacyBuildV3Proposal
} from "@/game/server/legacy-build-v3";
import {
  fingerprintTelegramInitData,
  readTelegramLaunchClaim,
  telegramUserIdFromInitData,
  writeTelegramLaunchClaim
} from "@/game/server/telegram-launch-claim";

export type TelegramLaunchContext = {
  isTelegram: boolean;
  initData: string | null;
};

type SessionStatus = "starting" | "ready" | "blocked" | "error";

type ServerSessionValue = {
  bootstrap: BootstrapResponseDto;
  refreshBootstrap: () => Promise<BootstrapResponseDto>;
  mutateActiveBuild: (commands: ShipBuildCommandDto[]) => Promise<ShipBuildDto>;
};

const ServerSessionContext = createContext<ServerSessionValue | null>(null);

const developmentBrowserAuthEnabled = process.env.NODE_ENV !== "production"
  && process.env.NEXT_PUBLIC_ALLOW_BROWSER_AUTH === "true";

export function ServerSessionProvider({
  children,
  launch
}: {
  children: React.ReactNode;
  launch: TelegramLaunchContext;
}) {
  const [status, setStatus] = useState<SessionStatus>("starting");
  const [bootstrap, setBootstrap] = useState<BootstrapResponseDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const refreshBootstrap = useCallback(async () => {
    const nextBootstrap = await getBootstrap();
    setBootstrap(nextBootstrap);
    return nextBootstrap;
  }, []);

  const mutateActiveBuild = useCallback(async (commands: ShipBuildCommandDto[]) => {
    if (!bootstrap?.activeBuild) throw new Error("No active server build is available.");
    const build = await applyShipBuildCommands(bootstrap.activeBuild.id, {
      expectedRevision: bootstrap.activeBuild.activeRevision.revision,
      idempotencyKey: crypto.randomUUID(),
      commands
    });
    setBootstrap((current) => current ? { ...current, activeBuild: build } : current);
    return build;
  }, [bootstrap]);

  useEffect(() => {
    let active = true;

    async function start() {
      setStatus("starting");
      setErrorMessage(null);
      clearAccessToken();
      try {
        let expectedTelegramUserId: string | null = null;
        if (launch.isTelegram && launch.initData) {
          expectedTelegramUserId = telegramUserIdFromInitData(launch.initData);
          if (!expectedTelegramUserId) {
            if (active) {
              setStatus("blocked");
              setErrorMessage("Telegram launch authorization does not contain a valid user. Close and reopen the Mini App.");
            }
            return;
          }
          const fingerprint = await fingerprintTelegramInitData(launch.initData);
          const claimedLaunch = readTelegramLaunchClaim(window.sessionStorage, fingerprint);
          if (claimedLaunch?.telegramUserId === expectedTelegramUserId) {
            try {
              await refreshAccessToken();
            } catch (error) {
              if (!(error instanceof ServerApiError) || (error.status !== 401 && error.status !== 403)) throw error;
              if (active) {
                setStatus("blocked");
                setErrorMessage("This Telegram launch was already used and its session expired. Close and reopen the Mini App.");
              }
              return;
            }
          } else {
            // A new Telegram launch must replace any refresh cookie belonging to
            // another account; the single-use claim is stored only after the
            // server has verified the payload successfully.
            const authenticated = await authenticateTelegram(launch.initData);
            if (authenticated.profile.telegramUserId !== expectedTelegramUserId) {
              clearAccessToken();
              throw new Error("Telegram launch identity does not match the verified server profile.");
            }
            writeTelegramLaunchClaim(window.sessionStorage, {
              fingerprint,
              telegramUserId: authenticated.profile.telegramUserId
            });
          }
        } else {
          try {
            await refreshAccessToken();
          } catch (error) {
            if (!(error instanceof ServerApiError) || (error.status !== 401 && error.status !== 403)) throw error;
            if (!launch.isTelegram && developmentBrowserAuthEnabled) {
              await authenticateDevelopment();
            } else {
              if (active) {
                setStatus("blocked");
                setErrorMessage(launch.isTelegram
                  ? "Telegram did not provide valid launch authorization. Close and reopen the Mini App."
                  : "SpaceY production gameplay is available only from the Telegram Mini App.");
              }
              return;
            }
          }
        }

        const nextBootstrap = await getBootstrap();
        if (!active) return;
        if (expectedTelegramUserId && nextBootstrap.profile.telegramUserId !== expectedTelegramUserId) {
          clearAccessToken();
          setStatus("blocked");
          setErrorMessage("The active server session belongs to another Telegram account. Close and reopen the Mini App.");
          return;
        }
        setBootstrap(nextBootstrap);
        setStatus("ready");

        const legacyProposal = readLegacyBuildV3Proposal();
        if (legacyProposal) {
          void submitLegacyBuildV3Proposal(legacyProposal).then((result) => {
            markLegacyBuildV3ProposalAccepted();
            if (active && result.imported) void refreshBootstrap();
          }).catch((error: unknown) => {
            console.warn("[SpaceY] Legacy build proposal was not accepted", error);
          });
        }
      } catch (error) {
        if (!active) return;
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Server session could not be started.");
      }
    }

    const startTimer = window.setTimeout(() => void start(), 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
    };
  }, [launch.initData, launch.isTelegram, refreshBootstrap, retryKey]);

  const contextValue = useMemo(
    () => bootstrap ? { bootstrap, mutateActiveBuild, refreshBootstrap } : null,
    [bootstrap, mutateActiveBuild, refreshBootstrap]
  );

  return (
    <ServerSessionContext.Provider value={contextValue}>
      {status === "ready" && contextValue ? children : (
        <ServerBoundaryStatus
          message={errorMessage}
          onRetry={status === "error" ? () => setRetryKey((value) => value + 1) : undefined}
          status={status}
        />
      )}
    </ServerSessionContext.Provider>
  );
}

export function useServerSession(): ServerSessionValue {
  const context = useContext(ServerSessionContext);
  if (!context) throw new Error("useServerSession must be used inside a ready ServerSessionProvider.");
  return context;
}
