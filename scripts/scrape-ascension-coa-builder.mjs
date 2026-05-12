import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const DEFAULT_URL = "https://ascension.gg/en/v2/coa-builder/voljin";
const DEFAULT_OUTPUT = "data/ascension-coa-voljin.json";
const ICON_SPRITE_URL = "https://ascension.gg/icon/coa-builder-icon.webp";
const ICON_CSS_OUTPUT = "app/coa-builder-icon.css";
const ICON_SPRITE_OUTPUT = "public/icon/coa-builder-icon.webp";
const ICON_METADATA_OUTPUT = "data/coa-builder-icons.json";
const CLASS_SETTINGS_OUTPUT = "data/coa-builder-class-settings.json";

const sourceUrl = process.argv[2] ?? DEFAULT_URL;
const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSlug(url) {
  const pathname = new URL(url).pathname;
  return pathname.split("/").filter(Boolean).at(-1);
}

function getCssUrls(html) {
  return [...html.matchAll(/href="([^"]+\.css)"/g)].map((match) =>
    new URL(match[1], sourceUrl).href,
  );
}

function getJsUrls(html) {
  return [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) =>
    new URL(match[1], sourceUrl).href,
  );
}

function iconClassName(iconPath = "") {
  const raw = iconPath.split("\\").at(-1)?.split("/").at(-1) ?? "";
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

function extractBalancedJson(text, start, open = "{", close = "}") {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  throw new Error("Could not find the end of the embedded JSON payload.");
}

function readReactFlightStream(html) {
  const sandbox = {
    self: {
      __next_f: [],
    },
  };

  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (!script.includes("__next_f")) {
      continue;
    }

    vm.runInNewContext(script, sandbox, { timeout: 1000 });
  }

  return sandbox.self.__next_f
    .map((chunk) => (typeof chunk[1] === "string" ? chunk[1] : ""))
    .join("");
}

function extractFlightTextReferences(flight) {
  const references = {};
  const recordPattern = /([0-9a-f]+):T([0-9a-f]+),/g;
  let match;

  while ((match = recordPattern.exec(flight))) {
    const [, id, hexLength] = match;
    const textStart = recordPattern.lastIndex;
    const textLength = Number.parseInt(hexLength, 16);

    references[id] = flight.slice(textStart, textStart + textLength);
    recordPattern.lastIndex = textStart + textLength;
  }

  return references;
}

function resolveFlightReferences(value, references) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveFlightReferences(item, references));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveFlightReferences(item, references),
      ]),
    );
  }

  if (typeof value === "string") {
    const match = /^\$([0-9a-f]+)$/i.exec(value);

    if (match && references[match[1]]) {
      return references[match[1]];
    }
  }

  return value;
}

function countUnresolvedFlightReferences(value) {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + countUnresolvedFlightReferences(item),
      0,
    );
  }

  if (value && typeof value === "object") {
    return Object.values(value).reduce(
      (total, item) => total + countUnresolvedFlightReferences(item),
      0,
    );
  }

  return typeof value === "string" && /^\$[0-9a-f]+$/i.test(value) ? 1 : 0;
}

function extractBuilderData(flight, slug) {
  const slugPattern = escapeRegex(slug);
  const marker = new RegExp(
    String.raw`\{"value":\[\{"id":\d+,"slug":"${slugPattern}"`,
  );
  const match = marker.exec(flight);

  if (!match) {
    throw new Error(`Could not find builder payload for slug "${slug}".`);
  }

  const payload = JSON.parse(extractBalancedJson(flight, match.index));
  const realm = payload.value?.[0];

  if (!realm?.talents?.classes || !realm?.talents?.entriesByTab) {
    throw new Error("Found a payload, but it does not look like builder data.");
  }

  return {
    sourceUrl,
    scrapedAt: new Date().toISOString(),
    realm: {
      id: realm.id,
      slug: realm.slug,
      name: realm.name,
      maxLevel: realm.max_level,
      schemaVersion: realm.schema_version,
    },
    talents: realm.talents,
  };
}

