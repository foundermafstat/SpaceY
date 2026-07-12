"use client";

import type {
  BootstrapResponseDto,
  InventoryItemDto,
  ShipBuildCommandDto,
  ShipBuildDto,
  ShipBuildPartDto,
} from "@spacey/contracts";
import { useCallback, useMemo, useState } from "react";
import { ServerSessionContext, type ServerSessionValue } from "@/game/server/session-context";

export function FixtureServerSessionProvider({
  children,
  initialBootstrap,
}: {
  children: React.ReactNode;
  initialBootstrap: BootstrapResponseDto;
}) {
  const [bootstrap, setBootstrap] = useState(initialBootstrap);

  const refreshBootstrap = useCallback(async () => bootstrap, [bootstrap]);

  const mutateActiveBuild = useCallback(async (commands: ShipBuildCommandDto[]) => {
    if (!bootstrap.activeBuild) throw new Error("No fixture build is available.");
    const result = applyFixtureCommands(bootstrap.activeBuild, bootstrap.inventory, commands);
    setBootstrap({ ...bootstrap, activeBuild: result.build, inventory: result.inventory });
    return result.build;
  }, [bootstrap]);

  const value = useMemo<ServerSessionValue>(
    () => ({ bootstrap, mutateActiveBuild, refreshBootstrap }),
    [bootstrap, mutateActiveBuild, refreshBootstrap],
  );

  return <ServerSessionContext.Provider value={value}>{children}</ServerSessionContext.Provider>;
}

function applyFixtureCommands(
  build: ShipBuildDto,
  inventory: InventoryItemDto[],
  commands: ShipBuildCommandDto[],
): { build: ShipBuildDto; inventory: InventoryItemDto[] } {
  let name = build.activeRevision.name;
  let parts = [...build.activeRevision.parts];
  let nextInventory = [...inventory];

  for (const command of commands) {
    if (command.type === "rename") {
      name = command.name;
      continue;
    }
    if (command.type === "remove") {
      parts = parts.filter((part) => part.inventoryItemId !== command.inventoryItemId);
      nextInventory = setFixtureItemState(nextInventory, command.inventoryItemId, "available", null);
      continue;
    }
    const existing = parts.find((part) => part.inventoryItemId === command.inventoryItemId);
    const item = nextInventory.find((candidate) => candidate.id === command.inventoryItemId);
    if (!existing && !item) throw new Error("Fixture inventory item was not found.");
    const part: ShipBuildPartDto = {
      inventoryItemId: command.inventoryItemId,
      definitionId: existing?.definitionId ?? item!.definitionId,
      gridX: command.gridX,
      gridY: command.gridY,
      rotation: command.rotation,
    };
    parts = [...parts.filter((candidate) => candidate.inventoryItemId !== command.inventoryItemId), part];
    nextInventory = setFixtureItemState(nextInventory, command.inventoryItemId, "installed", build.activeRevision.id);
  }

  const now = new Date().toISOString();
  const revision = build.activeRevision.revision + 1;
  return {
    build: {
      ...build,
      activeRevision: { ...build.activeRevision, id: `fixture-revision-${revision}`, revision, name, parts, createdAt: now },
      updatedAt: now,
    },
    inventory: nextInventory,
  };
}

function setFixtureItemState(
  inventory: InventoryItemDto[],
  itemId: string,
  state: InventoryItemDto["state"],
  installedBuildRevisionId: string | null,
) {
  return inventory.map((item) => item.id === itemId ? { ...item, state, installedBuildRevisionId } : item);
}
