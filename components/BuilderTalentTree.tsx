"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from "react";

import type {
  BuilderClass,
  BuilderClassSetting,
  BuilderTab,
  BuilderViewModel,
  FlatTalentEntry,
} from "@/lib/builder-data";

type Props = {
  data: BuilderViewModel;
  initialParams?: {
    class?: string;
    spec?: string;
    talents?: string;
    freePick?: string;
  };
};

type TreeNode = FlatTalentEntry & {
  section: "class" | "spec";
  nodeKey: string;
  left: number;
  top: number;
  choices?: FlatTalentEntry[];
};

type TreeConnection = {
  key: string;
  source: TreeNode;
  target: TreeNode;
};

type ThresholdMarker = {
  key: string;
  section: "class" | "spec";
  amount: number;
  top: number;
  left: number;
  lineWidth: number;
};

type TreeLayout = "wide" | "stacked";
type MobileTreeSection = "class" | "spec";

type InitialUrlState = {
  classId: number | null;
  specId: number | null;
  points: Record<string, number>;
  freePick: boolean;
};

const TREE_HEIGHT = 640;
const NODE_SIZE = 38;
const GRID_LEFT = 0;
const GRID_TOP = 84;
const GRID_X = 58;
const GRID_Y = 58;
const SPEC_OFFSET = 600;
const STACK_BREAKPOINT = 1000;
const CANVAS_SAFE_PADDING = 76;
const TREE_GRID_COLUMNS = 10;
const TREE_GRID_WIDTH = TREE_GRID_COLUMNS * GRID_X + NODE_SIZE;
const WIDE_TREE_WIDTH = SPEC_OFFSET + TREE_GRID_WIDTH + CANVAS_SAFE_PADDING;
const WIDE_MIN_SIDE_PADDING = 16;
const WIDE_MIN_SCALE = 0.7;
const STACKED_SIDE_PADDING = 24;
const STACKED_MIN_SIDE_PADDING = 16;
const STACKED_MIN_CANVAS_WIDTH = 304;
const STACKED_CLASS_TREE_BOTTOM = GRID_TOP + 9 * GRID_Y + NODE_SIZE;
const STACKED_PASSIVE_TOP = STACKED_CLASS_TREE_BOTTOM + 52;
const STACKED_PASSIVE_STEP = GRID_X;
const STACKED_PASSIVE_TO_SPEC_GAP = 0;
const STACKED_SPEC_HEADER_OFFSET = 44;
const MOBILE_TOOLTIP_BREAKPOINT = 520;
const TOOLTIP_WIDTH = 336;
const TOOLTIP_HEIGHT = 322;
const CHOICE_POPOVER_WIDTH = 260;
const CHOICE_POPOVER_HEIGHT = 102;
const CHOICE_POPOVER_CLEAR_HEIGHT = 148;
const TOUCH_LONG_PRESS_MS = 550;
const TOUCH_MOVE_TOLERANCE = 10;
const CLASS_TREE_POINT_LIMIT = 26;
const SPEC_TREE_POINT_LIMIT = 25;
const CHARACTER_LEVEL_OFFSET = 9;
const ICON_SPRITE_PATH = "/icon/coa-builder-icon.webp";
const PASSIVE_LEVEL_PATTERN = /\bLevel\s+(\d+)\s+Passive\b/i;

function getCharacterLevel(spent: { ability: number; talent: number }) {
  return spent.ability + spent.talent + CHARACTER_LEVEL_OFFSET;
}

function iconClassName(iconPath?: string) {
  const raw = iconPath?.split("\\").at(-1)?.split("/").at(-1) ?? "";
  const normalized = raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "";
  }

  return /^\d/.test(normalized) ? `_${normalized}` : normalized;
}

function sortedSpecs(builderClass: BuilderClass) {
  return builderClass.tabs
    .filter((tab) => tab.tabName !== "Class" && tab.tabName !== "None")
    .slice()
    .sort((first, second) => first.sortOrder - second.sortOrder);
}

function getTabEntries(
  data: BuilderViewModel,
  builderClass: BuilderClass,
  tab: BuilderTab | undefined,
) {
  if (!tab) {
    return [];
  }

  return data.flatEntries.filter(
    (entry) =>
      entry.classId === builderClass.classId && entry.tabId === tab.tabId,
  );
}

function getClassTreeTab(builderClass: BuilderClass) {
  return builderClass.tabs.find((tab) => tab.tabName === "Class");
}

function getClassIcon(data: BuilderViewModel, builderClass: BuilderClass) {
  const classTab = getClassTreeTab(builderClass);
  const entries = getTabEntries(data, builderClass, classTab);

  return getRepresentativeIcon(entries);
}

function getClassIconClass(data: BuilderViewModel, builderClass: BuilderClass) {
  const setting = data.classSettings[builderClass.classId];

  if (setting) {
    return setting.iconClass;
  }

  return iconClassName(getClassIcon(data, builderClass)?.iconPath);
}

function getRepresentativeIcon(entries: FlatTalentEntry[]) {
  return (
    entries.find((entry) => entry.entryType === "Ability") ??
    entries.find((entry) => entry.iconPath) ??
    entries[0]
  );
}

function getSpecIcon(
  data: BuilderViewModel,
  builderClass: BuilderClass,
  tab: BuilderTab,
) {
  return getRepresentativeIcon(getTabEntries(data, builderClass, tab));
}

function makeSectionNodes(
  entries: FlatTalentEntry[],
  section: "class" | "spec",
  offsetLeft = 0,
  offsetTop = 0,
) {
  const grouped = new Map<string, FlatTalentEntry[]>();
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (!entry.group) {
      nodes.push(makeTreeNode(entry, section, offsetLeft, offsetTop));
      continue;
    }

    const groupKey = `${entry.classId}:${entry.tabId}:${entry.group}`;
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), entry]);
  }

  for (const choices of grouped.values()) {
    const sortedChoices = choices
      .slice()
      .sort(
        (first, second) =>
          first.sortOrder - second.sortOrder || first.id - second.id,
      );
    nodes.push(
      makeTreeNode(
        sortedChoices[0],
        section,
        offsetLeft,
        offsetTop,
        sortedChoices,
      ),
    );
  }

  return nodes;
}

function makeTreeNode(
  entry: FlatTalentEntry,
  section: "class" | "spec",
  offsetLeft: number,
  offsetTop: number,
  choices?: FlatTalentEntry[],
): TreeNode {
  return {
    ...entry,
    choices,
    section,
    nodeKey: `${section}:${entry.id}`,
    left: GRID_LEFT + offsetLeft + entry.x * GRID_X,
    top: GRID_TOP + offsetTop + entry.y * GRID_Y,
  };
}

function makeTreeNodes(
  classEntries: FlatTalentEntry[],
  specEntries: FlatTalentEntry[],
  layout: TreeLayout,
  layoutOffsetLeft: number,
  viewportWidth: number,
) {
  if (layout === "wide") {
    const metrics = getWideHorizontalMetrics(viewportWidth);

    return [
      ...makeResponsiveSectionNodes(
        classEntries,
        "class",
        layoutOffsetLeft,
        metrics,
      ),
      ...makeResponsiveSectionNodes(
        specEntries,
        "spec",
        layoutOffsetLeft,
        metrics,
      ),
    ];
  }

  const metrics = getStackedHorizontalMetrics(viewportWidth);
  const classNodes = centerStackedNodes(
    makeResponsiveSectionNodes(
      classEntries,
      "class",
      layoutOffsetLeft,
      metrics,
    ),
    layoutOffsetLeft,
    metrics.canvasWidth,
  );
  const specNodes = makeStackedSpecNodes(
    specEntries,
    layoutOffsetLeft,
    viewportWidth,
    metrics,
  );

  return [...classNodes, ...specNodes];
}

function makeStackedSpecNodes(
  specEntries: FlatTalentEntry[],
  layoutOffsetLeft: number,
  viewportWidth: number,
  metrics: TreeHorizontalMetrics,
) {
  const specNodes = makeResponsiveSectionNodes(
    specEntries,
    "spec",
    layoutOffsetLeft,
    metrics,
  );
  const passiveNodes = specNodes
    .filter(isPassiveNode)
    .sort(
      (first, second) =>
        getPassiveThreshold(first) - getPassiveThreshold(second) ||
        first.top - second.top ||
        first.left - second.left,
    );
  const passiveOrder = new Map(
    passiveNodes.map((node, index) => [node.nodeKey, index]),
  );
  const specStackOffset = getStackedSpecOffset(passiveNodes.length);
  const passiveLeft = getStackedPassiveLeft(
    layoutOffsetLeft,
    viewportWidth,
    passiveNodes.length,
  );
  const passiveStep = getStackedPassiveStep(viewportWidth, passiveNodes.length);

  const arrangedNodes = specNodes.map((node) => {
    const passiveIndex = passiveOrder.get(node.nodeKey);

    if (passiveIndex !== undefined) {
      return {
        ...node,
        left: passiveLeft + passiveIndex * passiveStep,
        top: STACKED_PASSIVE_TOP,
      };
    }

    return {
      ...node,
      top: node.top + specStackOffset,
    };
  });

  const centeredSpecNodes = centerStackedNodes(
    arrangedNodes.filter((node) => !isPassiveNode(node)),
    layoutOffsetLeft,
    metrics.canvasWidth,
  );
  const centeredSpecByKey = new Map(
    centeredSpecNodes.map((node) => [node.nodeKey, node.left]),
  );

  return arrangedNodes.map((node) =>
    centeredSpecByKey.has(node.nodeKey)
      ? { ...node, left: centeredSpecByKey.get(node.nodeKey) ?? node.left }
      : node,
  );
}

type TreeHorizontalMetrics = {
  canvasWidth: number;
  gridLeft: number;
  gridX: number;
  specOffset: number;
};

function makeResponsiveSectionNodes(
  entries: FlatTalentEntry[],
  section: "class" | "spec",
  layoutOffsetLeft: number,
  metrics: TreeHorizontalMetrics,
) {
  return makeSectionNodes(entries, section, layoutOffsetLeft).map((node) => ({
    ...node,
    left:
      layoutOffsetLeft +
      metrics.gridLeft +
      (section === "spec" ? metrics.specOffset : 0) +
      node.x * metrics.gridX,
  }));
}

function centerStackedNodes(
  nodes: TreeNode[],
  layoutOffsetLeft: number,
  canvasWidth: number,
) {
  if (nodes.length === 0) {
    return nodes;
  }

  const minLeft = Math.min(...nodes.map((node) => node.left));
  const maxRight = Math.max(...nodes.map((node) => node.left + NODE_SIZE));
  const nodesWidth = maxRight - minLeft;
  const targetLeft =
    layoutOffsetLeft + Math.max(0, Math.round((canvasWidth - nodesWidth) / 2));
  const offset = targetLeft - minLeft;

  return nodes.map((node) => ({ ...node, left: node.left + offset }));
}

function getStackedSpecOffset(passiveCount: number) {
  const passiveBottom =
    passiveCount > 0
      ? STACKED_PASSIVE_TOP + NODE_SIZE
      : STACKED_CLASS_TREE_BOTTOM;

  return (
    passiveBottom +
    STACKED_PASSIVE_TO_SPEC_GAP +
    STACKED_SPEC_HEADER_OFFSET -
    GRID_TOP
  );
}

