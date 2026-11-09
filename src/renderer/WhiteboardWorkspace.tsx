import { ReadingNoteSidebarTagFilter } from './ReadingNoteTags';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import type { MemoryImageSide, ReaderDesktopApi, ReadingNote } from '../shared/contracts';
import type { BoardSide, BoardNote, Whiteboard, WhiteboardsApi } from '../shared/whiteboard';
import { BOARD_SIDES, boardCardHeight, boardPort, boardEdgeGeometry, BOARD_CARD_WIDTH, BOARD_TEXT_HEIGHT, canvasPoint, fitBoard, placeBoardElement, zoomBoard } from '../shared/whiteboard';
import { WhiteboardSession } from './whiteboard-session';
import { ReadingNoteCardVisual } from './ReadingNoteLibrary';
import { ReadingNoteVisualLightbox } from './ReadingNoteTwoSidedLightbox';
import { ReadingNoteEditorDialog } from './ReadingNoteEditorDialog';
import { ReadingNoteBookFilter } from './ReadingNoteBookFilter';
import './whiteboards.css';

type NotesApi = ReaderDesktopApi['readingNotes'];
type LeaveGuard = ((next: () => void) => void) | undefined;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const uid = () => crypto.randomUUID();
const bounded = (n: number) => Math.max(-1_000_000, Math.min(1_000_000, n));

type IconName = 'minus' | 'back' | 'plus' | 'search' | 'text' | 'grip' | 'flip' | 'expand' | 'open' | 'trash' | 'close' | 'refresh' | 'check' | 'locate' | 'board';
function WbIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    minus: 'M5 12h14', back: 'M15 5l-7 7 7 7M8 12h12', plus: 'M12 5v14M5 12h14',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    text: 'M4 6V4h16v2M12 4v16M8 20h8', grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
    flip: 'M4 7h16l-4-4M20 17H4l4 4', expand: 'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6',
    open: 'M14 3h7v7M21 3l-11 11M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    close: 'M6 6l12 12M18 6L6 18', refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2',
    check: 'M5 12l4 4L19 6', locate: 'M12 2v4M12 18v4M2 12h4M18 12h4M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0M12 12h.01',
    board: 'M3 3h18v15H3zM8 18l-2 3M16 18l2 3M7 7h4v6H7zM15 7h2M15 11h2'
  };
  return <svg className="wb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function WbDialog({ label, onCancel, children }: { label: string; onCancel(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => { if (typeof dialog.close === 'function') dialog.close(); };
  }, []);
  return <dialog ref={ref} className="wb-modal" role="alertdialog" aria-label={label} aria-modal="true" onCancel={e => { e.preventDefault(); onCancel(); }}>{children}</dialog>;
}
function BoardPreview({ board }: { board: Whiteboard }) {
  const items = [...board.notes.map(n => ({ ...n, height: boardCardHeight(n) })), ...board.texts.map(t => ({ ...t, height: BOARD_TEXT_HEIGHT }))];
  if (!items.length) return <span className="wb-miniature wb-miniature-empty"><WbIcon name="board" /><span>Empty whiteboard</span></span>;
  const left = Math.min(...items.map(n => n.x)), top = Math.min(...items.map(n => n.y));
  const width = Math.max(...items.map(n => n.x + BOARD_CARD_WIDTH)) - left;
  const height = Math.max(...items.map(n => n.y + n.height)) - top;
  const scale = Math.min(248 / width, 88 / height, .3);
  return <span className="wb-miniature" aria-hidden="true"><svg viewBox="0 0 280 120">
    <g transform={`translate(${(280 - width * scale) / 2} ${(120 - height * scale) / 2}) scale(${scale}) translate(${-left} ${-top})`}>
      {board.edges.map(e => { const a = board.notes.find(n => n.id === e.source), b = board.notes.find(n => n.id === e.target); return a && b ? <line key={e.id} x1={a.x + BOARD_CARD_WIDTH / 2} y1={a.y + boardCardHeight(a) / 2} x2={b.x + BOARD_CARD_WIDTH / 2} y2={b.y + boardCardHeight(b) / 2} /> : null; })}
      {board.notes.map(n => <rect key={n.id} x={n.x} y={n.y} width={BOARD_CARD_WIDTH} height={boardCardHeight(n)} rx={18} />)}
      {board.texts.map(t => <rect key={t.id} className="wb-preview-text" x={t.x} y={t.y} width={BOARD_CARD_WIDTH} height={BOARD_TEXT_HEIGHT} rx={14} />)}
    </g>
  </svg></span>;
}

