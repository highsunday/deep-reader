import { GenerationActivitySummary } from './GenerationActivitySummary';
import { useEffect, useId, useRef, useState } from "react";
import type { MemoryImageSide, ReadingNote, ReaderDesktopApi, ReadingNoteMemoryImageSnapshot } from "../shared/contracts";
import { activeMemoryImageKeys, memoryImageKeyBelongsToNote } from "./memory-image-generation-state";

import { readingNoteImage } from "../shared/reading-note-images";

interface GenerationBatch {
  activeImageKeys: Set<string>;
  total: number;
  completed: number;
}

const emptyBatch = (): GenerationBatch => ({ activeImageKeys: new Set(), total: 0, completed: 0 });

export function updateGenerationBatch(
  current: GenerationBatch,
  snapshot: ReadingNoteMemoryImageSnapshot
): GenerationBatch {
  const activeImageKeys = new Set(current.activeImageKeys);
  if (snapshot.phase === "generating" || snapshot.phase === "ready" && snapshot.batch?.phase === "running") {
    const target = new Set(activeMemoryImageKeys(snapshot));
    const previous = [...activeImageKeys].filter(key => memoryImageKeyBelongsToNote(key, snapshot.noteId));
    let removed = 0;
    let added = 0;
    for (const key of previous) {
      if (!target.has(key)) { activeImageKeys.delete(key); removed += 1; }
    }
    for (const key of target) {
      if (!activeImageKeys.has(key)) { activeImageKeys.add(key); added += 1; }
    }
    if (!removed && !added) return current;
    if (!activeImageKeys.size) return emptyBatch();
    return { activeImageKeys, total: current.total + added, completed: current.completed + removed };
  }
  const completedKeys = [...activeImageKeys].filter(key => memoryImageKeyBelongsToNote(key, snapshot.noteId));
  if (!completedKeys.length) return current;
  for (const key of completedKeys) activeImageKeys.delete(key);
  if (!activeImageKeys.size) return emptyBatch();
  return { activeImageKeys, total: current.total, completed: current.completed + completedKeys.length };
}

interface CompletedNote {
  noteId: string;
  title: string;
  images: Partial<Record<MemoryImageSide, string>>;
  partial: boolean;
  viewed?: boolean;
}
interface NotificationState {
  batch: GenerationBatch;
  completed: CompletedNote[];
  failures: Record<string, string>;
  seen: Set<string>;
  hidden: boolean;
}
const emptyState = (): NotificationState => ({ batch: emptyBatch(), completed: [], failures: {}, seen: new Set(), hidden: false });
const resultKey = (item: CompletedNote) => JSON.stringify(item.images);

function receive(state: NotificationState, snapshot: ReadingNoteMemoryImageSnapshot, restore = false): NotificationState {
  const batch = updateGenerationBatch(state.batch, snapshot);
  const newWork = [...batch.activeImageKeys].some(key => !state.batch.activeImageKeys.has(key));
  const failures = { ...state.failures };
  const wasGenerating = [...state.batch.activeImageKeys].some(key => memoryImageKeyBelongsToNote(key, snapshot.noteId));
  if (snapshot.phase === "generating" || snapshot.completion) delete failures[snapshot.noteId];
  if (!restore && wasGenerating && (snapshot.phase === "error" || snapshot.phase === "unavailable")) {
    failures[snapshot.noteId] = snapshot.status;
  }
  let next = { ...state, batch, failures, hidden: newWork ? false : state.hidden };
  if (restore || !snapshot.completion || !snapshot.note || snapshot.note.trashedAt !== undefined || snapshot.batch?.phase === "running") return next;
  const seen = new Set(state.seen);
  const images: CompletedNote["images"] = {};
  for (const side of snapshot.completion.sides) {
    const image = readingNoteImage(snapshot.note, side);
    if (!image) continue;
    const key = JSON.stringify([snapshot.noteId, side, image.attachmentId]);
    if (seen.has(key)) continue;
    seen.add(key);
    images[side] = image.attachmentId;
  }
  if (!Object.keys(images).length) return next;
  const previous = state.completed.find(item => item.noteId === snapshot.noteId);
  const item: CompletedNote = { noteId: snapshot.noteId, title: snapshot.note.title,
    images: { ...previous?.images, ...images }, partial: Boolean(snapshot.batch && snapshot.batch.phase !== "completed") };
  next = { ...next, seen, hidden: false, completed: previous
    ? state.completed.map(current => current.noteId === item.noteId ? item : current)
    : [...state.completed, item] };
  return next;
}

function imageLabel(item: CompletedNote) {
  return `${item.partial ? "Partially completed · " : ""}${item.images.recall && item.images.understand ? "Recall + understanding" : item.images.recall ? "Recall" : "Understanding"}`;
}

function CompletedImageThumbnail({ attachmentId, readDataUrl }: {
  attachmentId?: string;
  readDataUrl?: (attachmentId: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = true;
    setUrl(undefined);
    if (attachmentId && readDataUrl) {
      void readDataUrl(attachmentId).then(value => { if (current) setUrl(value); }).catch(() => undefined);
    }
    return () => { current = false; };
  }, [attachmentId, readDataUrl]);
  return <span className="memory-image-results-icon" aria-hidden="true">
    {url ? <img src={url} alt="" decoding="async" onError={() => setUrl(undefined)} />
      : <svg viewBox="0 0 20 20"><rect x="3.5" y="3.5" width="13" height="13" rx="3" /><circle cx="7.5" cy="7.5" r="1" /><path d="m4 14 4-4 2.5 2.5 2-2 3.5 3.5" /></svg>}
  </span>;
}

