import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GenerationActivitySummary } from "./GenerationActivitySummary";
import type { CardNoteUploadApi, CardNoteUploadBatch, CardNoteUploadStatus } from "../shared/card-note-upload";
const dismissedBatchKey = "deep-reading.card-pool.dismissed-batch";
function readDismissedBatch() {
  try { return window.localStorage.getItem(dismissedBatchKey) ?? ""; }
  catch { return ""; }
}
const labels: Record<CardNoteUploadStatus, string> = {
  pending: "Waiting", uploading: "Uploading…", created: "Saved", duplicate_title: "Title already exists — not added",
  validation_error: "Unable to upload", refused: "Refused", unreachable: "Service unavailable", uncertain: "Result not confirmed — may already be saved"
};
function useUploadState(api?: CardNoteUploadApi) {
  const [batch, setBatch] = useState<CardNoteUploadBatch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const operation = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const before = generation.current;
      try { const current = await api!.get(); if (mounted && before === generation.current) { setBatch(current); setReadError(""); setLoaded(true); } }
      catch (cause) { if (mounted && before === generation.current) setReadError(cause instanceof Error ? cause.message : "Unable to read upload progress."); }
      if (mounted) timer = setTimeout(() => void poll(), 800);
    };
    if (api) void poll();
    return () => { mounted = false; clearTimeout(timer); };
  }, [api]);
  const unresolved = batch?.items.some(item => ["pending", "uploading", "unreachable", "uncertain"].includes(item.status));
  async function submit(retry: boolean, noteIds: string[]) {
    if (operation.current) return;
    operation.current = true; generation.current += 1; setBusy(true); setError("");
    try { setBatch(await (retry ? api!.retry() : api!.start(noteIds))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start upload."); }
    finally { operation.current = false; setBusy(false); }
  }
  return { batch, busy, error, readError, loaded, unresolved, submit };
}
const UploadContext = createContext<ReturnType<typeof useUploadState> | null>(null);
export function CardNoteUploadProvider({ api, children }: { api?: CardNoteUploadApi; children: ReactNode }) {
  const state = useUploadState(api);
  return <UploadContext.Provider value={state}>{children}</UploadContext.Provider>;
}
type PanelProps = { api: CardNoteUploadApi; noteIds: string[]; actionsTarget?: HTMLElement | null; actionOnly?: boolean };
export function CardNoteUploadPanel(props: PanelProps) {
  const shared = useContext(UploadContext);
  return shared ? <UploadPanel {...props} state={shared} /> : <StandaloneUploadPanel {...props} />;
}
function StandaloneUploadPanel(props: PanelProps) {
  const state = useUploadState(props.api);
  return <UploadPanel {...props} state={state} />;
}
function UploadPanel({ noteIds, actionsTarget, actionOnly, state }: PanelProps & { state: ReturnType<typeof useUploadState> }) {
  const { batch, busy, error, readError, loaded, unresolved, submit } = state;
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissedBatch);
  const [dismissedError, setDismissedError] = useState("");
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const message = error || readError;
  const visibleError = message && message !== dismissedError;
  useEffect(() => { if (!message) setDismissedError(""); }, [message]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  const completed = batch?.items.filter(item => !["pending", "uploading"].includes(item.status)).length ?? 0;
  const saved = batch?.items.filter(item => item.status === "created").length ?? 0;
  const duplicates = batch?.items.filter(item => item.status === "duplicate_title").length ?? 0;
  const issues = batch?.items.filter(item => ["validation_error", "refused", "unreachable", "uncertain"].includes(item.status)).length ?? 0;
  const uploadButton = noteIds.length > 0 ? <button className="card-pool-upload-action" type="button" aria-label={`Upload ${noteIds.length} notes to card pool`} disabled={!loaded || busy || batch?.running || unresolved} onClick={() => void submit(false, noteIds)}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 12V3m-3.25 3.25L10 3l3.25 3.25M4 11.5V16h12v-4.5" /></svg>
    <span>{batch?.running ? "Uploading…" : "Upload to card pool"}</span>
  </button> : null;
  return <>
    {actionsTarget ? createPortal(uploadButton, actionsTarget) : actionsTarget === undefined ? uploadButton : null}
    {!actionOnly && (batch && (batch.running || batch.id !== dismissed) || visibleError) ? <aside ref={root} className="memory-image-generation-progress card-pool-upload" aria-label="Card pool uploads"
      onKeyDown={event => { if (event.key === "Escape" && expanded) { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
    {visibleError ? <p className="memory-image-activity-error" role="alert">{message}</p> : null}
    {expanded && batch ? <section id={panelId} className="memory-image-results" aria-label="Upload results">
      <div className="memory-image-results-heading"><span>Card pool upload</span><span>{saved} saved{duplicates ? ` · ${duplicates} already exist` : ""}</span></div>
      <div className="card-pool-upload-details">
          <p>{batch.running ? "Uploading saved notes and all their images…" : unresolved ? "Retry to finish or confirm the saved submissions before starting another batch." : "Upload finished."}</p>
          {batch.items.some(item => item.status === "unreachable") ? <p>Start your card pool service, then retry.</p> : null}
          <ol>{batch.items.map(item => <li key={item.submissionId}>
            <div className="card-pool-upload-item-heading"><strong>{item.title}</strong><span data-status={item.status}>{labels[item.status]}</span></div>
            {item.message ? <p>{item.message}</p> : null}
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer">Open card pool note ↗</a> : null}
            {["unreachable", "uncertain"].includes(item.status) ? <small>Submission ID: {item.submissionId}</small> : null}
          </li>)}</ol>
          <details className="card-pool-upload-connection"><summary>Connection details</summary>
            <p>Destination: {batch.baseUrl}</p>
            {batch.items.some(item => item.status === "unreachable") ? <p>Start your card-note pool service, then retry using the destination above.</p> : null}
          </details>
        </div>
      {unresolved ? <button className="card-pool-upload-retry" type="button" disabled={busy || batch.running} onClick={() => void submit(true, noteIds)}>Retry unfinished uploads</button> : null}
    </section> : null}
    <GenerationActivitySummary kind="upload" active={batch?.running ? Math.max(1, batch.items.length - completed) : 0}
      completed={saved} attention={issues || (visibleError ? 1 : 0) || (unresolved && !batch?.running ? 1 : 0)} secondary={duplicates ? `${duplicates} already exist` : undefined}
      expanded={expanded} panelId={panelId} trigger={trigger} onToggle={() => setExpanded(value => !value)}
      onDismiss={() => { if (!batch?.running) { const id = batch?.id ?? ""; setDismissed(id);
        if (id) { try { window.localStorage.setItem(dismissedBatchKey, id); } catch { /* Keep dismissal usable when storage is unavailable. */ } }
        setDismissedError(message); setExpanded(false); } }} />
    <span className="visually-hidden" role="status">{batch?.running ? `Uploading ${completed} / ${batch.items.length}` : `${saved} saved`}</span>
    {batch?.running ? <progress aria-label="Finished uploads" max={batch.items.length} value={completed} /> : null}
    </aside> : null}
  </>;
}
