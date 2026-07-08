import {
  cellKey,
  getElement,
  getInstalledCabinCells,
  getModule,
  getPanel,
  getTransformedCells
} from "@/game/ship/build";
import { moduleToElementDef } from "@/game/ship/domainCompat";
import type {
  ConnectorFamily,
  GridCell,
  NetworkType,
  PanelConnectorSide,
  ShipBuild,
  ShipTopologyEdge,
  ShipTopologyGraph,
  ShipTopologyNode
} from "@/game/types";

const sideDeltas: Record<PanelConnectorSide, GridCell> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};

export function buildShipTopology(build: ShipBuild): ShipTopologyGraph {
  const nodes: ShipTopologyNode[] = [];
  const edges: ShipTopologyEdge[] = [];
  const cabinCells = getInstalledCabinCells(build);
  const cabinNodeId = cabinNode(build);

  nodes.push({
    id: cabinNodeId,
    kind: "cabin",
    cells: cabinCells,
    networkTypes: ["structure", "power", "control"]
  });

  const panelCells = new Map<string, string>();
  const panelNetworks = new Map<string, NetworkType[]>();
  for (const installed of build.panels ?? []) {
    const panel = getPanel(installed.panelId);
    const cells = getTransformedCells(panel, installed.position, installed.rotation);
    const nodeId = panelNode(installed.instanceId);
    nodes.push({
      id: nodeId,
      kind: "panel",
      cells,
      networkTypes: panel.networks
    });
    panelNetworks.set(nodeId, panel.networks);
    cells.forEach((cell) => panelCells.set(cellKey(cell), nodeId));
    if (touchesAnyCell(cells, cabinCells)) {
      edges.push(makeEdge(cabinNodeId, nodeId, "structural", panel.networks));
    }
  }

  for (const installed of build.panels ?? []) {
    const fromNode = panelNode(installed.instanceId);
    const panel = getPanel(installed.panelId);
    const cells = getTransformedCells(panel, installed.position, installed.rotation);
    for (const cell of cells) {
      for (const delta of Object.values(sideDeltas)) {
        const toNode = panelCells.get(cellKey({ x: cell.x + delta.x, y: cell.y + delta.y }));
        if (!toNode || toNode === fromNode) continue;
        edges.push(makeEdge(fromNode, toNode, "structural", panel.networks));
      }
    }
  }

  for (const installed of build.modules) {
    const module = getModule(installed.moduleId);
    if (build.cabinId && module.type === "core") continue;
    const element = getElement(installed.moduleId) ?? moduleToElementDef(module);
    const cells = getTransformedCells(module, installed.position, installed.rotation);
    const nodeId = elementNode(installed.instanceId);
    const elementNetworks = unique(element.mountSlots.flatMap((slot) => slot.networkTypes));
    nodes.push({
      id: nodeId,
      kind: "element",
      cells,
      networkTypes: elementNetworks
    });
    unique(cells.map((cell) => panelCells.get(cellKey(cell))).filter(Boolean) as string[]).forEach(
      (panelId) => {
        const networkTypes = intersect(elementNetworks, panelNetworks.get(panelId) ?? []);
        edges.push(makeEdge(nodeId, panelId, networkFamily(networkTypes), networkTypes));
      }
    );
  }

  return { nodes, edges: uniqueEdges(edges) };
}

export function getConnectedPanelsFromCabin(graph: ShipTopologyGraph) {
  return connectedNodeIds(graph, graph.nodes.find((node) => node.kind === "cabin")?.id)
    .filter((id) => graph.nodes.find((node) => node.id === id)?.kind === "panel");
}

export function isPanelConnectedToCabin(graph: ShipTopologyGraph, panelInstanceId: string) {
  return getConnectedPanelsFromCabin(graph).includes(panelNode(panelInstanceId));
}

export function getElementNetworkAccess(graph: ShipTopologyGraph, elementInstanceId: string) {
  const nodeId = elementInstanceId.startsWith("element:") ? elementInstanceId : elementNode(elementInstanceId);
  const connected = connectedNodeIds(graph, graph.nodes.find((node) => node.kind === "cabin")?.id);
  if (!connected.includes(nodeId)) return [];
  return graph.nodes.find((node) => node.id === nodeId)?.networkTypes ?? [];
}

export function getDetachedGroupsAfterPartDestroyed(graph: ShipTopologyGraph, partId: string) {
  const removed = normalizeNodeId(partId);
  const remaining = graph.nodes.filter((node) => node.id !== removed);
  const groups: string[][] = [];
  const seen = new Set<string>();

  for (const node of remaining) {
    if (seen.has(node.id)) continue;
    const group = connectedNodeIds(
      {
        nodes: remaining,
        edges: graph.edges.filter((edge) => edge.from !== removed && edge.to !== removed)
      },
      node.id
    );
    group.forEach((id) => seen.add(id));
    groups.push(group);
  }

  return groups;
}

export function getNetworkLoad(graph: ShipTopologyGraph, networkType: NetworkType) {
  const connected = connectedNodeIds(graph, graph.nodes.find((node) => node.kind === "cabin")?.id);
  return graph.nodes.filter(
    (node) =>
      connected.includes(node.id) &&
      node.kind === "element" &&
      node.networkTypes.includes(networkType)
  ).length;
}

function connectedNodeIds(graph: ShipTopologyGraph, startId?: string) {
  if (!startId) return [];
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    graph.edges.forEach((edge) => {
      if (edge.from === current && !visited.has(edge.to)) queue.push(edge.to);
      if (edge.to === current && !visited.has(edge.from)) queue.push(edge.from);
    });
  }
  return [...visited];
}

function makeEdge(
  from: string,
  to: string,
  family: ConnectorFamily,
  networkTypes: NetworkType[]
): ShipTopologyEdge {
  return { from, to, family, networkTypes: unique(networkTypes) };
}

function networkFamily(networkTypes: NetworkType[]): ConnectorFamily {
  if (networkTypes.includes("power")) return "power";
  if (networkTypes.includes("heat")) return "thermal";
  return "structural";
}

function intersect(a: NetworkType[], b: NetworkType[]) {
  return a.filter((item) => b.includes(item));
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function uniqueEdges(edges: ShipTopologyEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = [edge.from, edge.to].sort().join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeNodeId(id: string) {
  if (id.startsWith("panel:") || id.startsWith("element:") || id.startsWith("cabin:")) return id;
  return id.startsWith("p-") ? panelNode(id) : elementNode(id);
}

function cabinNode(build: ShipBuild) {
  return `cabin:${build.cabinId ?? build.frameId}`;
}

function panelNode(instanceId: string) {
  return `panel:${instanceId}`;
}

function elementNode(instanceId: string) {
  return `element:${instanceId}`;
}

function touchesAnyCell(cells: GridCell[], targetCells: GridCell[]) {
  const targets = new Set(targetCells.map(cellKey));
  return cells.some((cell) =>
    (Object.keys(sideDeltas) as PanelConnectorSide[]).some((side) => {
      const delta = sideDeltas[side];
      return targets.has(cellKey({ x: cell.x + delta.x, y: cell.y + delta.y }));
    })
  );
}
