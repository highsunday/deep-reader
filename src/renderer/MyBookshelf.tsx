import { useEffect, useId, useRef, useState } from "react";
import type { BookTagsApi, ReadingNoteTag, ReadingNoteTagsApi, LibraryBook, SetShelfStatusInput } from "../shared/contracts";
import "./my-bookshelf.css";
import { ReadingNoteTagPicker } from "./ReadingNoteTags";

const labels = { all: "All books", reading: "Reading", unread: "To read", finished: "Finished" };
type Filter = keyof typeof labels;

function statusOf(book: LibraryBook) {
  return book.shelfStatus ?? (book.lastChapterId ? "reading" : "unread");
}

interface BookActions {
  onRead(book: LibraryBook): void;
  onPin(book: LibraryBook): void;
  onStatus(input: SetShelfStatusInput): Promise<void>;
}

function ClothCover({ book }: { book: LibraryBook }) {
  // Keep each binding recognizable when the collection is searched or reordered.
  const binding = Array.from(book.id).reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % 6;
  return <span className="shelf-binding" data-binding={binding} aria-hidden="true">
    <span className="shelf-binding-rule" />
    <strong>{book.title}</strong>
    <svg viewBox="0 0 180 100" preserveAspectRatio="xMidYMax slice" fill="none" stroke="currentColor">
      {[0, 1, 2, 3, 4, 5, 6].map(i => binding % 3 === 0
        ? <ellipse key={i} cx="90" cy="128" rx={85 - i * 9} ry={120 - i * 10}/>
        : binding % 3 === 1
          ? <path key={i} d={`M-20 ${62 + i * 6} Q35 ${-15 + i * 5} 91 ${42 + i * 7} T200 ${22 + i * 6}`}/>
          : <path key={i} d={`M${5 + i * 12} 110 L${93 + i * 12} 12 L${181 + i * 12} 110`}/>)}
    </svg>
    <span className="shelf-binding-author">{book.author}</span>
  </span>;
}

interface ShelfCardProps extends BookActions {
  book: LibraryBook;
  tags: ReadingNoteTag[];
  tagsBusy: boolean;
  onAddTag?: () => void;
  onRemoveTag(tag: ReadingNoteTag): void;
}

function ShelfCard({ book, onRead, onPin, onStatus, tags, tagsBusy, onAddTag, onRemoveTag }: ShelfCardProps) {
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const status = statusOf(book);
  const action = status === "finished" ? "Revisit" : status === "reading" ? "Continue reading" : "Start reading";
  async function changeStatus(nextStatus: SetShelfStatusInput["status"]) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onStatus({ bookId: book.id, status: nextStatus });
      menu.current?.hidePopover();
    } catch {
      setError("Couldn’t save the reading status. Try again.");
    } finally {
      setSaving(false);
    }
  }
  return <article className="shelf-card" aria-label={book.title}>
    <button className="shelf-cover" onClick={() => onRead(book)} disabled={!book.chapters.length}
      aria-label={`${action} ${book.title}`} title={`${action} · ${book.title}`}>
      {book.coverDataUrl ? <img alt="" src={book.coverDataUrl} /> : <ClothCover book={book} />}
      {book.pinned && <span className="shelf-ribbon" aria-label="Pinned" title="Pinned">★</span>}
      <span className="shelf-open" aria-hidden="true">{action} <span>→</span></span>
    </button>
    <div className="shelf-card-tools">
      <span className="shelf-caption"><span className={`shelf-status ${status}`}>{labels[status]}</span>
        {tags.length > 0 && <span className="shelf-tag-summary" title={tags.map(tag => tag.name).join(", ")}>
          <span className="shelf-tag-name">{tags[0].name}</span>
          {tags.length > 1 && <small>+{tags.length - 1}</small>}
        </span>}
      </span>
      <button className="shelf-more" aria-label={`More actions for ${book.title}`} title="More actions" popoverTarget={menuId}>•••</button>
      <div id={menuId} popover="auto" ref={menu} className="shelf-menu">
        <button onClick={() => { menu.current?.hidePopover(); onPin(book); }}>{book.pinned ? "Unpin book" : "Pin to top"}</button>
        <button disabled={saving} onClick={() => changeStatus(status === "finished" ? "reading" : "finished")}>{saving ? "Saving…" : status === "finished" ? "Move to Reading" : "Mark as finished"}</button>
        {status !== "unread" && <button disabled={saving} onClick={() => changeStatus("unread")}>Move to To read</button>}
        {onAddTag && <div className="shelf-menu-tags">
          <button disabled={tagsBusy} onClick={() => { menu.current?.hidePopover(); onAddTag(); }}>Add tag…</button>
          {tags.map(tag => <button key={tag.id} disabled={tagsBusy} onClick={() => {
            menu.current?.hidePopover();
            onRemoveTag(tag);
          }}>Remove “{tag.name}”</button>)}
        </div>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </article>;
}

