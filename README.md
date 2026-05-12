# Ascension CoA Builder Data

This is a small Next.js app plus a repeatable scraper for the Ascension CoA
builder data.

The app uses Tailwind CSS through `@tailwindcss/postcss`, with Tailwind imported
from `app/globals.css`. The custom tree layout still lives in regular CSS where
precise sprite and canvas positioning is easier to maintain.

## Run The App

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## Share A Build

The builder keeps the current class, spec, and selected talent ranks in the URL
query string while you edit:

```text
?class=witch-doctor&spec=brewing&talents=c4005.1,s30823.1
```

Talent codes use `c` for class-tree nodes and `s` for spec-tree nodes, followed
by the node id and rank. You can share the current browser URL to reopen the
same build state.

## Refresh The JSON

The app reads `data/ascension-coa-voljin.json` on the server for each request.
When Ascension updates the talent calculator, refresh the data and icon assets:

```powershell
npm run scrape:data
```

For a custom source URL or output file:

```powershell
node scripts/scrape-ascension-coa-builder.mjs "https://ascension.gg/en/v2/coa-builder/voljin" "data/ascension-coa-voljin.json"
```

## Use The Data

- Raw JSON file: `data/ascension-coa-voljin.json`
- Class colors/settings: `data/coa-builder-class-settings.json`
- Icon sprite metadata: `data/coa-builder-icons.json`
- Local icon sprite: `public/icon/coa-builder-icon.webp`
- Bundled icon sprite CSS: `app/coa-builder-icon.css`
- Local API endpoint while the app runs: `http://localhost:3000/api/builder-data`

Ascension stores talent/spec icons as a CSS sprite. The scraper downloads
`https://ascension.gg/icon/coa-builder-icon.webp`, finds the generated
`.coa-builder-icon.<name>` CSS rules from the page assets, writes them locally,
and adds alias classes for scraped `iconPath` names whose punctuation differs
from the generated CSS.

Ascension also stores class color settings in the builder JavaScript as a
`classId` map. The scraper extracts that into `coa-builder-class-settings.json`
with `classFile`, `iconClass`, `color`, `rgb`, readable `textColor`, and the
matching tree texture path.

The JSON keeps Ascension's builder schema mostly intact:

```ts
{
  sourceUrl: string;
  scrapedAt: string;
  realm: {
    id: number;
    slug: string;
    name: string;
    maxLevel: number;
  };
  talents: {
    meta: object;
    classes: BuilderClass[];
    entriesByTab: Record<"classId:tabId", TalentEntry[]>;
  };
}
```
