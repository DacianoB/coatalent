import fs from "node:fs/promises";
import path from "node:path";

const DATA_FILE = path.join(process.cwd(), "data", "ascension-coa-voljin.json");
const CLASS_SETTINGS_FILE = path.join(
  process.cwd(),
  "data",
  "coa-builder-class-settings.json",
);

export type TalentRankDescription = {
  rank: number;
  spellId: number;
  description: string;
};

export type TalentEntry = {
  x: number;
  y: number;
  id: number;
  name: string;
  flags: number;
  group: number;
  tabId: number;
  aeCost: number;
  teCost: number;
  classId: number;
  spellId: number;
  iconPath: string;
  nodeType: string;
  reqTabAE: number;
  reqTabTE: number;
  spellIds: number[];
  entryType: "Ability" | "Talent" | string;
  isPassive: number;
  maxPoints: number;
  sortOrder: number;
  description: string;
  requiredIds: number[];
  requiredLevel: number;
  isStartingNode: number;
  connectedNodeIds: number[];
  rankDescriptions: TalentRankDescription[];
};

export type BuilderTab = {
  tabId: number;
  tabName: string;
  sortOrder: number;
};

export type BuilderClass = {
  classId: number;
  className: string;
  tabs: BuilderTab[];
};

export type BuilderClassSetting = {
  classId: number;
  className: string;
  classFile: string;
  iconClass: string;
  color: string;
  rgb: string;
  colorHex: string;
  textColor: string;
  treeTexture: string;
};

export type BuilderClassSettingsData = {
  sourceJsUrl: string;
  scrapedAt: string;
  settings: BuilderClassSetting[];
};

export type BuilderData = {
  sourceUrl: string;
  scrapedAt: string;
  realm: {
    id: number;
    slug: string;
    name: string;
    maxLevel: number;
    schemaVersion: {
      talents: number;
    };
  };
  talents: {
    meta: Record<string, string>;
    classes: BuilderClass[];
    entriesByTab: Record<string, TalentEntry[]>;
  };
};

export type FlatTalentEntry = TalentEntry & {
  tabKey: string;
  tabName: string;
  className: string;
  plainDescription: string;
};

export type BuilderViewModel = BuilderData & {
  classSettings: Record<number, BuilderClassSetting>;
  flatEntries: FlatTalentEntry[];
  stats: {
    classes: number;
    tabs: number;
    entries: number;
    abilities: number;
    talents: number;
    passives: number;
  };
};

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function readBuilderData(): Promise<BuilderData> {
  const file = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(file) as BuilderData;
}

export async function readClassSettings(): Promise<BuilderClassSettingsData> {
  const file = await fs.readFile(CLASS_SETTINGS_FILE, "utf8");
  return JSON.parse(file) as BuilderClassSettingsData;
}

export async function getBuilderViewModel(): Promise<BuilderViewModel> {
  const [data, classSettingsData] = await Promise.all([
    readBuilderData(),
    readClassSettings(),
  ]);
  const classSettings = Object.fromEntries(
    classSettingsData.settings.map((setting) => [setting.classId, setting]),
  );
  const classMap = new Map(
    data.talents.classes.map((builderClass) => [
      builderClass.classId,
      builderClass,
    ]),
  );

  const flatEntries = Object.entries(data.talents.entriesByTab).flatMap(
    ([tabKey, entries]) =>
      entries.map((entry) => {
        const builderClass = classMap.get(entry.classId);
        const tab = builderClass?.tabs.find(
          (classTab) => classTab.tabId === entry.tabId,
        );

        return {
          ...entry,
          tabKey,
          className: builderClass?.className ?? `Class ${entry.classId}`,
          tabName: tab?.tabName ?? `Tab ${entry.tabId}`,
          plainDescription: stripHtml(entry.description),
        };
      }),
  );

  const uniqueTabCount = Object.keys(data.talents.entriesByTab).length;

  return {
    ...data,
    classSettings,
    flatEntries,
    stats: {
      classes: data.talents.classes.length,
      tabs: uniqueTabCount,
      entries: flatEntries.length,
      abilities: flatEntries.filter((entry) => entry.entryType === "Ability")
        .length,
      talents: flatEntries.filter((entry) => entry.entryType === "Talent")
        .length,
      passives: flatEntries.filter((entry) => entry.isPassive === 1).length,
    },
  };
}
