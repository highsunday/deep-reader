import { ReadingNoteRevisionModes, ReadingNoteRevisionLegend } from './ReadingNoteRevisionControls';
import { ReadingNoteRevision } from './ReadingNoteRevision';
import { createPortal } from 'react-dom';
import { ReadingNoteEditorDialog } from './ReadingNoteEditorDialog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ReadingNoteReadOnlyContent as ReadOnlyContent } from './ReadingNoteReadOnlyContent';
import type { ReaderDesktopApi, ReadingNote, ReadingNoteSummary } from '../shared/contracts';
import type { NoteReference, NoteUpdate } from '../shared/reading-note-reference';
function errorMessage(reason: unknown, fallback: string): string {
  return (reason instanceof Error ? reason.message : fallback).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
function NoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>;
}
type NotesApi = ReaderDesktopApi['readingNotes'];
export type NoteDecision = (id: string, decision: 'apply' | 'reject') => Promise<void>;

export function NoteReferencePicker({ api, selected, onChange, disabled = false }: {
  api?: NotesApi; selected: ReadingNoteSummary[]; onChange(notes: ReadingNoteSummary[]): void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [book, setBook] = useState('');
  const [books, setBooks] = useState<string[]>([]);
  const [items, setItems] = useState<ReadingNoteSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!open || !container.current) return;
    const element = container.current;
    const panel = element.closest('.chat-panel');
    const boundary = panel?.querySelector('.chat-management-bar');
    function measure() {
      const top = boundary?.getBoundingClientRect().bottom ?? panel?.getBoundingClientRect().top ?? 0;
      setAvailableHeight(Math.max(0, element.getBoundingClientRect().top - top - 12));
    }
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    if (panel) observer?.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [open, selected.length]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const query = { status: 'active' as const, sort: 'recent' as const, ...(search.trim() ? { search: search.trim() } : {}), ...(book ? { bookTitle: book } : {}) };
  useEffect(() => {
    const generation = ++epoch.current;
    if (!open || !api) return;
    setLoading(true); setError(''); setItems([]); setCursor(undefined);
    void Promise.all([api.listPage(query), api.activeBookTitles()]).then(([page, titles]) => {
      if (epoch.current !== generation) return;
      setItems(page.items); setCursor(page.nextCursor); setBooks(titles);
    }).catch(reason => {
      if (epoch.current === generation) setError(errorMessage(reason, '無法讀取筆記。'));
    }).finally(() => { if (epoch.current === generation) setLoading(false); });
    return () => { epoch.current++; };
  }, [api, open, search, book, retry]);
  async function more() {
    if (!api) return;
    const generation = epoch.current;
    setLoading(true); setError('');
    try {
      const page = await api.listPage({ ...query, cursor });
      if (epoch.current === generation) { setItems(current => [...current, ...page.items.filter(n => !current.some(c => c.id === n.id))]); setCursor(page.nextCursor); }
    } catch (reason) {
      if (epoch.current === generation) setError(errorMessage(reason, '無法讀取筆記。'));
    } finally { if (epoch.current === generation) setLoading(false); }
  }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div ref={container} className="conversation-note-picker" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Enter' && open && event.target instanceof HTMLInputElement) event.preventDefault();
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {selected.length ? <div className="conversation-note-chips" aria-label="待送出的筆記引用">
      {selected.map(n => <span className="conversation-note-chip" key={n.id} title={`${n.bookTitle}／${n.chapterTitle}`}>
        <span>{n.title}<small>{n.bookTitle}</small></span><button type="button" disabled={disabled} aria-label={`移除引用 ${n.title} ${n.bookTitle}`} onClick={() => onChange(selected.filter(p => p.id !== n.id))}>×</button>
      </span>)}
    </div> : null}
    <button ref={trigger} type="button" className="note-reference-trigger" aria-expanded={open} disabled={disabled} onClick={() => setOpen(v => !v)}><NoteIcon />引用筆記</button>
    {open ? <section className="conversation-note-search" style={availableHeight === undefined ? undefined : { maxHeight: `min(460px, ${availableHeight}px)` }} aria-label="搜尋並引用筆記">
      <div className="conversation-note-search-heading"><strong><NoteIcon />引用既有筆記</strong><button type="button" aria-label="關閉筆記搜尋" onClick={close}>×</button></div>
      <input type="search" autoFocus aria-label="搜尋引用筆記的標題" placeholder="搜尋筆記標題…" value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} />
      <select aria-label="篩選引用筆記的書籍" value={book} disabled={disabled} onChange={e => setBook(e.target.value)}>
        <option value="">所有書籍</option>{books.map(title => <option key={title}>{title}</option>)}
      </select>
      <div className="conversation-note-results">
        {items.map(n => { const added = selected.some(p => p.id === n.id); return <button type="button" key={n.id} disabled={disabled} aria-pressed={added} aria-label={`${added ? '已選取' : '引用'} ${n.title} ${n.bookTitle} ${n.chapterTitle}`} onClick={() => onChange(added ? selected.filter(p => p.id !== n.id) : [...selected, n])}>
          <strong>{n.title}</strong><small>{n.bookTitle} · {n.chapterTitle}</small><span aria-hidden="true">{added ? '✓' : '＋'}</span>
        </button>; })}
        {loading ? <p role="status">讀取筆記中…</p> : !error && !items.length ? <p>找不到符合的筆記。</p> : null}
        {error ? <><p role="alert">{error}</p><button type="button" disabled={disabled || loading} onClick={() => cursor ? void more() : setRetry(v => v + 1)}>重試</button></> : null}
        {cursor && !error ? <button type="button" disabled={disabled || loading} onClick={() => void more()}>載入更多筆記</button> : null}
      </div>
      <div className="conversation-note-search-footer">
        <small>引用將隨問題送出，並保留在此對話。</small>
        <button type="button" onClick={close}>完成選取{selected.length ? `（${selected.length}）` : ''}</button>
      </div>
    </section> : null}
  </div>;
}
function previewNote(n: NoteReference | NoteUpdate): ReadingNote {
  const isReference = 'bookTitle' in n;
  return { id: isReference ? n.id : n.noteId, sourceDraftId: 'conversation-preview', title: n.title, content: n.content,
    revision: isReference ? n.revision : n.baseRevision, bookTitle: isReference ? n.bookTitle : '引用筆記', chapterTitle: isReference ? n.chapterTitle : '', createdAt: 0, updatedAt: 0 };
}
export function NoteReferenceHistory({ references, api, onOpen }: { references: NoteReference[]; api: NotesApi; onOpen?: (note: ReadingNote) => void }) {
  const [loadingId, setLoadingId] = useState<string>();
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  async function open(id: string) {
    if (loadingId || !onOpen) return;
    const generation = ++request.current;
    setLoadingId(id); setError('');
    try {
      const note = await api.get(id);
      if (generation !== request.current) return;
      if (!note) throw new Error('筆記已刪除，無法開啟。');
      if (note.trashedAt !== undefined) throw new Error('筆記已在垃圾桶，請先還原再開啟。');
      onOpen(note);
    } catch (reason) {
      if (generation === request.current) setError(errorMessage(reason, '無法開啟筆記，請重試。'));
    } finally { if (generation === request.current) setLoadingId(undefined); }
  }
  return <div className="conversation-note-history">{references.map(n => <button key={n.id} type="button"
    className="conversation-note-open" disabled={Boolean(loadingId) || !onOpen}
    aria-label={`開啟筆記 ${n.title} ${n.bookTitle}`} onClick={() => void open(n.id)}>
    <NoteIcon /><span><strong>引用筆記：{n.title}</strong><small>{n.bookTitle} · {n.chapterTitle} · 引用時版本 {n.revision}</small>
    <small className="conversation-note-open-hint">{loadingId === n.id ? '開啟中…' : '開啟最新筆記 · 編輯／AI 編修'}</small></span><span aria-hidden="true">↗</span>
  </button>)}{error ? <p role="alert">{error}</p> : null}</div>;
}
const statusLabels = { pending: '待確認 · 尚未保存', applied: '已套用', rejected: '不套用', superseded: '已被新候選取代' };
export function NoteUpdateCard({ proposal, api, onDecide, disabled = false }: { proposal: NoteUpdate; api: NotesApi; onDecide?: NoteDecision; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const appendOnly = proposal.preservedBlockCount !== undefined;
  const targeted = Boolean(proposal.changes && proposal.originalContent);
  const [previewMode, setPreviewMode] = useState<'changes' | 'before' | 'after'>('changes');
  const showBefore = previewMode === 'before';
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const modeControls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (previewOpen) modeControls.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [previewOpen, previewMode]);
  const [savedMetadata, setSavedMetadata] = useState<ReadingNote>();
  const [opening, setOpening] = useState(false);
  async function openPreview() {
    if (opening) return;
    setOpening(true); setError('');
    try {
      const saved = await api.get(proposal.noteId);
      if (!saved) throw new Error('筆記已刪除，無法開啟預覽。');
      setSavedMetadata(saved); setPreviewMode('changes'); setPreviewOpen(true);
    } catch (reason) { setError(errorMessage(reason, '無法開啟預覽，請重試。')); }
    finally { setOpening(false); }
  }
  function closePreview() { setPreviewOpen(false); previewTrigger.current?.focus(); }
  const preview = { ...savedMetadata, ...previewNote(proposal), ...(savedMetadata ? { bookTitle: savedMetadata.bookTitle, chapterTitle: savedMetadata.chapterTitle, createdAt: savedMetadata.createdAt, updatedAt: savedMetadata.updatedAt } : {}) };
  if (targeted && showBefore) { preview.title = proposal.originalTitle; preview.content = proposal.originalContent!; }
  if (appendOnly && !showFull) preview.content = { version: 1, blocks: proposal.content.blocks.slice(proposal.preservedBlockCount) };
  const [expanded, setExpanded] = useState(proposal.status === 'pending');
  const [error, setError] = useState('');
  useEffect(() => { if (proposal.status !== 'pending') setExpanded(false); }, [proposal.status]);
  async function decide(decision: 'apply' | 'reject') {
    if (busy || !onDecide) return;
    setBusy(true); setError('');
    try { await onDecide(proposal.id, decision); closePreview(); }
    catch (reason) { setError(errorMessage(reason, '無法處理筆記修改。')); }
    finally { setBusy(false); }
  }
  return <section className="conversation-note-update" data-status={proposal.status} aria-label={`修改筆記 ${proposal.originalTitle}`}>
    <div className="conversation-note-update-heading"><div><small className="conversation-note-eyebrow"><NoteIcon />{targeted ? 'AI 編修建議' : appendOnly ? '筆記補充建議' : '筆記更新建議'}</small><strong>{proposal.originalTitle}</strong></div><span role="status">{statusLabels[proposal.status]}</span></div>
    <p className="conversation-note-change-summary">{proposal.summary}</p>
    {targeted ? <p className="conversation-note-preserved">只調整指定段落，其餘原文保持不變。確認修改前後，再套用編修。</p> : appendOnly ? <p className="conversation-note-preserved">原標題與原文完整保留，以下內容將加在筆記末尾。</p> : proposal.status === 'pending' ? <p role="alert">這是舊版替換候選，已停用套用。請要求 AI 重新產生保留原文的補充。</p> : null}
    {targeted ? <button ref={previewTrigger} type="button" className="conversation-note-preview-toggle" disabled={opening} onClick={() => void openPreview()}>{opening ? '開啟中…' : '預覽編修'}</button> : <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>{targeted ? (showBefore ? '修改前的原筆記' : '修改後的完整筆記') : appendOnly ? (showFull ? '完整筆記預覽' : '本次新增內容') : '完整修改預覽'}</summary>
      {expanded ? <>{!appendOnly || showFull ? <h3>{preview.title}</h3> : null}
      <div className="conversation-note-preview"><ReadOnlyContent key={showBefore ? 'original' : showFull ? 'full' : 'additions'} api={api} note={preview} /></div></> : null}
    </details>}
    {targeted && previewOpen ? createPortal(<ReadingNoteEditorDialog key={previewMode} api={api} mode="manual-edit"
      note={preview} readOnly initialView="note"
      previewContent={previewMode === 'changes' ? <ReadingNoteRevision proposal={proposal} note={preview} api={api} /> : undefined} onClose={closePreview} onSaved={() => {}}
      previewControls={<>
        <div><strong>{previewMode === 'changes' ? '筆記追蹤修訂' : showBefore ? '修改前的原筆記' : '修改後的完整筆記'}</strong><small>{proposal.summary} · {statusLabels[proposal.status]}</small></div>
        <div className="conversation-note-decisions">
          <div ref={modeControls}><ReadingNoteRevisionModes value={previewMode} onChange={setPreviewMode} /></div>
          {proposal.status === 'pending' ? <><button type="button" className="note-preview-apply" disabled={disabled || busy || !onDecide} onClick={() => void decide('apply')}>{busy ? '處理中…' : '套用編修'}</button>
          <button type="button" disabled={disabled || busy || !onDecide} onClick={() => void decide('reject')}>不套用</button></> : null}
        </div>
        {previewMode === 'changes' ? <ReadingNoteRevisionLegend /> : null}
        {error ? <p role="alert">{error}</p> : null}
      </>} />, document.body) : null}
    {appendOnly && expanded ? <button type="button" className="conversation-note-preview-toggle" onClick={() => setShowFull(v => !v)}>{showFull ? '只看本次新增' : '查看完整筆記'}</button> : null}
    {proposal.status === 'pending' && !targeted ? <div className="conversation-note-decisions">
      {appendOnly || targeted ? <button type="button" disabled={disabled || busy || !onDecide} onClick={() => void decide('apply')}>{busy ? '處理中…' : targeted ? '套用編修' : '加入筆記'}</button> : null}
      <button type="button" disabled={disabled || busy || !onDecide} onClick={() => void decide('reject')}>不套用</button>
    </div> : null}
    {error && !previewOpen ? <p role="alert">{error}</p> : null}
  </section>;
}
