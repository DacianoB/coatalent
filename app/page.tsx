import { Suspense } from "react";

import BuilderTalentTree from "@/components/BuilderTalentTree";
import { getBuilderViewModel } from "@/lib/builder-data";

export default async function Home() {
  const builderData = await getBuilderViewModel();

  return (
    <Suspense fallback={null}>
      <BuilderTalentTree data={builderData} />
    </Suspense>
  );
}
