import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { ReaderDesktopApi, ReadingNote, UpdateReadingNoteInput } from "../shared/contracts";
import { readingNoteSchema } from "./reading-note-schema";
import { blockNoteBlocksToReadingNoteDocument, readingNoteDocumentToBlockNoteBlocks } from "./reading-note-editor-adapter";
import { ReadingNoteVisualContext } from "./ReadingNoteInlineVisual";

const colors = ["Yellow", "Green", "Blue", "Pink", "Purple"] as const;
type TextRange = { from: number; to: number; domRange: Range; color?: string; highlighted: boolean };

/** The sidebar can change text marks, while the editor itself stays read-only. */
export function ReaderNoteHighlightContent({ api, note, onSaved, onStart }: {
  api: ReaderDesktopApi["readingNotes"];
  note: ReadingNote;
  onSaved(note: ReadingNote): void;
  onStart?(): void;
}) {
  const editor = useCreateBlockNote({
    schema: readingNoteSchema,
    initialContent: readingNoteDocumentToBlockNoteBlocks(note.content) as never,
    resolveFileUrl: async url => {
      if (!url.startsWith("reading-note-asset:")) throw new Error("Only managed note images are supported.");
      return api.attachments.readDataUrl(url.slice("reading-note-asset:".length));
    }
  });
  const toolbar = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const pending = useRef<UpdateReadingNoteInput | undefined>(undefined);
  const saving = useRef(false);
  const revision = useRef(note.revision);
  const lastContent = useRef(note.content);
  const [selection, setSelection] = useState<TextRange>();
  const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 280, visible: false });
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    // A successful local highlight is already in this editor; keep its DOM and scroll.
    // External changes still refresh the document, unless an unsaved snapshot needs retrying.
    if (note.revision <= revision.current || pending.current) return;
    if (JSON.stringify(note.content) !== JSON.stringify(lastContent.current)) {
      editor.replaceBlocks(editor.document, readingNoteDocumentToBlockNoteBlocks(note.content) as never);
      setSelection(undefined);
    }
    revision.current = note.revision;
    lastContent.current = note.content;
  }, [editor, note.revision, note.content, state]);

  useEffect(() => {
    mounted.current = true;
    let dragging = false;
    const selectionChanged = () => {
      // Keyboard focus in the toolbar keeps the range chosen in the document.
      if (dragging || toolbar.current?.contains(document.activeElement) || saving.current || pending.current) return;
      const native = window.getSelection();
      const dom = editor.prosemirrorView.dom;
      const range = native?.rangeCount === 1 ? native.getRangeAt(0) : undefined;
      let next: TextRange | undefined;
      if (range && !range.collapsed && native?.toString().trim() &&
        dom.contains(range.startContainer) && dom.contains(range.endContainer)) {
        try {
          const from = editor.prosemirrorView.posAtDOM(range.startContainer, range.startOffset);
          const to = editor.prosemirrorView.posAtDOM(range.endContainer, range.endOffset);
          // Inspect only text: images and formula atoms cannot be highlighted.
          const backgrounds = new Set<string>();
          editor.prosemirrorView.state.doc.nodesBetween(from, to, node => {
            if (node.isText) backgrounds.add(node.marks.find(mark => mark.type.name === "backgroundColor")?.attrs.stringValue ?? "");
          });
          if (from < to && backgrounds.size) next = {
            from, to, domRange: range.cloneRange(),
            color: backgrounds.size === 1 ? [...backgrounds][0] : undefined,
            highlighted: [...backgrounds].some(Boolean)
          };
        } catch { /* A detached DOM selection cannot be mapped to this document. */ }
      }
      setSelection(next);
    };
    const pointerDown = (event: PointerEvent) => {
      if (toolbar.current?.contains(event.target as Node)) return;
      dragging = editor.prosemirrorView.dom.contains(event.target as Node);
      if (!saving.current && !pending.current) setSelection(undefined);
    };
    const pointerUp = () => { dragging = false; selectionChanged(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (toolbar.current?.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
      setSelection(undefined);
    };
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("keydown", escape);
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (!selection || !toolbar.current || state !== "idle") return;
    const panel = editor.prosemirrorView.dom.closest(".reader-notes-preview")!;
    const place = () => {
      const bounds = panel.getBoundingClientRect();
      const rect = selection.domRange.getBoundingClientRect?.() ?? editor.prosemirrorView.dom.getBoundingClientRect();
      const tool = toolbar.current?.getBoundingClientRect();
      if (!tool) return;
      const leftEdge = Math.max(0, bounds.left) + 8;
      const rightEdge = Math.min(window.innerWidth, bounds.right || window.innerWidth) - 8;
      const topEdge = Math.max(0, bounds.top) + 8;
      const bottomEdge = Math.min(window.innerHeight, bounds.bottom || window.innerHeight) - 8;
      const maxWidth = Math.max(0, rightEdge - leftEdge);
      const width = Math.min(tool.width, maxWidth);
      const left = Math.max(leftEdge, Math.min(rect.left + rect.width / 2 - width / 2, rightEdge - width));
      const above = rect.top - tool.height - 8;
      const top = above >= topEdge ? above : Math.min(rect.bottom + 8, bottomEdge - tool.height);
      const visible = !panel.closest("[hidden]") && (!rect.height || (rect.bottom > topEdge && rect.top < bottomEdge));
      const next = { left, top: Math.max(topEdge, top), maxWidth, visible };
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    observer.observe(panel); observer.observe(toolbar.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [selection, editor, state]);

  async function save() {
    const input = pending.current;
    if (!input || saving.current) return;
    saving.current = true;
    setState("saving"); setError("");
    try {
      const saved = await api.update(input);
      revision.current = saved.revision;
      lastContent.current = saved.content;
      pending.current = undefined;
      if (mounted.current) { setSelection(undefined); setState("idle"); }
      // Even after navigation, update the cache for the saved note's own ID.
      onSaved(saved);
    } catch (cause) {
      if (mounted.current) {
        setSelection(undefined);
        setState("error");
        setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "Unable to save highlights.");
      }
    } finally { saving.current = false; }
  }

  function highlight(color?: string) {
    if (!selection || saving.current || pending.current) return;
    onStart?.();
    const before = blockNoteBlocksToReadingNoteDocument(editor.document);
    editor.transact(tr => {
      const mark = editor.pmSchema.marks.backgroundColor;
      tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!node.isText) return;
        const from = Math.max(pos, selection.from), to = Math.min(pos + node.nodeSize, selection.to);
        if (color) tr.addMark(from, to, mark.create({ stringValue: color }));
        else tr.removeMark(from, to, mark);
      });
    });
    const content = blockNoteBlocksToReadingNoteDocument(editor.document);
    if (JSON.stringify(before) === JSON.stringify(content)) return;
    pending.current = { id: note.id, baseRevision: revision.current, title: note.title, content };
    void save();
  }

  return <div className="reader-note-highlight-content">
    {selection && state !== "error" ? createPortal(<div ref={toolbar} className="reader-note-highlight-toolbar" role="toolbar" aria-label="Highlight text"
      style={{ left: position.left, top: position.top, maxWidth: position.maxWidth, visibility: position.visible ? "visible" : "hidden" }}
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(toolbar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true }); event.preventDefault();
      }}>

      {colors.map(color => <button key={color} type="button" className="reader-note-highlight-color"
        data-color={color.toLowerCase()} aria-label={`${color} highlight`} title={`${color} highlight`}
        aria-pressed={selection.color === color.toLowerCase()} disabled={state === "saving"}
        onClick={() => highlight(color.toLowerCase())}><span>{selection.color === color.toLowerCase() ? "✓" : ""}</span></button>)}
      <span className="reader-note-highlight-divider" />
      <button type="button" className="reader-note-highlight-clear" aria-label="Clear highlight" title="Clear highlight"
        disabled={state === "saving" || !selection.highlighted} onClick={() => highlight()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11 3 6 6-7 8H6l-4-4Zm-5 6 6 6M10 17h7" /></svg>
      </button>
    </div>, document.body) : null}
    {state === "saving" ? <div className="reader-note-highlight-notice" role="status">Saving highlight…</div> : null}
    {state === "error" ? <div className="reader-note-highlight-error" role="alert"><span><strong>Highlight not saved</strong><span>{error}</span></span>
      <button type="button" aria-label="Retry highlight save" onClick={() => void save()}>Retry</button>
    </div> : null}
    <ReadingNoteVisualContext.Provider value={{ api, note, browsing: true }}>
      <BlockNoteView editor={editor} editable={false} theme="light"
        formattingToolbar={false} sideMenu={false} slashMenu={false} />
    </ReadingNoteVisualContext.Provider>
  </div>;
}