function getStackedPassiveLeft(
  layoutOffsetLeft: number,
  viewportWidth: number,
  passiveCount: number,
) {
  const metrics = getStackedHorizontalMetrics(viewportWidth);
  const visibleCanvasWidth = metrics.canvasWidth;
  const passiveStep = getStackedPassiveStep(viewportWidth, passiveCount);
  const passiveRowWidth =
    passiveCount > 0 ? (passiveCount - 1) * passiveStep + NODE_SIZE : NODE_SIZE;

  return (
    layoutOffsetLeft +
    Math.max(0, Math.round((visibleCanvasWidth - passiveRowWidth) / 2))
  );
}

function getStackedPassiveStep(viewportWidth: number, passiveCount: number) {
  if (passiveCount <= 1) {
    return 0;
  }

  return Math.min(
    STACKED_PASSIVE_STEP,
    Math.max(
      0,
      (getStackedCanvasWidth(viewportWidth) -
        STACKED_MIN_SIDE_PADDING * 2 -
        NODE_SIZE) /
        (passiveCount - 1),
    ),
  );
}

function getViewportContentWidth(viewportWidth: number) {
  if (viewportWidth <= 0) {
    return WIDE_TREE_WIDTH;
  }

  return Math.max(0, viewportWidth - getShellHorizontalPadding(viewportWidth));
}

function getStackedCanvasWidth(viewportWidth: number) {
  return Math.max(
    STACKED_MIN_CANVAS_WIDTH,
    getViewportContentWidth(viewportWidth),
  );
}

function getStackedHorizontalMetrics(viewportWidth: number) {
  const canvasWidth = getStackedCanvasWidth(viewportWidth);
  const centeredGridLeft = Math.round((canvasWidth - TREE_GRID_WIDTH) / 2);

  if (centeredGridLeft >= STACKED_SIDE_PADDING) {
    return {
      canvasWidth,
      gridLeft: centeredGridLeft,
      gridX: GRID_X,
      specOffset: 0,
    };
  }

  const gridLeft = STACKED_MIN_SIDE_PADDING;
  const gridX = Math.max(
    0,
    (canvasWidth - gridLeft * 2 - NODE_SIZE) / TREE_GRID_COLUMNS,
  );

  return {
    canvasWidth,
    gridLeft,
    gridX: Math.min(GRID_X, gridX),
    specOffset: 0,
  };
}

function getWideCanvasWidth(viewportWidth: number) {
  const viewportContentWidth = getViewportContentWidth(viewportWidth);
  const metrics = getWideHorizontalMetrics(viewportWidth);
  const treeWidth =
    metrics.gridLeft +
    metrics.specOffset +
    TREE_GRID_COLUMNS * metrics.gridX +
    NODE_SIZE +
    WIDE_MIN_SIDE_PADDING;

  return Math.max(viewportContentWidth, treeWidth);
}

function getWideHorizontalMetrics(
  viewportWidth: number,
): TreeHorizontalMetrics {
  const viewportContentWidth = getViewportContentWidth(viewportWidth);
  const scalableWidth = SPEC_OFFSET + TREE_GRID_COLUMNS * GRID_X;
  const fitScale =
    viewportContentWidth > 0
      ? (viewportContentWidth - WIDE_MIN_SIDE_PADDING * 2 - NODE_SIZE) /
        scalableWidth
      : 1;
  const scale = Math.min(1, Math.max(WIDE_MIN_SCALE, fitScale));
  const gridX = GRID_X * scale;
  const specOffset = SPEC_OFFSET * scale;
  const contentWidth = specOffset + TREE_GRID_COLUMNS * gridX + NODE_SIZE;
  const canvasWidth = Math.max(
    viewportContentWidth,
    contentWidth + WIDE_MIN_SIDE_PADDING * 2,
  );

  return {
    canvasWidth,
    gridLeft: Math.max(
      WIDE_MIN_SIDE_PADDING,
      Math.round((canvasWidth - contentWidth) / 2),
    ),
    gridX,
    specOffset,
  };
}

function getShellHorizontalPadding(viewportWidth: number) {
  if (viewportWidth <= 520) {
    return 0;
  }

  if (viewportWidth <= STACK_BREAKPOINT) {
    return 32;
  }

  return 88;
}

function getNodeIds(node: TreeNode) {
  return (node.choices ?? [node]).map((choice) => choice.id);
}

function getSelectedChoice(node: TreeNode, points: Record<string, number>) {
  return (node.choices ?? [node]).find(
    (choice) => points[`${node.section}:${choice.id}`] > 0,
  );
}

function getDisplayEntry(node: TreeNode, points: Record<string, number>) {
  return getSelectedChoice(node, points) ?? node.choices?.[0] ?? node;
}

function getNodeRank(node: TreeNode, points: Record<string, number>) {
  const selectedChoice = getSelectedChoice(node, points);

  if (!selectedChoice) {
    return 0;
  }

  return points[`${node.section}:${selectedChoice.id}`] ?? 0;
}

function getNodeMaxPoints(node: TreeNode) {
  return Math.max(
    ...(node.choices ?? [node]).map((choice) => choice.maxPoints),
  );
}

function isFreeSpecFirstLineNode(node: TreeNode) {
  return node.section === "spec" && node.y === 0;
}

function withFreeSpecFirstLinePoints(
  nodes: TreeNode[],
  points: Record<string, number>,
) {
  let nextPoints = points;

  for (const node of nodes) {
    if (!isFreeSpecFirstLineNode(node)) {
      continue;
    }

    const selectedChoice = getSelectedChoice(node, nextPoints);
    const grantedChoice = selectedChoice ?? node.choices?.[0] ?? node;
    const grantedKey = `${node.section}:${grantedChoice.id}`;
    const grantedRank = Math.max(1, grantedChoice.maxPoints);

    if (nextPoints[grantedKey] === grantedRank) {
      continue;
    }

    nextPoints =
      nextPoints === points
        ? { ...points, [grantedKey]: grantedRank }
        : { ...nextPoints, [grantedKey]: grantedRank };
  }

  return nextPoints;
}

function isPassiveEntry(entry: FlatTalentEntry) {
  return (
    entry.isPassive === 1 ||
    (entry.requiredLevel > 0 && entry.aeCost === 0 && entry.teCost === 0)
  );
}

function isPassiveNode(node: TreeNode) {
  return (node.choices ?? [node]).some(isPassiveEntry);
}

function getPassiveThreshold(node: TreeNode) {
  return Math.max(
    0,
    ...(node.choices ?? [node]).map((choice) =>
      getPassiveEntryThreshold(choice),
    ),
  );
}

function getPassiveEntryThreshold(entry: FlatTalentEntry) {
  const passiveLevel = entry.plainDescription.match(PASSIVE_LEVEL_PATTERN);

  if (passiveLevel) {
    return Number(passiveLevel[1]);
  }

  if (
    entry.x === 10 &&
    entry.y >= 0 &&
    entry.y <= 8 &&
    entry.y % 2 === 0 &&
    (entry.isPassive === 1 ||
      (entry.requiredLevel > 0 && entry.aeCost === 0 && entry.teCost === 0))
  ) {
    return 10 + (entry.y / 2) * 10;
  }

  return entry.requiredLevel;
}

function isPassiveUnlocked(
  node: TreeNode,
  spent: { ability: number; talent: number },
) {
  const threshold = getPassiveThreshold(node);
  const characterLevel = getCharacterLevel(spent);

  return threshold <= characterLevel;
}

function getVisualRank(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
) {
  if (isFreeSpecFirstLineNode(node)) {
    return getNodeRank(node, points);
  }

  if (isPassiveNode(node)) {
    return isPassiveUnlocked(node, spent) ? getNodeMaxPoints(node) : 0;
  }

  return getNodeRank(node, points);
}

function hasActiveId(
  id: number,
  section: "class" | "spec",
  points: Record<string, number>,
) {
  return points[`${section}:${id}`] > 0;
}

function makeConnections(
  nodes: TreeNode[],
  points: Record<string, number>,
): TreeConnection[] {
  const bySectionAndId = new Map<string, TreeNode>();

  for (const node of nodes) {
    for (const id of getNodeIds(node)) {
      bySectionAndId.set(`${node.section}:${id}`, node);
    }
  }
  const seen = new Set<string>();

  return nodes.flatMap((source) => {
    const connections: TreeConnection[] = [];

    const connectedIds = new Set(
      (source.choices ?? [source]).flatMap((choice) =>
        choice.connectedNodeIds.filter(Boolean),
      ),
    );

    for (const targetId of connectedIds) {
      const target = bySectionAndId.get(`${source.section}:${targetId}`);

      if (!target || target === source) {
        continue;
      }

      const pair = [source.nodeKey, target.nodeKey].sort().join(">");

      if (seen.has(pair)) {
        continue;
      }

      seen.add(pair);
      connections.push({
        key: pair,
        source,
        target,
      });
    }

    return connections;
  });
}

function getSpentTotals(nodes: TreeNode[], points: Record<string, number>) {
  return nodes.reduce(
    (totals, node) => {
      if (isPassiveNode(node) || isFreeSpecFirstLineNode(node)) {
        return totals;
      }

      const selectedChoice = getSelectedChoice(node, points);

      if (!selectedChoice) {
        return totals;
      }

      const rank = points[`${node.section}:${selectedChoice.id}`] ?? 0;
      const pointCost = Math.max(1, getPointCost(selectedChoice, node.section));

      return {
        ability:
          totals.ability + (node.section === "class" ? pointCost * rank : 0),
        talent:
          totals.talent + (node.section === "spec" ? pointCost * rank : 0),
      };
    },
    { ability: 0, talent: 0 },
  );
}

function getSpentInSection(
  spent: { ability: number; talent: number },
  section: "class" | "spec",
) {
  return section === "class" ? spent.ability : spent.talent;
}

function getPointCost(entry: FlatTalentEntry, section: "class" | "spec") {
  return section === "class" ? entry.aeCost : entry.teCost;
}

function getTreePointLimit(section: "class" | "spec") {
  return section === "class" ? CLASS_TREE_POINT_LIMIT : SPEC_TREE_POINT_LIMIT;
}

function canApplyPointChange(
  nodes: TreeNode[],
  currentPoints: Record<string, number>,
  nextPoints: Record<string, number>,
  section: "class" | "spec",
  freePick: boolean,
) {
  const currentSpent = getSpentTotals(nodes, currentPoints);
  const nextSpent = getSpentTotals(nodes, nextPoints);
  const currentSectionSpent = getSpentInSection(currentSpent, section);
  const nextSectionSpent = getSpentInSection(nextSpent, section);
  const treePointLimit = getTreePointLimit(section);
  const isWithinTreeLimit =
    nextSectionSpent <= treePointLimit ||
    nextSectionSpent <= currentSectionSpent;

  if (!isWithinTreeLimit) {
    return false;
  }

  return freePick || isOrderedDistribution(nextSpent);
}

function isOrderedDistribution(spent: { ability: number; talent: number }) {
  return spent.ability === spent.talent || spent.ability === spent.talent + 1;
}

function getNextOrderedSection(spent: { ability: number; talent: number }) {
  return spent.ability === spent.talent ? "class" : "spec";
}

function canAddRankToNode(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
  freePick: boolean,
) {
  if (
    isPassiveNode(node) ||
    isFreeSpecFirstLineNode(node) ||
    getNodeRank(node, points) >= getNodeMaxPoints(node)
  ) {
    return false;
  }

  const pointCost = Math.min(
    ...(node.choices ?? [node]).map((choice) =>
      Math.max(1, getPointCost(choice, node.section)),
    ),
  );

  const nextSpent =
    node.section === "class"
      ? { ...spent, ability: spent.ability + pointCost }
      : { ...spent, talent: spent.talent + pointCost };

  return (
    getSpentInSection(spent, node.section) + pointCost <=
      getTreePointLimit(node.section) &&
    (freePick || isOrderedDistribution(nextSpent))
  );
}

