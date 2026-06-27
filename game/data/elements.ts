import { moduleDefs } from "@/game/data/modules";
import { moduleToElementDef } from "@/game/ship/domainCompat";
import type { ElementDef } from "@/game/types";

export const elementDefs: ElementDef[] = moduleDefs.map(moduleToElementDef);
