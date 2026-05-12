"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

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

type InitialUrlState = {
  classId: number | null;
  specId: number | null;
  points: Record<string, number>;
  freePick: boolean;
};

const TREE_WIDTH = 1320;
const TREE_HEIGHT = 640;
const NODE_SIZE = 38;
const GRID_LEFT = 64;
const GRID_TOP = 84;
const GRID_X = 58;
const GRID_Y = 58;
const SPEC_OFFSET = 720;
const SPEC_STACK_OFFSET = 560;
const STACK_BREAKPOINT = 1500;
const CANVAS_SAFE_PADDING = 76;
const TREE_POINT_LIMIT = 25;

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
) {
  const classNodes = makeSectionNodes(classEntries, "class", layoutOffsetLeft);
  const specNodes = makeSectionNodes(
    specEntries,
    "spec",
    layoutOffsetLeft + (layout === "wide" ? SPEC_OFFSET : 0),
    layout === "stacked" ? SPEC_STACK_OFFSET : 0,
  );

  return [...classNodes, ...specNodes];
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

function isPassiveNode(node: TreeNode) {
  return (node.choices ?? [node]).some((choice) => choice.isPassive === 1);
}

function getPassiveThreshold(node: TreeNode) {
  return Math.max(
    0,
    ...(node.choices ?? [node]).map((choice) => choice.requiredLevel),
  );
}

function isPassiveUnlocked(
  node: TreeNode,
  spent: { ability: number; talent: number },
) {
  const threshold = getPassiveThreshold(node);
  const distributedLevel = spent.ability + spent.talent + 10;

  return threshold <= distributedLevel;
}

function getVisualRank(
  node: TreeNode,
  points: Record<string, number>,
  spent: { ability: number; talent: number },
) {
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
      if (isPassiveNode(node)) {
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
          totals.ability +
          (node.section === "class" ? pointCost * rank : 0),
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

function getPointCost(
  entry: FlatTalentEntry,
  section: "class" | "spec",
) {
  return section === "class" ? entry.aeCost : entry.teCost;
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
  const isWithinTreeLimit =
    nextSectionSpent <= TREE_POINT_LIMIT ||
    nextSectionSpent <= currentSectionSpent;

  if (!isWithinTreeLimit) {
    return false;
  }

  return freePick || isOrderedDistribution(nextSpent);
}

function isOrderedDistribution(spent: { ability: number; talent: number }) {
  return (
    spent.ability === spent.talent || spent.ability === spent.talent + 1
  );
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
    getSpentInSection(spent, node.section) + pointCost <= TREE_POINT_LIMIT &&
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

  if (getSpentInSection(spent, node.section) >= TREE_POINT_LIMIT) {
    return [`${treeName} is limited to ${TREE_POINT_LIMIT} points`];
  }

  if (!freePick && getNextOrderedSection(spent) !== node.section) {
    const nextTreeName =
      getNextOrderedSection(spent) === "class" ? "Class Tree" : "Spec Tree";

    return [`Next point must be spent in the ${nextTreeName}`];
  }

  return [`${treeName} is limited to ${TREE_POINT_LIMIT} points`];
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
    if (isPassiveNode(node)) {
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
      TREE_POINT_LIMIT - spentBySection[selectable.section];
    const allowedRank = Math.min(
      rank,
      Math.floor(remaining / selectable.pointCost),
    );

    if (allowedRank > 0) {
      limitedPoints[key] = allowedRank;
      spentBySection[selectable.section] +=
        allowedRank * selectable.pointCost;
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
      spentBySection[selectable.section] +=
        allowedRank * selectable.pointCost;
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

  if (isPassiveNode(node)) {
    const threshold = getPassiveThreshold(node);
    const distributedLevel = spent.ability + spent.talent;

    if (threshold > 0 && threshold > distributedLevel) {
      missing.push(
        `automatic passive unlocks at ${threshold} distributed points`,
      );
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
    const left = sectionLefts[node.section] - 60;
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

function encodeTalentCode(points: Record<string, number>) {
  return Object.entries(points)
    .filter(([, rank]) => rank > 0)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([nodeKey, rank]) => {
      const [section, id] = nodeKey.split(":");
      const prefix = section === "class" ? "c" : "s";
      return `${prefix}${id}.${rank}`;
    })
    .join(",");
}

function decodeTalentCode(code: string | null) {
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

  return {
    classId: classFromParams.classId,
    specId: specFromParams?.tabId ?? null,
    points: decodeTalentCode(params?.talents ?? null),
    freePick,
  };
}

function getTreeLayout(viewportWidth: number) {
  if (viewportWidth > 0 && viewportWidth < STACK_BREAKPOINT) {
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

function getTreeContentSize(layout: TreeLayout) {
  return {
    width:
      layout === "stacked"
        ? GRID_LEFT + 10 * GRID_X + NODE_SIZE + CANVAS_SAFE_PADDING
        : GRID_LEFT +
          SPEC_OFFSET +
          10 * GRID_X +
          NODE_SIZE +
          CANVAS_SAFE_PADDING,
    height:
      layout === "stacked" ? TREE_HEIGHT + SPEC_STACK_OFFSET : TREE_HEIGHT,
  };
}

function getCanvasSize(
  nodes: TreeNode[],
  viewport: { width: number; height: number },
  layout: TreeLayout,
) {
  const minStackedWidth = 760;
  const minStackedHeight = TREE_HEIGHT + SPEC_STACK_OFFSET;
  const baseWidth = layout === "stacked" ? minStackedWidth : TREE_WIDTH;
  const baseHeight = layout === "stacked" ? minStackedHeight : TREE_HEIGHT;
  const maxNodeRight = Math.max(
    baseWidth,
    ...nodes.map((node) => node.left + NODE_SIZE + CANVAS_SAFE_PADDING),
  );
  const maxNodeBottom = Math.max(
    baseHeight,
    ...nodes.map((node) => node.top + NODE_SIZE + CANVAS_SAFE_PADDING),
  );
  const shellPadding = viewport.width <= 900 ? 32 : 88;
  const availableWidth = Math.max(0, viewport.width - shellPadding);
  const availableHeight = Math.max(0, viewport.height - 180);
  const contentSize = getTreeContentSize(layout);

  return {
    width: Math.max(contentSize.width, maxNodeRight, availableWidth),
    height: Math.max(contentSize.height, maxNodeBottom, availableHeight),
  };
}

function readInitialUrlState(
  data: BuilderViewModel,
  fallbackClass: BuilderClass,
  fallbackSpec: BuilderTab | undefined,
): InitialUrlState {
  if (typeof window === "undefined") {
    return {
      classId: null,
      specId: null,
      points: {},
      freePick: false,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const classParam = params.get("class");
  const freePick = params.get("freePick") === "1";
  const classFromUrl = data.talents.classes.find((builderClass) =>
    matchesQueryValue(builderClass.className, classParam),
  );

  if (!classFromUrl) {
    return {
      classId: null,
      specId: null,
      points: {},
      freePick,
    };
  }

  const specs = sortedSpecs(classFromUrl);
  const specFromUrl =
    specs.find((spec) => matchesQueryValue(spec.tabName, params.get("spec"))) ??
    (classFromUrl.classId === fallbackClass.classId ? fallbackSpec : specs[0]);

  return {
    classId: classFromUrl.classId,
    specId: specFromUrl?.tabId ?? null,
    points: decodeTalentCode(params.get("talents")),
    freePick,
  };
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
  const longPressTimer = useRef<number | null>(null);
  const hasHydratedUrlState = useRef(false);
  const hasUserSelectedClass = useRef(false);
  const [isUrlStateReady, setIsUrlStateReady] = useState(false);

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
  const treeContentSize = getTreeContentSize(treeLayout);

  useEffect(() => {
    if (hasHydratedUrlState.current) {
      return;
    }

    const initialState = readInitialUrlState(data, defaultClass, defaultSpec);

    hasHydratedUrlState.current = true;
    if (hasUserSelectedClass.current) {
      setIsUrlStateReady(true);
      return;
    }

    setSelectedClassId(initialState.classId);
    setSelectedSpecId(initialState.specId);
    setPoints(initialState.points);
    setIsFreePickEnabled(initialState.freePick);
    setIsUrlStateReady(true);
  }, [data, defaultClass]);

  useEffect(() => {
    function handleResize() {
      setViewport(getViewportSize());
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
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

    const talentCode = encodeTalentCode(points);

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

    const nextQuery = params.toString().replace(/%2C/g, ",");
    const nextUrl = `${window.location.pathname}?${nextQuery}`;
    window.history.replaceState(null, "", nextUrl);
  }, [
    isUrlStateReady,
    selectedClass,
    selectedSpec,
    points,
    isFreePickEnabled,
  ]);

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
    () => makeTreeNodes(classEntries, specEntries, treeLayout, 0),
    [classEntries, specEntries, treeLayout],
  );
  const canvasSize = useMemo(
    () => getCanvasSize(nodes, viewport, treeLayout),
    [nodes, viewport, treeLayout],
  );

  const queryText = query.trim().toLowerCase();
  const connections = useMemo(
    () => makeConnections(nodes, points),
    [nodes, points],
  );
  const thresholdMarkers = useMemo(() => getThresholdMarkers(nodes), [nodes]);
  const hoveredNode = nodes.find((node) => node.nodeKey === hoveredNodeKey);
  const openChoiceNode = nodes.find(
    (node) => node.nodeKey === openChoiceNodeKey,
  );
  const spent = getSpentTotals(nodes, points);

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

    hasUserSelectedClass.current = true;
    setSelectedClassId(builderClass.classId);
    setSelectedSpecId(nextSpecs[0]?.tabId ?? null);
    setPoints({});
    setOpenChoiceNodeKey(null);
    setIsClassPickerOpen(false);
  }

  function chooseSpec(tab: BuilderTab) {
    setSelectedSpecId(tab.tabId);
    setPoints({});
    setOpenChoiceNodeKey(null);
  }

  function spendPoint(node: TreeNode) {
    if (isPassiveNode(node)) {
      return;
    }

    setPoints((current) => {
      const currentSpent = getSpentTotals(nodes, current);
      const isSelected = getNodeRank(node, current) > 0;

      if (
        !isSelected &&
        !canRankNode(node, current, currentSpent, data.realm.maxLevel)
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

        if (!canUsePointState(nextPoints)) {
          return current;
        }
      }

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
  }

  function canUsePointState(nextPoints: Record<string, number>) {
    const nextSpent = getSpentTotals(nodes, nextPoints);

    return (
      (isFreePickEnabled || isOrderedDistribution(nextSpent)) &&
      nodes.every((node) => {
        if (isPassiveNode(node) || getNodeRank(node, nextPoints) === 0) {
          return true;
        }

        return canRankNode(node, nextPoints, nextSpent, data.realm.maxLevel);
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

  function clearLongPress() {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function deselectNode(node: TreeNode) {
    if (isPassiveNode(node)) {
      return;
    }

    setPoints((current) => {
      const nextPoints = removeNodePoints(node, current);

      return canUsePointState(nextPoints) ? nextPoints : current;
    });
    setOpenChoiceNodeKey(null);
    setHoveredChoiceId(null);
  }

  function startLongPress(node: TreeNode) {
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      deselectNode(node);
      longPressTimer.current = null;
    }, 550);
  }

  function toggleChoiceNode(node: TreeNode, canOpen: boolean) {
    if (!canOpen) {
      return;
    }

    setOpenChoiceNodeKey((current) =>
      current === node.nodeKey ? null : node.nodeKey,
    );
    setHoveredNodeKey(node.nodeKey);
    setHoveredChoiceId(getSelectedChoice(node, points)?.id ?? null);
  }

  function chooseTalentOption(node: TreeNode, choice: FlatTalentEntry) {
    const currentSpent = getSpentTotals(nodes, points);

    if (
      getNodeRank(node, points) === 0 &&
      !canRankNode(node, points, currentSpent, data.realm.maxLevel)
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
    setHoveredChoiceId(choice.id);
    setHoveredNodeKey(node.nodeKey);
    setOpenChoiceNodeKey(null);
  }

  return (
    <main
      className="builder-shell relative flex w-full"
      style={classThemeStyle(selectedClassSetting)}
    >
      {" "}
      <div className="h-full w-full pointer-events-none  absolute top-0 left-0 inset-0">
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
        <header className="builder-topbar shadow-lg shadow-black/20">
          <div className="class-identity">
            {selectedClass ? (
              <ClassIcon
                data={data}
                builderClass={selectedClass}
                size="large"
              />
            ) : null}
            <h1>
              {selectedClass
                ? `${selectedClass.className} Lv. ${spent.ability + spent.talent + 9}`
                : "CoA Builder"}
            </h1>
            <button
              className="change-button"
              type="button"
              onClick={() => setIsClassPickerOpen(true)}
            >
              {selectedClass ? "Change" : "Select Class"}
            </button>
          </div>

          <div className="builder-controls">
            <label className="free-pick-toggle">
              <input
                checked={isFreePickEnabled}
                onChange={(event) =>
                  setIsFreePickEnabled(event.target.checked)
                }
                type="checkbox"
              />
              <span>Free pick</span>
            </label>

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
        <nav className="spec-tabs" aria-label="Class specializations">
          {specs.map((spec) => (
            <button
              className={spec.tabId === selectedSpec?.tabId ? "active" : ""}
              key={spec.tabId}
              type="button"
              onClick={() => chooseSpec(spec)}
            >
              <span className="spec-icon">
                <span
                  className={`coa-builder-icon ${iconClassName(
                    selectedClass
                      ? getSpecIcon(data, selectedClass, spec)?.iconPath
                      : undefined,
                  )}`}
                />
              </span>
              <span>{spec.tabName}</span>
            </button>
          ))}
        </nav>
        <section
          className="tree-frame ring-1 ring-white/10"
          aria-label="Talent tree builder"
        >
          {!selectedClass ? (
            <div className="empty-builder">
              <h2>Select a CoA class to start</h2>
              <div className="start-class-grid">
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
          ) : (
            <div className="tree-scroll">
              <div
                className={`tree-canvas ${treeLayout}`}
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
                  <strong>Class Tree</strong>
                  <span>
                    {spent.ability}/{TREE_POINT_LIMIT} Ability Essence
                  </span>
                  <strong>{selectedSpec?.tabName}</strong>
                  <span>
                    {spent.talent}/{TREE_POINT_LIMIT} Talent Essence
                  </span>
                </div>

                {treeLayout === "stacked" ? (
                  <div
                    className="stacked-spec-heading"
                    style={{ top: GRID_TOP + SPEC_STACK_OFFSET - 44 }}
                  >
                    <strong>{selectedSpec?.tabName}</strong>
                    <span>
                      {spent.talent}/{TREE_POINT_LIMIT} Talent Essence
                    </span>
                  </div>
                ) : null}

                <div
                  className="tree-stage"
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
                        points,
                        spent,
                      );
                      const targetRank = getVisualRank(
                        connection.target,
                        points,
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
                    {nodes.map((node) => {
                      const displayEntry = getDisplayEntry(node, points);
                      const isPassive = isPassiveNode(node);
                      const current = getVisualRank(node, points, spent);
                      const maxPoints = getNodeMaxPoints(node);
                      const isSpent = current > 0;
                      const meetsRequirements = canRankNode(
                        node,
                        points,
                        spent,
                        data.realm.maxLevel,
                      );
                      const canUseNode =
                        isSpent ||
                        (meetsRequirements &&
                          canAddRankToNode(
                            node,
                            points,
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
                          onFocus={() => setHoveredNodeKey(node.nodeKey)}
                          onMouseEnter={() => setHoveredNodeKey(node.nodeKey)}
                          onMouseLeave={() => {
                            if (openChoiceNodeKey !== node.nodeKey) {
                              setHoveredNodeKey(null);
                              setHoveredChoiceId(null);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            deselectNode(node);
                          }}
                          onClick={() =>
                            node.choices?.length
                              ? toggleChoiceNode(node, canUseNode)
                              : spendPoint(node)
                          }
                          onPointerCancel={clearLongPress}
                          onPointerDown={(event) => {
                            if (event.pointerType === "touch") {
                              startLongPress(node);
                            }
                          }}
                          onPointerLeave={clearLongPress}
                          onPointerMove={clearLongPress}
                          onPointerUp={clearLongPress}
                          style={{ left: node.left, top: node.top }}
                          type="button"
                        >
                          <TreeNodeIcon node={node} points={points} />
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
                      points={points}
                      onChoose={(choice) =>
                        chooseTalentOption(openChoiceNode, choice)
                      }
                      onHover={(choice) => {
                        setHoveredNodeKey(openChoiceNode.nodeKey);
                        setHoveredChoiceId(choice.id);
                      }}
                      onLeave={() => setHoveredChoiceId(null)}
                    />
                  ) : null}

                  {hoveredNode ? (
                    <TalentTooltip
                      node={hoveredNode}
                      points={points}
                      canvasSize={{
                        width: treeContentSize.width,
                        height: canvasSize.height,
                      }}
                      previewChoiceId={hoveredChoiceId}
                      missingRequirements={getRequirementText(
                        hoveredNode,
                        points,
                        spent,
                        data.realm.maxLevel,
                      ).concat(
                        getPointBlockText(
                          hoveredNode,
                          points,
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
  onChoose,
  onHover,
  onLeave,
}: {
  node: TreeNode;
  points: Record<string, number>;
  onChoose: (choice: FlatTalentEntry) => void;
  onHover: (choice: FlatTalentEntry) => void;
  onLeave: () => void;
}) {
  const left = node.left + NODE_SIZE / 2;
  const top = node.top - 74;

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
            onClick={() => onChoose(choice)}
            onMouseEnter={() => onHover(choice)}
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
    </div>
  );
}

function TalentTooltip({
  node,
  points,
  canvasSize,
  previewChoiceId,
  missingRequirements,
}: {
  node: TreeNode;
  points: Record<string, number>;
  canvasSize: { width: number; height: number };
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
  const isRightSide = node.left > canvasSize.width - 390;
  const left = isRightSide ? node.left - 350 : node.left + NODE_SIZE + 14;
  const top = Math.min(Math.max(node.top - 18, 54), canvasSize.height - 330);

  return (
    <aside
      className="talent-tooltip backdrop-blur-sm"
      style={{ left, top }}
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
        className="class-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-heading">
          <h2>Select CoA Class</h2>
          <button
            aria-label="Close class picker"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="class-grid">
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