function getPointBlockText(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
  freePick: boolean,
) {
  if (canAddRankToNode(node, points, spent, freePick) || isPassiveNode(node)) {
    return [];
  }

  if (getNodeRank(node, points) >= getNodeMaxPoints(node)) {
    return [];
  }

  const treeName = node.section === "class" ? "Class Tree" : "Spec Tree";
  const treePointLimit = getTreePointLimit(node.section);

  if (getSpentInSection(spent, node.section) >= treePointLimit) {
    return [`${treeName} is limited to ${treePointLimit} points`];
  }

  if (!freePick && getNextOrderedSection(spent) !== node.section) {
    const nextTreeName =
      getNextOrderedSection(spent) === "class" ? "Class Tree" : "Spec Tree";

    return [`Next point must be spent in the ${nextTreeName}`];
  }

  return [`${treeName} is limited to ${treePointLimit} points`];
}

function arePointStatesEqual(
  first: Record<string, number>,
  second: Record<string, number>,
) {
  const firstEntries = Object.entries(first);
  const secondEntries = Object.entries(second);

  if (firstEntries.length !== secondEntries.length) {
    return false;
  }

  return firstEntries.every(([key, value]) => second[key] === value);
}

function limitPointStateToTreeCaps(
  nodes: TreeNode[],
  points: Record<string, number>,
  freePick: boolean,
) {
  const selectableByKey = new Map<
    string,
    { maxPoints: number; pointCost: number; section: "class" | "spec" }
  >();

  for (const node of nodes) {
    if (isPassiveNode(node) || isFreeSpecFirstLineNode(node)) {
      continue;
    }

    for (const entry of node.choices ?? [node]) {
      selectableByKey.set(`${node.section}:${entry.id}`, {
        maxPoints: entry.maxPoints,
        pointCost: Math.max(1, getPointCost(entry, node.section)),
        section: node.section,
      });
    }
  }

  let spentBySection = { class: 0, spec: 0 };
  let limitedPoints: Record<string, number> = {};

  for (const [key, rawRank] of Object.entries(points)) {
    const selectable = selectableByKey.get(key);

    if (!selectable) {
      continue;
    }

    const rank = Math.min(selectable.maxPoints, Math.max(0, rawRank));
    const remaining =
      getTreePointLimit(selectable.section) -
      spentBySection[selectable.section];
    const allowedRank = Math.min(
      rank,
      Math.floor(remaining / selectable.pointCost),
    );

    if (allowedRank > 0) {
      limitedPoints[key] = allowedRank;
      spentBySection[selectable.section] += allowedRank * selectable.pointCost;
    }
  }

  if (freePick) {
    return limitedPoints;
  }

  const targetClassPoints = Math.min(
    spentBySection.class,
    spentBySection.spec + 1,
  );
  const targetSpecPoints = Math.min(spentBySection.spec, targetClassPoints);

  spentBySection = { class: 0, spec: 0 };
  const orderedPoints: Record<string, number> = {};

  for (const [key, rawRank] of Object.entries(limitedPoints)) {
    const selectable = selectableByKey.get(key);

    if (!selectable) {
      continue;
    }

    const target =
      selectable.section === "class" ? targetClassPoints : targetSpecPoints;
    const remaining = target - spentBySection[selectable.section];
    const allowedRank = Math.min(
      rawRank,
      Math.floor(remaining / selectable.pointCost),
    );

    if (allowedRank > 0) {
      orderedPoints[key] = allowedRank;
      spentBySection[selectable.section] += allowedRank * selectable.pointCost;
    }
  }

  limitedPoints = orderedPoints;

  return limitedPoints;
}

function getRequirementText(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
  maxLevel: number,
) {
  const selectedChoice = getSelectedChoice(node, points) ?? node;
  const missing: string[] = [];

  if (isFreeSpecFirstLineNode(node)) {
    return missing;
  }

  if (isPassiveNode(node)) {
    const threshold = getPassiveThreshold(node);
    const characterLevel = getCharacterLevel(spent);

    if (threshold > 0 && threshold > characterLevel) {
      missing.push(`automatic passive unlocks at level ${threshold}`);
    }

    return missing;
  }

  const pointType =
    node.section === "class" ? "Ability Essence" : "Talent Essence";
  const spentInTree = node.section === "class" ? spent.ability : spent.talent;
  const requiredEssence =
    node.section === "class"
      ? selectedChoice.reqTabAE
      : selectedChoice.reqTabTE;

  if (
    selectedChoice.requiredLevel > 0 &&
    selectedChoice.requiredLevel > maxLevel
  ) {
    missing.push(`requires level ${selectedChoice.requiredLevel}`);
  }

  if (requiredEssence > spentInTree) {
    missing.push(`requires ${requiredEssence} ${pointType}`);
  }

  if (selectedChoice.y > 0) {
    for (const requiredId of selectedChoice.requiredIds.filter(Boolean)) {
      if (!hasActiveId(requiredId, node.section, points)) {
        missing.push("requires a previous required node");
        break;
      }
    }
  }

  const connectedIds = selectedChoice.connectedNodeIds.filter(Boolean);

  if (
    selectedChoice.y > 0 &&
    connectedIds.length > 0 &&
    !connectedIds.some((id) => hasActiveId(id, node.section, points))
  ) {
    missing.push("requires a connected selected node");
  }

  return missing;
}

function canRankNode(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
  maxLevel: number,
) {
  return getRequirementText(node, points, spent, maxLevel).length === 0;
}

function getThresholdMarkers(nodes: TreeNode[]): ThresholdMarker[] {
  const markerMap = new Map<string, ThresholdMarker>();
  const sectionLefts = {
    class: Math.min(
      ...nodes
        .filter((node) => node.section === "class" && !isPassiveNode(node))
        .map((node) => node.left),
    ),
    spec: Math.min(
      ...nodes
        .filter((node) => node.section === "spec" && !isPassiveNode(node))
        .map((node) => node.left),
    ),
  };

  for (const node of nodes) {
    const amount = node.section === "class" ? node.reqTabAE : node.reqTabTE;

    if (amount <= 0) {
      continue;
    }

    const key = `${node.section}:${amount}`;
    const existing = markerMap.get(key);
    const top = node.top + NODE_SIZE / 2 - 9;
    const left = Math.max(4, sectionLefts[node.section] - 60);
    const lineWidth = Math.max(18, node.left - left - 28);

    if (!existing || top < existing.top) {
      markerMap.set(key, {
        key,
        section: node.section,
        amount,
        top,
        left,
        lineWidth,
      });
    }
  }

  return [...markerMap.values()].sort((first, second) => {
    if (first.section !== second.section) {
      return first.section === "class" ? -1 : 1;
    }

    return first.amount - second.amount;
  });
}

function matchesQuery(entry: FlatTalentEntry, query: string) {
  if (!query) {
    return false;
  }

  return [
    entry.name,
    entry.className,
    entry.tabName,
    entry.entryType,
    entry.plainDescription,
    entry.spellId,
    entry.spellIds.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getClassSetting(
  data: BuilderViewModel,
  builderClass: BuilderClass,
): BuilderClassSetting {
  return (
    data.classSettings[builderClass.classId] ?? {
      classId: builderClass.classId,
      className: builderClass.className,
      classFile: "hero",
      iconClass: "class-hero",
      color: "rgb(245, 0, 255)",
      rgb: "245, 0, 255",
      colorHex: "#f500ff",
      textColor: "#ffffff",
      treeTexture: "/textures/coa/trees/hero.webp",
    }
  );
}

function getNeutralClassSetting(): BuilderClassSetting {
  return {
    classId: 0,
    className: "CoA Builder",
    classFile: "neutral",
    iconClass: "",
    color: "rgb(255, 255, 255)",
    rgb: "255, 255, 255",
    colorHex: "#ffffff",
    textColor: "#111214",
    treeTexture: "/textures/coa/trees/witchdoctor.webp",
  };
}

function classThemeStyle(setting: BuilderClassSetting): CSSProperties {
  return {
    "--class-color": setting.color,
    "--class-rgb": setting.rgb,
    "--class-text-color": setting.textColor,
  } as CSSProperties;
}

function localAssetUrl(assetPath: string) {
  return assetPath.startsWith("/") ? `.${assetPath}` : assetPath;
}

function assetUrlWithRetry(assetPath: string, attempt: number) {
  const assetUrl = localAssetUrl(assetPath);

  if (attempt === 0) {
    return assetUrl;
  }

  const separator = assetUrl.includes("?") ? "&" : "?";

  return `${assetUrl}${separator}retry=${attempt}`;
}

function useImageAssetStatus(assetPath: string) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let isCancelled = false;
    let retryTimer: number | null = null;
    let attempt = 0;

    function markReady(image: HTMLImageElement) {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          if (!isCancelled) {
            setStatus("ready");
          }
        });
    }

    function loadImage() {
      const image = new Image();

      image.decoding = "async";
      image.onload = () => markReady(image);
      image.onerror = () => {
        if (isCancelled) {
          return;
        }

        if (attempt < 2) {
          attempt += 1;
          retryTimer = window.setTimeout(loadImage, attempt * 450);
          return;
        }

        setStatus("failed");
        attempt += 1;
        retryTimer = window.setTimeout(loadImage, 2000);
      };
      image.src = assetUrlWithRetry(assetPath, attempt);

      if (image.complete && image.naturalWidth > 0) {
        markReady(image);
      }
    }

    loadImage();

    return () => {
      isCancelled = true;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [assetPath]);

  return status;
}

