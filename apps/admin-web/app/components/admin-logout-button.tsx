"use client";

import { useState } from "react";
import { revokeCurrentAdminSession } from "../../lib/admin-browser-api";

export function AdminLogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      await revokeCurrentAdminSession();
      window.location.assign("/");
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "Sign out failed.");
    }
  }

  return (
    <div className="logout-control">
      <button type="button" onClick={logout} disabled={pending}>
        {pending ? "Revoking…" : "Sign out"}
      </button>
      <span role="alert">{error ?? ""}</span>
    </div>
  );
}