export function WhiteboardWorkspace({ api, notesApi, registerGuard, initialBoardId, onBoardChange }: { api: WhiteboardsApi; notesApi: NotesApi; registerGuard?(guard: LeaveGuard): void; initialBoardId?: string; onBoardChange?(id: string | undefined): void }) {
  const [boards, setBoards] = useState<Whiteboard[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const [session, setSession] = useState<WhiteboardSession>();
  const resumeId = useRef(initialBoardId), openId = useRef(0);
  const [restoring, setRestoring] = useState(Boolean(initialBoardId));
  const [deleting, setDeleting] = useState<Whiteboard>(), [leaving, setLeaving] = useState<{ next(): void }>();
  const loadId = useRef(0);
  const reload = useCallback(async () => {
    const request = ++loadId.current; setLoading(true); setError('');
    try { const result = await api.list(); if (request === loadId.current) setBoards(result); }
    catch (e) { if (request === loadId.current) setError(message(e)); }
    finally { if (request === loadId.current) setLoading(false); }
  }, [api]);
  useEffect(() => { void reload(); return () => { loadId.current++; }; }, [reload]);
  useEffect(() => {
    if (resumeId.current) void open(resumeId.current);
    return () => { openId.current++; };
  }, [api]);
  const leave = useCallback((next: () => void) => {
    if (!session) { next(); return; }
    void session.flush().then(ok => { if (ok) next(); else setLeaving({ next }); });
  }, [session]);
  useEffect(() => { registerGuard?.(session ? leave : undefined); return () => registerGuard?.(undefined); }, [registerGuard, session, leave]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session && session.getSnapshot().status !== 'saved') { event.preventDefault(); event.returnValue = ''; void session.flush(); }
    };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [session]);
  async function open(id: string) {
    const request = ++openId.current;
    setBusy(true); setError('');
    try {
      const board = await api.get(id);
      if (request !== openId.current) return;
      setSession(new WhiteboardSession(board, input => api.save(input))); onBoardChange?.(board.id);
    }
    catch (e) { if (request === openId.current) { setError(message(e)); onBoardChange?.(undefined); } }
    finally { if (request === openId.current) { setBusy(false); setRestoring(false); } }
  }
  const matches = boards.filter(b => b.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="whiteboard-workspace" aria-label="Whiteboards">
    {restoring ? <p role="status">Loading whiteboard…</p> : session ? <BoardEditor key={session.getSnapshot().board.id} session={session} notesApi={notesApi}
      onBack={() => leave(() => { setSession(undefined); onBoardChange?.(undefined); void reload(); })} /> : <div className="wb-library">
      <header className="wb-library-header library-page-heading"><div><span className="library-page-eyebrow">Connect your notes</span><h1>Whiteboards</h1><p>Organize your notes and connections.</p></div><span className="wb-board-count">{boards.length} boards</span></header>
      <div className="wb-library-controls">
      <div className="wb-library-search"><WbIcon name="search" /><input type="search" aria-label="Search whiteboards" placeholder="Search whiteboards" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <form className="wb-create" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void api.create(name).then(board => { setName(''); setSession(new WhiteboardSession(board, input => api.save(input))); onBoardChange?.(board.id); }).catch(e => setError(message(e))).finally(() => setBusy(false)); }}>
        <input aria-label="New whiteboard name" placeholder="New whiteboard name" value={name} maxLength={200} onChange={e => setName(e.target.value)} />
        <button className="wb-primary" disabled={busy || !name.trim()} type="submit"><WbIcon name="plus" />New whiteboard</button>
      </form>
      </div><p className="wb-results-count">{matches.length} whiteboards</p>
      {error && <div className="wb-error" role="alert">{error} <button onClick={() => void reload()}>Retry</button></div>}
      {loading ? <p role="status">Loading whiteboards…</p> : <div className="wb-board-grid">{matches.map(board => <article key={board.id} className="wb-board-tile">
        <button className="wb-open-board" aria-label={`Open ${board.title}`} disabled={busy} onClick={() => void open(board.id)}>
          <BoardPreview board={board} />
          <strong>{board.title}</strong><small>{board.notes.length} notes · {board.edges.length} connections</small><time>{new Date(board.updatedAt).toLocaleDateString()}</time>
        </button><button className="wb-delete-board" aria-label={`Delete ${board.title}`} title="Delete whiteboard" onClick={() => setDeleting(board)}><WbIcon name="trash" /></button>
      </article>)}</div>}
      {!loading && !error && !matches.length && <div className="wb-empty"><WbIcon name="board" /><h2>{search ? 'No matching whiteboards' : 'A place for your ideas to meet'}</h2><p>{search ? 'Try another title or clear your search.' : 'Create a whiteboard, then add notes from the sidebar.'}</p>{search && <button onClick={() => setSearch('')}>Clear search</button>}</div>}
    </div>}
    {deleting && <WbDialog label="Delete whiteboard" onCancel={() => { if (!busy) setDeleting(undefined); }}><h2>Delete “{deleting.title}”?</h2><p>The arrangement and connections will be deleted. Your reading notes will be kept.</p><div><button disabled={busy} onClick={() => setDeleting(undefined)}>Cancel</button><button className="wb-danger" disabled={busy} onClick={() => { setBusy(true); void api.remove(deleting.id).then(() => { setDeleting(undefined); void reload(); }).catch(e => setError(message(e))).finally(() => setBusy(false)); }}>Delete whiteboard</button></div>{error && <p role="alert">{error}</p>}</WbDialog>}
    {leaving && <WbDialog label="Unsaved whiteboard" onCancel={() => setLeaving(undefined)}><h2>Unsaved whiteboard</h2><p>{message(session?.getSnapshot().error)}</p><p>Your changes are still here. Retry saving, or explicitly discard them before leaving.</p><div><button onClick={() => setLeaving(undefined)}>Keep editing</button><button onClick={() => { const next = leaving.next; onBoardChange?.(undefined); setLeaving(undefined); next(); }}>Discard and leave</button><button className="wb-primary" onClick={() => { void session?.flush().then(ok => { if (ok) { const next = leaving.next; setLeaving(undefined); next(); } }); }}>Retry save</button></div></WbDialog>}
  </section>;
}

