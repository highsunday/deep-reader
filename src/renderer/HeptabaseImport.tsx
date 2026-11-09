import { createPortal } from "react-dom";
import { GenerationActivitySummary } from "./GenerationActivitySummary";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  HeptabaseImportApi,
  HeptabaseImportBatch,
  HeptabaseImportStatus,
} from "../shared/heptabase-import";
const dismissedBatchKey = "deep-reading.heptabase.dismissed-batch";
function readDismissedBatch() { try { return window.localStorage.getItem(dismissedBatchKey) ?? ""; } catch { return ""; } }
function useImport(api?: HeptabaseImportApi) {
  const [batch, setBatch] = useState<HeptabaseImportBatch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dismissedId, setDismissedId] = useState(readDismissedBatch);
  const [notificationVisible, setNotificationVisible] = useState(true);
  const [revealRequest, setRevealRequest] = useState(0);
  const lock = useRef(false);
  function rememberDismissal(id: string) { setDismissedId(id); try { window.localStorage.setItem(dismissedBatchKey, id); } catch { /* Session dismissal still works. */ } }
  function showNotification() { setNotificationVisible(true); setDismissedId(""); try { window.localStorage.removeItem(dismissedBatchKey); } catch { /* Session visibility still works. */ } }
  useEffect(() => { if (!notificationVisible && batch) rememberDismissal(batch.id); }, [notificationVisible, batch?.id]);
  const epoch = useRef(0);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const generation = epoch.current;
      try {
        const next = await api.get();
        if (alive && generation === epoch.current) {
          setBatch(next);
          setLoaded(true);
        }
      } catch {
        if (alive) {
          setError(
            "Unable to read Heptabase import progress. Check the desktop app and try again.",
          );
          setLoaded(true);
        }
      }
      if (alive) timer = setTimeout(poll, 600);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api]);
  async function submit(ids?: string[], before?: () => Promise<void>) {
    if (!api || lock.current || batch?.running) return;
    lock.current = true;
    epoch.current++;
    setBusy(true);
    setError("");
    showNotification();
    try {
      await before?.();
      setBatch(await (ids ? api.start(ids) : api.retry()));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to import to Heptabase.",
      );
    } finally {
      epoch.current++;
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    batch,
    busy: busy || Boolean(batch?.running),
    error,
    loaded,
    submit,
    showNotification: notificationVisible && Boolean(error || batch && batch.id !== dismissedId),
    revealRequest,
    revealResults: () => { showNotification(); setRevealRequest(value => value + 1); },
    dismissResults: () => { if (batch) rememberDismissal(batch.id); setNotificationVisible(false); setError(""); },
  };
}
type State = ReturnType<typeof useImport>;
const Context = createContext<State | undefined>(undefined);
export function HeptabaseImportProvider({
  api,
  children,
}: {
  api?: HeptabaseImportApi;
  children: ReactNode;
}) {
  const state = useImport(api);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
const labels: Record<HeptabaseImportStatus, string> = {
  pending: "Waiting",
  importing: "Importing…",
  created: "Imported",
  duplicate: "Skipped — title already exists",
  failed: "Failed",
  uncertain: "Check Heptabase — result not confirmed",
};
function Results({ state }: { state: State }) {
  const [target, setTarget] = useState<HTMLElement>();
  useEffect(() => {
    const update = () =>
      setTarget(
        document.querySelector<HTMLElement>(".reading-note-editor-dialog") ??
          document.querySelector<HTMLElement>(
            ".generation-activity-stack:not(.heptabase-import-floating)",
          ) ??
          document.body,
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  if (!target || !state.showNotification) return null;
  const content = <ResultContent state={state} />;
  return createPortal(
    target.classList.contains("generation-activity-stack") ? (
      content
    ) : (
      <div className="generation-activity-stack heptabase-import-floating">
        {content}
      </div>
    ),
    target,
  );
}
function ResultContent({ state }: { state: State }) {
  const { batch, error, busy } = state;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (state.revealRequest > 0) setExpanded(true); }, [state.revealRequest]);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);
  if (!batch && !error) return null;
  const created =
    batch?.items.filter((i) => i.status === "created").length ?? 0;
  const skipped =
    batch?.items.filter((i) => i.status === "duplicate").length ?? 0;
  const failed = batch?.items.filter((i) => i.status === "failed").length ?? 0;
  const uncertain =
    batch?.items.filter((i) => i.status === "uncertain").length ?? 0;
  const processed =
    batch?.items.filter((i) => !["pending", "importing"].includes(i.status))
      .length ?? 0;
  return (
    <aside
      ref={root}
      className="memory-image-generation-progress card-pool-upload heptabase-import-results"
      aria-label="Heptabase import"
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      {error ? (
        <p className="memory-image-activity-error" role="alert">
          {error}
        </p>
      ) : null}
      {error && batch ? (
        <p className="heptabase-previous-results">Previous import results</p>
      ) : null}
      {expanded && batch ? (
        <section
          id={panelId}
          className="memory-image-results"
          aria-label="Heptabase import results"
        >
          <div className="memory-image-results-heading">
            <span>Heptabase import</span>
            <span>
              {created} imported{skipped ? ` · ${skipped} already exist` : ""}
            </span>
          </div>
          <div className="card-pool-upload-details">
            <p>
              {batch.running
                ? `Importing ${processed} / ${batch.items.length} · ${batch.items.find((i) => i.status === "importing")?.title ?? "Checking existing titles…"}`
                : failed || uncertain
                  ? "Check the items below to finish this import."
                  : "Import finished."}
            </p>
            <ol>
              {batch.items.map((i) => (
                <li key={i.noteId}>
                  <div className="card-pool-upload-item-heading">
                    <strong>{i.title}</strong>
                    <span data-status={i.status}>{labels[i.status]}</span>
                  </div>
                  {i.message ? <p>{i.message}</p> : null}
                </li>
              ))}
            </ol>
            {uncertain > 0 ? (
              <p>
                Unconfirmed cards will not be created again automatically. Check
                them in Heptabase.
              </p>
            ) : null}
            <details className="card-pool-upload-connection">
              <summary>Connection details</summary>
              <p>
                Destination: the workspace currently open in Heptabase. Keep
                that workspace open until this import finishes.
              </p>
            </details>
          </div>
          {!busy && (failed > 0 || uncertain > 0) ? (
            <button
              className="card-pool-upload-retry"
              type="button"
              onClick={() => void state.submit()}
            >
              {failed > 0 ? "Retry failed items" : "Check unconfirmed results"}
            </button>
          ) : null}
        </section>
      ) : null}
      <GenerationActivitySummary
        kind="upload"
        uploadDestination="Heptabase"
        allowDismissWhileActive
        active={
          batch?.running ? Math.max(1, batch.items.length - processed) : 0
        }
        completed={created}
        attention={failed + uncertain + (error ? 1 : 0)}
        secondary={skipped ? `${skipped} already exist` : undefined}
        expanded={expanded}
        panelId={panelId}
        trigger={trigger}
        onToggle={() => setExpanded(!expanded)}
        onDismiss={() => {
          state.dismissResults();
          setExpanded(false);
        }}
      />
      <span className="visually-hidden" role="status">
        {batch?.running
          ? `Importing ${processed} / ${batch.items.length}`
          : `${created} imported · ${skipped} skipped · ${failed} failed · ${uncertain} need checking`}
      </span>
      {batch?.running ? (
        <progress
          aria-label="Finished Heptabase imports"
          max={batch.items.length}
          value={processed}
        />
      ) : null}
    </aside>
  );
}
export function HeptabaseImportPanel() {
  const state = useContext(Context);
  return state ? <Results state={state} /> : null;
}
export function HeptabaseImportAction({
  api,
  noteIds,
  beforeStart,
  compact = false,
}: {
  api?: HeptabaseImportApi;
  noteIds: string[];
  beforeStart?: () => Promise<void>;
  compact?: boolean;
}) {
  const shared = useContext(Context);
  const local = useImport(shared ? undefined : api);
  const state = shared ?? local;
  if (!api) return null;
  return (
    <>
      <button
        type="button"
        className={
          compact
            ? "reading-note-canvas-tool-button"
            : "heptabase-import-action"
        }
        aria-label="Import to Heptabase"
        title="Import to Heptabase"
        disabled={!state.loaded || !noteIds.length || state.busy}
        onClick={() => void state.submit(noteIds, beforeStart)}
      >
        <span>{state.busy ? "Importing…" : "Import to Heptabase"}</span>
      </button>
      {state.batch ? <button type="button" className={compact ? "reading-note-canvas-tool-button" : "heptabase-history-action"} aria-label="View Heptabase import results" title="View Heptabase import results" onClick={state.revealResults}><span>Results</span></button> : null}
      {!shared ? <Results state={state} /> : null}
    </>
  );
}
