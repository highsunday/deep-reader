import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConceptVideo, ConceptVideoApi } from '../shared/concept-video';
import { ConceptVideoCover, ConceptVideoPlayer, currentVersion, videoCardDescription, videoCardTitle, videoLastChangedAt } from './ConceptVideoWorkspace';
import { videoJobLabel } from './ConceptVideoActivity';

function VideoIcon({ search = false, kind }: { search?: boolean; kind?: 'back' | 'edit' }) {
  return <svg className="reader-notes-icon" viewBox="0 0 20 20" aria-hidden="true"><path d={kind === 'back' ? 'M12 4l-6 6 6 6 M6 10h11' : kind === 'edit' ? 'M12 4l4 4 M4 12l9-9 4 4-9 9-5 1 1-5Z' : search ? 'M14 14l3 3 M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0' : 'M3 4h14v12H3z M8 7l5 3-5 3z'} /></svg>;
}

export function ReaderVideosPanel({ api, videos, bookId, chapterId, chapterTitle, loading, error, active,
  canCreate, onCreate, onOpen, onRefresh }: {
  api: ConceptVideoApi; videos: ConceptVideo[]; bookId: string; chapterId: string; chapterTitle: string;
  loading: boolean; error: string; active: boolean; canCreate: boolean;
  onCreate(): void; onOpen(video: ConceptVideo): void; onRefresh(): void;
}) {
  const [scope, setScope] = useState<'chapter' | 'book' | 'all'>('chapter');
  const [search, setSearch] = useState(''), [bookFilter, setBookFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const backRef = useRef<HTMLButtonElement>(null), listRef = useRef<HTMLDivElement>(null);
  const selected = videos.find(video => video.id === selectedId);
  const version = selected && currentVersion(selected);
  const books = useMemo(() => [...new Map(videos.map(video => [video.source.bookId, video.source.bookTitle]))]
    .sort((a, b) => a[1].localeCompare(b[1])), [videos]);
  const query = search.trim().toLocaleLowerCase(), filtering = Boolean(query || scope === 'all' && bookFilter);
  const filtered = useMemo(() => videos.filter(video =>
    (scope === 'all' ? !bookFilter || video.source.bookId === bookFilter : video.source.bookId === bookId) &&
    (scope !== 'chapter' || video.source.chapterId === chapterId) &&
    videoCardTitle(video).toLocaleLowerCase().includes(query)
  ).sort((a, b) => videoLastChangedAt(b) - videoLastChangedAt(a) || a.id.localeCompare(b.id)),
  [videos, scope, bookFilter, bookId, chapterId, query]);
  useEffect(() => { if (selectedId && active) backRef.current?.focus({ preventScroll: true }); }, [selectedId, active]);
  function back() {
    setSelectedId(undefined);
    window.requestAnimationFrame(() => {
      Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-video-id]') ?? [])
        .find(button => button.dataset.videoId === selectedId)?.focus({ preventScroll: true });
    });
  }
  return <section className="reader-notes-panel reader-videos-panel" aria-label="Saved reading videos">
    <div className="reader-notes-list-view" hidden={Boolean(selected)}>
      <div className="reader-notes-controls">
        <div className="reader-notes-scopes" role="group" aria-label="Video scope">
          <button type="button" aria-pressed={scope === 'chapter'} onClick={() => setScope('chapter')}>This chapter</button>
          <button type="button" aria-pressed={scope === 'book'} onClick={() => setScope('book')}>This book</button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All videos</button>
        </div>
        <p className="reader-notes-context">{scope === 'chapter' ? chapterTitle : scope === 'book' ? 'All chapters in this book' : 'All saved videos and drafts'}</p>
        <label className="reader-notes-search"><VideoIcon search /><span className="visually-hidden">Search video titles</span>
          <input type="search" placeholder="Search video titles…" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        {scope === 'all' ? <label className="reader-videos-book-filter">Book
          <select aria-label="Filter videos by book" value={bookFilter} onChange={event => setBookFilter(event.target.value)}>
            <option value="">All books</option>{books.map(([id, title], i) => <option key={id} value={id}>{title}{books.filter(([, name]) => name === title).length > 1 ? ` (${i + 1})` : ''}</option>)}
          </select></label> : null}
        {!loading && !error ? <div className="reader-notes-summary"><span>{filtered.length} {filtered.length === 1 ? 'video' : 'videos'}{filtering ? ' found' : ''}</span>{filtered.length ? <span>Newest first</span> : null}</div> : null}
      </div>
      <div ref={listRef} className="reader-notes-results" aria-busy={loading}>
        {loading && !error ? <p role="status">Loading videos…</p> : error ? <div className="reader-notes-empty" role="alert"><p>{error}</p><button type="button" onClick={onRefresh}>Retry</button></div> : null}
        {!loading && !error && !filtered.length ? <div className="reader-notes-empty">
          <span className="reader-notes-empty-icon"><VideoIcon search={filtering} /></span>
          <p>{filtering ? 'No matching videos.' : scope === 'chapter' ? 'No videos in this chapter yet.' : scope === 'book' ? 'No videos in this book yet.' : 'No saved videos yet.'}</p>
          <span className="reader-notes-empty-hint">{filtering ? 'Try a different title or book.' : canCreate ? 'Turn an idea from your reading into a short video.' : 'Set a START and END reading range to create a video.'}</span>
          {filtering ? <>{query ? <button type="button" onClick={() => setSearch('')}>Clear search</button> : null}{bookFilter ? <button type="button" onClick={() => setBookFilter('')}>Clear book filter</button> : null}</> : <>
            {scope === 'chapter' ? <button type="button" onClick={() => setScope('book')}>View book videos</button> : null}
            <button type="button" onClick={onCreate} disabled={!canCreate}>Create video</button></>}
        </div> : null}
        {active && !loading && !error ? filtered.map(video => <article className="reader-notes-row reader-videos-row" key={video.id}>
          <ConceptVideoCover api={api} video={video} onWatch={() => setSelectedId(video.id)} />
          <button className="reader-notes-row-copy reader-videos-row-open" type="button" aria-label={`View: ${videoCardTitle(video)}`} data-video-id={video.id} onClick={() => setSelectedId(video.id)}>
            <strong>{videoCardTitle(video)}</strong><span className="reader-notes-excerpt">{videoCardDescription(video)}</span>
            <span className="reader-videos-status">{videoJobLabel(video)}</span>
            {scope !== 'chapter' ? <small>{scope === 'all' ? `${video.source.bookTitle} · ` : ''}{video.source.chapterTitle}</small> : null}
          </button>
        </article>) : null}
      </div>
    </div>
    {selected ? <div className="reader-notes-detail">
      <div className="reader-notes-detail-actions">
        <button ref={backRef} type="button" className="reader-notes-back" aria-label="Back to videos" title="Back to videos" onClick={back}><VideoIcon kind="back" /><span>Videos</span></button>
        <button type="button" className="reader-notes-edit" aria-label={version ? 'Edit video' : 'Continue discussion'} title={version ? 'Edit video' : 'Continue discussion'} onClick={() => onOpen(selected)}><VideoIcon kind="edit" /><span>{version ? 'Edit video' : 'Continue discussion'}</span></button>
      </div>
      <div className="reader-notes-preview" role="region" aria-label="Video preview">
        <h2>{videoCardTitle(selected)}</h2><div className="reader-notes-source"><VideoIcon /><p><span>{selected.source.bookTitle}</span><strong>{selected.source.chapterTitle}</strong></p></div>
        {version ? active ? <ConceptVideoPlayer key={`${selected.id}:${version.id}`} api={api} videoId={selected.id} version={version} /> : null : <p>No video generated yet.</p>}
        <p className="reader-videos-description">{videoCardDescription(selected)}</p>
        <p className="reader-videos-status" role="status">{videoJobLabel(selected)}</p>
        {selected.generation?.error ? <p role="alert">{selected.generation.error}</p> : null}
      </div>
    </div> : null}
  </section>;
}
