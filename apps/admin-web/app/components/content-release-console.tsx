"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import {
  type AdminContentRelease,
  type ContentReleaseActionResult,
  cloneContentRelease,
  publishContentRelease,
  rollbackContentRelease,
  validateContentRelease,
} from "../../lib/admin-browser-api";
import type { ContentHistoryEntry } from "../../lib/private-admin-client";

type ActionKind = "clone" | "publish" | "rollback";
const HISTORY_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function actionFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

function ReleaseActionForm({ release, action }: Readonly<{ release: AdminContentRelease; action: ActionKind }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContentReleaseActionResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const reason = String(values.get("reason") ?? "");
      const version = String(values.get("version") ?? "");
      const response = action === "publish"
        ? await publishContentRelease(release.id, { reason })
        : action === "clone"
          ? await cloneContentRelease(release.id, { version, reason })
          : await rollbackContentRelease(release.id, { version, reason });
      setResult(response);
      event.currentTarget.reset();
      router.refresh();
    } catch (cause) {
      setError(actionFailure(cause));
    } finally {
      setPending(false);
    }
  }

  const label = action === "publish" ? "Publish draft" : action === "clone" ? "Clone to draft" : "Rollback as new draft";
  return (
    <form className="release-action" onSubmit={submit}>
      {action !== "publish" ? (
        <label>
          New version
          <input name="version" required minLength={3} maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" disabled={pending} />
        </label>
      ) : null}
      <label>
        Reason
        <input name="reason" required minLength={1} maxLength={500} disabled={pending} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Committing…" : label}</button>
      <span className="form-error" role="alert">{error ?? ""}</span>
      {result ? <span className="form-success">Committed · {result.correlationId}</span> : null}
    </form>
  );
}

function ReleaseCard({ release, canWrite }: Readonly<{ release: AdminContentRelease; canWrite: boolean }>) {
  const [validation, setValidation] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function validate() {
    setValidation("Validating…");
    setValidationError(null);
    try {
      const result = await validateContentRelease(release.id);
      setValidation(result.valid
        ? `Valid · ${result.configHash.slice(0, 12)} · simulation ${result.simulationVersion}`
        : `${result.violations.length} violation(s): ${result.violations.map((item) => item.code).join(", ")}`);
    } catch (cause) {
      setValidation(null);
      setValidationError(actionFailure(cause));
    }
  }

  return (
    <article className="release-card">
      <header>
        <div>
          <span className={`release-status release-status-${release.status.toLowerCase()}`}>{release.status}</span>
          <h2>{release.version}</h2>
        </div>
        <code title={release.configHash}>{release.configHash.slice(0, 12)}</code>
      </header>
      <p>{release.notes ?? "No release notes."}</p>
      <dl>
        <div><dt>Missions</dt><dd>{release.counts.missions}</dd></div>
        <div><dt>Modules</dt><dd>{release.counts.modules}</dd></div>
        <div><dt>Enemies</dt><dd>{release.counts.enemies}</dd></div>
        <div><dt>Drop tables</dt><dd>{release.counts.dropTables}</dd></div>
      </dl>
      <div className="release-toolbar">
        <Link href={`/content?history=${release.id}`}>Revision history</Link>
        {release.status === "DRAFT" ? <button type="button" onClick={validate}>Semantic validation</button> : null}
      </div>
      <p className="form-success" role="status">{validation ?? ""}</p>
      <p className="form-error" role="alert">{validationError ?? ""}</p>
      {canWrite && release.status === "DRAFT" ? <ReleaseActionForm release={release} action="publish" /> : null}
      {canWrite && release.status === "PUBLISHED" ? <ReleaseActionForm release={release} action="clone" /> : null}
      {canWrite && release.status !== "DRAFT" ? <ReleaseActionForm release={release} action="rollback" /> : null}
    </article>
  );
}

function History({ releaseId, entries }: Readonly<{ releaseId: string; entries: readonly ContentHistoryEntry[] }>) {
  return (
    <section className="release-history" aria-labelledby="release-history-title">
      <header>
        <div>
          <p className="eyebrow">IMMUTABLE HISTORY</p>
          <h2 id="release-history-title">Release revisions</h2>
        </div>
        <Link href="/content">Close</Link>
      </header>
      <code>{releaseId}</code>
      {entries.length === 0 ? <p>No recorded revisions.</p> : (
        <ol>
          {entries.map((entry, index) => (
            <li key={`${entry.kind}-${entry.resourceId}-${entry.revision ?? entry.correlationId}-${index}`}>
              <strong>{entry.action}</strong>
              <span>{entry.reason}</span>
              <small>{HISTORY_DATE_FORMAT.format(new Date(entry.createdAt))} UTC · {entry.resourceType} · {entry.revision ? `r${entry.revision}` : "release"}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ContentReleaseConsole({
  releases,
  canWrite,
  selectedHistory,
}: Readonly<{
  releases: readonly AdminContentRelease[];
  canWrite: boolean;
  selectedHistory: Readonly<{ releaseId: string; entries: readonly ContentHistoryEntry[] }> | null;
}>) {
  return (
    <>
      {selectedHistory ? <History releaseId={selectedHistory.releaseId} entries={selectedHistory.entries} /> : null}
      <section className="release-grid" aria-label="Content releases">
        {releases.length === 0 ? <p className="notice">No content releases are available.</p> : null}
        {releases.map((release) => <ReleaseCard key={release.id} release={release} canWrite={canWrite} />)}
      </section>
    </>
  );
}