function BoardEditor({ session, notesApi, onBack }: { session: WhiteboardSession; notesApi: NotesApi; onBack(): void }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), board = snapshot.board;
  const canvas = useRef<HTMLDivElement>(null), dragCleanup = useRef<() => void>(() => {});
  const [notes, setNotes] = useState<ReadingNote[]>([]), [notesLoading, setNotesLoading] = useState(true), [notesError, setNotesError] = useState('');
  const [query, setQuery] = useState(''), [book, setBook] = useState<string>(), [selected, setSelected] = useState<string>();
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [placementFilter, setPlacementFilter] = useState<'on-board' | 'not-on-board'>('on-board');
  const [connection, setConnection] = useState<{ id: string; side: BoardSide }>(), [lineEnd, setLineEnd] = useState<{ x: number; y: number }>();
  const [detail, setDetail] = useState<ReadingNote>(), [image, setImage] = useState<{ noteId: string; side: MemoryImageSide }>();
  const [notice, setNotice] = useState('');
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const noteRequest = useRef(0), noteVersions = useRef(new Map<string, ReadingNote>());
  const refresh = useCallback(async () => {
    const request = ++noteRequest.current; setNotesError('');
    try {
      const [active, trashed] = await Promise.all([notesApi.list({ status: 'active', sort: 'recent' }), notesApi.list({ status: 'trashed', sort: 'recent' })]);
      if (request !== noteRequest.current) return;
      const next = [...active, ...trashed].map(n => { const old = noteVersions.current.get(n.id); return old && old.revision > n.revision ? { ...old, trashedAt: n.trashedAt } : n; });
      noteVersions.current = new Map(next.map(n => [n.id, n])); setNotes(next);
    } catch (e) { if (request === noteRequest.current) setNotesError(message(e)); }
    finally { if (request === noteRequest.current) setNotesLoading(false); }
  }, [notesApi]);
  useEffect(() => {
    void refresh(); const focus = () => { void refresh(); }; window.addEventListener('focus', focus);
    const off = notesApi.memoryImage?.onStateChanged?.(() => { void refresh(); });
    return () => { noteRequest.current++; window.removeEventListener('focus', focus); off?.(); };
  }, [notesApi, refresh]);
  useEffect(() => { if (snapshot.status !== 'dirty') return; const timer = setTimeout(() => { void session.flush(); }, 500); return () => clearTimeout(timer); }, [snapshot, session]);
  useEffect(() => () => dragCleanup.current(), []);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('textarea,input,[role="dialog"]')) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      session.edit(b => ({ ...b, viewport: event.ctrlKey || event.metaKey
        ? zoomBoard(b.viewport, b.viewport.zoom * Math.exp(-event.deltaY * .005), { x: event.clientX - rect.left, y: event.clientY - rect.top })
        : { ...b.viewport, x: bounded(b.viewport.x - event.deltaX), y: bounded(b.viewport.y - event.deltaY) } }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [session]);
  const edit = (change: (b: Whiteboard) => Whiteboard) => session.edit(change);
  const size = () => ({ width: canvas.current?.clientWidth || 800, height: canvas.current?.clientHeight || 600 });
  function addNote(note: ReadingNote) {
    const current = session.getSnapshot().board, existing = current.notes.find(n => n.noteId === note.id);
    if (existing) {
      const { width, height } = size(), zoom = 1.5;
      edit(b => ({ ...b, viewport: {
        zoom,
        x: width / 2 - (existing.x + BOARD_CARD_WIDTH / 2) * zoom,
        y: height / 2 - (existing.y + boardCardHeight(existing) / 2) * zoom
      } }));
      setSelected(existing.id); return;
    }
    const { width, height } = size(), position = placeBoardElement(current, width, height), id = uid();
    edit(b => ({ ...b, viewport: position.viewport, notes: [...b.notes, { id, noteId: note.id, x: bounded(position.x), y: bounded(position.y) }] })); setSelected(id);
  }
  function remove(id: string) {
    edit(b => ({ ...b, notes: b.notes.filter(n => n.id !== id), texts: b.texts.filter(t => t.id !== id), edges: b.edges.filter(e => e.id !== id && e.source !== id && e.target !== id) }));
    setSelected(undefined); if (connection?.id === id) setConnection(undefined);
  }
  function beginDrag(event: ReactPointerEvent, kind: 'notes' | 'texts' | 'viewport', id?: string, onMoved?: () => void) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation(); dragCleanup.current();
    const start = { x: event.clientX, y: event.clientY }, original = session.getSnapshot().board;
    const position = kind === 'viewport' ? original.viewport : original[kind].find(n => n.id === id)!;
    if (id) setSelected(id); else { setSelected(undefined); canvas.current?.focus(); }
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      onMoved?.();
      edit(b => kind === 'viewport' ? { ...b, viewport: { ...b.viewport, x: bounded(position.x + dx), y: bounded(position.y + dy) } }
        : { ...b, [kind]: b[kind].map(n => n.id === id ? { ...n, x: bounded(position.x + dx / original.viewport.zoom), y: bounded(position.y + dy / original.viewport.zoom) } : n) });
    };
    const finish = (event?: PointerEvent) => { if (event?.type === 'pointercancel') onMoved?.(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); };
    dragCleanup.current = finish;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  }
  function connect(source: string, target: string, sourceSide: BoardSide, targetSide: BoardSide) {
    setConnection(undefined); setLineEnd(undefined); if (source === target) return;
    const current = session.getSnapshot().board;
    if (current.edges.some(e => !e.arrow && [e.source, e.target].includes(source) && [e.source, e.target].includes(target))) { setNotice('These cards are already connected.'); return; }
    const id = uid(); edit(b => ({ ...b, edges: [...b.edges, { id, source, target, sourceSide, targetSide, label: '', arrow: false }] })); setSelected(id); setNotice('');
  }
  const portDrag = useRef(false);
  function startPort(event: ReactPointerEvent, source: string, side: BoardSide) {
    event.stopPropagation(); if (event.button !== 0) return;
    dragCleanup.current(); portDrag.current = false;
    const start = { x: event.clientX, y: event.clientY };
    const move = (e: PointerEvent) => {
      if (Math.abs(start.x - e.clientX) + Math.abs(start.y - e.clientY) > 4) {
        portDrag.current = true; setConnection({ id: source, side });
        if (canvas.current) setLineEnd(canvasPoint({ x: e.clientX, y: e.clientY }, canvas.current.getBoundingClientRect(), session.getSnapshot().board.viewport));
      }
    };
    const up = (e: PointerEvent) => {
      if (portDrag.current) { const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-port]'); if (target?.dataset.port && target.dataset.side) connect(source, target.dataset.port, side, target.dataset.side as BoardSide); else { setConnection(undefined); setLineEnd(undefined); } }
      cleanup();
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
    const cancel = () => { setConnection(undefined); setLineEnd(undefined); cleanup(); };
    dragCleanup.current = cleanup; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  }
  const active = notes.filter(n => n.trashedAt === undefined), books = [...new Set(active.map(n => n.bookTitle))].sort((a, b) => a.localeCompare(b));
  const placedNoteIds = new Set(board.notes.map(n => n.noteId));
  const results = active.filter(n => (!book || n.bookTitle === book)
    && (!tagFilter.length || tagFilter.some(id => n.tagIds?.includes(id)))
    && n.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && placedNoteIds.has(n.id) === (placementFilter === 'on-board'));
  const hasNoteFilters = Boolean(query || book || tagFilter.length);
  const selectedEdge = board.edges.find(e => e.id === selected), source = board.notes.find(n => n.id === connection?.id);
  const imageNote = image && notes.find(n => n.id === image.noteId && n.trashedAt === undefined);
  function changeEdge(patch: Partial<{ label: string; arrow: boolean }>) {
    if (!selectedEdge) return;
    const changed = { ...selectedEdge, ...patch };
    const duplicate = board.edges.some(e => e.id !== changed.id && e.arrow === changed.arrow && (e.source === changed.source && e.target === changed.target || !e.arrow && e.source === changed.target && e.target === changed.source));
    if (duplicate) { setNotice('That connection already exists.'); return; }
    edit(b => ({ ...b, edges: b.edges.map(e => e.id === changed.id ? changed : e) }));
  }
  return <div className="wb-editor">
    <div className="wb-editor-body"><div className="wb-canvas-column">
      <nav className="wb-canvas-title" aria-label="Whiteboard navigation">
        <button className="wb-breadcrumb-back" onClick={onBack} aria-label="All whiteboards">所有白板</button>
        <span className="wb-breadcrumb-separator" aria-hidden="true">/</span>
        <input aria-label="Whiteboard name" title={board.title} maxLength={200} value={board.title} style={{ width: `${Math.max(8, board.title.length + 2)}ch` }} onChange={e => edit(b => ({ ...b, title: e.target.value }))} />
      </nav>
      <span className="wb-save-status" role="status" data-state={snapshot.status}>{snapshot.status === 'saved' ? 'Saved' : snapshot.status === 'error' ? 'Save failed' : snapshot.status === 'saving' ? 'Saving…' : 'Unsaved changes'}</span>
      <div className="wb-floating-tools">
        <div className="wb-tool-rail" role="group" aria-label="Whiteboard tools">
          <button className="wb-tool wb-tool-add" aria-label="Add text" data-tooltip="Add text" onClick={() => { const id = uid(), { width, height } = size(); const position = placeBoardElement(board, width, height, BOARD_TEXT_HEIGHT); edit(b => ({ ...b, viewport: position.viewport, texts: [...b.texts, { id, text: '', x: position.x, y: position.y }] })); setSelected(id); }}><WbIcon name="text" /></button>
          <span className="wb-tool-divider" />
          <button className="wb-tool" aria-label="Zoom in" data-tooltip="Zoom in" disabled={board.viewport.zoom >= 2.5} onClick={() => { const { width, height } = size(); edit(b => ({ ...b, viewport: zoomBoard(b.viewport, b.viewport.zoom * 1.2, { x: width / 2, y: height / 2 }) })); }}><WbIcon name="plus" /></button>
          <span className="wb-zoom-value" aria-label="Zoom level">{Math.round(board.viewport.zoom * 100)}%</span>
          <button className="wb-tool" aria-label="Zoom out" data-tooltip="Zoom out" disabled={board.viewport.zoom <= .2} onClick={() => { const { width, height } = size(); edit(b => ({ ...b, viewport: zoomBoard(b.viewport, b.viewport.zoom / 1.2, { x: width / 2, y: height / 2 }) })); }}><WbIcon name="minus" /></button>
          <button className="wb-tool" aria-label="Fit content" data-tooltip="Fit content" onClick={() => { const { width, height } = size(); edit(b => { const viewport = fitBoard(b, Math.max(1, width - 84), height); return { ...b, viewport: { ...viewport, x: viewport.x + 84 } }; }); }}><WbIcon name="locate" /></button>
        </div>

      </div>
      <div className="wb-canvas-messages">
        {snapshot.status === 'error' && <div className="wb-error" role="alert">{message(snapshot.error)}<button onClick={() => void session.flush()}>Retry save</button></div>}
        {connection && <div className="wb-notice" role="status">Choose another card’s connection point<button onClick={() => { setConnection(undefined); setLineEnd(undefined); }}>Cancel connection</button></div>}
        {notice && <div className="wb-notice" role="status">{notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      </div>
      {selectedEdge && <div className="wb-edge-editor"><label>Relationship<input aria-label="Connection label" maxLength={1000} placeholder="e.g. leads to, contrasts with…" value={selectedEdge.label} onChange={e => changeEdge({ label: e.target.value })} /></label><label className="wb-check"><input type="checkbox" checked={selectedEdge.arrow} onChange={e => changeEdge({ arrow: e.target.checked })} />Arrow</label><button className="wb-icon-button wb-remove" title="Delete connection" aria-label="Delete connection" onClick={() => remove(selectedEdge.id)}><WbIcon name="trash" /></button><button className="wb-icon-button" title="Close connection editor" aria-label="Close connection editor" onClick={() => setSelected(undefined)}><WbIcon name="close" /></button></div>}
      <div ref={canvas} className="wb-canvas" role="region" aria-label="Whiteboard canvas" tabIndex={0}
        style={{ backgroundSize: `${24 * board.viewport.zoom}px ${24 * board.viewport.zoom}px`, backgroundPosition: `${board.viewport.x}px ${board.viewport.y}px` }}
        onPointerDown={e => { if (e.target === e.currentTarget) beginDrag(e, 'viewport'); }}
        onKeyDown={e => { if ((e.target as HTMLElement).closest('input,textarea,button,[role="dialog"],[contenteditable="true"]')) return; if (e.key === 'Escape') { setSelected(undefined); setConnection(undefined); } if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); } }}>
        <div className="wb-world" style={{ transform: `translate(${board.viewport.x}px, ${board.viewport.y}px) scale(${board.viewport.zoom})` }}>
          <svg className="wb-connections" width="1" height="1"><defs><marker id={`arrow-${board.id}`} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0 0L10 5L0 10z" /></marker></defs>
            {board.edges.map(edge => {
              const a = board.notes.find(n => n.id === edge.source)!, b = board.notes.find(n => n.id === edge.target)!;
              const { path } = boardEdgeGeometry(a, b, edge);
              return <g key={edge.id} className={selected === edge.id ? 'selected' : ''}><path className="wb-edge-hit" d={path} role="button" tabIndex={0} aria-label={`Connection: ${edge.label || 'Untitled'}`} onClick={() => setSelected(edge.id)} onKeyDown={e => { if (e.key === 'Enter') setSelected(edge.id); }} /><path className="wb-edge-line" d={path} markerEnd={edge.arrow ? `url(#arrow-${board.id})` : undefined} /></g>;
            })}
            {source && connection && lineEnd && <path className="wb-edge-line wb-pending-edge" d={`M${boardPort(source, connection.side).x} ${boardPort(source, connection.side).y}L${lineEnd.x} ${lineEnd.y}`} />}
          </svg>
          {board.edges.map(edge => { const a = board.notes.find(n => n.id === edge.source)!, b = board.notes.find(n => n.id === edge.target)!; const { label } = boardEdgeGeometry(a, b, edge); return <button key={edge.id} className={`wb-edge-label${selected === edge.id ? ' selected' : ''}`} style={{ left: label.x, top: label.y }} onClick={() => setSelected(edge.id)} aria-label={`Edit connection: ${edge.label || 'Untitled'}`}>{edge.label || 'Add label'}</button>; })}
          {board.notes.map(placement => {
            const note = notes.find(n => n.id === placement.noteId), unavailable = notesLoading ? 'Loading note…' : notesError ? 'Note could not be loaded' : !note ? 'Note deleted' : note.trashedAt !== undefined ? 'Note in Trash' : undefined;
            return <BoardCard key={placement.id} placement={placement} note={unavailable ? undefined : note} unavailable={unavailable} selected={selected === placement.id} connecting={connection?.id === placement.id} notesApi={notesApi}
              onHeightChange={height => { if (height !== boardCardHeight(session.getSnapshot().board.notes.find(n => n.id === placement.id) ?? placement)) edit(b => ({ ...b, notes: b.notes.map(n => n.id === placement.id ? { ...n, height } : n) })); }}
              onSelect={() => setSelected(placement.id)} onDrag={(e, onMoved) => beginDrag(e, 'notes', placement.id, onMoved)} onRemove={() => remove(placement.id)}
              onPortDown={(e, side) => startPort(e, placement.id, side)} onConnect={side => { if (portDrag.current) { portDrag.current = false; return; } if (connection) connect(connection.id, placement.id, connection.side, side); else { setConnection({ id: placement.id, side }); setSelected(placement.id); } }}
              onDetail={() => { if (note) setDetail(note); }} onEnlarge={side => setImage({ noteId: placement.noteId, side })} />;
          })}
          {board.texts.map(text => <section key={text.id} className={`wb-text${selected === text.id ? ' selected' : ''}`} style={{ left: text.x, top: text.y }}><header><button aria-label="Move text" onPointerDown={e => beginDrag(e, 'texts', text.id)}><WbIcon name="grip" /><span>Text</span></button><button aria-label="Delete text" title="Delete text" onClick={() => remove(text.id)}><WbIcon name="close" /></button></header><textarea autoFocus={selected === text.id && !text.text} aria-label="Whiteboard text" placeholder="Add a thought, a question, a connection…" value={text.text} maxLength={20000} onFocus={() => setSelected(text.id)} onChange={e => edit(b => ({ ...b, texts: b.texts.map(t => t.id === text.id ? { ...t, text: e.target.value } : t) }))} /></section>)}
        </div>
        {!board.notes.length && !board.texts.length && <div className="wb-canvas-empty"><WbIcon name="board" /><h2>Add your first note</h2><p>Choose a note from the right, then connect your ideas.</p></div>}
      </div>

    </div>
    <aside className={`wb-notes-sidebar${notesCollapsed ? ' is-collapsed' : ''}`} aria-label="Add reading notes">
      <header className="wb-notes-heading">{!notesCollapsed && <div><h2>Reading notes</h2><p>Add notes to this whiteboard.</p></div>}
        <button className="sidebar-toggle" type="button" aria-label={notesCollapsed ? 'Expand reading notes' : 'Collapse reading notes'} title={notesCollapsed ? 'Expand reading notes' : 'Collapse reading notes'} aria-expanded={!notesCollapsed} onClick={() => setNotesCollapsed(value => !value)}>
          <svg className="panel-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3" /><path d={`M${notesCollapsed ? 15 : 9} 4v16`} /></svg>
        </button>
      </header>
      {!notesCollapsed && <><div className="wb-sidebar-search"><WbIcon name="search" /><input type="search" aria-label="Search notes" placeholder="Search note titles…" value={query} onChange={e => setQuery(e.target.value)} /></div><ReadingNoteBookFilter books={books} value={book} onChange={setBook} />
      {notesApi.tags ? <ReadingNoteSidebarTagFilter api={notesApi.tags} selected={tagFilter} onChange={setTagFilter} refreshKey={notes} /> : null}
      <div className="wb-placement-filter" role="group" aria-label="筆記範圍">
        {([{ value: 'on-board', label: '目前白板' }, { value: 'not-on-board', label: '未加入白板' }] as const).map(option => <button key={option.value} type="button" aria-pressed={placementFilter === option.value} onClick={() => setPlacementFilter(option.value)}>{option.label}</button>)}
      </div>
      <div className="wb-sidebar-count"><span>{results.length} notes</span><button onClick={() => void refresh()} title="Refresh notes" aria-label="Refresh notes"><WbIcon name="refresh" /></button></div>
      {notesLoading && <p role="status">Loading notes…</p>}{notesError && <div className="wb-error" role="alert">{notesError}<button onClick={() => void refresh()}>Retry notes</button></div>}
      <div className="wb-note-results">{results.map(note => { const added = board.notes.some(n => n.noteId === note.id); return <article key={note.id} className={added ? 'is-added' : ''}><div className="wb-result-copy"><strong title={note.title}>{note.title}</strong><span className="wb-result-book" title={`${note.bookTitle} · ${note.chapterTitle}`}>{note.bookTitle}</span>{added && <small><WbIcon name="check" />On this board</small>}</div><button className={added ? 'wb-added' : ''} disabled={Boolean(notesError)} aria-label={`${added ? 'Locate' : 'Add'} ${note.title}`} title={added ? 'Locate on whiteboard' : 'Add to whiteboard'} onClick={() => addNote(note)}><WbIcon name={added ? 'locate' : 'plus'} /><span>{added ? 'Locate' : 'Add'}</span></button></article>; })}
      {!notesLoading && !notesError && !results.length && <div className="wb-sidebar-empty"><strong>{hasNoteFilters ? 'No matching notes' : placementFilter === 'on-board' ? '目前白板沒有可用的筆記' : '沒有尚未加入的筆記'}</strong><p>{hasNoteFilters ? 'Try another title, book or tag.' : placementFilter === 'on-board' ? '切換到「未加入白板」來新增筆記。' : '切換到「目前白板」來定位已加入的筆記。'}</p>{hasNoteFilters && <button onClick={() => { setQuery(''); setBook(undefined); setTagFilter([]); }}>Clear filters</button>}</div>}</div>
      </>}
    </aside></div>
    {imageNote && image && <ReadingNoteVisualLightbox note={imageNote} initialSide={image.side} readAttachmentDataUrl={notesApi.attachments.readDataUrl} onClose={() => setImage(undefined)} />}
    {detail && <ReadingNoteEditorDialog api={notesApi} mode="manual-edit" note={detail} initialView="note" onClose={() => { setDetail(undefined); void refresh(); }} onSaved={saved => { noteRequest.current++; noteVersions.current.set(saved.id, saved); setNotes(old => old.map(n => n.id === saved.id ? saved : n)); setDetail(saved); }} />}
  </div>;
}

