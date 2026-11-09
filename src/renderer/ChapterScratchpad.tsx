import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { ChapterScratchpadApi } from "../shared/chapter-scratchpad";
import { readingNoteDocumentIsEmpty } from "../shared/reading-note-document";
import { readingNoteSchema } from "./reading-note-schema";
import { blockNoteBlocksToReadingNoteDocument, readingNoteDocumentToBlockNoteBlocks } from "./reading-note-editor-adapter";
import { chapterScratchpadSession, type ChapterScratchpadSession, type ScratchpadState } from "./chapter-scratchpad-session";
import "./chapter-scratchpad.css";

// Reset legacy placement once for the lower-left default; retain subsequent moves.
const POSITION_KEY = "deep-reader:scratchpad-position:v2";
const bounded = (n: number) => Math.max(0, Math.min(1, n));
export function scratchpadPosition(value: unknown): { x: number; y: number } {
  const p = value as { x?: number; y?: number } | null;
  return p && typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)
    ? { x: bounded(p.x), y: bounded(p.y) } : { x: 0, y: 1 };
}
function initialPosition() {
  try { return scratchpadPosition(JSON.parse(localStorage.getItem(POSITION_KEY) || "null")); }
  catch { return scratchpadPosition(null); }
}
function Icon({ kind }: { kind: "note" | "grip" | "minimize" | "expand" }) {
  const paths = {
    note: "M4 3h12v10l-4 4H4V3Zm8 14v-4h4M7 7h6M7 10h4",
    grip: "M6 6h.01M10 6h.01M14 6h.01M6 10h.01M10 10h.01M14 10h.01M6 14h.01M10 14h.01M14 14h.01",
    minimize: "M5 10h10",
    expand: "M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4"
  };
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d={paths[kind]} /></svg>;
}

