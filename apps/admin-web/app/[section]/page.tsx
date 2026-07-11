import { notFound, redirect } from "next/navigation";
import { AdminShell } from "../components/admin-shell";
import { ContentRevisionForm, EconomyAdjustmentForm } from "../components/admin-mutation-forms";
import { navigationForPermissions } from "../../lib/navigation";
import { getCurrentAdminSession } from "../../lib/private-admin-client";

function PermissionNotice({ permission }: Readonly<{ permission: string }>) {
  return <p className="notice">This session is read-only for this module. Required permission: <code>{permission}</code>.</p>;
}

export default async function AdminSection({ params }: Readonly<{ params: Promise<{ section: string }> }>) {
  const [session, route] = await Promise.all([getCurrentAdminSession(), params]);
  if (!session) redirect("/");

  const item = navigationForPermissions(session.permissions).find((candidate) => candidate.href === `/${route.section}`);
  if (!item) notFound();

  const granted = new Set(session.permissions);
  let content;
  if (route.section === "content") {
    content = granted.has("content:write") ? (
      <>
        <ContentRevisionForm />
        <aside className="gap-note">
          <strong>Rollback is not exposed yet.</strong>
          <span>The current private API has no rollback or revision-read endpoint, so the UI does not emulate it with an unsafe mutation.</span>
        </aside>
      </>
    ) : <PermissionNotice permission="content:write" />;
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
