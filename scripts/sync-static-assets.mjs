import fs from "node:fs/promises";
import path from "node:path";

const ASCENSION_ORIGIN = "https://ascension.gg";
const SETTINGS_FILE = path.join(
  process.cwd(),
  "data",
  "coa-builder-class-settings.json",
);
const PUBLIC_DIR = path.join(process.cwd(), "public");

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadAsset(assetPath) {
  const normalizedPath = assetPath.startsWith("/") ? assetPath : `/${assetPath}`;
  const outputPath = path.join(PUBLIC_DIR, normalizedPath);

  if (await fileExists(outputPath)) {
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const response = await fetch(`${ASCENSION_ORIGIN}${normalizedPath}`);

  if (!response.ok) {
    throw new Error(
      `Failed to download ${normalizedPath}: ${response.status} ${response.statusText}`,
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, body);
  console.log(`Downloaded ${normalizedPath}`);
}

const settingsData = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"));
const texturePaths = [
  ...new Set(
    settingsData.settings
      .map((setting) => setting.treeTexture)
      .filter((assetPath) => typeof assetPath === "string" && assetPath),
  ),
];

for (const texturePath of texturePaths) {
  await downloadAsset(texturePath);
}