export function MemoryImageGenerationProgress({ memoryImage, api, onView }: {
  memoryImage?: NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>;
  api?: ReaderDesktopApi["readingNotes"];
  onView?(note: ReadingNote, side: MemoryImageSide): void;
}) {
  const [state, setState] = useState<NotificationState>(emptyState);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const opening = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!memoryImage) return;
    let mounted = true;
    const observed = new Set<string>();
    const unsubscribe = memoryImage.onStateChanged(snapshot => {
      if (!mounted) return;
      observed.add(snapshot.noteId);
      setState(current => receive(current, snapshot));
    });
    void memoryImage.listActive().then(snapshots => {
      if (mounted) setState(current => snapshots.reduce((next, snapshot) => observed.has(snapshot.noteId) ? next : receive(next, snapshot, true), current));
    }).catch(() => undefined);
    return () => { mounted = false; unsubscribe(); request.current += 1; };
  }, [memoryImage]);

  useEffect(() => {
    if (!expanded) return;
    root.current?.querySelector<HTMLButtonElement>(".memory-image-results-view")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);

  function dismissAll() {
    if (state.batch.activeImageKeys.size) return;
    request.current += 1;
    opening.current = false;
    setLoading(false); setError(""); setExpanded(false);
    setState(current => ({ ...current, completed: [], failures: {}, hidden: true }));
  }
  function dismiss(item: CompletedNote) {
    request.current += 1; opening.current = false; setLoading(false);
    setState(current => ({ ...current, completed: current.completed.filter(note => note.noteId !== item.noteId) }));
    setError("");
    trigger.current?.focus();
  }
  async function view(item: CompletedNote) {
    if (!api || !onView || opening.current) return;
    const ticket = ++request.current;
    opening.current = true; setLoading(true); setError("");
    try {
      const note = await api.get(item.noteId);
      if (!note || note.trashedAt !== undefined) throw new Error("This note is no longer available.");
      const sides = (["recall", "understand"] as const).filter(side => item.images[side] && readingNoteImage(note, side));
      const side = sides[0];
      if (!side) throw new Error("The completed image is no longer available.");
      await api.attachments.readDataUrl(readingNoteImage(note, side)!.attachmentId);
      if (ticket !== request.current) return;
      onView(note, side); setExpanded(false);
      setState(current => ({ ...current, completed: current.completed.map(result => result.noteId === item.noteId && resultKey(result) === resultKey(item) ? { ...result, viewed: true } : result) }));
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : "Unable to open the image. Try again.");
    } finally {
      if (ticket === request.current) { opening.current = false; setLoading(false); }
    }
  }
  const active = state.batch.activeImageKeys.size;
  const count = state.completed.length;
  const failureCount = Object.keys(state.failures).length;
  const visible = !state.hidden && Boolean(active || count || failureCount);
  if (!visible) return null;
  return <aside ref={root} className="memory-image-generation-progress" aria-label="Memory image activity"
    onKeyDown={event => { if (event.key === "Escape" && expanded) { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
    {expanded ? <section id={panelId} className="memory-image-results" aria-label="Completed images">
      <div className="memory-image-results-heading"><span>Completed images</span><span className="memory-image-results-count">{count}</span></div>
      {active ? <p className="memory-image-results-progress">{state.batch.completed} of {state.batch.total} image jobs finished</p> : null}
      {count ? <div className="memory-image-results-list">{state.completed.map(item => <div className="memory-image-results-row" key={item.noteId}>
        <button type="button" className="memory-image-results-view" aria-label={`View images for ${item.title}`} disabled={loading || !api || !onView} onClick={() => void view(item)}>
          <CompletedImageThumbnail key={item.images.recall ?? item.images.understand}
            attachmentId={item.images.recall ?? item.images.understand} readDataUrl={api?.attachments.readDataUrl} />
          <span className="memory-image-results-copy"><strong>{item.title}</strong><small>{imageLabel(item)}<span className="memory-image-results-viewed">{item.viewed ? " · Viewed" : " · Open in sidebar"}</span></small></span>
        </button>
        <button type="button" aria-label={`Dismiss ${item.title} notification`} onClick={() => dismiss(item)}>×</button>
      </div>)}</div> : <p className="memory-image-results-empty">Images will appear here when ready.</p>}
    </section> : null}
    {Object.entries(state.failures).map(([noteId, message]) => <div key={noteId} className="memory-image-activity-error" role="alert">{message}</div>)}
    {error ? <div className="memory-image-activity-error" role="alert">{error}</div> : null}
    <GenerationActivitySummary kind="image" active={active} completed={count} attention={failureCount}
      expanded={expanded} panelId={panelId} trigger={trigger} onToggle={() => setExpanded(current => !current)} onDismiss={dismissAll} />
    <span className="visually-hidden" role="status">{active} images generating, {count} completed notes.</span>
    {active ? <progress aria-label="Finished image jobs" max={state.batch.total} value={state.batch.completed} /> : null}
  </aside>;
}
