import { HeptabaseImportAction } from "./HeptabaseImport";
import { CardNoteUploadPanel } from "./CardNoteUploadPanel";
import { ReadingNoteTagFilter, ReadingNoteTagManager, ReadingNoteTagPicker } from "./ReadingNoteTags";
import { ReadingNoteBookFilter } from "./ReadingNoteBookFilter";
import { ReadingNoteReviewControl } from "./ReadingNoteReviewControl";
import type { SpacedReviewApi } from "../shared/spaced-review";
import { readingNoteImage } from "../shared/reading-note-images";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  MemoryImageSide,
  ReaderDesktopApi,
  ReadingNote,
  ReadingNoteCounts,
  ReadingNoteTag,
  ReadingNoteListInput,
  ReadingNoteSummary,
  ReadingNoteStatus
} from "../shared/contracts";
import { ReadingNoteEditorDialog } from "./ReadingNoteEditorDialog";
import { ReadingNoteDefaultVisualIcon } from "./ReadingNoteDefaultVisualIcon";
import { ReadingNoteVisualLightbox } from "./ReadingNoteTwoSidedLightbox";
import { readingNoteDocumentToMarkdown } from "../shared/reading-note-document";
import { activeMemoryImageSides } from "./memory-image-generation-state";

export interface ReadingNoteFilterOptions {
  books: string[];
}

export function readingNoteFilterOptions(notes: Pick<ReadingNote, "bookTitle">[]): ReadingNoteFilterOptions {
  const books = [...new Set(notes.map((note) => note.bookTitle))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  return { books };
}

function createdTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function ReadingNoteSourceDisclosure({ kind, value }: { kind: "book" | "chapter"; value: string }) {
  const [expanded, setExpanded] = useState(false);
  const label = kind === "book" ? "Book" : "Chapter";
  return (
    <button
      className={`reading-note-detail-source-item${expanded ? " expanded" : ""}`}
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((current) => !current)}
    >
      {kind === "book" ? (
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h8.25a2 2 0 0 1 2 2v11.5H6a2.25 2.25 0 0 0-2.25 2.25V4.5Z" /><path d="M6 2.25v13.5M3.75 18A2.25 2.25 0 0 1 6 15.75" /></svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5.25 3.25h9.5v13.5L10 13.9l-4.75 2.85V3.25Z" /></svg>
      )}
      <span className="reading-note-detail-source-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <svg className="reading-note-detail-source-chevron" aria-hidden="true" viewBox="0 0 20 20"><path d="m6.5 8 3.5 3.5L13.5 8" /></svg>
    </button>
  );
}

