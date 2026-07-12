import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DevelopmentUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { UiSandbox } = await import("@/components/dev/UiSandbox");
  return <UiSandbox />;
}