function ScratchpadEditor({ api, session, state, open, onError }: {
  api: ChapterScratchpadApi; session: ChapterScratchpadSession; state: ScratchpadState; open: boolean; onError(message: string): void;
}) {
  const [error, setError] = useState("");
  const lastContent = useRef(state.content);
  const editor = useCreateBlockNote({
    schema: readingNoteSchema,
    initialContent: readingNoteDocumentToBlockNoteBlocks(state.content) as never,
    tables: { headers: true, splitCells: false, cellBackgroundColor: false, cellTextColor: false },
    uploadFile: async file => {
      try {
        const uploaded = await api.attachments.upload({ name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
        return uploaded.url;
      } catch (cause) { const message = cause instanceof Error ? cause.message : "Unable to upload image."; setError(message); onError(message); throw cause; }
    },
    resolveFileUrl: async url => {
      if (!url.startsWith("reading-note-asset:")) throw new Error("Only managed note images are supported.");
      return api.attachments.readDataUrl(url.slice("reading-note-asset:".length));
    },
    pasteHandler: ({ defaultPasteHandler }) => defaultPasteHandler({ prioritizeMarkdownOverHTML: false, plainTextAsMarkdown: true })
  }, [session]);
  useEffect(() => { if (open) editor.focus(); }, [editor, open]);
  useEffect(() => {
    // A save can assign a private copy of a pasted attachment. Never replace newer typing.
    if (lastContent.current === state.content) return;
    lastContent.current = state.content;
    if (state.dirty) return;
    try {
      const current = blockNoteBlocksToReadingNoteDocument(editor.document as unknown[]);
      if (JSON.stringify(current) !== JSON.stringify(state.content)) {
        editor.replaceBlocks(editor.document, readingNoteDocumentToBlockNoteBlocks(state.content) as never);
      }
    } catch { /* In-progress editor blocks are handled by onChange. */ }
  }, [editor, state.content, state.dirty]);
  return <>
    <div className="chapter-scratchpad-editor" onKeyDown={event => {
      // Keep editor keyboard shortcuts out of the reader's selection handlers.
      if (event.key !== "Escape" && !(event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j")) event.stopPropagation();
    }}>
      <BlockNoteView editor={editor} theme="light" onChange={() => {
        try {
          // BlockNote inserts an empty image block before its file picker is used.
          // Keep that transient block in the editor, but commit it only once uploaded.
          session.update(scratchpadEditorContent(editor.document as unknown[]));
          setError("");
          onError("");
        } catch (cause) { const message = cause instanceof Error ? cause.message : "This content cannot be saved."; setError(message); onError(message); }
      }} />
    </div>
    {error ? <p className="chapter-scratchpad-error" role="alert">{error}</p> : null}
  </>;
}

export function scratchpadEditorContent(blocks: unknown[]) {
  const complete = (items: unknown[]): unknown[] => items.flatMap(item => {
    const block = item as { type: string; props?: { url?: string }; children?: unknown[] };
    if (block.type === "image" && !block.props?.url) return [];
    return [{ ...block, children: complete(block.children ?? []) }];
  });
  const filtered = complete(blocks);
  return filtered.length ? blockNoteBlocksToReadingNoteDocument(filtered) :
    blockNoteBlocksToReadingNoteDocument([{ id: "scratchpad-start", type: "paragraph", props: {}, content: [], children: [] }]);
}

export function ChapterScratchpad({ api, bookId, chapterId, chapterTitle, suspended = false }: {
  api: ChapterScratchpadApi; bookId: string; chapterId: string; chapterTitle: string; suspended?: boolean;
}) {
  const session = useMemo(() => chapterScratchpadSession(api, { bookId, chapterId }), [api, bookId, chapterId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editorError, setEditorError] = useState("");
  useEffect(() => { setEditorError(""); }, [session]);
  const [position, setPosition] = useState(initialPosition);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const regionId = useId();
  function close() { void session.flush(); setOpen(false); window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }
  function show() { setVisited(true); setOpen(true); }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (suspended || event.isComposing || event.defaultPrevented || event.repeat || event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        if (open) close(); else show();
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [open, suspended, session]);
  useEffect(() => {
    const unloading = (event: BeforeUnloadEvent) => {
      void session.flush();
      const current = session.getSnapshot();
      if (current.dirty && current.recoveryWarning) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unloading);
    return () => { window.removeEventListener("beforeunload", unloading); void session.flush(); };
  }, [session]);
  const remember = (next: { x: number; y: number }) => {
    const safe = scratchpadPosition(next);
    setPosition(safe);
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(safe)); } catch { /* Position is optional. */ }
  };
  function drag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !layer.current || !panel.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const bounds = layer.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const startX = event.clientX, startY = event.clientY;
    let next = position;
    handle.setPointerCapture(event.pointerId);
    function move(pointer: PointerEvent) {
      next = scratchpadPosition({
        x: bounds.width > box.width ? (box.left - bounds.left + pointer.clientX - startX) / (bounds.width - box.width) : 0,
        y: bounds.height > box.height ? (box.top - bounds.top + pointer.clientY - startY) / (bounds.height - box.height) : 0
      });
      setPosition(next);
    }
    function finish() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      remember(next);
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
  }
  const hasContent = !readingNoteDocumentIsEmpty(state.content);
  return <div className="chapter-scratchpad-layer" ref={layer} hidden={suspended}>
    <button ref={trigger} className={`chapter-scratchpad-launch${state.error ? " has-error" : ""}`} type="button"
      hidden={open} aria-label="Open chapter scratchpad" aria-expanded={open} aria-controls={regionId}
      title="Chapter scratchpad · ⌘/Ctrl+Shift+J" onClick={show}>
      <Icon kind="note" />
      {hasContent || state.error ? <span className="chapter-scratchpad-dot" aria-label={state.error ? "Scratchpad needs attention" : "This chapter has notes"} /> : null}
    </button>
    <section ref={panel} id={regionId} aria-label="Chapter scratchpad" hidden={!open}
      className={`chapter-scratchpad${expanded ? " expanded" : ""}`} style={{
        left: `${position.x * 100}%`, top: `${position.y * 100}%`, transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`
      } as CSSProperties}
      onKeyDownCapture={event => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing || event.defaultPrevented) return;
        // Capture before ProseMirror closes its menu. Mantine may leave hidden
        // dropdown shells mounted during transitions; those must not trap Escape.
        const hasMenu = Array.from(document.querySelectorAll<HTMLElement>(
          '.bn-suggestion-menu, .bn-file-panel, .bn-link-toolbar, [role="menu"]'
        )).some(menu => {
          const style = getComputedStyle(menu);
          return !menu.closest('[hidden], [aria-hidden="true"], [data-state="closed"]') &&
            style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        });
        if (hasMenu) return;
        event.preventDefault(); event.stopPropagation(); close();
      }}>
      <header className="chapter-scratchpad-header">
        <button type="button" className="chapter-scratchpad-drag" aria-label="Move scratchpad" title="Drag to move · Arrow keys to reposition"
          onPointerDown={drag} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            remember({ x: position.x + (event.key === "ArrowLeft" ? -.1 : event.key === "ArrowRight" ? .1 : 0),
              y: position.y + (event.key === "ArrowUp" ? -.1 : event.key === "ArrowDown" ? .1 : 0) });
          }}><Icon kind="grip" /><span>Chapter scratchpad</span></button>
        <button type="button" className="chapter-scratchpad-tool" aria-label={expanded ? "Shrink scratchpad" : "Expand scratchpad"} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}><Icon kind="expand" /></button>
        <button type="button" className="chapter-scratchpad-tool" aria-label="Minimize scratchpad" title="Minimize · Esc" onClick={close}><Icon kind="minimize" /></button>
      </header>
      <div className="chapter-scratchpad-source" title={chapterTitle}>{chapterTitle}</div>
      <div className="chapter-scratchpad-body">
        {state.phase === "ready" && visited ? <ScratchpadEditor key={JSON.stringify([bookId, chapterId])} api={api} session={session} state={state} open={open && !suspended} onError={setEditorError} /> :
          <p className="chapter-scratchpad-loading">{state.error ? "Unable to load this chapter’s scratchpad." : "Loading scratchpad…"}</p>}
      </div>
      <footer className="chapter-scratchpad-footer">
        <span role="status">{state.error || editorError ? "Not saved" : state.saving ? "Saving…" : state.dirty ? "Unsaved changes" : state.phase === "loading" ? "Loading…" : "Saved"}</span>
        <span>⌘ / Ctrl ⇧ J</span>
      </footer>
      {state.error ? <div className="chapter-scratchpad-error" role="alert"><span>{state.error}</span><button type="button" onClick={() => void session.retry()}>{state.phase === "loading" ? "Retry loading" : "Save my draft"}</button></div> : null}
      {state.recoveryWarning ? <p className="chapter-scratchpad-error" role="alert">{state.recoveryWarning}</p> : null}
    </section>
  </div>;
}
