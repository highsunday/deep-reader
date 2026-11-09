import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { MemoryImageSide, ReaderDesktopApi, ReadingNote } from '../shared/contracts';
import type { PracticeApi, PracticeState, SetPracticePinned } from '../shared/practice';
import type { ReadingNoteBlock, ReadingNoteInlineContent } from '../shared/reading-note-document';
import { readingNoteImage } from '../shared/reading-note-images';
import { ReadingNoteEditorDialog } from './ReadingNoteEditorDialog';
import { ReadingNoteVisualLightbox } from './ReadingNoteTwoSidedLightbox';
import { ReadingNoteBookFilter } from './ReadingNoteBookFilter';
import './practice.css';

type NotesApi = ReaderDesktopApi['readingNotes'];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
function inlineText(items: ReadingNoteInlineContent[]): string {
  return items.map(item => item.type === 'text' ? item.text : item.type === 'inlineMath' ? item.props.latex : inlineText(item.content)).join('');
}
function blockText(block: ReadingNoteBlock): string {
  const text = Array.isArray(block.content) ? inlineText(block.content)
    : block.content ? block.content.rows.map(row => row.cells.map(inlineText).join(' ')).join(' ')
    : block.type === 'image' ? String(block.props.alt || block.props.caption || '')
    : block.type === 'mathBlock' ? String(block.props.latex || '') : '';
  return [text, ...block.children.map(blockText)].filter(Boolean).join(' ');
}
export function practiceNoteText(note: ReadingNote): string { return note.content.blocks.map(blockText).join(' ').replace(/\s+/g, ' ').trim(); }
function Icon({ name }: { name: 'pin' | 'plus' | 'close' | 'arrow' }) {
  return <svg className="practice-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={{ pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18', arrow: 'M5 12h14m-5-5 5 5-5 5' }[name]} /></svg>;
}
function PracticeFace({ note, api, small, side }: { note?: ReadingNote; api: NotesApi; small: boolean; side: MemoryImageSide }) {
  const attachmentId = note?.trashedAt === undefined ? readingNoteImage(note, side)?.attachmentId : undefined;
  const [image, setImage] = useState<{ id: string; url: string }>();
  useEffect(() => {
    let current = true;
    setImage(undefined);
    if (attachmentId) void api.attachments.readDataUrl(attachmentId).then(url => { if (current) setImage({ id: attachmentId, url }); }).catch(() => undefined);
    return () => { current = false; };
  }, [api, attachmentId]);
  const available = note && note.trashedAt === undefined;
  if (attachmentId && image?.id === attachmentId) return <img className="practice-image" src={image.url} alt={small ? '' : `${note!.title} — ${side === 'recall' ? 'Recall' : 'Understand'} image`} onError={() => setImage(undefined)} />;
  return <div className={`practice-text-visual${small ? ' small' : ''}`} aria-hidden={small || undefined}>
    <span aria-hidden="true">“</span><strong>{available ? (side === 'recall' ? note.title : practiceNoteText(note) || note.title).slice(0, small ? 32 : 100) : 'This note is currently unavailable'}</strong>{!small && <small>{available ? side === 'recall' ? 'Recall the idea. Use Flip to explore.' : 'Keep it in sight. Put it into practice.' : 'Your pin is still here'}</small>}
  </div>;
}
export function PracticeVisual({ note, api, small = false }: { note?: ReadingNote; api: NotesApi; small?: boolean }) {
  const [flipped, setFlipped] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const zoom = useRef<HTMLButtonElement>(null), wasExpanded = useRef(false);
  useEffect(() => {
    if (!expanded && wasExpanded.current) zoom.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  const available = Boolean(note && note.trashedAt === undefined);
  if (small) return <span className="practice-thumbnail-visual" aria-hidden="true"><PracticeFace note={note} api={api} small side="recall" /></span>;
  const side = flipped ? 'understand' : 'recall';
  // Faces stay mounted for instant manual flips; moving the pointer never changes the face.
  return <><div className="practice-visual-container" role="group" aria-label={`Note image: ${note?.title ?? 'Note deleted'}`} data-side={side}>
    <div className="practice-flip" data-side={side}>
      <span className="practice-flip-face practice-flip-recall" aria-hidden={flipped}><PracticeFace note={note} api={api} small={false} side="recall" /></span>
      <span className="practice-flip-face practice-flip-understand" aria-hidden={!flipped}><PracticeFace note={note} api={api} small={false} side="understand" /></span>
    </div>
    <button ref={zoom} className="reading-note-card-zoom" type="button" aria-label="Enlarge image" title="View large image" disabled={!available} onClick={() => setExpanded(true)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.25" cy="10.25" r="5.75" /><path d="m14.5 14.5 5 5" /></svg>
    </button>
    <button className="reading-note-card-flip" type="button" aria-label={`Flip to ${flipped ? 'recall' : 'understanding'} image`} title={`Show ${flipped ? 'recall' : 'understanding'} image`} disabled={!available} onClick={() => setFlipped(value => !value)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7.25 6.25h8.5a3 3 0 0 1 3 3v7.5" /><path d="m15.75 14 3 2.75 2.75-3" /><path d="M16.75 17.75h-8.5a3 3 0 0 1-3-3v-7.5" /><path d="m8.25 10-3-2.75L2.5 10" /></svg>
    </button>
  </div>{expanded && available && <ReadingNoteVisualLightbox note={note!} initialSide={side} readAttachmentDataUrl={api.attachments.readDataUrl} onClose={() => setExpanded(false)} />}</>;
}

function PickerDialog({ close, controls, children, busy }: { close(): void; controls: ReactNode; children: ReactNode; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  function isBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement, dialog = ref.current!;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLInputElement>('input')?.focus();
    return () => { dialog.close?.(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className="practice-picker-dialog" aria-label="Pin a note" aria-modal="true"
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}
    onMouseDown={e => { backdropPressed.current = e.button === 0 && isBackdrop(e); }}
    onClick={e => {
      const dismiss = backdropPressed.current && isBackdrop(e);
      backdropPressed.current = false;
      if (dismiss && !busy) close();
    }}>
    <header><h2>Pin a note</h2><button aria-label="Close dialog" disabled={busy} onClick={close}><Icon name="close" /></button></header>
    <div className="practice-picker-controls">{controls}</div>
    <div className="practice-picker-body">{children}</div>
  </dialog>;
}
export function PracticeWorkspace({ api, notesApi }: { api: PracticeApi; notesApi: NotesApi }) {
  const [state, setState] = useState<PracticeState>(), stateRef = useRef<PracticeState | undefined>(undefined);
  const [notes, setNotes] = useState<ReadingNote[]>([]), [selectedId, setSelectedId] = useState<string>();
  const [picker, setPicker] = useState(false), [query, setQuery] = useState(''), [detail, setDetail] = useState<ReadingNote>();
  const [bookFilter, setBookFilter] = useState<string>();
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState<SetPracticePinned>();
  const saving = useRef(false), request = useRef(0), detailRequest = useRef(0), mounted = useRef(false);
  const [notice, setNotice] = useState('');
  const detailTrigger = useRef<HTMLElement | null>(null);
  const accept = useCallback((next: PracticeState) => {
    if (!stateRef.current || next.revision >= stateRef.current.revision) { stateRef.current = next; setState(next); }
  }, []);
  const refresh = useCallback(async () => {
    const id = ++request.current; setLoading(true); setLoadError('');
    try {
      const [pins, active, trashed] = await Promise.all([api.list(), notesApi.list({ status: 'active', sort: 'recent' }), notesApi.list({ status: 'trashed', sort: 'recent' })]);
      if (id !== request.current) return;
      accept(pins); setNotes([...new Map([...trashed, ...active].map(note => [note.id, note])).values()]);
    } catch (error) { if (id === request.current) setLoadError(message(error)); }
    finally { if (id === request.current) setLoading(false); }
  }, [api, notesApi, accept]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const focus = () => { void refresh(); }; window.addEventListener('focus', focus);
    return () => { mounted.current = false; request.current++; detailRequest.current++; window.removeEventListener('focus', focus); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  const pins = state?.pins ?? [];
  const selected = pins.find(p => p.noteId === selectedId) ?? pins[0];
  const currentNote = selected ? notes.find(n => n.id === selected.noteId) : undefined;
  const available = Boolean(currentNote && currentNote.trashedAt === undefined);
  const activeNotes = notes.filter(n => n.trashedAt === undefined);
  const books = [...new Set(activeNotes.map(n => n.bookTitle))].sort((a, b) => a.localeCompare(b));
  const filtered = activeNotes.filter(n => (!bookFilter || n.bookTitle === bookFilter) && `${n.title} ${n.bookTitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function openPicker() { setQuery(''); setBookFilter(undefined); setActionError(''); setRetry(undefined); setPicker(true); }
  async function changePin(input: SetPracticePinned) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setActionError(''); setRetry(undefined);
    try {
      const result = await api.setPinned(input);
      if (!mounted.current) return;
      accept(result);
      if (input.pinned) { setSelectedId(input.noteId); setPicker(false); }
      setNotice(input.pinned ? 'Note pinned.' : 'Unpinned. Your original note is still saved.');
    } catch (error) { if (mounted.current) { setActionError(message(error)); setRetry(input); } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  async function openNote() {
    if (!selected || saving.current) return;
    const id = ++detailRequest.current;
    detailTrigger.current = document.activeElement as HTMLElement;
    setActionError(''); setRetry(undefined); saving.current = true; setBusy(true);
    try {
      const note = await notesApi.get(selected.noteId);
      if (!mounted.current || id !== detailRequest.current) return;
      if (!note || note.trashedAt !== undefined) { setActionError('This note is unavailable. It may have been moved to Trash or deleted.'); void refresh(); return; }
      setDetail(note); setNotes(old => old.map(n => n.id === note.id ? note : n));
    } catch (error) { if (mounted.current && id === detailRequest.current) setActionError(message(error)); }
    finally { saving.current = false; if (mounted.current && id === detailRequest.current) setBusy(false); }
  }
  function saved(note: ReadingNote) {
    request.current++; setLoading(false); setNotes(old => old.map(n => n.id === note.id ? note : n)); setDetail(note);
  }
  const loadFailure = loadError && <div className="practice-error" role="alert"><span>{loadError}</span><button onClick={() => void refresh()} disabled={loading}>Reload</button></div>;
  const actionFailure = actionError && <div className="practice-error" role="alert"><span>{actionError}</span>{retry && <button disabled={busy} onClick={() => void changePin(retry)}>Retry saving</button>}</div>;
  return <div className="practice-workspace"><div className="practice-inner">
    <header className="practice-heading library-page-heading"><div><div className="library-page-eyebrow">Ideas in action</div><h1>Pinned Notes{state && <span>{pins.length} {pins.length === 1 ? 'note' : 'notes'}</span>}</h1><p>Keep the ideas you want to put into practice in sight.</p></div></header>
    {!picker && loadFailure}{!picker && actionFailure}
    {!state && loading ? <p role="status" className="practice-status">Loading pinned notes…</p> : state && !pins.length ? <section className="practice-empty"><Icon name="pin" /><h2>Make room for an idea to live by.</h2><p>Choose a note you want to put into practice.</p><button className="practice-primary" onClick={openPicker}>Pin your first note</button></section> : selected ? <>
      <article className="practice-focus" data-testid="practice-focus"><div className="practice-focus-picture"><PracticeVisual key={selected.noteId} note={currentNote} api={notesApi} /></div><div className="practice-focus-copy">
        <small title={currentNote ? `${currentNote.bookTitle} · ${currentNote.chapterTitle}` : undefined}>{currentNote ? `${currentNote.bookTitle} · ${currentNote.chapterTitle}` : 'Source note unavailable'}</small><h2 title={currentNote?.title}>{currentNote?.title ?? 'Note deleted'}</h2>
        <p>{available ? practiceNoteText(currentNote!).slice(0, 240) || 'Open the note to revisit what you want to practice.' : currentNote ? 'This note is in Trash. Restore it to view it again.' : 'The original note could not be found. You can unpin it.'}</p>
        <button className="practice-primary" onClick={() => void openNote()} disabled={busy || !available}>View note <Icon name="arrow" /></button>
      </div><button className="practice-unpin" title="Unpin" aria-label={`Unpin: ${currentNote?.title ?? 'Note deleted'}`} disabled={busy} onClick={() => void changePin({ noteId: selected.noteId, pinned: false })}><Icon name="pin" /></button></article>
      <div className="practice-pin-collection"><nav className="practice-filmstrip" aria-label="Switch pinned notes">{pins.map(pin => {
        const note = notes.find(n => n.id === pin.noteId), title = note?.title ?? 'Note deleted';
        return <button key={pin.noteId} aria-label={`Select note: ${title}`} aria-pressed={pin.noteId === selected.noteId} onClick={() => { setSelectedId(pin.noteId); setActionError(''); setRetry(undefined); }}>
          <span className="practice-thumb"><PracticeVisual note={note} api={notesApi} small /></span><span>{title}</span>
        </button>;
      })}</nav><button className="practice-add-pin" onClick={openPicker} disabled={busy}><Icon name="plus" /><span>Pin a note</span></button></div>
    </> : null}
    {notice && <p className="practice-notice" role="status">{notice}</p>}
    {picker && <PickerDialog busy={busy} close={() => { setPicker(false); setActionError(''); setRetry(undefined); }} controls={<>
      <p className="practice-modal-hint">Choose a note to keep in sight.</p>
      <div className="practice-picker-filters">
        <label className="practice-search">Search notes or books<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" /></label>
        <ReadingNoteBookFilter books={books} value={bookFilter} onChange={setBookFilter} />
      </div>
    </>}>
      {loadFailure}{actionFailure}{loading && <p role="status">Refreshing notes…</p>}
      <div className="practice-picker">{filtered.map(note => {
        const pinned = pins.some(p => p.noteId === note.id);
        return <button key={note.id} aria-label={`${pinned ? 'Pinned' : 'Pin'}: ${note.title}`} disabled={pinned || busy} onClick={() => void changePin({ noteId: note.id, pinned: true })}>
          <span className="practice-picker-picture"><PracticeVisual note={note} api={notesApi} small /></span><span><strong>{note.title}</strong><small>{note.bookTitle}</small></span><span>{pinned ? 'Pinned' : '+ Pin'}</span>
        </button>;
      })}</div>{!loading && !loadError && !filtered.length && <p className="practice-modal-hint">{activeNotes.length ? 'No matching notes. Try another search.' : 'No notes to pin yet. Save a note while reading to get started.'}</p>}
      {busy && <p role="status">Saving pin…</p>}
    </PickerDialog>}
    {detail && <ReadingNoteEditorDialog api={notesApi} mode="manual-edit" note={detail} initialView="note" onSaved={saved} onClose={() => { setDetail(undefined); detailTrigger.current?.focus(); void refresh(); }} />}
  </div></div>;
}
