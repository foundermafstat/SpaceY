import Link from "next/link";
import type { ReactNode } from "react";
import { navigationForPermissions } from "../../lib/navigation";
import type { AdminSession } from "../../lib/private-admin-client";
import { AdminLogoutButton } from "./admin-logout-button";

export function AdminShell({
  session,
  title,
  eyebrow,
  children,
}: Readonly<{
  session: AdminSession;
  title: string;
  eyebrow: string;
  children: ReactNode;
}>) {
  const navigation = navigationForPermissions(session.permissions);
  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">SPACEY</p>
          <Link className="brand-link" href="/">Control</Link>
        </div>
        <nav aria-label="Administration">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="operator">
          <p>{session.role}<br /><span>{session.authenticationMethod}</span></p>
          <AdminLogoutButton />
        </div>
      </aside>
      <section className="workspace">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="workspace-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}