function BoardCard({ placement, note, unavailable, selected, connecting, notesApi, onDrag, onRemove, onConnect, onPortDown, onDetail, onEnlarge, onSelect, onHeightChange }: {
  placement: BoardNote; note?: ReadingNote; unavailable?: string; selected: boolean; connecting: boolean; notesApi: NotesApi;
  onHeightChange(height: number): void; onDrag(e: ReactPointerEvent, onMoved: () => void): void; onPortDown(e: ReactPointerEvent, side: BoardSide): void; onRemove(): void; onConnect(side: BoardSide): void; onDetail(): void; onEnlarge(side: MemoryImageSide): void; onSelect(): void;
}) {
  const [side, setSide] = useState<MemoryImageSide>('recall');
  const suppressImageClick = useRef(false);
  const flip = () => setSide(s => s === 'recall' ? 'understand' : 'recall');
  return <div role="group" aria-label={`Card: ${note?.title ?? unavailable}`} data-side={side} className={`wb-card${selected ? ' selected' : ''}${connecting ? ' connecting' : ''}`} style={{ left: placement.x, top: placement.y, height: boardCardHeight(placement) }} onClick={onSelect}
    onPointerDown={event => { if (!(event.target as Element).closest('button, input, textarea, a, [contenteditable="true"]')) { suppressImageClick.current = false; onDrag(event, () => { suppressImageClick.current = true; }); } }}
    onDragStart={event => event.preventDefault()}>
    {note ? <div className="wb-card-image" role="button" tabIndex={0} aria-label={`Flip image: ${note.title}`} title={side === 'recall' ? 'Show front image' : 'Show back image'}
      onClick={() => { if (!suppressImageClick.current) flip(); suppressImageClick.current = false; }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); flip(); } }}
      onLoadCapture={event => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.naturalWidth > 0 && image.naturalHeight > 0) {
        // Match the image's intrinsic ratio inside the one-pixel card border.
        const height = 2 + (BOARD_CARD_WIDTH - 2) * image.naturalHeight / image.naturalWidth;
        if (height > 2 && height <= 1_000_000) onHeightChange(height);
      }
    }}><ReadingNoteCardVisual note={note} side={side} generating={false} readAttachmentDataUrl={notesApi.attachments.readDataUrl} /></div>
      : <div className="wb-unavailable"><WbIcon name="board" /><strong>{unavailable}</strong><p>The position and connections are kept.</p></div>}
    <div className="wb-card-tools" role="group" aria-label="Card actions">
      {note && <>
        <button aria-label="Flip card" data-tooltip={side === 'recall' ? 'Show front image' : 'Show back image'} title={side === 'recall' ? 'Show front image' : 'Show back image'} onClick={flip}><WbIcon name="flip" /></button>
        <button aria-label="Enlarge image" data-tooltip="Enlarge image" title="Enlarge image" onClick={() => onEnlarge(side)}><WbIcon name="expand" /></button>
        <button aria-label="View detailed note" data-tooltip="Open note" title="Open note" onClick={onDetail}><WbIcon name="open" /></button>
      </>}
      <button className="wb-card-remove" aria-label="Remove from whiteboard" data-tooltip="Remove from board" title="Remove from whiteboard" onClick={onRemove}><WbIcon name="close" /></button>
    </div>
    {BOARD_SIDES.map(side => <button key={side} className={`wb-port wb-port-${side}`} data-port={placement.id} data-side={side} aria-label={`Connect card: ${side}`} title={`Connect from ${side}: drag or click two points`} onPointerDown={e => onPortDown(e, side)} onClick={e => { e.stopPropagation(); onConnect(side); }}><WbIcon name="plus" /></button>)}
  </div>;
}