export function ReadingNoteLibraryHeader({
  view,
  counts,
  query,
  filterOptions,
  emptyTrashConfirming = false,
  mutating = false,
  onView,
  onQuery,
  onClear,
  onEmptyTrash,
  onCancelEmptyTrash,
  onConfirmEmptyTrash,
  tagTools
}: {
  view: ReadingNoteStatus;
  counts: ReadingNoteCounts;
  query: ReadingNoteListInput;
  filterOptions: ReadingNoteFilterOptions;
  emptyTrashConfirming?: boolean;
  mutating?: boolean;
  onView(view: ReadingNoteStatus): void;
  onQuery(query: ReadingNoteListInput): void;
  onClear(): void;
  onEmptyTrash(): void;
  onCancelEmptyTrash?(): void;
  onConfirmEmptyTrash?(): void;
  tagTools?: ReactNode;
}) {
  const filtersActive = Boolean(query.search || query.bookTitle || query.tagIds?.length || query.sort !== "recent");
  function patchQuery(update: Partial<ReadingNoteListInput>) {
    onQuery({ ...query, ...update });
  }
  return (
    <>
      <div className="reading-note-library-sticky">
        <div className="reading-note-library-toolbar-inner">
        <header className="reading-note-library-heading library-page-heading">
          <div>
            <span className="library-page-eyebrow">Your knowledge</span>
            <h1>{view === "active" ? "Notes" : "Trash"}</h1>
            <p>{view === "active"
              ? "Organize, search, and revisit the ideas you want to remember."
              : "Items stay here until you permanently empty Trash."}</p>
          </div>
          {view === "active" ? (
            <button className="reading-note-trash-entry" type="button" onClick={() => onView("trashed")}>
              <svg className="reading-note-trash-entry-icon" aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3.5 5.25h13M8 2.75h4M5.25 5.25l.75 11h8l.75-11M8 8v5.5M12 8v5.5" />
              </svg>
              <span>Trash</span><strong>{counts.trashed}</strong>
            </button>
          ) : (
            <button className="secondary-action" type="button" onClick={() => onView("active")}>
              ← Back to Reading Notes
            </button>
          )}
        </header>
        {view === "active" ? (
          <div className="reading-note-library-controls" aria-label="Reading Notes search and filters">
            <label className="reading-note-search">
              <span>Search titles</span>
              <span className="reading-note-search-field">
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <circle cx="8.75" cy="8.75" r="5.25" /><path d="m12.5 12.5 4 4" />
                </svg>
                <input
                  type="search"
                  aria-label="Search reading note titles"
                  placeholder="Enter a title"
                  value={query.search ?? ""}
                  onChange={(event) => patchQuery({ search: event.target.value || undefined })}
                />
              </span>
            </label>
            <ReadingNoteBookFilter
              books={filterOptions.books}
              value={query.bookTitle}
              onChange={(bookTitle) => patchQuery({ bookTitle })}
            />
            <label>
              Sort
              <select
                value={query.sort}
                onChange={(event) => patchQuery({
                  sort: event.target.value as ReadingNoteListInput["sort"]
                })}
              >
                <option value="recent">Recently added</option>
                <option value="alphabetical">Title: A–Z</option>
              </select>
            </label>
            <button type="button" onClick={onClear} disabled={!filtersActive}>Clear filters</button>
          </div>
        ) : (
          <div className="reading-note-trash-toolbar">
            <strong>{counts.trashed} {counts.trashed === 1 ? "item" : "items"}</strong>
            <button
              className="danger-outline-action"
              type="button"
              disabled={!counts.trashed || mutating}
              onClick={onEmptyTrash}
            >
              <svg className="reading-note-empty-trash-icon" aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3.5 5.25h13M8 2.75h4M5.25 5.25l.75 11h8l.75-11M8 8v5.5M12 8v5.5" />
              </svg>
              <span>Empty Trash</span>
            </button>
          </div>
        )}
        {view === "active" ? tagTools : null}
        </div>
      </div>
      {emptyTrashConfirming ? (
        <div className="dialog-backdrop">
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="empty-reading-note-trash-title">
            <span className="delete-dialog-icon" aria-hidden="true">!</span>
            <h2 id="empty-reading-note-trash-title">Permanently empty Trash?</h2>
            <p>Every reading note in Trash will be permanently deleted. This cannot be undone.</p>
            <div className="delete-dialog-actions">
              <button type="button" onClick={onCancelEmptyTrash} disabled={mutating}>Cancel</button>
              <button className="danger-action" type="button" onClick={onConfirmEmptyTrash} disabled={mutating}>
                {mutating ? "Emptying…" : "Empty Trash"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function ReadingNoteList({
  view,
  notes,
  mutating,
  restoringNoteId,
  generatingNoteSides = new Map<string, ReadonlySet<MemoryImageSide>>(),
  onOpen,
  onRestore,
  readAttachmentDataUrl,
  reviewApi,
  tags = [], selecting = false, selectedIds = new Set<string>(), onToggle
}: {
  view: ReadingNoteStatus;
  notes: ReadingNoteSummary[];
  mutating: boolean;
  restoringNoteId?: string;
  generatingNoteSides?: ReadonlyMap<string, ReadonlySet<MemoryImageSide>>;
  onOpen(note: ReadingNoteSummary, initialView?: "note" | "visual"): void;
  onRestore(noteId: string): void;
  readAttachmentDataUrl?(attachmentId: string): Promise<string>;
  reviewApi?: SpacedReviewApi;
  tags?: ReadingNoteTag[];
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggle?(id: string): void;
}) {
  return view === "active" ? (
    <div className="reading-note-library-grid" aria-label="Saved reading notes">
      {notes.map((note) => (
        <ReadingNoteLibraryCard
          key={note.id}
          note={note}
          tags={tags} selecting={selecting} selectedIds={selectedIds} onToggle={onToggle}
          generatingSides={generatingNoteSides.get(note.id) ?? new Set<MemoryImageSide>()}
          onOpen={onOpen}
          reviewApi={reviewApi}
          readAttachmentDataUrl={readAttachmentDataUrl}
        />
      ))}
    </div>
  ) : (
    <div className="reading-note-trash-list" aria-label="Reading notes in Trash">
      {notes.map((note) => {
        const deletedAt = note.trashedAt ?? note.updatedAt;
        const restoring = restoringNoteId === note.id;
        return (
          <article className="reading-note-trash-item" key={note.id} data-note-id={note.id} aria-busy={restoring}>
            <button
              type="button"
              className="reading-note-trash-preview"
              aria-label={`Open ${note.title}`}
              onClick={() => onOpen(note, "note")}
            >
              <span className="reading-note-trash-note-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M7 3.75h7l4 4V20.25H7V3.75Z" />
                  <path d="M14 3.75v4h4M9.75 12h5.5M9.75 15.5h4" />
                </svg>
              </span>
              <span className="reading-note-trash-copy">
                <span className="reading-note-trash-meta">
                  <span title={note.bookTitle}>{note.bookTitle}</span>
                  <span aria-hidden="true">·</span>
                  <span title={note.chapterTitle}>{note.chapterTitle}</span>
                </span>
                <strong className="reading-note-trash-title">{note.title}</strong>
                <span className="reading-note-trash-deleted">
                  <svg aria-hidden="true" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="6.75" />
                    <path d="M10 6.5v4l2.75 1.5" />
                  </svg>
                  <span>Deleted <time dateTime={new Date(deletedAt).toISOString()}>{createdTime(deletedAt)}</time></span>
                </span>
              </span>
              <svg className="reading-note-trash-open-icon" aria-hidden="true" viewBox="0 0 20 20">
                <path d="m7.5 4.75 5 5.25-5 5.25" />
              </svg>
            </button>
            <button
              type="button"
              className="reading-note-trash-restore"
              disabled={mutating}
              aria-label={`Restore ${note.title}`}
              onClick={() => onRestore(note.id)}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M5.25 7.25H2.75v-2.5" />
                <path d="M3 7.1a7 7 0 1 1-.15 5.45" />
              </svg>
              <span>{restoring ? "Restoring…" : "Restore"}</span>
            </button>
          </article>
        );
      })}
    </div>
  );
}

function ReadingNoteLibraryCard({
  note,
  generatingSides,
  onOpen,
  readAttachmentDataUrl,
  reviewApi,
  tags = [], selecting = false, selectedIds = new Set<string>(), onToggle
}: {
  note: ReadingNoteSummary;
  generatingSides: ReadonlySet<MemoryImageSide>;
  onOpen(note: ReadingNoteSummary, initialView?: "note" | "visual"): void;
  readAttachmentDataUrl?: (attachmentId: string) => Promise<string>;
  reviewApi?: SpacedReviewApi;
  tags?: ReadingNoteTag[];
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggle?(id: string): void;
}) {
  const [side, setSide] = useState<MemoryImageSide>("recall");
  const [expanded, setExpanded] = useState(false);
  const nextSide: MemoryImageSide = side === "recall" ? "understand" : "recall";
  const nextFace = nextSide === "understand" ? "front" : "back";
  const nextPurpose = nextSide === "understand" ? "understanding" : "recall";
  const hasFront = Boolean(readingNoteImage(note, "understand"));
  const hasBack = Boolean(readingNoteImage(note, "recall"));
  const currentFace = side === "understand" ? "Front" : "Back";
  const currentGenerating = generatingSides.has(side);
  const frontStatus = generatingSides.has("understand") ? "generating" : hasFront ? "generated" : "not generated";
  const backStatus = generatingSides.has("recall") ? "generating" : hasBack ? "generated" : "not generated";
  const detailedFaceStatus = `Current face: ${currentFace}. Front image: ${frontStatus}. Back image: ${backStatus}.`;

  return (
    <div className="reading-note-card-container" role="group" aria-label={note.title} data-note-id={note.id} data-side={side} data-selected={selecting && selectedIds.has(note.id)}>
        <button
          className={`reading-note-library-card${currentGenerating ? " generating" : ""}`}
          type="button"
          aria-busy={currentGenerating}
          aria-label={selecting ? `Select ${note.title}` : undefined}
          aria-pressed={selecting ? selectedIds.has(note.id) : undefined}
          onClick={() => selecting ? onToggle?.(note.id) : onOpen(note, "note")}
        >
          <ReadingNoteCardVisual
            note={note}
            side={side}
            generating={currentGenerating}
            readAttachmentDataUrl={readAttachmentDataUrl}
          />
          <strong className="reading-note-card-title" title={note.title}>{note.title}</strong>
          <span className="reading-note-card-source">
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h8.25a2 2 0 0 1 2 2v11.5H6a2.25 2.25 0 0 0-2.25 2.25V4.5Z" />
              <path d="M6 2.25v13.5M3.75 18A2.25 2.25 0 0 1 6 15.75" />
            </svg>
            <span title={note.bookTitle}>{note.bookTitle}</span>
          </span>
          {tags.length > 0 ? <span className="note-tag-card-chips" aria-label="Tags" title={tags.filter(tag => note.tagIds?.includes(tag.id)).map(tag => tag.name).join(", ")}>
            {tags.filter(tag => note.tagIds?.includes(tag.id)).map(tag => <span className="note-tag-chip" key={tag.id}>{tag.name}</span>)}
          </span> : null}
          <span className="reading-note-card-footer">
            <time dateTime={new Date(note.createdAt).toISOString()}>{createdTime(note.createdAt)}</time>
            <span className="reading-note-card-open">
              {selecting ? "Select note" : "Open note"}
              <span className="reading-note-card-arrow" aria-hidden="true">→</span>
            </span>
          </span>
      </button>
      <ReadingNoteReviewControl api={reviewApi} note={note} displayOnly />
      <span className="reading-note-card-face-status" aria-label={detailedFaceStatus} title={detailedFaceStatus}>
        <button type="button" aria-label="Show front image" aria-pressed={side === "understand"}
          data-current={side === "understand"} data-generated={hasFront} data-generating={generatingSides.has("understand")}
          onClick={(event) => { event.stopPropagation(); setSide("understand"); }}>
          <i aria-hidden="true" />
          <span aria-hidden="true">Front</span>
        </button>
        <button type="button" aria-label="Show back image" aria-pressed={side === "recall"}
          data-current={side === "recall"} data-generated={hasBack} data-generating={generatingSides.has("recall")}
          onClick={(event) => { event.stopPropagation(); setSide("recall"); }}>
          <i aria-hidden="true" />
          <span aria-hidden="true">Back</span>
        </button>
      </span>
      <button
        className="reading-note-card-zoom"
        type="button"
        aria-label="Enlarge image"
        title="View large image"
        onClick={() => setExpanded(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10.25" cy="10.25" r="5.75" />
          <path d="m14.5 14.5 5 5" />
        </svg>
      </button>
      <button
        className="reading-note-card-flip"
        type="button"
        aria-label={`Flip to ${nextPurpose} image`}
        title={`Show ${nextFace} · ${nextPurpose}`}
        onClick={() => setSide(nextSide)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M7.25 6.25h8.5a3 3 0 0 1 3 3v7.5" />
          <path d="m15.75 14 3 2.75 2.75-3" />
          <path d="M16.75 17.75h-8.5a3 3 0 0 1-3-3v-7.5" />
          <path d="m8.25 10-3-2.75L2.5 10" />
        </svg>
      </button>
      {expanded ? (
        <ReadingNoteVisualLightbox
          note={note}
          initialSide={side}
          readAttachmentDataUrl={readAttachmentDataUrl}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </div>
  );
}

export function ReadingNoteCardVisual({
  note,
  side,
  generating,
  readAttachmentDataUrl
}: {
  note: ReadingNoteSummary;
  side: MemoryImageSide;
  generating: boolean;
  readAttachmentDataUrl?: (attachmentId: string) => Promise<string>;
}) {
  const currentImage = readingNoteImage(note, side);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setUrl(undefined);
    setFailed(false);
    if (currentImage && readAttachmentDataUrl) {
      void readAttachmentDataUrl(currentImage.attachmentId)
        .then((next) => { if (current) setUrl(next); })
        .catch(() => { if (current) setFailed(true); });
    }
    return () => { current = false; };
  }, [currentImage?.attachmentId, readAttachmentDataUrl]);
  return (
    <span className="reading-note-card-visual" data-has-image={Boolean(url)} data-side={side}>
      {url ? <img src={url} loading="lazy" decoding="async" alt={`${side === "understand" ? "Understanding" : "Recall"} image for ${note.title}`} /> : (
        <span className="reading-note-card-memory-placeholder" aria-label={failed ? "Memory image unavailable" : "No memory image"}>
          <ReadingNoteDefaultVisualIcon side={side} />
        </span>
      )}
      {generating ? (
        <span className="reading-note-card-generating" aria-label="產圖中">
          <span className="reading-note-card-generating-pill">
            <span className="reading-note-card-generating-spinner" aria-hidden="true" />
            <strong>產圖中</strong>
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function ReadingNoteLibraryEmpty({
  view,
  filtersActive,
  onClear,
  onReturnToBooks
}: {
  view: ReadingNoteStatus;
  filtersActive: boolean;
  onClear?(): void;
  onReturnToBooks?(): void;
}) {
  if (view === "trashed") return <div className="reading-note-library-empty"><span className="reading-note-empty-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M7 9h18M12 5h8M9.5 9l1 18h11l1-18M13.5 13v9M18.5 13v9" /></svg></span><strong>Trash is empty</strong></div>;
  if (filtersActive) return (
    <div className="reading-note-library-empty">
      <span className="reading-note-empty-icon" aria-hidden="true">⌕</span>
      <strong>No notes match these filters</strong>
      <button type="button" onClick={onClear}>Clear filters</button>
    </div>
  );
  return (
    <div className="reading-note-library-empty">
      <span className="reading-note-empty-icon" aria-hidden="true">＋</span>
      <strong>Your Reading Notes Library is empty</strong>
      <p>Return to a book and save one focused idea.</p>
      {onReturnToBooks ? <button type="button" onClick={onReturnToBooks}>Back to books</button> : null}
    </div>
  );
}

export function ReadingNoteDetail({
  note,
  deleteConfirming,
  mutating,
  onClose,
  onEdit,
  onEditWithAi,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  note: ReadingNote;
  deleteConfirming: boolean;
  mutating: boolean;
  onClose(): void;
  onEdit?(): void;
  onEditWithAi?(): void;
  onRequestDelete(): void;
  onCancelDelete(): void;
  onConfirmDelete(): void;
}) {
  return (
    <section className="reading-note-detail" aria-labelledby="reading-note-detail-title">
        <header>
          <div><span>Reading note</span><h2 id="reading-note-detail-title">{note.title}</h2></div>
          <button className="reading-note-detail-close" type="button" aria-label="Back to reading notes" onClick={onClose}>←</button>
        </header>
        <div className="reading-note-detail-scroll">
          <div className="reading-note-detail-paper">
            <section className="reading-note-detail-content"><h3>Note Content</h3><pre>{readingNoteDocumentToMarkdown(note.content)}</pre></section>
            <section className="reading-note-detail-source"><h3>Source</h3><div className="reading-note-detail-source-list">
              <ReadingNoteSourceDisclosure kind="book" value={note.bookTitle} />
              <ReadingNoteSourceDisclosure kind="chapter" value={note.chapterTitle} />
            </div></section>
          </div>
        </div>
        <footer>
          <button className="danger-outline-action" type="button" onClick={onRequestDelete}>Delete</button>
        </footer>
      {deleteConfirming ? (
        <div className="dialog-backdrop" onMouseDown={(event) => event.stopPropagation()}>
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trash-reading-note-title">
            <span className="delete-dialog-icon" aria-hidden="true">!</span>
            <h2 id="trash-reading-note-title">Move this note to Trash?</h2>
            <p>The note will leave your library, but you can restore it later.</p>
            <div className="delete-dialog-actions">
              <button type="button" onClick={onCancelDelete} disabled={mutating}>Cancel</button>
              <button className="danger-action" type="button" onClick={onConfirmDelete} disabled={mutating}>
                {mutating ? "Moving…" : "Move to Trash"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

const initialCounts: ReadingNoteCounts = { active: 0, trashed: 0 };
const initialQuery: ReadingNoteListInput = { status: "active", sort: "recent" };

function summaryOf(note: ReadingNote): ReadingNoteSummary {
  const { content: _content, sourceDraftId: _sourceDraftId, ...summary } = note;
  return summary;
}

export function ReadingNoteLibrary({
  api,
  onReturnToBooks,
  draftSource,
  onDraftConsumed
}: {
  api: ReaderDesktopApi["readingNotes"];
  onReturnToBooks(): void;
  draftSource?: { bookTitle: string; chapterTitle: string; readingSegment: string };
  onDraftConsumed?(): void;
}) {
  const [uploadActionsTarget, setUploadActionsTarget] = useState<HTMLSpanElement | null>(null);
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [batchTrashError, setBatchTrashError] = useState("");
  const [batchTrashConfirming, setBatchTrashConfirming] = useState(false);
  const batchTrashPending = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [matchingIds, setMatchingIds] = useState<string[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);
  const selectionGeneration = useRef(0);

  const [tagAction, setTagAction] = useState<"add" | "remove">();
  const [manageTags, setManageTags] = useState(false);
  const [tagNotice, setTagNotice] = useState("");
  const [view, setView] = useState<ReadingNoteStatus>("active");
  const [query, setQuery] = useState<ReadingNoteListInput>(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = useState<string>();
  const [notes, setNotes] = useState<ReadingNoteSummary[]>([]);
  const [bookTitles, setBookTitles] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [counts, setCounts] = useState(initialCounts);
  const [selected, setSelected] = useState<ReadingNote>();
  const [selectedInitialView, setSelectedInitialView] = useState<"note" | "visual">("visual");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [restoringNoteId, setRestoringNoteId] = useState<string>();
  const [error, setError] = useState("");
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [emptyTrashConfirming, setEmptyTrashConfirming] = useState(false);
  const [generatingNoteSides, setGeneratingNoteSides] = useState<Map<string, ReadonlySet<MemoryImageSide>>>(new Map());
  const [openingNoteId, setOpeningNoteId] = useState<string>();
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const loadMorePending = useRef(false);
  const openGeneration = useRef(0);
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, height: 700, width: 900 });
  const [focusedNoteId, setFocusedNoteId] = useState<string>();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(query.search), 250);
    return () => window.clearTimeout(timer);
  }, [query.search]);

  const effectiveQuery = useMemo(() => ({
    status: query.status,
    sort: query.sort,
    ...(query.bookTitle ? { bookTitle: query.bookTitle } : {}),
    ...(query.chapterTitle ? { chapterTitle: query.chapterTitle } : {}),
    ...(query.tagIds?.length ? { tagIds: query.tagIds } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {})
  }), [query.status, query.sort, query.bookTitle, query.chapterTitle, query.tagIds, debouncedSearch]);
  const filterOptions = useMemo(() => ({ books: bookTitles }), [bookTitles]);
  const filtersActive = Boolean(query.search || query.bookTitle || query.tagIds?.length || query.sort !== "recent");

  const reload = useCallback(async (nextQuery: ReadingNoteListInput = effectiveQuery, { background = false } = {}) => {
    const generation = ++requestGeneration.current;
    loadMorePending.current = false;
    setLoadingMore(false);
    setLoadMoreError("");
    setError("");
    if (!background) {
      setLoading(true);
      setNotes([]);
      setNextCursor(undefined);
      if (scrollRegionRef.current) scrollRegionRef.current.scrollTop = 0;
      setScrollMetrics(current => ({ ...current, top: 0 }));
    }
    const targetCount = background ? Math.max(50, notes.length) : 50;
    try {
      const [first, titles, nextCounts, nextTags] = await Promise.all([
        api.listPage(nextQuery), api.activeBookTitles(), api.counts(), api.tags?.list() ?? []
      ]);
      if (generation !== requestGeneration.current) return;
      const listed = [...first.items];
      let cursor = first.nextCursor;
      while (background && cursor && listed.length < targetCount) {
        const page = await api.listPage({ ...nextQuery, cursor });
        if (generation !== requestGeneration.current) return;
        listed.push(...page.items);
        cursor = page.nextCursor;
      }
      setNotes(listed);
      setNextCursor(cursor);
      setBookTitles(titles);
      setCounts(nextCounts);
      setTags(nextTags);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to load the Reading Notes Library.");
    } finally {
      if (generation === requestGeneration.current && !background) setLoading(false);
    }
  }, [api, effectiveQuery, notes.length]);

  useEffect(() => {
    cancelSelection();
    void reload(effectiveQuery);
    return () => { requestGeneration.current += 1; };
  }, [effectiveQuery, api]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadMorePending.current) return;
    loadMorePending.current = true;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const page = await api.listPage({ ...effectiveQuery, cursor: nextCursor });
      if (generation !== requestGeneration.current) return;
      setNotes(current => {
        const existing = new Set(current.map(note => note.id));
        return [...current, ...page.items.filter(note => !existing.has(note.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      if (cause instanceof Error && /reading-note cursor/i.test(cause.message)) {
        await reload(effectiveQuery, { background: true });
        return;
      }
      setLoadMoreError(cause instanceof Error ? cause.message : "Unable to load more reading notes.");
    } finally {
      if (generation === requestGeneration.current) {
        loadMorePending.current = false;
        setLoadingMore(false);
      }
    }
  }, [api, effectiveQuery, nextCursor, reload]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRegionRef.current;
    if (!sentinel || !root || !nextCursor || loadMoreError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { root, rootMargin: "0px 0px 420px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadMoreError, loadMore]);

  useLayoutEffect(() => {
    const root = scrollRegionRef.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setScrollMetrics({
        top: root.scrollTop, height: root.clientHeight, width: root.clientWidth
      }));
    };
    measure();
    root.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    resize?.observe(root);
    return () => { root.removeEventListener("scroll", measure); resize?.disconnect(); window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const memoryImage = api.memoryImage;
    if (!memoryImage) return;
    let mounted = true;
    const observedAfterSubscribe = new Set<string>();
    const unsubscribe = memoryImage.onStateChanged((snapshot) => {
      if (!mounted) return;
      observedAfterSubscribe.add(snapshot.noteId);
      setGeneratingNoteSides((current) => {
        const next = new Map(current);
        const sides = activeMemoryImageSides(snapshot);
        if (sides.length) next.set(snapshot.noteId, new Set(sides));
        else next.delete(snapshot.noteId);
        return next;
      });
      if (snapshot.note) {
        setNotes(items => items.map(item => item.id === snapshot.note!.id
          ? summaryOf(snapshot.note!) : item));
      }
    });
    void memoryImage.listActive().then((snapshots) => {
      if (!mounted) return;
      setGeneratingNoteSides((current) => {
        // Events received during the query are newer than its initial snapshot.
        const next = new Map([...current].filter(([id]) => observedAfterSubscribe.has(id)));
        for (const snapshot of snapshots) {
          if (!observedAfterSubscribe.has(snapshot.noteId) && snapshot.phase === "generating") {
            const sides = activeMemoryImageSides(snapshot);
            if (sides.length) next.set(snapshot.noteId, new Set(sides));
          }
        }
        return next;
      });
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [api]);

  function cancelSelection() {
    setBatchTrashConfirming(false);
    setBatchTrashError("");
    selectionGeneration.current += 1;
    setSelecting(false); setSelectedIds(new Set()); setMatchingIds([]); setSelectingAll(false); setTagAction(undefined);
  }
  function changeQuery(next: ReadingNoteListInput) { cancelSelection(); setTagNotice(""); setQuery(next); }
  function toggleNote(id: string) {
    setSelectedIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function beginSelection() {
    const generation = ++selectionGeneration.current;
    setSelecting(true); setSelectingAll(true); setError(""); setTagNotice("");
    try {
      const ids = await api.tags!.matchingIds(effectiveQuery);
      if (generation === selectionGeneration.current) setMatchingIds(ids);
    } catch (cause) {
      if (generation === selectionGeneration.current) { setError(cause instanceof Error ? cause.message : "Unable to select notes."); cancelSelection(); }
    } finally { if (generation === selectionGeneration.current) setSelectingAll(false); }
  }
  async function trashSelectedNotes() {
    if (batchTrashPending.current || !selectedIds.size) return;
    setBatchTrashError("");
    batchTrashPending.current = true;
    setMutating(true);
    setError("");
    const remaining = new Set(selectedIds);
    try {
      for (const id of selectedIds) {
        await api.trash(id);
        remaining.delete(id);
      }
      cancelSelection();
    } catch (cause) {
      setSelectedIds(remaining);
      setBatchTrashError(cause instanceof Error ? cause.message : "Unable to move selected notes to Trash.");
    } finally {
      setBatchTrashConfirming(false);
      try {
        await reload(effectiveQuery, { background: true });
      } finally {
        batchTrashPending.current = false;
        setMutating(false);
      }
    }
  }

  async function applyTag(tag: ReadingNoteTag) {
    const count = await api.tags!.change({ noteIds: [...selectedIds], tagId: tag.id, action: tagAction! });
    cancelSelection();
    setTagNotice(`${tagAction === "add" ? "Added" : "Removed"} “${tag.name}” ${tagAction === "add" ? "on" : "from"} ${count} notes.`);
    await reload(effectiveQuery, { background: true });
  }

  function changeView(nextView: ReadingNoteStatus) {
    cancelSelection();
    setTagNotice("");
    openGeneration.current += 1;
    setOpeningNoteId(undefined);
    setView(nextView);
    setQuery({ status: nextView, sort: "recent" });
    setDebouncedSearch(undefined);
    setSelected(undefined);
  }

  async function mutate(action: () => Promise<unknown>) {
    if (mutating) return;
    setMutating(true);
    setError("");
    try {
      await action();
      await reload(effectiveQuery, { background: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update the reading note.");
    } finally {
      setMutating(false);
    }
  }

  async function openNote(note: ReadingNoteSummary, initialView: "note" | "visual" = "visual") {
    const generation = ++openGeneration.current;
    setOpeningNoteId(note.id);
    setError("");
    try {
      const full = await api.get(note.id);
      if (generation !== openGeneration.current) return;
      if (!full) throw new Error("Reading note not found.");
      setSelectedInitialView(initialView);
      setSelected(full);
    } catch (cause) {
      if (generation === openGeneration.current) setError(cause instanceof Error ? cause.message : "Unable to open the reading note.");
    } finally {
      if (generation === openGeneration.current) setOpeningNoteId(undefined);
    }
  }

  const contentWidth = Math.max(1, scrollMetrics.width - (scrollMetrics.width <= 700 ? 40 : 64));
  const minimumCardWidth = scrollMetrics.width <= 480 ? contentWidth : scrollMetrics.width <= 700 ? 220 : 236;
  const columns = view === "active" ? Math.max(1, Math.floor((contentWidth + 20) / (minimumCardWidth + 20))) : 1;
  const gap = view === "active" ? scrollMetrics.width <= 480 ? 14 : 20 : 9;
  const cardWidth = (contentWidth - (columns - 1) * gap) / columns;
  const rowHeight = view === "active" ? Math.ceil((cardWidth - 24) / 1.08 + 200 + (tags.length ? 34 : 0) + gap)
    : scrollMetrics.width <= 480 ? 150 : 118;
  const totalRows = Math.ceil(notes.length / columns);
  const startRow = Math.max(0, Math.floor(scrollMetrics.top / rowHeight) - 3);
  const endRow = Math.min(totalRows, Math.ceil((scrollMetrics.top + scrollMetrics.height) / rowHeight) + 3);
  const startIndex = startRow * columns;
  const endIndex = Math.min(notes.length, endRow * columns);
  const visibleNotes = notes.slice(startIndex, endIndex);
  const focusedIndex = focusedNoteId ? notes.findIndex(note => note.id === focusedNoteId) : -1;
  const focusedNote = focusedIndex >= 0 && (focusedIndex < startIndex || focusedIndex >= endIndex)
    ? notes[focusedIndex] : undefined;

  useLayoutEffect(() => {
    if (!focusedNoteId || document.activeElement !== document.body) return;
    const card = [...(scrollRegionRef.current?.querySelectorAll<HTMLElement>("[data-note-id]") ?? [])]
      .find(element => element.dataset.noteId === focusedNoteId);
    card?.querySelector<HTMLElement>("button")?.focus();
  }, [focusedNoteId, startIndex, endIndex]);

  return (
    <section className="reading-note-library" aria-label="Reading Notes Library">
      <ReadingNoteLibraryHeader
        view={view}
        counts={counts}
        query={query}
        filterOptions={filterOptions}
        emptyTrashConfirming={emptyTrashConfirming}
        mutating={mutating}
        tagTools={api.tags ? <div className="note-tag-toolbar">
          <div className="note-library-tag-tools">
          <ReadingNoteTagFilter tags={tags} selected={query.tagIds ?? []} onChange={tagIds => changeQuery({ ...query, tagIds })} />
          <button className="note-library-manage-tags" type="button" onClick={() => setManageTags(true)}>Manage tags</button>
          </div>
          <div className="note-library-selection-tools">
          <button className="note-library-select" type="button" aria-pressed={selecting} disabled={loading || selectingAll || query.search !== debouncedSearch} onClick={() => selecting ? cancelSelection() : void beginSelection()}><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><rect x="3.5" y="3.5" width="13" height="13" rx="3" /><path d="m6.5 10 2.3 2.3 4.7-4.6" /></svg>{selecting ? "Cancel selection" : "Select notes"}</button>
          {selecting ? <button type="button" disabled={selectingAll || !matchingIds.length} onClick={() => setSelectedIds(new Set(matchingIds))}>{selectingAll ? "Finding notes…" : `Select all ${matchingIds.length} matching notes`}</button> : null}
          </div>
          {tagNotice ? <span role="status">{tagNotice}</span> : null}
        </div> : null}
        onView={changeView}
        onQuery={changeQuery}
        onClear={() => changeQuery({ status: "active", sort: "recent" })}
        onEmptyTrash={() => setEmptyTrashConfirming(true)}
        onCancelEmptyTrash={() => setEmptyTrashConfirming(false)}
        onConfirmEmptyTrash={() => void mutate(async () => {
          await api.emptyTrash();
          setEmptyTrashConfirming(false);
        })}
      />
      <div className="reading-note-library-results" ref={scrollRegionRef} aria-busy={loading}
        onFocusCapture={event => setFocusedNoteId(event.target.closest<HTMLElement>("[data-note-id]")?.dataset.noteId)}>
        {api.cardPool ? <CardNoteUploadPanel actionOnly api={api.cardPool} noteIds={selecting ? [...selectedIds] : []} actionsTarget={uploadActionsTarget} /> : null}
        {error ? <p className="library-error" role="alert">{error}</p> : null}
        {loading ? <p role="status">Loading Reading Notes…</p> : null}
        {openingNoteId ? <p role="status">Opening reading note…</p> : null}
        {!loading && !notes.length ? (
          <ReadingNoteLibraryEmpty view={view} filtersActive={filtersActive} onClear={() => changeQuery(initialQuery)} onReturnToBooks={onReturnToBooks} />
        ) : null}
        {!loading && notes.length ? (
          <div className="reading-note-virtual-space" style={{ height: totalRows * rowHeight }}>
            <div className="reading-note-virtual-window" style={{ top: startRow * rowHeight, "--note-row-height": `${rowHeight - gap}px` } as CSSProperties}>
              <ReadingNoteList
                view={view}
                notes={visibleNotes}
                tags={tags} selecting={selecting} selectedIds={selectedIds} onToggle={toggleNote}
                mutating={mutating}
                restoringNoteId={restoringNoteId}
                generatingNoteSides={generatingNoteSides}
                onOpen={(note, initialView) => void openNote(note, initialView)}
                onRestore={(noteId) => {
                  setRestoringNoteId(noteId);
                  void mutate(() => api.restore(noteId)).finally(() => setRestoringNoteId(undefined));
                }}
                reviewApi={api.review}
                readAttachmentDataUrl={api.attachments.readDataUrl}
              />
            </div>
            {focusedNote ? (
              <div className="reading-note-focus-keeper" style={{
                top: Math.floor(focusedIndex / columns) * rowHeight,
                left: view === "active" ? (focusedIndex % columns) * (cardWidth + gap) : 0,
                width: view === "active" ? cardWidth : contentWidth,
                "--note-row-height": `${rowHeight - gap}px`
              } as CSSProperties}>
                <ReadingNoteList view={view} notes={[focusedNote]} mutating={mutating}
                  tags={tags} selecting={selecting} selectedIds={selectedIds} onToggle={toggleNote}
                  restoringNoteId={restoringNoteId} generatingNoteSides={generatingNoteSides}
                  onOpen={(note, initialView) => void openNote(note, initialView)}
                  onRestore={(noteId) => { setRestoringNoteId(noteId); void mutate(() => api.restore(noteId)).finally(() => setRestoringNoteId(undefined)); }}
                  reviewApi={api.review} readAttachmentDataUrl={api.attachments.readDataUrl} />
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && nextCursor ? <div className="reading-note-load-sentinel" ref={sentinelRef} aria-hidden="true" /> : null}
        {loadingMore ? <p className="reading-note-load-status" role="status">Loading more reading notes…</p> : null}
        {loadMoreError ? <div className="reading-note-load-error" role="alert">Couldn’t load more reading notes. <button type="button" onClick={() => void loadMore()}>Retry</button></div> : null}
      </div>
      {selecting && view === "active" ? <div className="note-tag-batch" role="region" aria-label="Selected notes actions">
        {batchTrashError ? <p role="alert">{batchTrashError}</p> : null}
        <div className="note-batch-heading">
          <strong className="note-batch-count">{selectedIds.size} selected</strong>
          <button className="note-batch-cancel" type="button" onClick={cancelSelection}>Cancel <span aria-hidden="true">×</span></button>
        </div>
        <div className="note-batch-actions">
        <div className="note-batch-transfer">
        <HeptabaseImportAction api={api.heptabase} noteIds={[...selectedIds]} />
        {api.cardPool ? <span className="note-batch-upload-action" ref={setUploadActionsTarget} /> : null}
        </div>
        <div className="note-batch-tags">
        <button type="button" disabled={!selectedIds.size} onClick={() => setTagAction("add")}><span aria-hidden="true">＋</span> Add tag</button>
        <button type="button" disabled={!selectedIds.size} onClick={() => setTagAction("remove")}><span aria-hidden="true">−</span> Remove tag</button>
        </div>
        <button className="danger-outline-action" type="button" disabled={!selectedIds.size || mutating} onClick={() => setBatchTrashConfirming(true)}>Move to Trash</button>
        </div>
      </div> : null}
      {batchTrashConfirming ? (
        <div className="reading-note-discard-backdrop" onKeyDown={event => {
          if (event.key === "Escape" && !mutating) setBatchTrashConfirming(false);
          if (event.key === "Tab") {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            if (!buttons.length) { event.preventDefault(); return; }
            const next = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
            if (document.activeElement === next) {
              event.preventDefault();
              (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus();
            }
          }
          event.stopPropagation();
        }}>
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="batch-trash-title" aria-describedby="batch-trash-description" aria-busy={mutating}>
            <h2 id="batch-trash-title">Move {selectedIds.size} {selectedIds.size === 1 ? "note" : "notes"} to Trash?</h2>
            <p id="batch-trash-description">The notes and their images stay recoverable until Trash is emptied.</p>
            <div className="delete-dialog-actions">
              <button autoFocus type="button" disabled={mutating} onClick={() => setBatchTrashConfirming(false)}>Keep notes</button>
              <button className="danger-action" type="button" disabled={mutating} onClick={() => void trashSelectedNotes()}>{mutating ? "Moving…" : "Move to Trash"}</button>
            </div>
          </section>
        </div>
      ) : null}
      {tagAction && api.tags ? <ReadingNoteTagPicker api={api.tags} title={`${tagAction === "add" ? "Add tag to" : "Remove tag from"} ${selectedIds.size} notes`} allowCreate={tagAction === "add"} onPick={applyTag} onClose={() => setTagAction(undefined)} /> : null}
      {manageTags && api.tags ? <ReadingNoteTagManager api={api.tags} onChanged={async () => { setTags(await api.tags!.list()); }} onClose={() => setManageTags(false)} /> : null}
      {draftSource && !selected ? (
        <ReadingNoteEditorDialog
          api={api}
          mode="create"
          source={draftSource}
          onClose={() => onDraftConsumed?.()}
          onSaved={async () => {
            onDraftConsumed?.();
            await reload(effectiveQuery, { background: true });
          }}
        />
      ) : null}
      {selected ? (
        <ReadingNoteEditorDialog
          api={api}
          mode="manual-edit"
          note={selected}
          initialView={selectedInitialView}
          readOnly={selected.trashedAt !== undefined}
          onClose={() => {
            setSelected(undefined);
            setDeleteConfirming(false);
            void reload(effectiveQuery, { background: true });
          }}
          onSaved={(saved) => setSelected(saved)}
          onRestore={() => void mutate(async () => {
            const restored = await api.restore(selected.id);
            setSelected(restored);
          })}
          onDelete={() => setDeleteConfirming(true)}
        />
      ) : null}
      {selected && deleteConfirming ? (
        <div className="reading-note-discard-backdrop">
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trash-reading-note-canvas-title">
            <span className="delete-dialog-icon" aria-hidden="true">!</span>
            <h2 id="trash-reading-note-canvas-title">Move this reading note to Trash?</h2>
            <p>The note and its images stay recoverable until Trash is emptied.</p>
            <div className="delete-dialog-actions">
              <button type="button" onClick={() => setDeleteConfirming(false)} disabled={mutating}>Cancel</button>
              <button className="danger-action" type="button" disabled={mutating} onClick={() => void mutate(async () => {
                await api.trash(selected.id);
                setSelected(undefined);
                setDeleteConfirming(false);
              })}>{mutating ? "Moving…" : "Move to Trash"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
