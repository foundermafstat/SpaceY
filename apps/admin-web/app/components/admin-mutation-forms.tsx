"use client";

import { type FormEvent, useState } from "react";
import {
  type AdminMutationResult,
  applyContentRevision,
  applyEconomyAdjustment,
} from "../../lib/admin-browser-api";

type SubmissionState = Readonly<{
  pending: boolean;
  error: string | null;
  result: AdminMutationResult | null;
}>;

const INITIAL_STATE: SubmissionState = { pending: false, error: null, result: null };
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

function mutationFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

function Result({ value }: Readonly<{ value: AdminMutationResult | null }>) {
  if (!value) return null;
  return (
    <p className="form-success" role="status">
      Committed as revision {value.revision}. Correlation ID: <code>{value.correlationId}</code>
    </p>
  );
}

export function ContentRevisionForm() {
  const [submission, setSubmission] = useState<SubmissionState>(INITIAL_STATE);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmission({ pending: true, error: null, result: null });

    try {
      const values = new FormData(form);
      let payload: unknown;
      try {
        payload = JSON.parse(String(values.get("payload") ?? ""));
      } catch {
        throw new Error("Payload must be valid JSON.");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length === 0) {
        throw new Error("Payload must be a non-empty JSON object.");
      }

      const expectedRevision = Number(values.get("expectedRevision"));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new Error("Expected revision must be a non-negative integer.");
      }

      const result = await applyContentRevision({
        resourceType: values.get("resourceType"),
        resourceId: values.get("resourceId"),
        expectedRevision,
        payload,
        reason: values.get("reason"),
      });
      setSubmission({ pending: false, error: null, result });
    } catch (error) {
      setSubmission({ pending: false, error: mutationFailure(error), result: null });
    }
  }

  return (
    <form className="admin-form mutation-form" onSubmit={submit}>
      <div className="field-grid">
        <label>
          Resource type
          <select name="resourceType" required disabled={submission.pending}>
            <option value="mission">Mission</option>
            <option value="module">Module</option>
            <option value="enemy">Enemy</option>
            <option value="drop-table">Drop table</option>
          </select>
        </label>
        <label>
          Resource ID
          <input name="resourceId" type="text" inputMode="text" pattern={UUID_PATTERN} required disabled={submission.pending} />
        </label>
        <label>
          Expected revision
          <input name="expectedRevision" type="number" min={0} step={1} required disabled={submission.pending} />
        </label>
      </div>
      <label>
        JSON payload
        <textarea name="payload" rows={12} spellCheck={false} defaultValue="{}" required disabled={submission.pending} />
      </label>
      <label>
        Change reason
        <textarea name="reason" rows={3} minLength={1} maxLength={500} required disabled={submission.pending} />
      </label>
      <button type="submit" disabled={submission.pending}>
        {submission.pending ? "Committing…" : "Commit audited revision"}
      </button>
      <p className="form-error" role="alert" aria-live="polite">{submission.error ?? ""}</p>
      <Result value={submission.result} />
    </form>
  );
}

export function EconomyAdjustmentForm() {
  const [submission, setSubmission] = useState<SubmissionState>(INITIAL_STATE);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmission({ pending: true, error: null, result: null });

    try {
      const values = new FormData(form);
      const amount = Number(values.get("amount"));
      if (!Number.isInteger(amount) || amount === 0) throw new Error("Amount must be a non-zero integer.");

      const result = await applyEconomyAdjustment({
        playerId: values.get("playerId"),
        currency: values.get("currency"),
        amount,
        idempotencyKey: values.get("idempotencyKey"),
        caseId: values.get("caseId"),
        reason: values.get("reason"),
      });
      setIdempotencyKey("");
      setSubmission({ pending: false, error: null, result });
    } catch (error) {
      setSubmission({ pending: false, error: mutationFailure(error), result: null });
    }
  }

  return (
    <form className="admin-form mutation-form" onSubmit={submit}>
      <div className="field-grid">
        <label>
          Player ID
          <input name="playerId" type="text" pattern={UUID_PATTERN} required disabled={submission.pending} />
        </label>
        <label>
          Currency
          <select name="currency" required disabled={submission.pending}>
            <option value="credits">Credits</option>
            <option value="scrap">Scrap</option>
            <option value="alloy">Alloy</option>
            <option value="dataShards">Data shards</option>
          </select>
        </label>
        <label>
          Signed amount
          <input name="amount" type="number" min={-1_000_000_000} max={1_000_000_000} step={1} required disabled={submission.pending} />
        </label>
        <label>
          Case ID
          <input name="caseId" type="text" minLength={1} maxLength={120} required disabled={submission.pending} />
        </label>
      </div>
      <label>
        Idempotency key
        <span className="inline-field">
          <input
            name="idempotencyKey"
            type="text"
            pattern={UUID_PATTERN}
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            required
            disabled={submission.pending}
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => setIdempotencyKey(crypto.randomUUID())}
            disabled={submission.pending}
          >
            Generate
          </button>
        </span>
      </label>
      <label>
        Adjustment reason
        <textarea name="reason" rows={3} minLength={1} maxLength={500} required disabled={submission.pending} />
      </label>
      <button type="submit" disabled={submission.pending}>
        {submission.pending ? "Committing…" : "Commit ledger adjustment"}
      </button>
      <p className="form-error" role="alert" aria-live="polite">{submission.error ?? ""}</p>
      <Result value={submission.result} />
    </form>
  );
}
