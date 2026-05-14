import fs from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "out");
const HTML_DIR = path.join(process.cwd(), "html");
const PRESERVED_HTML_ENTRIES = new Set([
  ".devcontainer",
  ".git",
  ".gitignore",
  "README.md",
  "package.json",
]);

function assertBuildLifecycle() {
  if (
    process.env.npm_lifecycle_event !== "build" &&
    process.env.npm_lifecycle_event !== "build:html"
  ) {
    throw new Error(
      "Refusing to update html/. Run `npm run build` to regenerate the static HTML export.",
    );
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

async function clearHtmlExportDirectory() {
  await fs.mkdir(HTML_DIR, { recursive: true });

  const entries = await fs.readdir(HTML_DIR, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => !PRESERVED_HTML_ENTRIES.has(entry.name))
      .map((entry) =>
        fs.rm(path.join(HTML_DIR, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }

      return entryPath;
    }),
  );

  return files.flat();
}

async function makeCssPublicUrlsFileFriendly() {
  const files = await listFiles(HTML_DIR);
  const cssFiles = files.filter((file) => file.endsWith(".css"));

  for (const cssFile of cssFiles) {
    const css = await fs.readFile(cssFile, "utf8");
    const nextCss = css
      .replaceAll("url(/icon/", "url(../../../icon/")
      .replaceAll("url(/textures/", "url(../../../textures/");

    if (nextCss !== css) {
      await fs.writeFile(cssFile, nextCss);
    }
  }
}

async function makeHtmlPublicUrlsFileFriendly() {
  const files = await listFiles(HTML_DIR);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));

  for (const htmlFile of htmlFiles) {
    const html = await fs.readFile(htmlFile, "utf8");
    const nextHtml = html
      .replaceAll('href="/icon/', 'href="./icon/')
      .replaceAll('\\"/icon/', '\\"./icon/')
      .replaceAll('href="/textures/', 'href="./textures/')
      .replaceAll('\\"/textures/', '\\"./textures/');

    if (nextHtml !== html) {
      await fs.writeFile(htmlFile, nextHtml);
    }
  }
}

assertBuildLifecycle();

if (!(await fileExists(OUT_DIR))) {
  throw new Error("Missing static export folder: out");
}

await clearHtmlExportDirectory();
await copyDirectory(OUT_DIR, HTML_DIR);
await fs.writeFile(path.join(HTML_DIR, ".nojekyll"), "");
await makeCssPublicUrlsFileFriendly();
await makeHtmlPublicUrlsFileFriendly();

console.log("Static HTML export written to html/");
