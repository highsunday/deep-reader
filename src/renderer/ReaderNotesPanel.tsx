import { ReadingNoteSidebarTagFilter } from "./ReadingNoteTags";
import { ReadingNoteBookFilter } from "./ReadingNoteBookFilter";
import { readingNoteImage } from "../shared/reading-note-images";
import { ReaderNoteVisualActions } from "./ReaderNoteVisualActions";
import { ReadingNoteInlineVisual } from "./ReadingNoteInlineVisual";
import { readingNoteDocumentAttachmentIds } from "../shared/reading-note-document";
import { ReadingNoteSourceContext } from "./reading-note-source-context";
import { resolveReadingNoteSource } from "../shared/reading-note-source";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MemoryImageSide, ReaderDesktopApi, ReadingNote } from "../shared/contracts";
import type { ReadingNoteBlock, ReadingNoteInlineContent } from "../shared/reading-note-document";
import { ReaderNoteHighlightContent } from "./ReaderNoteHighlightContent";

function NotesIcon({ kind }: { kind: "note" | "search" | "back" | "edit" }) {
  const paths = {
    note: "M5 3h8l3 3v11H5V3Z M12 3v4h4 M8 10h5 M8 13h5",
    search: "M14 14l3 3 M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0",
    back: "M12 4l-6 6 6 6 M6 10h11",
    edit: "M12 4l4 4 M4 12l9-9 4 4-9 9-5 1 1-5Z",
  };
  return <svg className="reader-notes-icon" viewBox="0 0 20 20" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function inlineText(items: ReadingNoteInlineContent[]): string {
  return items.map((item) => item.type === "text" ? item.text
    : item.type === "inlineMath" ? item.props.latex
    : inlineText(item.content)).join("");
}

function blockText(block: ReadingNoteBlock): string {
  const text = Array.isArray(block.content) ? inlineText(block.content)
    : block.content ? block.content.rows.map((row) => row.cells.map(inlineText).join(" ")).join(" ")
    : block.type === "image" ? String(block.props.alt || block.props.caption || "")
    : block.type === "mathBlock" ? String(block.props.latex || "") : "";
  return [text, ...block.children.map(blockText)].filter(Boolean).join(" ");
}

function NoteThumbnail({ attachmentId, api }: {
  attachmentId: string;
  api: ReaderDesktopApi["readingNotes"];
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let current = true;
    void api.attachments.readDataUrl(attachmentId)
      .then((value) => { if (current) setUrl(value); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [api, attachmentId]);
  return url ? <img className="reader-notes-thumbnail" src={url} alt=""
    loading="lazy" decoding="async" onError={() => setUrl(undefined)} /> : null;
}

function NotePreview({ note, api, initialSide, onSaved }: { note: ReadingNote; api: ReaderDesktopApi["readingNotes"]; initialSide?: MemoryImageSide; onSaved(note: ReadingNote): void }) {
  const sourceNavigation = useContext(ReadingNoteSourceContext);
  const source = resolveReadingNoteSource(note, sourceNavigation?.books ?? []);
  const [highlightSaved, setHighlightSaved] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewMounted = useRef(true);
  useEffect(() => {
    previewMounted.current = true;
    return () => { previewMounted.current = false; clearTimeout(noticeTimer.current); };
  }, []);
  function savedHighlight(saved: ReadingNote) {
    if (previewMounted.current) {
      setHighlightSaved(true);
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setHighlightSaved(false), 1800);
    }
    onSaved(saved);
  }
  const frontId = readingNoteImage(note, "understand")?.attachmentId;
  const backId = readingNoteImage(note, "recall")?.attachmentId;
  const embeddedIds = readingNoteDocumentAttachmentIds(note.content);
  // An illustration already in the document gets its flip control in place.
  const showVisual = initialSide || (frontId ? !embeddedIds.includes(frontId) : backId && !embeddedIds.length);
  const visualSide = initialSide ?? (frontId ? "understand" : "recall");
  return <>
    <h2>{note.title}</h2>
    <div className="reader-notes-source"><NotesIcon kind="note" /><div className="reader-notes-source-copy">
      <button type="button" className="reader-notes-source-link" aria-label="開啟原文章節"
        title={source.reason ?? "開啟原文章節"} disabled={!sourceNavigation || !source.target}
        onClick={() => { if (source.target) sourceNavigation?.open(source.target); }}>
        <span>{note.bookTitle}</span><strong>{note.chapterTitle}</strong>
      </button>
      {sourceNavigation && source.reason ? <small>{source.reason}</small> : null}
    </div></div>
    {showVisual ? <div className="reader-notes-inline-visual">
      <ReadingNoteInlineVisual key={`${note.id}:${frontId}:${backId}:${initialSide}`} api={api}
        frontId={frontId} backId={backId} initialSide={visualSide}
        alt={`${visualSide === "understand" ? "Understanding" : "Recall"} image for ${note.title}`} />
    </div> : null}
    <ReaderNoteHighlightContent key={note.id} api={api} note={note} onSaved={savedHighlight} onStart={() => setHighlightSaved(false)} />
    {highlightSaved ? <div className="reader-note-highlight-notice" role="status"><span aria-hidden="true">✓</span> Highlight saved</div> : null}
  </>;
}

export function ReaderNotesPanel({
  api, notes, allNotes = notes, chapterTitle, loading, error, selectedId, focusedNote, initialImageSide, focusRequest, onSelect,
  onEdit, onVisual, onSaved, onCreate, canCreate, onRefresh
}: {
  api: ReaderDesktopApi["readingNotes"];
  notes: ReadingNote[];
  allNotes?: ReadingNote[];
  chapterTitle: string;
  loading: boolean;
  error: string;
  selectedId?: string;
  focusedNote?: ReadingNote;
  initialImageSide?: MemoryImageSide;
  focusRequest?: number;
  onSelect(id: string | undefined): void;
  onEdit(note: ReadingNote): void;
  onVisual?(note: ReadingNote): void;
  onSaved?(note: ReadingNote): void;
  onCreate(): void;
  canCreate: boolean;
  onRefresh(): void;
}) {
  const [scope, setScope] = useState<"chapter" | "book" | "all">("chapter");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const filteringTags = scope === "all" && tagFilter.length > 0;
  const [bookFilter, setBookFilter] = useState<string>();
  const books = useMemo(() => [...new Set(allNotes.map(note => note.bookTitle))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [allNotes]);
  const filteringBook = scope === "all" && Boolean(bookFilter);
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const selected = focusedNote?.id === selectedId ? focusedNote : allNotes.find((note) => note.id === selectedId);
  useEffect(() => {
    if (selected) backRef.current?.focus({ preventScroll: true });
  }, [selected?.id]);
  const filtered = useMemo(() => (scope === "all" ? allNotes : notes).filter((note) =>
    (scope !== "all" || !tagFilter.length || tagFilter.some(id => note.tagIds?.includes(id))) &&
    (scope !== "chapter" || note.chapterTitle === chapterTitle) &&
    (scope !== "all" || !bookFilter || note.bookTitle === bookFilter) &&
    note.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ), [notes, allNotes, scope, chapterTitle, search, bookFilter, tagFilter]);
  const searching = Boolean(search.trim());

  function back() {
    onSelect(undefined);
    window.requestAnimationFrame(() => {
      const button = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-id]") ?? [])
        .find((item) => item.dataset.noteId === selectedId);
      button?.focus({ preventScroll: true });
    });
  }

  return (
    <section className="reader-notes-panel" aria-label="Saved reading notes">
      <div className="reader-notes-list-view" hidden={Boolean(selected)}>
        <div className="reader-notes-controls">
          <div className="reader-notes-scopes" role="group" aria-label="Note scope">
            <button type="button" aria-pressed={scope === "chapter"} onClick={() => setScope("chapter")}>This chapter</button>
            <button type="button" aria-pressed={scope === "book"} onClick={() => setScope("book")}>This book</button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All notes</button>
          </div>
          <p className="reader-notes-context" title={scope === "chapter" ? chapterTitle : undefined}>{scope === "chapter" ? chapterTitle : scope === "all" ? "All saved notes" : "All chapters in this book"}</p>
          <label className="reader-notes-search">
            <NotesIcon kind="search" />
            <span className="visually-hidden">Search note titles</span>
            <input type="search" placeholder="Search note titles…" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          {scope === "all" ? <ReadingNoteBookFilter books={books} value={bookFilter} onChange={setBookFilter} /> : null}
          {scope === "all" && api.tags ? <ReadingNoteSidebarTagFilter api={api.tags} selected={tagFilter} onChange={setTagFilter} refreshKey={allNotes} /> : null}
          {!loading && !error ? <div className="reader-notes-summary"><span>{filtered.length} {filtered.length === 1 ? "note" : "notes"}{searching || filteringBook || filteringTags ? " found" : ""}</span>{filtered.length ? <span>Newest first</span> : null}</div> : null}
        </div>
        <div ref={listRef} className="reader-notes-results" aria-busy={loading}>
          {loading ? <p role="status">Loading notes…</p> : null}
          {error ? <div className="reader-notes-empty" role="alert">
            <p>{error}</p><button type="button" onClick={onRefresh}>Retry</button>
          </div> : null}
          {!loading && !error && !filtered.length ? <div className="reader-notes-empty">
            <span className="reader-notes-empty-icon"><NotesIcon kind={searching || filteringBook || filteringTags ? "search" : "note"} /></span>
            <p>{searching || filteringBook || filteringTags ? "No matching notes." : scope === "chapter" ? "No notes in this chapter yet." : scope === "all" ? "No saved notes yet." : "No notes in this book yet."}</p>
            <span className="reader-notes-empty-hint">{filteringTags ? "Try another tag or clear the tag filter." : filteringBook ? "Try another book or clear the book filter." : searching ? "Try a different word from the title." : canCreate ? "Keep an idea from your reading, in your own words." : "Set a START and END reading range to create a note."}</span>
            {searching || filteringBook || filteringTags ? <>
              {filteringTags ? <button type="button" onClick={() => setTagFilter([])}>Clear tag filter</button> : null}
              {searching ? <button type="button" onClick={() => setSearch("")}>Clear search</button> : null}
              {filteringBook ? <button type="button" onClick={() => setBookFilter(undefined)}>Clear book filter</button> : null}
            </> : <>
              {scope === "chapter" ? <button type="button" onClick={() => setScope("book")}>View book notes</button> : null}
              <button type="button" onClick={onCreate} disabled={!canCreate}>Create note</button>
            </>}
          </div> : null}
          {filtered.map((note) => <button key={note.id} type="button" data-note-id={note.id}
            className="reader-notes-row" onClick={() => onSelect(note.id)}>
            {readingNoteImage(note, "recall") ? <NoteThumbnail key={readingNoteImage(note, "recall")!.attachmentId}
              attachmentId={readingNoteImage(note, "recall")!.attachmentId} api={api} /> : null}
            <span className="reader-notes-row-copy">
              <strong>{note.title}</strong>
              <span className="reader-notes-excerpt">{note.content.blocks.map(blockText).join(" ") || "No text content"}</span>
              {scope !== "chapter" ? <small>{scope === "all" ? `${note.bookTitle} · ` : ""}{note.chapterTitle}</small> : null}
            </span>
          </button>)}
        </div>
      </div>
      {selected ? <div className="reader-notes-detail">
        <div className="reader-notes-detail-actions">
          <button ref={backRef} className="reader-notes-back" type="button" aria-label="Notes" title="Back to notes" onClick={back}><NotesIcon kind="back" /><span>Notes</span></button>
          <button className="reader-notes-edit" type="button" aria-label="Edit" title="Edit note" onClick={() => onEdit(selected)}><NotesIcon kind="edit" /><span>Edit</span></button>
        <ReaderNoteVisualActions key={`visuals:${selected.id}`} api={api} note={selected}
          onSaved={onSaved ?? onRefresh} onAdjust={onVisual ? () => onVisual(selected) : undefined} />
        </div>
        <div className="reader-notes-preview" key={`${selected.id}:${focusRequest ?? 0}`} role="region" aria-label="Note preview">
          <NotePreview note={selected} api={api} initialSide={initialImageSide} onSaved={onSaved ?? onRefresh} />
        </div>
      </div> : null}
    </section>
  );
}
