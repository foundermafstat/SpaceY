import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DevelopmentUiKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { UiCatalog } = await import("@/components/dev/UiCatalog");
  return <UiCatalog />;
}
