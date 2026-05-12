import BuilderTalentTree from "@/components/BuilderTalentTree";
import { getBuilderViewModel } from "@/lib/builder-data";

export default async function Home() {
  const builderData = await getBuilderViewModel();

  return <BuilderTalentTree data={builderData} />;
}