interface Props extends BookActions {
  bookTagsApi?: BookTagsApi;
  tagsApi?: ReadingNoteTagsApi;
  books: LibraryBook[];
  onImport(): void;
  importing: boolean;
}

export function MyBookshelf({ books, onImport, importing, tagsApi, bookTagsApi, ...actions }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [byBook, setByBook] = useState<Record<string, string[]>>({});
  const [tagFilter, setTagFilter] = useState("");
  const [editingBook, setEditingBook] = useState<LibraryBook>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!tagsApi || !bookTagsApi) return;
    let current = true;
    setReady(false);
    setError("");
    Promise.all([tagsApi.list(), bookTagsApi.list()]).then(([catalog, assignments]) => {
      if (current) { setTags(catalog); setByBook(assignments); setReady(true); }
    }).catch(() => { if (current) setError("Couldn’t load book tags."); });
    return () => { current = false; };
  }, [tagsApi, bookTagsApi, retry]);

  async function changeTag(book: LibraryBook, tag: ReadingNoteTag, action: "add" | "remove") {
    if (!bookTagsApi) return;
    setSaving(true);
    setError("");
    try {
      const ids = await bookTagsApi.change({ bookId: book.id, tagId: tag.id, action });
      setByBook(previous => ({ ...previous, [book.id]: ids }));
      setTags(previous => previous.some(t => t.id === tag.id) ? previous : [...previous, tag]);
      setEditingBook(undefined);
    } catch (cause) {
      if (action === "add") throw cause;
      setError("Couldn’t remove the book tag. Try again.");
    } finally { setSaving(false); }
  }
  const search = useRef<HTMLInputElement>(null);
  const visible = books.filter(book => (filter === "all" || statusOf(book) === filter) &&
    (!tagFilter || byBook[book.id]?.includes(tagFilter)) &&
    book.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  return <section className="my-bookshelf" aria-labelledby="shelf-title">
    <header className="shelf-heading library-page-heading">
      <h1 id="shelf-title">Bookshelf</h1>
      <div className="shelf-heading-actions">
        {bookTagsApi && <select className="shelf-tag-filter" aria-label="Filter by book tag" value={tagFilter}
          disabled={!ready} onChange={event => setTagFilter(event.target.value)}>
          <option value="">All tags</option>
          {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>}
        <label className="shelf-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg>
          <input ref={search} type="search" aria-label="Search by title" placeholder="Search by title" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <button className="import-button" type="button" onClick={onImport} disabled={importing}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          {importing ? "Importing…" : "Import EPUB"}
        </button>
      </div>
      {error && <p role="alert">{error} {!ready && <button onClick={() => setRetry(n => n + 1)}>Retry</button>}</p>}
    </header>
    <div className="shelf-filters" role="group" aria-label="Reading status">{(Object.keys(labels) as Filter[]).map(key =>
      <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
        {labels[key]} <small>{key === "all" ? books.length : books.filter(book => statusOf(book) === key).length}</small>
      </button>)}</div>
    <div className="shelf-results" role="region" aria-label="Books" tabIndex={0} key={JSON.stringify([filter, query, tagFilter])}>
      {visible.length ? <div className="shelf-grid">{visible.map(book => <ShelfCard key={book.id} book={book} {...actions}
        tags={tags.filter(tag => byBook[book.id]?.includes(tag.id))}
        tagsBusy={!ready || saving} onAddTag={tagsApi && bookTagsApi ? () => setEditingBook(book) : undefined}
        onRemoveTag={tag => void changeTag(book, tag, "remove")} />)}</div> :
      <div className="shelf-empty">
        <h2 role="status">{!books.length ? "Your bookshelf is empty" : query.trim() || tagFilter ? "No matching books" : `No books in “${labels[filter]}” yet`}</h2>
        {!books.length ? <p>Import an EPUB to add your first book.</p> : tagFilter ?
          <button onClick={() => { setTagFilter(""); setQuery(""); setFilter("all"); }}>Clear filters</button> : query.trim() ?
          <button onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</button> :
          <button onClick={() => setFilter("all")}>Show all books</button>}
      </div>}
    </div>
    {editingBook && tagsApi && <ReadingNoteTagPicker api={tagsApi} title={`Add tag to ${editingBook.title}`}
      onClose={() => setEditingBook(undefined)} onPick={tag => changeTag(editingBook, tag, "add")} />}
  </section>;
}
