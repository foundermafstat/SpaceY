"use client";

type ServerBoundaryStatusProps = {
  status: "starting" | "ready" | "blocked" | "error";
  message: string | null;
  onRetry?: () => void;
};

export function ServerBoundaryStatus({ status, message, onRetry }: ServerBoundaryStatusProps) {
  const title = status === "blocked"
    ? "Telegram Authorization Required"
    : status === "error"
      ? "Server Connection Failed"
      : "Connecting to SpaceY";

  return (
    <main className="app-shell game-shell">
      <section className="mobile-frame game-frame server-boundary-frame" aria-live="polite">
        <div className="server-boundary-card panel">
          <span className="eyebrow">Server-authoritative session</span>
          <h1>{title}</h1>
          <p>{message ?? "Validating the Telegram session and loading your server profile…"}</p>
          {onRetry ? (
            <button className="button primary" onClick={onRetry} type="button">
              Retry
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