function builderUrl(builderClass: BuilderClass, spec?: BuilderTab) {
  const params = new URLSearchParams();
  params.set("class", slugify(builderClass.className));

  if (spec) {
    params.set("spec", slugify(spec.tabName));
  }

  return `?${params.toString()}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function matchesQueryValue(name: string, queryValue: string | null) {
  if (!queryValue) {
    return false;
  }

  return (
    slugify(name) === slugify(queryValue) ||
    name.toLowerCase() === queryValue.toLowerCase()
  );
}

function encodeTalentCode(nodes: TreeNode[], points: Record<string, number>) {
  const tokens = nodes
    .map((node) => {
      const selectedChoice = getSelectedChoice(node, points);

      if (!selectedChoice) {
        return null;
      }

      const rank = points[`${node.section}:${selectedChoice.id}`] ?? 0;

      if (rank <= 0) {
        return null;
      }

      return {
        section: node.section,
        id: selectedChoice.id,
        rank,
        x: selectedChoice.x,
        y: selectedChoice.y,
        sortOrder: selectedChoice.sortOrder,
      };
    })
    .filter((token) => token !== null)
    .sort(
      (first, second) =>
        (first.section === "class" ? 0 : 1) -
          (second.section === "class" ? 0 : 1) ||
        first.y - second.y ||
        first.x - second.x ||
        first.sortOrder - second.sortOrder ||
        first.id - second.id,
    );

  if (tokens.length === 0) {
    return "";
  }

  return `:${tokens.map(({ id, rank }) => `${id}t${rank}`).join(":")}:`;
}

function decodeTalentCode(
  code: string | null,
  entries?: {
    classEntries: FlatTalentEntry[];
    specEntries: FlatTalentEntry[];
  },
) {
  const points: Record<string, number> = {};

  if (!code) {
    return points;
  }

  for (const token of code.split(",")) {
    const match = /^([cs])(\d+)\.(\d+)$/.exec(token.trim());

    if (!match) {
      continue;
    }

    const [, prefix, id, rank] = match;
    const section = prefix === "c" ? "class" : "spec";
    points[`${section}:${id}`] = Math.max(0, Number(rank));
  }

  if (Object.keys(points).length > 0 || !entries) {
    return points;
  }

  for (const token of code.split(":")) {
    const match = /^(\d+)t(\d+)$/i.exec(token.trim());

    if (!match) {
      continue;
    }

    const [, id, rank] = match;
    const numericId = Number(id);
    const classEntry = entries.classEntries.find(
      (entry) => entry.id === numericId,
    );
    const specEntry = entries.specEntries.find(
      (entry) => entry.id === numericId,
    );
    const section = classEntry ? "class" : specEntry ? "spec" : null;

    if (!section || (section === "spec" && specEntry?.y === 0)) {
      continue;
    }

    points[`${section}:${id}`] = Math.max(0, Number(rank));
  }

  return points;
}

function readInitialParamState(
  data: BuilderViewModel,
  fallbackClass: BuilderClass,
  fallbackSpec: BuilderTab | undefined,
  params:
    | { class?: string; spec?: string; talents?: string; freePick?: string }
    | undefined,
): InitialUrlState {
  const classFromParams = data.talents.classes.find((builderClass) =>
    matchesQueryValue(builderClass.className, params?.class ?? null),
  );
  const freePick = params?.freePick === "1";

  if (!classFromParams) {
    return {
      classId: null,
      specId: null,
      points: {},
      freePick,
    };
  }

  const specs = sortedSpecs(classFromParams);
  const specFromParams =
    specs.find((spec) =>
      matchesQueryValue(spec.tabName, params?.spec ?? null),
    ) ??
    (classFromParams.classId === fallbackClass.classId
      ? fallbackSpec
      : specs[0]);
  const classEntries = getTabEntries(
    data,
    classFromParams,
    getClassTreeTab(classFromParams),
  );
  const specEntries = getTabEntries(data, classFromParams, specFromParams);

  return {
    classId: classFromParams.classId,
    specId: specFromParams?.tabId ?? null,
    points: decodeTalentCode(params?.talents ?? null, {
      classEntries,
      specEntries,
    }),
    freePick,
  };
}

function readBrowserUrlState(
  data: BuilderViewModel,
  fallbackClass: BuilderClass,
  fallbackSpec: BuilderTab | undefined,
) {
  const params = new URLSearchParams(window.location.search);

  return readInitialParamState(data, fallbackClass, fallbackSpec, {
    class: params.get("class") ?? undefined,
    spec: params.get("spec") ?? undefined,
    talents: params.get("talents") ?? undefined,
    freePick: params.get("freePick") ?? undefined,
  });
}

function subscribeToUrlChanges(callback: () => void) {
  const originalPushState = window.history.pushState;

  window.history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);

    window.dispatchEvent(new Event("builder:urlchange"));

    return result;
  };

  window.addEventListener("builder:urlchange", callback);
  window.addEventListener("popstate", callback);

  return () => {
    window.history.pushState = originalPushState;
    window.removeEventListener("builder:urlchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

function getTreeLayout(viewportWidth: number) {
  if (viewportWidth > 0 && viewportWidth <= STACK_BREAKPOINT) {
    return "stacked";
  }

  return "wide";
}

function getViewportSize() {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getScrollPosition() {
  if (typeof window === "undefined") {
    return { x: 0, y: 0 };
  }

  return {
    x: window.scrollX,
    y: window.scrollY,
  };
}

function getTreeContentSize(layout: TreeLayout, viewportWidth = 0) {
  return {
    width:
      layout === "stacked"
        ? getStackedCanvasWidth(viewportWidth)
        : getWideCanvasWidth(viewportWidth),
    height: layout === "stacked" ? STACKED_CLASS_TREE_BOTTOM : TREE_HEIGHT,
  };
}

function getStackedSpecHeadingTop(nodes: TreeNode[]) {
  const specTreeTop = Math.min(
    ...nodes
      .filter((node) => node.section === "spec" && !isPassiveNode(node))
      .map((node) => node.top),
  );

  if (Number.isFinite(specTreeTop)) {
    return specTreeTop - STACKED_SPEC_HEADER_OFFSET;
  }

  return STACKED_CLASS_TREE_BOTTOM + STACKED_PASSIVE_TO_SPEC_GAP;
}

function getCanvasSize(
  nodes: TreeNode[],
  viewport: { width: number; height: number },
  layout: TreeLayout,
) {
  const minStackedWidth = getStackedCanvasWidth(viewport.width);
  const minStackedHeight = STACKED_CLASS_TREE_BOTTOM;
  const baseWidth =
    layout === "stacked" ? minStackedWidth : getWideCanvasWidth(viewport.width);
  const baseHeight = layout === "stacked" ? minStackedHeight : TREE_HEIGHT;
  const maxNodeRight = Math.max(
    baseWidth,
    ...nodes.map((node) => node.left + NODE_SIZE),
  );
  const maxNodeBottom = Math.max(
    baseHeight,
    ...nodes.map((node) => node.top + NODE_SIZE + CANVAS_SAFE_PADDING),
  );
  const shellPadding = getShellHorizontalPadding(viewport.width);
  const availableWidth = Math.max(0, viewport.width - shellPadding);
  const availableHeight = Math.max(0, viewport.height - 280);
  const contentSize = getTreeContentSize(layout, viewport.width);

  return {
    width: Math.max(contentSize.width, maxNodeRight, availableWidth),
    height: Math.max(contentSize.height, maxNodeBottom, availableHeight),
  };
}

function getMobileTreeTabNodes(
  nodes: TreeNode[],
  activeSection: MobileTreeSection,
) {
  const visibleNodes = nodes.filter((node) => node.section === activeSection);

  if (activeSection === "class" || visibleNodes.length === 0) {
    return visibleNodes;
  }

  const minTop = Math.min(...visibleNodes.map((node) => node.top));
  const offsetTop = GRID_TOP - minTop;

  return visibleNodes.map((node) => ({
    ...node,
    top: node.top + offsetTop,
  }));
}

export default function BuilderTalentTree({ data, initialParams }: Props) {
  const defaultClass =
    data.talents.classes.find((item) => item.className === "Witch Doctor") ??
    data.talents.classes[0];
  const defaultSpec =
    sortedSpecs(defaultClass)[1] ?? sortedSpecs(defaultClass)[0];
  const initialState = readInitialParamState(
    data,
    defaultClass,
    defaultSpec,
    initialParams,
  );
  const [selectedClassId, setSelectedClassId] = useState<number | null>(
    initialState.classId,
  );
  const [selectedSpecId, setSelectedSpecId] = useState<number | null>(
    initialState.specId,
  );
  const [query, setQuery] = useState("");
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isMobileSpecMenuOpen, setIsMobileSpecMenuOpen] = useState(false);
  const [mobileTreeSection, setMobileTreeSection] =
    useState<MobileTreeSection>("class");
  const [isClassPickerOpen, setIsClassPickerOpen] = useState(false);
  const [points, setPoints] = useState<Record<string, number>>(
    initialState.points,
  );
  const [isFreePickEnabled, setIsFreePickEnabled] = useState(
    initialState.freePick,
  );
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);
  const [hoveredChoiceId, setHoveredChoiceId] = useState<number | null>(null);
  const [openChoiceNodeKey, setOpenChoiceNodeKey] = useState<string | null>(
    null,
  );
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<number | null>(null);
  const touchResetTimer = useRef<number | null>(null);
  const didLongPressNode = useRef(false);
  const isTouchingNode = useRef(false);
  const suppressNextTouchClick = useRef(false);
  const touchPressStart = useRef<{ x: number; y: number } | null>(null);
  const treeStageRef = useRef<HTMLDivElement | null>(null);
  const [isUrlStateReady, setIsUrlStateReady] = useState(
    () => initialParams !== undefined,
  );
  const iconSpriteStatus = useImageAssetStatus(ICON_SPRITE_PATH);

  const selectedClass =
    data.talents.classes.find((item) => item.classId === selectedClassId) ??
    null;
  const selectedClassSetting = selectedClass
    ? getClassSetting(data, selectedClass)
    : getNeutralClassSetting();

  const specs = useMemo(
    () => (selectedClass ? sortedSpecs(selectedClass) : []),
    [selectedClass],
  );
  const selectedSpec =
    specs.find((spec) => spec.tabId === selectedSpecId) ?? specs[0] ?? null;
  const treeLayout = getTreeLayout(viewport.width);
  const treeContentSize = getTreeContentSize(treeLayout, viewport.width);

  useEffect(() => {
    function applyUrlState() {
      const nextState = readBrowserUrlState(data, defaultClass, defaultSpec);

      setSelectedClassId(nextState.classId);
      setSelectedSpecId(nextState.specId);
      setPoints(nextState.points);
      setIsFreePickEnabled(nextState.freePick);
      setOpenChoiceNodeKey(null);
      setHoveredChoiceId(null);
      setIsUrlStateReady(true);
    }

    applyUrlState();

    return subscribeToUrlChanges(applyUrlState);
  }, [data, defaultClass, defaultSpec]);

  useEffect(() => {
    function handleResize() {
      setViewport(getViewportSize());
      setScrollPosition(getScrollPosition());
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let frame: number | null = null;

    function updateScrollPosition() {
      frame = null;
      setScrollPosition(getScrollPosition());
    }

    function handleScroll() {
      if (frame !== null) {
        return;
      }

      frame = window.requestAnimationFrame(updateScrollPosition);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!openChoiceNodeKey) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(".choice-popover") ||
        target.closest(".tree-node.choice")
      ) {
        return;
      }

      setOpenChoiceNodeKey(null);
      setHoveredChoiceId(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openChoiceNodeKey]);

  const classEntries = useMemo(
    () =>
      selectedClass
        ? getTabEntries(data, selectedClass, getClassTreeTab(selectedClass))
        : [],
    [data, selectedClass],
  );

  const specEntries = useMemo(
    () =>
      selectedClass
        ? getTabEntries(data, selectedClass, selectedSpec ?? undefined)
        : [],
    [data, selectedClass, selectedSpec],
  );

  const nodes = useMemo(
    () =>
      makeTreeNodes(classEntries, specEntries, treeLayout, 0, viewport.width),
    [classEntries, specEntries, treeLayout, viewport.width],
  );
  const effectivePoints = useMemo(
    () => withFreeSpecFirstLinePoints(nodes, points),
    [nodes, points],
  );

  useEffect(() => {
    if (!isUrlStateReady || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (!selectedClass) {
      const nextUrl = window.location.pathname;
      window.history.replaceState(null, "", nextUrl);
      return;
    }

    params.set("class", slugify(selectedClass.className));

    if (selectedSpec) {
      params.set("spec", slugify(selectedSpec.tabName));
    } else {
      params.delete("spec");
    }

    const talentCode = encodeTalentCode(nodes, effectivePoints);

    if (talentCode) {
      params.set("talents", talentCode);
    } else {
      params.delete("talents");
    }

    if (isFreePickEnabled) {
      params.set("freePick", "1");
    } else {
      params.delete("freePick");
    }

    const nextQuery = params.toString().replace(/%3A/g, ":");
    const nextUrl = `${window.location.pathname}?${nextQuery}`;
    window.history.replaceState(null, "", nextUrl);
  }, [
    isUrlStateReady,
    selectedClass,
    selectedSpec,
    nodes,
    effectivePoints,
    isFreePickEnabled,
  ]);
  const isMobileTreeTabs =
    treeLayout === "stacked" && viewport.width > 0 && viewport.width <= 520;
  const spent = getSpentTotals(nodes, effectivePoints);
  const renderedNodes = useMemo(
    () =>
      isMobileTreeTabs
        ? getMobileTreeTabNodes(nodes, mobileTreeSection)
        : nodes,
    [isMobileTreeTabs, mobileTreeSection, nodes],
  );
  const stackedSpecHeadingTop =
    treeLayout === "stacked" ? getStackedSpecHeadingTop(nodes) : 0;
  const canvasSize = useMemo(
    () => getCanvasSize(renderedNodes, viewport, treeLayout),
    [renderedNodes, viewport, treeLayout],
  );

  const queryText = query.trim().toLowerCase();
  const connections = useMemo(
    () => makeConnections(renderedNodes, effectivePoints),
    [renderedNodes, effectivePoints],
  );
  const thresholdMarkers = useMemo(
    () => getThresholdMarkers(renderedNodes),
    [renderedNodes],
  );
  const hoveredNode = renderedNodes.find(
    (node) => node.nodeKey === hoveredNodeKey,
  );
  const openChoiceNode = renderedNodes.find(
    (node) => node.nodeKey === openChoiceNodeKey,
  );

  useEffect(() => {
    if (!isMobileTreeTabs || isFreePickEnabled) {
      return;
    }

    setMobileTreeSection(getNextOrderedSection(spent));
  }, [isMobileTreeTabs, isFreePickEnabled, spent.ability, spent.talent]);

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    setPoints((current) => {
      const limitedPoints = limitPointStateToTreeCaps(
        nodes,
        current,
        isFreePickEnabled,
      );

      return arePointStatesEqual(current, limitedPoints)
        ? current
        : limitedPoints;
    });
  }, [nodes, isFreePickEnabled]);

  function chooseClass(builderClass: BuilderClass) {
    const nextSpecs = sortedSpecs(builderClass);

    setSelectedClassId(builderClass.classId);
    setSelectedSpecId(nextSpecs[0]?.tabId ?? null);
    setPoints({});
    setOpenChoiceNodeKey(null);
    setIsClassPickerOpen(false);
    setIsMobileSpecMenuOpen(false);
    setMobileTreeSection("class");
  }

  function chooseSpec(tab: BuilderTab) {
    setSelectedSpecId(tab.tabId);
    setPoints({});
    setOpenChoiceNodeKey(null);
    setIsMobileSpecMenuOpen(false);
  }

  function spendPoint(node: TreeNode) {
    if (isPassiveNode(node) || isFreeSpecFirstLineNode(node)) {
      return;
    }

    setPoints((current) => {
      const currentEffectivePoints = withFreeSpecFirstLinePoints(
        nodes,
        current,
      );
      const currentSpent = getSpentTotals(nodes, currentEffectivePoints);
      const isSelected = getNodeRank(node, currentEffectivePoints) > 0;

      if (
        !isSelected &&
        !canRankNode(
          node,
          currentEffectivePoints,
          currentSpent,
          data.realm.maxLevel,
        )
      ) {
        return current;
      }

      const existing = current[node.nodeKey] ?? 0;
      const next = existing >= getNodeMaxPoints(node) ? 0 : existing + 1;
      const nextPoints = { ...current };

      if (next > 0) {
        nextPoints[node.nodeKey] = next;
      } else {
        delete nextPoints[node.nodeKey];
      }

      if (
        canUsePointState(nextPoints) &&
        canApplyPointChange(
          nodes,
          current,
          nextPoints,
          node.section,
          isFreePickEnabled,
        )
      ) {
        return nextPoints;
      }

      if (next !== 0 || existing <= 1) {
        return current;
      }

      const reducedPoints = setNodeRank(node, current, existing - 1);

      return canUsePointState(reducedPoints) &&
        canApplyPointChange(
          nodes,
          current,
          reducedPoints,
          node.section,
          isFreePickEnabled,
        )
        ? reducedPoints
        : current;
    });
  }

  function canUsePointState(nextPoints: Record<string, number>) {
    const effectiveNextPoints = withFreeSpecFirstLinePoints(nodes, nextPoints);
    const nextSpent = getSpentTotals(nodes, effectiveNextPoints);

    return (
      (isFreePickEnabled || isOrderedDistribution(nextSpent)) &&
      nodes.every((node) => {
        if (
          isPassiveNode(node) ||
          isFreeSpecFirstLineNode(node) ||
          getNodeRank(node, effectiveNextPoints) === 0
        ) {
          return true;
        }

        return canRankNode(
          node,
          effectiveNextPoints,
          nextSpent,
          data.realm.maxLevel,
        );
      })
    );
  }

  function removeNodePoints(node: TreeNode, current: Record<string, number>) {
    const nextPoints = { ...current };

    if (node.choices?.length) {
      for (const choice of node.choices) {
        delete nextPoints[`${node.section}:${choice.id}`];
      }
    } else {
      delete nextPoints[node.nodeKey];
    }

    return nextPoints;
  }

  function setNodeRank(
    node: TreeNode,
    current: Record<string, number>,
    rank: number,
  ) {
    const nextPoints = { ...current };
    const selectedChoice = getSelectedChoice(node, current);
    const selectedKey = selectedChoice
      ? `${node.section}:${selectedChoice.id}`
      : node.nodeKey;

    if (rank > 0) {
      nextPoints[selectedKey] = rank;
    } else if (node.choices?.length) {
      for (const choice of node.choices) {
        delete nextPoints[`${node.section}:${choice.id}`];
      }
    } else {
      delete nextPoints[selectedKey];
    }

    return nextPoints;
  }

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function clearTouchResetTimer() {
    if (touchResetTimer.current) {
      window.clearTimeout(touchResetTimer.current);
      touchResetTimer.current = null;
    }
  }

  function resetTouchPressState() {
    clearTouchResetTimer();
    didLongPressNode.current = false;
    isTouchingNode.current = false;
    suppressNextTouchClick.current = false;
    touchPressStart.current = null;
  }

  function scheduleTouchReset(delay: number) {
    clearTouchResetTimer();
    touchResetTimer.current = window.setTimeout(() => {
      touchResetTimer.current = null;
      resetTouchPressState();
    }, delay);
  }

  function finishTouchPress() {
    clearLongPress();

    if (didLongPressNode.current) {
      suppressNextTouchClick.current = true;
      scheduleTouchReset(700);
      return;
    }

    if (isTouchingNode.current) {
      scheduleTouchReset(350);
    }
  }

  function cancelTouchPress() {
    clearLongPress();
    isTouchingNode.current = false;
    touchPressStart.current = null;

    if (didLongPressNode.current) {
      scheduleTouchReset(350);
    }
  }

  function deselectNode(node: TreeNode) {
    if (isPassiveNode(node) || isFreeSpecFirstLineNode(node)) {
      return;
    }

    setPoints((current) => {
      const currentRank = getNodeRank(node, current);
      const nextPoints = removeNodePoints(node, current);

      if (canUsePointState(nextPoints)) {
        return nextPoints;
      }

      if (currentRank <= 1) {
        return current;
      }

      const reducedPoints = setNodeRank(node, current, currentRank - 1);

      return canUsePointState(reducedPoints) ? reducedPoints : current;
    });
    setOpenChoiceNodeKey(null);
    setHoveredChoiceId(null);
  }

  function shouldCancelTouchPress(event: ReactPointerEvent) {
    if (!touchPressStart.current) {
      return false;
    }

    const distanceX = Math.abs(event.clientX - touchPressStart.current.x);
    const distanceY = Math.abs(event.clientY - touchPressStart.current.y);

    return distanceX > TOUCH_MOVE_TOLERANCE || distanceY > TOUCH_MOVE_TOLERANCE;
  }

  function startLongPress(
    node: TreeNode,
    event: ReactPointerEvent,
    previewChoiceId = getSelectedChoice(node, effectivePoints)?.id ?? null,
  ) {
    clearLongPress();
    clearTouchResetTimer();
    didLongPressNode.current = false;
    suppressNextTouchClick.current = false;
    isTouchingNode.current = true;
    touchPressStart.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = window.setTimeout(() => {
      setHoveredNodeKey(node.nodeKey);
      setHoveredChoiceId(previewChoiceId);
      didLongPressNode.current = true;
      longPressTimer.current = null;
    }, TOUCH_LONG_PRESS_MS);
  }

  function completeTouchPress(event: ReactPointerEvent) {
    if (didLongPressNode.current) {
      event.preventDefault();
      event.stopPropagation();
    }

    finishTouchPress();
  }

  function preventLongPressTouchEnd(event: ReactTouchEvent) {
    if (didLongPressNode.current || suppressNextTouchClick.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleTouchMove(event: ReactPointerEvent) {
    if (shouldCancelTouchPress(event)) {
      cancelTouchPress();
    }
  }

  function handleNodeClick(
    event: ReactMouseEvent,
    node: TreeNode,
    canUseNode: boolean,
  ) {
    if (didLongPressNode.current || suppressNextTouchClick.current) {
      event.preventDefault();
      resetTouchPressState();
      return;
    }

    isTouchingNode.current = false;
    setHoveredNodeKey(null);
    setHoveredChoiceId(null);

    if (node.choices?.length) {
      toggleChoiceNode(node, canUseNode);
    } else {
      spendPoint(node);
    }
  }

  function handleChoiceOptionClick(
    event: ReactMouseEvent,
    node: TreeNode,
    choice: FlatTalentEntry,
  ) {
    if (didLongPressNode.current || suppressNextTouchClick.current) {
      event.preventDefault();
      resetTouchPressState();
      return;
    }

    chooseTalentOption(node, choice);
  }

  function handleChoiceDeselectClick(event: ReactMouseEvent, node: TreeNode) {
    if (didLongPressNode.current || suppressNextTouchClick.current) {
      event.preventDefault();
      resetTouchPressState();
      return;
    }

    deselectNode(node);
  }

  function toggleChoiceNode(node: TreeNode, canOpen: boolean) {
    if (!canOpen) {
      return;
    }

    setOpenChoiceNodeKey((current) =>
      current === node.nodeKey ? null : node.nodeKey,
    );
    setHoveredNodeKey(null);
    setHoveredChoiceId(getSelectedChoice(node, effectivePoints)?.id ?? null);
  }

  function chooseTalentOption(node: TreeNode, choice: FlatTalentEntry) {
    if (isFreeSpecFirstLineNode(node)) {
      return;
    }

    const currentSpent = getSpentTotals(nodes, effectivePoints);

    if (
      getNodeRank(node, effectivePoints) === 0 &&
      !canRankNode(node, effectivePoints, currentSpent, data.realm.maxLevel)
    ) {
      return;
    }

    setPoints((current) => {
      const nextPoints = { ...current };

      for (const option of node.choices ?? []) {
        delete nextPoints[`${node.section}:${option.id}`];
      }

      const choiceKey = `${node.section}:${choice.id}`;
      const existing = current[choiceKey] ?? 0;
      nextPoints[choiceKey] =
        existing > 0 && existing < choice.maxPoints ? existing + 1 : 1;

      return canUsePointState(nextPoints) &&
        canApplyPointChange(
          nodes,
          current,
          nextPoints,
          node.section,
          isFreePickEnabled,
        )
        ? nextPoints
        : current;
    });
    setHoveredChoiceId(null);
    setHoveredNodeKey(null);
    setOpenChoiceNodeKey(null);
  }

  if (!isUrlStateReady || iconSpriteStatus !== "ready") {
    return (
      <BuilderLoadingState
        iconStatus={iconSpriteStatus}
        setting={selectedClassSetting}
      />
    );
  }

  return (
    <main
      className="builder-shell relative flex w-full"
      style={classThemeStyle(selectedClassSetting)}
    >
      {" "}
      <div className="h-full w-full pointer-events-none  absolute top-0 left-0 inset-0 opacity-40">
        <video
          loop
          autoPlay
          playsInline
          preload="metadata"
          width="100%"
          height="100%"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source
            src="https://ascension.gg/videos/landing_mobile.webm"
            type="video/webm"
            media="(max-width: 1023px)"
          />
          <source
            src="https://ascension.gg/videos/landing.webm"
            type="video/webm"
            media="(min-width: 1024px)"
          />
          <track kind="captions" label="English" />
        </video>
      </div>
      <div className="z-10 w-full">
        <header
          className={`builder-topbar ${isMobileSearchOpen ? "search-open" : ""}`}
        >
          <div className="class-identity">
            {selectedClass ? (
              <ClassIcon
                data={data}
                builderClass={selectedClass}
                size="large"
              />
            ) : null}
            <div className="class-title-stack">
              <h1>
                {selectedClass ? (
                  <>
                    <span>{selectedClass.className}</span>
                    <span className="class-level">
                      {" "}
                      Lv. {getCharacterLevel(spent)}
                    </span>
                  </>
                ) : (
                  "CoA Builder"
                )}
              </h1>
              {selectedSpec ? (
                <span className="class-subtitle">{selectedSpec.tabName}</span>
              ) : null}
            </div>
            <button
              className="change-button"
              type="button"
              onClick={() => setIsClassPickerOpen(true)}
            >
              {selectedClass ? (
                <span className="w-6 h-6">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1em"
                    height="1em"
                    viewBox="0 0 1536 1536"
                  >
                    <path d="M0 0h1536v1536H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M1511 928q0 5-1 7q-64 268-268 434.5T764 1536q-146 0-282.5-55T238 1324l-129 129q-19 19-45 19t-45-19t-19-45V960q0-26 19-45t45-19h448q26 0 45 19t19 45t-19 45l-137 137q71 66 161 102t187 36q134 0 250-65t186-179q11-17 53-117q8-23 30-23h192q13 0 22.5 9.5t9.5 22.5m25-800v448q0 26-19 45t-45 19h-448q-26 0-45-19t-19-45t19-45l138-138Q969 256 768 256q-134 0-250 65T332 500q-11 17-53 117q-8 23-30 23H50q-13 0-22.5-9.5T18 608v-7q65-268 270-434.5T768 0q146 0 284 55.5T1297 212l130-129q19-19 45-19t45 19t19 45"
                    />
                  </svg>
                </span>
              ) : (
                "Select Class"
              )}
            </button>
          </div>
          {specs.length > 0 ? (
            <label
              aria-label={
                isFreePickEnabled ? "Free pick unlocked" : "Free pick locked"
              }
              className={`md:hidden! free-pick-toggle  ${
                isFreePickEnabled ? "unlocked" : "locked"
              }`}
              title={
                isFreePickEnabled ? "Free pick unlocked" : "Free pick locked"
              }
            >
              <input
                checked={isFreePickEnabled}
                onChange={(event) => setIsFreePickEnabled(event.target.checked)}
                type="checkbox"
              />
              {isFreePickEnabled ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1.19em"
                  height="1em"
                  viewBox="0 0 1664 1408"
                >
                  <path d="M0 0h1664v1408H0z" fill="none" />
                  <path
                    fill="currentColor"
                    d="M1664 448v256q0 26-19 45t-45 19h-64q-26 0-45-19t-19-45V448q0-106-75-181t-181-75t-181 75t-75 181v192h96q40 0 68 28t28 68v576q0 40-28 68t-68 28H96q-40 0-68-28t-28-68V736q0-40 28-68t68-28h672V448q0-185 131.5-316.5T1216 0t316.5 131.5T1664 448"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="0.82em"
                  height="1em"
                  viewBox="0 0 1152 1408"
                >
                  <path d="M0 0h1152v1408H0z" fill="none" />
                  <path
                    fill="currentColor"
                    d="M320 640h512V448q0-106-75-181t-181-75t-181 75t-75 181zm832 96v576q0 40-28 68t-68 28H96q-40 0-68-28t-28-68V736q0-40 28-68t68-28h32V448q0-184 132-316T576 0t316 132t132 316v192h32q40 0 68 28t28 68"
                  />
                </svg>
              )}

              {/* <span aria-hidden="true" className="free-pick-lock" /> */}
              <span className="free-pick-text">Free pick</span>
            </label>
          ) : null}
          <button
            aria-expanded={isMobileSearchOpen}
            aria-label={isMobileSearchOpen ? "Hide search" : "Show search"}
            className="mobile-search-toggle"
            type="button"
            onClick={() => setIsMobileSearchOpen((current) => !current)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="1em"
              height="1em"
              viewBox="0 0 1664 1664"
            >
              <path d="M0 0h1664v1664H0z" fill="none" />
              <path
                fill="currentColor"
                d="M1152 704q0-185-131.5-316.5T704 256T387.5 387.5T256 704t131.5 316.5T704 1152t316.5-131.5T1152 704m512 832q0 52-38 90t-90 38q-54 0-90-38l-343-342q-179 124-399 124q-143 0-273.5-55.5t-225-150t-150-225T0 704t55.5-273.5t150-225t225-150T704 0t273.5 55.5t225 150t150 225T1408 704q0 220-124 399l343 343q37 37 37 90"
              />
            </svg>
          </button>

          <div className="builder-controls">
            {specs.length > 0 ? (
              <label
                aria-label={
                  isFreePickEnabled ? "Free pick unlocked" : "Free pick locked"
                }
                className={`max-md:hidden! free-pick-toggle ${
                  isFreePickEnabled ? "unlocked" : "locked"
                }`}
                title={
                  isFreePickEnabled ? "Free pick unlocked" : "Free pick locked"
                }
              >
                <input
                  checked={isFreePickEnabled}
                  onChange={(event) =>
                    setIsFreePickEnabled(event.target.checked)
                  }
                  type="checkbox"
                />
                {isFreePickEnabled ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1.19em"
                    height="1em"
                    viewBox="0 0 1664 1408"
                  >
                    <path d="M0 0h1664v1408H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M1664 448v256q0 26-19 45t-45 19h-64q-26 0-45-19t-19-45V448q0-106-75-181t-181-75t-181 75t-75 181v192h96q40 0 68 28t28 68v576q0 40-28 68t-68 28H96q-40 0-68-28t-28-68V736q0-40 28-68t68-28h672V448q0-185 131.5-316.5T1216 0t316.5 131.5T1664 448"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="0.82em"
                    height="1em"
                    viewBox="0 0 1152 1408"
                  >
                    <path d="M0 0h1152v1408H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M320 640h512V448q0-106-75-181t-181-75t-181 75t-75 181zm832 96v576q0 40-28 68t-68 28H96q-40 0-68-28t-28-68V736q0-40 28-68t68-28h32V448q0-184 132-316T576 0t316 132t132 316v192h32q40 0 68 28t28 68"
                    />
                  </svg>
                )}

                {/* <span aria-hidden="true" className="free-pick-lock" /> */}
                <span className="free-pick-text">Free pick</span>
              </label>
            ) : null}
            <label className="tree-search">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search classes, specs, or talents"
              />
            </label>
          </div>
        </header>
        <nav
          className={`spec-tabs ${
            isMobileSpecMenuOpen ? "mobile-menu-open" : ""
          }`}
          aria-label="Class specializations"
        >
          {specs.map((spec) => (
            <button
              className={`${spec.tabId === selectedSpec?.tabId ? "active " : ""} relative overflow-hidden h-16`}
              key={spec.tabId}
              type="button"
              aria-expanded={
                spec.tabId === selectedSpec?.tabId
                  ? isMobileSpecMenuOpen
                  : undefined
              }
              onClick={() => {
                if (spec.tabId === selectedSpec?.tabId) {
                  setIsMobileSpecMenuOpen((current) => !current);
                  return;
                }

                chooseSpec(spec);
              }}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-l  z-10 ${spec.tabId === selectedSpec?.tabId ? "from-transparent to-black/50 via-black/80" : "from-transparent to-black via-black/80"}`}
              />
              <div
                className={`absolute inset-0 scale-125 coa-builder-icon blur-md contrast-120 brightness-150 z-0 ${iconClassName(
                  selectedClass
                    ? getSpecIcon(data, selectedClass, spec)?.iconPath
                    : undefined,
                )}`}
              />

              <span className="spec-icon z-10 border-2 border-white/10 outline-2 outline-black">
                <span
                  className={`coa-builder-icon scale-110 ${iconClassName(
                    selectedClass
                      ? getSpecIcon(data, selectedClass, spec)?.iconPath
                      : undefined,
                  )}`}
                />
              </span>
              <span
                className={`z-10 ml-2 !tracking-widest `}
                style={{
                  color:
                    spec.tabId === selectedSpec?.tabId
                      ? selectedClassSetting.colorHex
                      : "",
                }}
              >
                {spec.tabName}
              </span>
              {spec.tabId === selectedSpec?.tabId ? (
                <span className="mobile-spec-arrow" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </nav>
        {selectedClass && selectedSpec ? (
          <div className="mobile-point-summary" aria-label="Point totals">
            <button
              aria-pressed={mobileTreeSection === "class"}
              className={mobileTreeSection === "class" ? "active" : ""}
              type="button"
              onClick={() => setMobileTreeSection("class")}
            >
              <span>Class Tree </span>
              <strong>
                {spent.ability} <small>/ {CLASS_TREE_POINT_LIMIT}</small>
              </strong>
              {/* <em>{CLASS_TREE_POINT_LIMIT - spent.ability} left</em> */}
            </button>
            <button
              aria-pressed={mobileTreeSection === "spec"}
              className={mobileTreeSection === "spec" ? "active" : ""}
              type="button"
              onClick={() => setMobileTreeSection("spec")}
            >
              <span>{selectedSpec.tabName} Tree</span>
              <strong>
                {spent.talent} <small>/ {SPEC_TREE_POINT_LIMIT}</small>
              </strong>
              {/* <em>{SPEC_TREE_POINT_LIMIT - spent.talent} left</em> */}
            </button>
          </div>
        ) : null}
        <section className="tree-frame " aria-label="Talent tree builder">
          {!selectedClass ? (
            <>
              <div className="flex flex-col items-center gap-4 min-h-[400px] justify-center hidden!">
                <h2
                  className="text-2xl text-center text-wow-shadow font-bold tracking-wide text-amber-400"
                  style={{
                    fontFamily: "var(--font-pivotal)",
                  }}
                >
                  Select a CoA class to start
                </h2>
                <div className="flex flex-wrap justify-center">
                  {data.talents.classes
                    .sort((a, b) => a.className.localeCompare(b.className))
                    .map((builderClass) => (
                      <button
                        // className={
                        //   builderClass.classId === selectedClassId ? "selected" : ""
                        // }
                        key={builderClass.classId}
                        style={classThemeStyle(
                          getClassSetting(data, builderClass),
                        )}
                        type="button"
                        onClick={() => chooseClass(builderClass)}
                        className="flex flex-col items-center gap-2 min-h-12 p-2 w-[110px] "
                      >
                        <div
                          className={`class-icon h-20! w-20! border-4! outline-none! border-[var(--class-color)]/70!  `}
                          style={{
                            boxShadow: "0 0 10px rgba(255, 255, 255, 0.2)",
                          }}
                        >
                          <span
                            className={`coa-builder-icon ${getClassIconClass(data, builderClass)}`}
                            style={{
                              width: "100%",
                              height: "100%",
                              border: "none !important",
                            }}
                          />
                        </div>
                        <span
                          className="text-sm text-wow-shadow"
                          style={{
                            color: "var(--class-color)",
                            fontFamily: "var(--font-pivotal)",
                            fontSize: "0.9rem",
                            fontWeight: "500",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {builderClass.className}
                        </span>
                      </button>
                    ))}
                </div>
                <div className="start-class-grid hidden!">
                  {data.talents.classes.map((builderClass) => {
                    const firstSpec = sortedSpecs(builderClass)[0];

                    return (
                      <a
                        href={builderUrl(builderClass, firstSpec)}
                        key={builderClass.classId}
                        style={classThemeStyle(
                          getClassSetting(data, builderClass),
                        )}
                      >
                        <ClassIcon data={data} builderClass={builderClass} />
                        <span>{builderClass.className}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
              <ClassPicker
                data={data}
                selectedClassId={selectedClassId}
                onClose={() => setIsClassPickerOpen(false)}
                onChoose={chooseClass}
              />
            </>
          ) : (
            <div className="tree-scroll">
              <div
                className={`tree-canvas ${treeLayout} ${
                  isMobileTreeTabs ? `mobile-tree-${mobileTreeSection}` : ""
                }`}
                style={{ width: canvasSize.width, height: canvasSize.height }}
              >
                <div
                  className="inset-0 absolute opacity-50"
                  style={{
                    backgroundImage: `url(${localAssetUrl(selectedClassSetting.treeTexture)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }}
                >
                  {/* A glowing ball on the class color */}
                  <div
                    className="absolute inset-0 bottom-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      width: "70%",
                      height: "70%",
                      borderRadius: "50%",
                      backgroundColor: selectedClassSetting.color,
                      opacity: 0.5,
                      filter: "blur(80px)",
                    }}
                  />
                </div>
                <div className={`tree-header ${treeLayout}`}>
                  {isMobileTreeTabs && mobileTreeSection === "spec" ? (
                    <>
                      <strong>{selectedSpec?.tabName}</strong>
                      <div className="text-xs font-bold md:hidden">
                        level {getCharacterLevel(spent)}
                      </div>
                      <span>
                        {spent.talent}/{SPEC_TREE_POINT_LIMIT} Talent Essence
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>Class Tree</strong>
                      <div className="text-xs font-bold md:hidden">
                        level {getCharacterLevel(spent)}
                      </div>
                      <span>
                        {spent.ability}/{CLASS_TREE_POINT_LIMIT} Ability Essence
                      </span>
                      <strong>{selectedSpec?.tabName}</strong>
                      <span>
                        {spent.talent}/{SPEC_TREE_POINT_LIMIT} Talent Essence
                      </span>
                    </>
                  )}
                </div>

                {treeLayout === "stacked" && !isMobileTreeTabs ? (
                  <div
                    className="stacked-spec-heading"
                    style={{ top: stackedSpecHeadingTop }}
                  >
                    <strong>{selectedSpec?.tabName}</strong>
                    <span>
                      {spent.talent}/{SPEC_TREE_POINT_LIMIT} Talent Essence
                    </span>
                  </div>
                ) : null}

                <div
                  className="tree-stage"
                  ref={treeStageRef}
                  style={{
                    width: treeContentSize.width,
                    height: canvasSize.height,
                  }}
                >
                  <svg
                    className="tree-lines"
                    viewBox={`0 0 ${treeContentSize.width} ${canvasSize.height}`}
                    aria-hidden="true"
                  >
                    {connections.map((connection) => {
                      const sourceRank = getVisualRank(
                        connection.source,
                        effectivePoints,
                        spent,
                      );
                      const targetRank = getVisualRank(
                        connection.target,
                        effectivePoints,
                        spent,
                      );
                      const isPassiveConnection =
                        isPassiveNode(connection.source) ||
                        isPassiveNode(connection.target);
                      const isSelected =
                        !isPassiveConnection &&
                        sourceRank > 0 &&
                        targetRank > 0;
                      const isEnabled =
                        !isSelected &&
                        (sourceRank > 0 || targetRank > 0) &&
                        (!isPassiveConnection ||
                          (sourceRank > 0 && targetRank > 0));

                      return (
                        <line
                          className={
                            isSelected ? "selected" : isEnabled ? "enabled" : ""
                          }
                          key={connection.key}
                          x1={connection.source.left + NODE_SIZE / 2}
                          y1={connection.source.top + NODE_SIZE / 2}
                          x2={connection.target.left + NODE_SIZE / 2}
                          y2={connection.target.top + NODE_SIZE / 2}
                        />
                      );
                    })}
                  </svg>

                  <div className="threshold-markers" aria-hidden="true">
                    {thresholdMarkers.map((marker) => {
                      const spentForMarker =
                        marker.section === "class"
                          ? spent.ability
                          : spent.talent;

                      return (
                        <span
                          className={
                            spentForMarker >= marker.amount ? "met" : "missing"
                          }
                          key={marker.key}
                          style={
                            {
                              left: marker.left,
                              top: marker.top,
                              "--threshold-line-width": `${marker.lineWidth}px`,
                            } as CSSProperties
                          }
                        >
                          {marker.amount}
                        </span>
                      );
                    })}
                  </div>

                  <div className="tree-nodes">
                    {renderedNodes.map((node) => {
                      const displayEntry = getDisplayEntry(
                        node,
                        effectivePoints,
                      );
                      const isPassive = isPassiveNode(node);
                      const current = getVisualRank(
                        node,
                        effectivePoints,
                        spent,
                      );
                      const maxPoints = getNodeMaxPoints(node);
                      const isSpent = current > 0;
                      const meetsRequirements = canRankNode(
                        node,
                        effectivePoints,
                        spent,
                        data.realm.maxLevel,
                      );
                      const canUseNode =
                        isSpent ||
                        (meetsRequirements &&
                          canAddRankToNode(
                            node,
                            effectivePoints,
                            spent,
                            isFreePickEnabled,
                          ));
                      const isMatch = (node.choices ?? [node]).some((choice) =>
                        matchesQuery(choice, queryText),
                      );

                      return (
                        <button
                          aria-label={`${displayEntry.name}, ${current} of ${maxPoints}`}
                          className={[
                            "tree-node",
                            isPassive ? "passive" : "",
                            node.choices?.length
                              ? "choice"
                              : node.nodeType.includes("Square")
                                ? "square"
                                : "circle",
                            canUseNode ? "available" : "locked",
                            isSpent ? "spent" : "",
                            isMatch ? "matched" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={node.nodeKey}
                          onBlur={() => setHoveredNodeKey(null)}
                          onFocus={() => {
                            if (
                              !didLongPressNode.current &&
                              !isTouchingNode.current
                            ) {
                              setHoveredNodeKey(node.nodeKey);
                            }
                          }}
                          onMouseEnter={() => setHoveredNodeKey(node.nodeKey)}
                          onMouseLeave={() => {
                            if (openChoiceNodeKey !== node.nodeKey) {
                              setHoveredNodeKey(null);
                              setHoveredChoiceId(null);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();

                            if (
                              !didLongPressNode.current &&
                              !isTouchingNode.current
                            ) {
                              deselectNode(node);
                            }
                          }}
                          onClick={(event) =>
                            handleNodeClick(event, node, canUseNode)
                          }
                          onPointerCancel={(event) => {
                            if (event.pointerType === "touch") {
                              cancelTouchPress();
                            } else {
                              clearLongPress();
                            }
                          }}
                          onPointerDown={(event) => {
                            if (event.pointerType === "touch") {
                              startLongPress(node, event);
                            }
                          }}
                          onPointerLeave={(event) => {
                            if (event.pointerType === "touch") {
                              cancelTouchPress();
                            } else {
                              clearLongPress();
                            }
                          }}
                          onPointerMove={(event) => {
                            if (event.pointerType === "touch") {
                              handleTouchMove(event);
                            } else {
                              clearLongPress();
                            }
                          }}
                          onPointerUp={(event) => {
                            if (event.pointerType === "touch") {
                              completeTouchPress(event);
                            } else {
                              clearLongPress();
                            }
                          }}
                          onTouchEnd={preventLongPressTouchEnd}
                          style={{ left: node.left, top: node.top }}
                          type="button"
                        >
                          <TreeNodeIcon node={node} points={effectivePoints} />
                          <b>
                            {current}/{maxPoints}
                          </b>
                        </button>
                      );
                    })}
                  </div>

                  {openChoiceNode?.choices?.length ? (
                    <ChoicePopover
                      node={openChoiceNode}
                      points={effectivePoints}
                      canvasSize={canvasSize}
                      scrollPosition={scrollPosition}
                      stageOffsetTop={
                        treeStageRef.current
                          ? treeStageRef.current.getBoundingClientRect().top +
                            scrollPosition.y
                          : 0
                      }
                      viewport={viewport}
                      onChoose={(event, choice) =>
                        handleChoiceOptionClick(event, openChoiceNode, choice)
                      }
                      onDeselect={(event) =>
                        handleChoiceDeselectClick(event, openChoiceNode)
                      }
                      onHover={(choice) => {
                        setHoveredNodeKey(openChoiceNode.nodeKey);
                        setHoveredChoiceId(choice.id);
                      }}
                      onPointerCancel={(event) => {
                        if (event.pointerType === "touch") {
                          cancelTouchPress();
                        }
                      }}
                      onPointerDown={(event, choice) => {
                        if (event.pointerType === "touch") {
                          startLongPress(openChoiceNode, event, choice.id);
                        }
                      }}
                      onPointerMove={(event) => {
                        if (event.pointerType === "touch") {
                          handleTouchMove(event);
                        }
                      }}
                      onPointerUp={(event) => {
                        if (event.pointerType === "touch") {
                          completeTouchPress(event);
                        }
                      }}
                      onTouchEnd={preventLongPressTouchEnd}
                      onLeave={() => setHoveredChoiceId(null)}
                    />
                  ) : null}

                  {hoveredNode ? (
                    <TalentTooltip
                      node={hoveredNode}
                      points={effectivePoints}
                      canvasSize={{
                        width: treeContentSize.width,
                        height: canvasSize.height,
                      }}
                      scrollPosition={scrollPosition}
                      stageOffsetTop={
                        treeStageRef.current
                          ? treeStageRef.current.getBoundingClientRect().top +
                            scrollPosition.y
                          : 0
                      }
                      viewport={viewport}
                      previewChoiceId={hoveredChoiceId}
                      missingRequirements={getRequirementText(
                        hoveredNode,
                        effectivePoints,
                        spent,
                        data.realm.maxLevel,
                      ).concat(
                        getPointBlockText(
                          hoveredNode,
                          effectivePoints,
                          spent,
                          isFreePickEnabled,
                        ),
                      )}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>
        {isClassPickerOpen ? (
          <ClassPicker
            data={data}
            selectedClassId={selectedClass?.classId ?? null}
            onClose={() => setIsClassPickerOpen(false)}
            onChoose={chooseClass}
          />
        ) : null}
      </div>
    </main>
  );
}

function TreeNodeIcon({
  node,
  points,
}: {
  node: TreeNode;
  points: Record<string, number>;
}) {
  const selectedChoice = getSelectedChoice(node, points);

  if (!node.choices?.length || selectedChoice) {
    const entry = selectedChoice ?? node;

    return (
      <span className={`coa-builder-icon ${iconClassName(entry.iconPath)}`} />
    );
  }

  return (
    <span className="choice-icons">
      {node.choices.slice(0, 2).map((choice) => (
        <span
          className={`coa-builder-icon ${iconClassName(choice.iconPath)}`}
          key={choice.id}
        />
      ))}
    </span>
  );
}

function ChoicePopover({
  node,
  points,
  canvasSize,
  scrollPosition,
  stageOffsetTop,
  viewport,
  onChoose,
  onDeselect,
  onHover,
  onLeave,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onTouchEnd,
}: {
  node: TreeNode;
  points: Record<string, number>;
  canvasSize: { width: number; height: number };
  scrollPosition: { x: number; y: number };
  stageOffsetTop: number;
  viewport: { width: number; height: number };
  onChoose: (event: ReactMouseEvent, choice: FlatTalentEntry) => void;
  onDeselect: (event: ReactMouseEvent) => void;
  onHover: (choice: FlatTalentEntry) => void;
  onLeave: () => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    choice: FlatTalentEntry,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTouchEnd: (event: ReactTouchEvent<HTMLButtonElement>) => void;
}) {
  const currentRank = getNodeRank(node, points);
  const popoverHeight =
    currentRank > 0 ? CHOICE_POPOVER_CLEAR_HEIGHT : CHOICE_POPOVER_HEIGHT;
  const preferredLeft = node.left + NODE_SIZE / 2;
  const minLeft = CHOICE_POPOVER_WIDTH / 2 + 8;
  const maxLeft = Math.max(
    minLeft,
    canvasSize.width - CHOICE_POPOVER_WIDTH / 2 - 8,
  );
  const visibleTop = Math.max(0, scrollPosition.y - stageOffsetTop);
  const visibleBottom =
    viewport.height > 0 ? visibleTop + viewport.height : canvasSize.height;
  const preferredTop = node.top + NODE_SIZE / 2 - popoverHeight;
  const minTop = Math.max(8, visibleTop + 8);
  const maxTop = Math.max(
    minTop,
    Math.min(
      canvasSize.height - popoverHeight - 8,
      visibleBottom - popoverHeight - 8,
    ),
  );
  const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);
  const top = Math.min(Math.max(preferredTop, minTop), maxTop);

  return (
    <div
      className="choice-popover"
      style={{ left, top }}
      onMouseLeave={onLeave}
    >
      {node.choices?.slice(0, 2).map((choice) => {
        const rank = points[`${node.section}:${choice.id}`] ?? 0;

        return (
          <button
            className={rank > 0 ? "selected" : ""}
            key={choice.id}
            type="button"
            onClick={(event) => onChoose(event, choice)}
            onMouseEnter={() => onHover(choice)}
            onPointerCancel={onPointerCancel}
            onPointerDown={(event) => onPointerDown(event, choice)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onTouchEnd={onTouchEnd}
          >
            <span className="choice-popover-icon">
              <span
                className={`coa-builder-icon ${iconClassName(choice.iconPath)}`}
              />
            </span>
            <span>{choice.name}</span>
            <b>
              {rank}/{choice.maxPoints}
            </b>
          </button>
        );
      })}
      {currentRank > 0 ? (
        <button
          className="choice-popover-clear bg-white/20!"
          type="button"
          onClick={onDeselect}
        >
          <span
            aria-hidden="true"
            className="flex items-center justify-center text-lg"
          >
            x
          </span>
          <span>Deselect</span>
          {/* <b>0/{getNodeMaxPoints(node)}</b> */}
        </button>
      ) : null}
    </div>
  );
}

function TalentTooltip({
  node,
  points,
  canvasSize,
  scrollPosition,
  stageOffsetTop,
  viewport,
  previewChoiceId,
  missingRequirements,
}: {
  node: TreeNode;
  points: Record<string, number>;
  canvasSize: { width: number; height: number };
  scrollPosition: { x: number; y: number };
  stageOffsetTop: number;
  viewport: { width: number; height: number };
  previewChoiceId: number | null;
  missingRequirements: string[];
}) {
  const previewChoice =
    previewChoiceId === null
      ? undefined
      : node.choices?.find((choice) => choice.id === previewChoiceId);
  const displayEntry = previewChoice ?? getDisplayEntry(node, points);
  const isPassive = isPassiveNode(node);
  const maxPoints = getNodeMaxPoints(node);
  const current = isPassive
    ? missingRequirements.length > 0
      ? 0
      : maxPoints
    : getNodeRank(node, points);
  const isCompact =
    viewport.width > 0 && viewport.width <= MOBILE_TOOLTIP_BREAKPOINT;
  const tooltipWidth = Math.min(
    TOOLTIP_WIDTH,
    Math.max(280, canvasSize.width - 16),
  );
  const tooltipHeight = Math.min(
    TOOLTIP_HEIGHT,
    Math.max(240, viewport.height - 24),
  );
  const preferredLeft = isCompact
    ? node.left + NODE_SIZE / 2 - tooltipWidth / 2
    : node.left > canvasSize.width - tooltipWidth - 40
      ? node.left - tooltipWidth - 14
      : node.left + NODE_SIZE + 14;
  const visibleTop = Math.max(0, scrollPosition.y - stageOffsetTop);
  const visibleBottom =
    viewport.height > 0 ? visibleTop + viewport.height : canvasSize.height;
  const preferredTop = isCompact ? node.top + NODE_SIZE + 10 : node.top - 18;
  const left = Math.min(
    Math.max(preferredLeft, 8),
    Math.max(8, canvasSize.width - tooltipWidth - 8),
  );
  const top = Math.min(
    Math.max(preferredTop, visibleTop + 8, 54),
    Math.max(
      54,
      Math.min(
        canvasSize.height - tooltipHeight - 8,
        visibleBottom - tooltipHeight - 8,
      ),
    ),
  );

  return (
    <aside
      className="talent-tooltip backdrop-blur-sm"
      style={{ left, top, width: tooltipWidth, maxHeight: tooltipHeight }}
      role="tooltip"
      aria-label={`${displayEntry.name} tooltip`}
    >
      <div className="tooltip-title">
        <span
          className={`tooltip-icon ${
            node.choices?.length
              ? "choice"
              : displayEntry.nodeType.includes("Square")
                ? "square"
                : ""
          }`}
        >
          <span
            className={`coa-builder-icon ${iconClassName(displayEntry.iconPath)}`}
          />
        </span>
        <div>
          <h2>{displayEntry.name}</h2>
          <p>
            {displayEntry.entryType} / Rank {current}/{maxPoints}
          </p>
        </div>
      </div>

      <div
        className="tooltip-description"
        dangerouslySetInnerHTML={{ __html: displayEntry.description }}
      />

      {node.choices?.length ? (
        <div className="tooltip-choices">
          {node.choices.map((choice) => (
            <div
              className={choice.id === displayEntry.id ? "selected-choice" : ""}
              key={choice.id}
            >
              <span
                className={`coa-builder-icon ${iconClassName(choice.iconPath)}`}
              />
              <strong>{choice.name}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {missingRequirements.length > 0 ? (
        <div className="tooltip-requirements">
          {missingRequirements.map((requirement) => (
            <span key={requirement}>{requirement}</span>
          ))}
        </div>
      ) : null}

      {displayEntry.rankDescriptions.length > 1 ? (
        <div className="tooltip-ranks">
          {displayEntry.rankDescriptions.map((rank) => (
            <div key={`${displayEntry.id}:${rank.rank}`}>
              <strong>Rank {rank.rank}</strong>
              <span dangerouslySetInnerHTML={{ __html: rank.description }} />
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function BuilderLoadingState({
  iconStatus,
  setting,
}: {
  iconStatus: "loading" | "ready" | "failed";
  setting: BuilderClassSetting;
}) {
  return (
    <main
      className="builder-shell builder-loading-shell relative flex w-full"
      style={classThemeStyle(setting)}
    >
      <div className="builder-loading-panel" role="status" aria-live="polite">
        <span className="builder-loading-mark" aria-hidden="true" />
        <strong>Loading builder</strong>
        <span>
          {iconStatus === "failed"
            ? "Retrying the icon atlas"
            : "Preparing talents and icons"}
        </span>
      </div>
    </main>
  );
}

function ClassIcon({
  data,
  builderClass,
  size,
}: {
  data: BuilderViewModel;
  builderClass: BuilderClass;
  size?: "large";
}) {
  return (
    <span className={`class-icon ${size === "large" ? "large" : ""}`}>
      <span
        className={`coa-builder-icon ${getClassIconClass(data, builderClass)}`}
      />
    </span>
  );
}

function ClassPicker({
  data,
  selectedClassId,
  onClose,
  onChoose,
}: {
  data: BuilderViewModel;
  selectedClassId: number | null;
  onClose: () => void;
  onChoose: (builderClass: BuilderClass) => void;
}) {
  return (
    <div
      className="modal-backdrop backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        aria-label="Select CoA Class"
        aria-modal="true"
        className="md:px-12 max-md:zoom-[.75]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        style={{
          width: "100%",
        }}
      >
        <div className="modal-heading ">
          <h2
            className="text-2xl w-full text-center text-wow-shadow font-bold tracking-wide text-amber-400!"
            style={{
              fontFamily: "var(--font-pivotal)",
            }}
          >
            Select a CoA class to start
          </h2>
          <button
            aria-label="Close class picker"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="flex flex-wrap justify-center">
          {data.talents.classes
            .sort((a, b) => a.className.localeCompare(b.className))
            .map((builderClass) => (
              <button
                // className={
                //   builderClass.classId === selectedClassId ? "selected" : ""
                // }
                key={builderClass.classId}
                style={classThemeStyle(getClassSetting(data, builderClass))}
                type="button"
                onClick={() => onChoose(builderClass)}
                className={`flex flex-col items-center gap-2 min-h-12 p-2 w-[110px] `}
              >
                <div
                  className={`class-icon h-20! w-20! border-4! outline-none! hover:scale-105! transition-all duration-300! hover:opacity-100 opacity-70 cursor-pointer ${builderClass.classId === selectedClassId ? "border-[var(--class-color)]! scale-110! transition-all duration-300!  opacity-100" : "border-[var(--class-color)]/50!"} `}
                  style={{
                    boxShadow: "0 0 10px rgba(255, 255, 255, 0.2)",
                  }}
                >
                  <span
                    className={`coa-builder-icon ${getClassIconClass(data, builderClass)}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "none !important",
                    }}
                  />
                </div>
                <span
                  className="text-sm text-wow-shadow"
                  style={{
                    color: "var(--class-color)",
                    fontFamily: "var(--font-pivotal)",
                    fontSize: "0.9rem",
                    fontWeight: "500",
                    letterSpacing: "0.06em",
                  }}
                >
                  {builderClass.className}
                </span>
              </button>
            ))}
        </div>
        <div className="class-grid !hidden">
          {/* classes by alphabetical order */}
          {data.talents.classes
            .sort((a, b) => a.className.localeCompare(b.className))
            .map((builderClass) => (
              <button
                className={
                  builderClass.classId === selectedClassId ? "selected" : ""
                }
                key={builderClass.classId}
                style={classThemeStyle(getClassSetting(data, builderClass))}
                type="button"
                onClick={() => onChoose(builderClass)}
              >
                <ClassIcon data={data} builderClass={builderClass} />
                <span>{builderClass.className}</span>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
