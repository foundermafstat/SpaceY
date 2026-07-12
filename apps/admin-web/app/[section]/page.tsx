import { notFound, redirect } from "next/navigation";
import { AdminShell } from "../components/admin-shell";
import { ContentRevisionForm, EconomyAdjustmentForm } from "../components/admin-mutation-forms";
import { ContentReleaseConsole } from "../components/content-release-console";
import { navigationForPermissions } from "../../lib/navigation";
import { getContentReleaseHistory, getContentReleases, getCurrentAdminSession } from "../../lib/private-admin-client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function PermissionNotice({ permission }: Readonly<{ permission: string }>) {
  return <p className="notice">This session is read-only for this module. Required permission: <code>{permission}</code>.</p>;
}

export default async function AdminSection({ params, searchParams }: Readonly<{
  params: Promise<{ section: string }>;
  searchParams: Promise<{ history?: string }>;
}>) {
  const [session, route, query] = await Promise.all([getCurrentAdminSession(), params, searchParams]);
  if (!session) redirect("/");

  const item = navigationForPermissions(session.permissions).find((candidate) => candidate.href === `/${route.section}`);
  if (!item) notFound();

  const granted = new Set(session.permissions);
  let content;
  if (route.section === "content") {
    const historyId = query.history && UUID_PATTERN.test(query.history) ? query.history : null;
    const [releases, history] = await Promise.all([
      getContentReleases(),
      historyId ? getContentReleaseHistory(historyId) : Promise.resolve(null),
    ]);
    content = (
      <>
        <ContentReleaseConsole
          releases={releases}
          canWrite={granted.has("content:write")}
          selectedHistory={historyId && history ? { releaseId: historyId, entries: history } : null}
        />
        {granted.has("content:write") ? (
          <details className="definition-editor">
            <summary>Advanced definition editor</summary>
            <ContentRevisionForm />
          </details>
        ) : <PermissionNotice permission="content:write" />}
      </>
    );
  } else if (route.section === "economy") {
    content = granted.has("economy:adjust")
      ? <EconomyAdjustmentForm />
      : <PermissionNotice permission="economy:adjust" />;
  } else {
    content = (
      <p className="notice">
        This permission-backed destination has no operation in the current private API specification.
      </p>
    );
  }

  return (
    <AdminShell session={session} eyebrow="AUTHORIZED MODULE" title={item.label}>
      {content}
    </AdminShell>
  );
}