function rgbToHex(rgb) {
  const parts = rgb.match(/\d+/g)?.map(Number) ?? [];

  if (parts.length < 3) {
    return "#ffd624";
  }

  return `#${parts
    .slice(0, 3)
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

function getReadableTextColor(rgb) {
  const [red = 0, green = 0, blue = 0] = rgb.match(/\d+/g)?.map(Number) ?? [];
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.58 ? "#111111" : "#ffffff";
}

async function extractClassThemeMap(jsUrls) {
  for (const jsUrl of jsUrls) {
    const response = await fetch(jsUrl);

    if (!response.ok) {
      continue;
    }

    const text = await response.text();
    const marker = "let Y=";
    const start = text.indexOf(marker);

    if (start < 0 || !text.slice(start, start + 4000).includes("classFile")) {
      continue;
    }

    const objectStart = text.indexOf("{", start);
    const objectText = extractBalancedJson(text, objectStart);

    return {
      sourceJsUrl: jsUrl,
      themes: vm.runInNewContext(`(${objectText})`, {}, { timeout: 1000 }),
    };
  }

  throw new Error("Could not find Ascension's CoA class settings map.");
}

async function scrapeClassSettings(html, data) {
  const { sourceJsUrl, themes } = await extractClassThemeMap(getJsUrls(html));
  const settings = data.talents.classes
    .map((builderClass) => {
      const theme = themes[builderClass.classId] ?? {
        classFile: "hero",
        color: "rgb(255, 214, 36)",
        rgb: "255, 214, 36",
      };
      const colorHex = rgbToHex(theme.rgb);

      return {
        classId: builderClass.classId,
        className: builderClass.className,
        classFile: theme.classFile,
        iconClass: `class-${theme.classFile}`,
        color: theme.color,
        rgb: theme.rgb,
        colorHex,
        textColor: getReadableTextColor(theme.rgb),
        treeTexture: `/textures/coa/trees/${theme.classFile}.webp`,
      };
    })
    .sort((first, second) => first.classId - second.classId);

  const resolvedOutput = path.resolve(CLASS_SETTINGS_OUTPUT);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(
    resolvedOutput,
    `${JSON.stringify(
      {
        sourceJsUrl,
        scrapedAt: new Date().toISOString(),
        settings,
      },
      null,
      2,
    )}\n`,
  );

  return {
    path: resolvedOutput,
    count: settings.length,
  };
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not download ${url}: ${response.status}`);
  }

  const resolvedOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, Buffer.from(await response.arrayBuffer()));

  return resolvedOutput;
}

async function findIconCss(cssUrls) {
  for (const cssUrl of cssUrls) {
    const response = await fetch(cssUrl);

    if (!response.ok) {
      continue;
    }

    const css = await response.text();

    if (css.includes(".coa-builder-icon")) {
      return {
        cssUrl,
        css,
      };
    }
  }

  throw new Error("Could not find Ascension's CoA builder icon CSS.");
}

function extractIconCss(css) {
  return [...css.matchAll(/\.coa-builder-icon(?:\.[^{]+)?\{[^}]+\}/g)]
    .map((match) => {
      const rule = match[0];
      const selector = rule.slice(0, rule.indexOf("{"));
      const body = rule.slice(rule.indexOf("{"));
      const builderSelector = selector.replace(".coa-builder-icon", ".builder-icon");

      return `${selector},${builderSelector}${body}`;
    })
    .join("\n")
    .replace(
      /background:url\([^)]*coa-builder-icon\.webp\)/,
      "background:url(/icon/coa-builder-icon.webp)",
    );
}

function extractIconMapping(iconCss) {
  const icons = {};
  const rulePattern =
    /\.coa-builder-icon\.([^,{]+)(?:,[^{]+)?\{background-position:([^;]+);background-size:([^;}]+)[^}]*\}/g;

  for (const [, className, backgroundPosition, backgroundSize] of iconCss.matchAll(
    rulePattern,
  )) {
    icons[className] = {
      className,
      backgroundPosition,
      backgroundSize,
    };
  }

  return icons;
}

