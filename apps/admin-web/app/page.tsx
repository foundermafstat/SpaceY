import { AdminLoginForm } from "./components/admin-login-form";
import { AdminShell } from "./components/admin-shell";
import { getAdminSessionState } from "../lib/private-admin-client";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const state = await getAdminSessionState();
  if (state.status !== "authenticated") {
    return (
      <main className="locked-shell">
        <section className="locked-card" aria-labelledby="locked-title">
          <p className="eyebrow">PRIVATE CONTOUR</p>
          <h1 id="locked-title">
            {state.status === "unavailable" ? "Control plane unavailable" : "Strong authentication required"}
          </h1>
          {state.status === "unavailable" ? (
            <p>The private Admin API is unavailable or not configured. Access remains fail-closed.</p>
          ) : (
            <>
              <p>Authenticate with a registered WebAuthn security key to open the control plane.</p>
              <AdminLoginForm />
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <AdminShell session={state.session} eyebrow="OPERATIONS OVERVIEW" title="Production control plane">
      <div className="status-grid">
        <article><span>Access</span><strong>Private ingress</strong></article>
        <article><span>Authentication</span><strong>Verified</strong></article>
        <article><span>Mutation policy</span><strong>Audited transaction</strong></article>
      </div>
    </AdminShell>
  );
}
