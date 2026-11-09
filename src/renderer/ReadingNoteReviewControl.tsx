import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReadingNote, ReadingNoteSummary } from "../shared/contracts";
import type { NoteReviewStatus, SpacedReviewApi } from "../shared/spaced-review";

export function ReadingNoteReviewControl({ api, note, displayOnly = false }: { api?: SpacedReviewApi; note: ReadingNote | ReadingNoteSummary; displayOnly?: boolean }) {
  const hintId = useId();
  const [status, setStatus] = useState<NoteReviewStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (!api) return;
    const current = ++sequence.current;
    try { const value = await api.status(note.id); if (sequence.current === current) { setStatus(value); setError(""); } }
    catch (cause) { if (sequence.current === current) { setStatus(undefined); setError(String(cause)); } }
  }, [api, note.id, note.revision]);
  useEffect(() => {
    void refresh();
    const changed = () => { void refresh(); };
    const unsubscribe = api?.onChanged(changed);
    window.addEventListener("focus", changed);
    return () => { sequence.current++; unsubscribe?.(); window.removeEventListener("focus", changed); };
  }, [api, refresh]);
  if (!api || note.trashedAt !== undefined) return null;
  const label = !status?.enrolled ? "Add to review" : status.paused ? "Resume review" : "Pause review";
  const disabled = busy || !status || ((!status.enrolled || status.paused) && !status.eligible);
  async function change() {
    if (!api || !status || disabled || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const value = !status.enrolled ? await api.enroll(note.id) : await api.setPaused(note.id, !status.paused);
      setStatus(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update review status."); }
    finally { pending.current = false; setBusy(false); }
  }
  const enabled = Boolean(status?.enrolled && !status.paused);
  const state = !status ? "unknown" : !status.enrolled ? "off" : status.paused ? "paused" : !status.eligible ? "unavailable" : "on";
  const stateLabel = !status ? error ? "Review status unavailable" : "Loading review status…"
    : !status.enrolled ? "Not enrolled" : status.paused ? "Paused" : !status.eligible ? "Unavailable for review" : "Enrolled";
  const hint = error || status?.reason;
  const tooltip = hint || (status?.dueAt ? `Next review: ${new Date(status.dueAt).toLocaleString("en")}` : stateLabel);
  if (displayOnly) return <span className="note-review-light" data-state={state} role="img"
    aria-label={stateLabel} title={tooltip === stateLabel ? stateLabel : `${stateLabel} · ${tooltip}`} tabIndex={0}>
    <span aria-hidden="true" />
  </span>;
  return <div className="note-review-control">
    <button type="button" role="switch" aria-checked={enabled} aria-label={label} aria-describedby={hint ? hintId : undefined}
      className="note-review-toggle" data-state={state} disabled={disabled} title={tooltip}
      onClick={() => void change()}>
      <span className="note-review-track" aria-hidden="true"><span /></span>
      <span>{busy ? "Saving…" : stateLabel}</span>
    </button>
    {hint ? <span id={hintId} className="note-review-hint" role={error ? "alert" : undefined}>{hint}
      {error ? <button type="button" disabled={busy} onClick={() => void refresh()}>Retry</button>
        : status?.enrolled && !status.eligible ? <button type="button" disabled={busy}
          onClick={() => void api.retryImages().then(refresh).catch(cause => setError(String(cause)))}>Retry images</button> : null}
    </span> : null}
  </div>;
}