function canonicalIconName(iconClass) {
  return iconClass
    .replace(/^_+/, "")
    .replace(/_/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findIconAliases(data, iconMapping) {
  const keysByCanonicalName = new Map();

  for (const iconClass of Object.keys(iconMapping)) {
    const canonicalName = canonicalIconName(iconClass);

    if (!keysByCanonicalName.has(canonicalName)) {
      keysByCanonicalName.set(canonicalName, iconClass);
    }
  }

  const aliases = {};

  for (const entries of Object.values(data.talents.entriesByTab)) {
    for (const entry of entries) {
      const normalizedClass = iconClassName(entry.iconPath);

      if (!normalizedClass || iconMapping[normalizedClass]) {
        continue;
      }

      const sourceClass = keysByCanonicalName.get(
        canonicalIconName(normalizedClass),
      );

      if (sourceClass) {
        aliases[normalizedClass] = {
          ...iconMapping[sourceClass],
          className: normalizedClass,
          aliasOf: sourceClass,
        };
      }
    }
  }

  return aliases;
}

function makeAliasCss(aliases) {
  return Object.values(aliases)
    .map(
      (alias) =>
        `.coa-builder-icon.${alias.className},.builder-icon.${alias.className}{background-position:${alias.backgroundPosition};background-size:${alias.backgroundSize}}`,
    )
    .join("\n");
}

function summarizeUsedIcons(data, iconMapping) {
  const used = new Map();
  const specIcons = [];

  for (const builderClass of data.talents.classes) {
    for (const tab of builderClass.tabs) {
      const entries =
        data.talents.entriesByTab[`${builderClass.classId}:${tab.tabId}`] ?? [];
      const representative =
        entries.find((entry) => entry.entryType === "Ability" && entry.iconPath) ??
        entries.find((entry) => entry.iconPath);

      if (representative) {
        specIcons.push({
          classId: builderClass.classId,
          className: builderClass.className,
          tabId: tab.tabId,
          tabName: tab.tabName,
          iconPath: representative.iconPath,
          iconClass: iconClassName(representative.iconPath),
        });
      }

      for (const entry of entries) {
        const iconClass = iconClassName(entry.iconPath);

        if (!iconClass) {
          continue;
        }

        const existing =
          used.get(iconClass) ??
          {
            iconClass,
            iconPath: entry.iconPath,
            inSprite: Boolean(iconMapping[iconClass]),
            entries: [],
          };

        existing.entries.push({
          id: entry.id,
          name: entry.name,
          classId: entry.classId,
          className: builderClass.className,
          tabId: entry.tabId,
          tabName: tab.tabName,
        });
        used.set(iconClass, existing);
      }
    }
  }

  return {
    usedIcons: [...used.values()].sort((first, second) =>
      first.iconClass.localeCompare(second.iconClass),
    ),
    specIcons,
  };
}

async function scrapeIconAssets(html, data) {
  const { cssUrl, css } = await findIconCss(getCssUrls(html));
  const baseIconCss = extractIconCss(css);
  const baseIconMapping = extractIconMapping(baseIconCss);
  const iconAliases = findIconAliases(data, baseIconMapping);
  const aliasCss = makeAliasCss(iconAliases);
  const iconCss = aliasCss ? `${baseIconCss}\n${aliasCss}` : baseIconCss;
  const iconMapping = {
    ...baseIconMapping,
    ...iconAliases,
  };
  const resolvedCssOutput = path.resolve(ICON_CSS_OUTPUT);
  const resolvedMetadataOutput = path.resolve(ICON_METADATA_OUTPUT);
  const resolvedSpriteOutput = await downloadFile(
    ICON_SPRITE_URL,
    ICON_SPRITE_OUTPUT,
  );
  const { usedIcons, specIcons } = summarizeUsedIcons(data, iconMapping);

  await fs.mkdir(path.dirname(resolvedCssOutput), { recursive: true });
  await fs.writeFile(resolvedCssOutput, `${iconCss}\n`);
  await fs.mkdir(path.dirname(resolvedMetadataOutput), { recursive: true });
  await fs.writeFile(
    resolvedMetadataOutput,
    `${JSON.stringify(
      {
        sourceCssUrl: cssUrl,
        sourceSpriteUrl: ICON_SPRITE_URL,
        scrapedAt: new Date().toISOString(),
        cssPath: ICON_CSS_OUTPUT.replaceAll("\\", "/"),
        spritePath: ICON_SPRITE_OUTPUT.replaceAll("\\", "/"),
        totalSpriteIcons: Object.keys(baseIconMapping).length,
        totalIconAliases: Object.keys(iconAliases).length,
        totalUsedIcons: usedIcons.length,
        totalMissingUsedIcons: usedIcons.filter((icon) => !icon.inSprite).length,
        icons: iconMapping,
        specIcons,
        usedIcons,
      },
      null,
      2,
    )}\n`,
  );

  return {
    cssPath: resolvedCssOutput,
    spritePath: resolvedSpriteOutput,
    metadataPath: resolvedMetadataOutput,
    totalSpriteIcons: Object.keys(baseIconMapping).length,
    totalIconAliases: Object.keys(iconAliases).length,
    totalUsedIcons: usedIcons.length,
    totalMissingUsedIcons: usedIcons.filter((icon) => !icon.inSprite).length,
  };
}

async function main() {
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; personal Ascension CoA builder data export)",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const slug = getSlug(sourceUrl);
  const flight = readReactFlightStream(html);
  const flightReferences = extractFlightTextReferences(flight);
  const data = resolveFlightReferences(
    extractBuilderData(flight, slug),
    flightReferences,
  );
  const unresolvedReferences = countUnresolvedFlightReferences(data);
  const classSettings = await scrapeClassSettings(html, data);
  const iconAssets = await scrapeIconAssets(html, data);
  const resolvedOutput = path.resolve(outputPath);

  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(data, null, 2)}\n`);

  const tabs = Object.keys(data.talents.entriesByTab).length;
  const entries = Object.values(data.talents.entriesByTab).reduce(
    (total, tabEntries) => total + tabEntries.length,
    0,
  );

  console.log(`Wrote ${resolvedOutput}`);
  console.log(
    `Exported ${data.talents.classes.length} classes, ${tabs} tabs, ${entries} entries.`,
  );
  console.log(
    `Resolved ${Object.keys(flightReferences).length} React Flight text records (${unresolvedReferences} unresolved references remain).`,
  );
  console.log(`Wrote ${classSettings.path}`);
  console.log(`Exported ${classSettings.count} class settings.`);
  console.log(`Wrote ${iconAssets.spritePath}`);
  console.log(`Wrote ${iconAssets.cssPath}`);
  console.log(`Wrote ${iconAssets.metadataPath}`);
  console.log(
    `Mapped ${iconAssets.totalSpriteIcons} sprite icons plus ${iconAssets.totalIconAliases} aliases; ${iconAssets.totalUsedIcons} are used by scraped talents/specs (${iconAssets.totalMissingUsedIcons} missing).`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
