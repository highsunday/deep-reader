import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ReaderDesktopApi, ReadingNoteTag, ReadingNoteTagsApi } from '../shared/contracts';
import './reading-note-tags.css';

function message(error: unknown) { return error instanceof Error ? error.message : 'Unable to update tags. Please try again.'; }

function TagDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose(): void; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => { previous?.focus(); };
  }, []);
  return <div className="note-tag-backdrop" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <section ref={ref} className="note-tag-dialog" role="dialog" aria-modal="true" aria-label={title} aria-busy={busy}>
      <header><h2>{title}</h2><button type="button" aria-label="Close tags" disabled={busy} onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>;
}

export function ReadingNoteTagPicker({ api, title, onPick, onClose, allowCreate = true }: {
  api: ReadingNoteTagsApi; title: string; onPick(tag: ReadingNoteTag): void | Promise<void>; onClose(): void; allowCreate?: boolean;
}) {
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { setTags(await api.list()); } catch (cause) { setError(message(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [api]);
  async function pick(tag?: ReadingNoteTag) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onPick(tag ?? await api.create(search.trim())); }
    catch (cause) { setError(message(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  const name = search.trim();
  const filtered = tags.filter(tag => tag.name.toLowerCase().includes(name.toLowerCase()));
  return <TagDialog title={title} onClose={onClose} busy={busy}>
    <label className="note-tag-search">{allowCreate ? 'Search or create tag' : 'Search tags'}
      <input aria-label={allowCreate ? 'Search or create tag' : 'Search tags'} value={search} maxLength={80} disabled={busy}
        placeholder="e.g. Communication" onChange={event => setSearch(event.target.value)} />
    </label>
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>Reload tags</button></p> : null}
    {loading ? <p role="status">Loading tags…</p> : <div className="note-tag-options">
      {filtered.map(tag => <button type="button" key={tag.id} disabled={busy} onClick={() => void pick(tag)}><span>#</span>{tag.name}</button>)}
      {!filtered.length ? <p>No matching tags.</p> : null}
    </div>}
    {allowCreate && !loading && name && !tags.some(tag => tag.name.toLowerCase() === name.toLowerCase()) ?
      <button className="note-tag-primary" type="button" disabled={busy} onClick={() => void pick()}>Create “{name}”</button> : null}
    {busy ? <p role="status">Saving tags…</p> : null}
  </TagDialog>;
}

export function ReadingNoteTagManager({ api, onChanged, onClose }: { api: ReadingNoteTagsApi; onChanged(): void | Promise<void>; onClose(): void }) {
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function load() {
    setLoading(true); setError('');
    try { const values = await api.list(); setTags(values); setNames(Object.fromEntries(values.map(tag => [tag.id, tag.name]))); }
    catch (cause) { setError(message(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [api]);
  async function rename(tag: ReadingNoteTag) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = await api.rename({ id: tag.id, name: names[tag.id] });
      setTags(items => items.map(item => item.id === saved.id ? saved : item));
      setNames(current => ({ ...current, [saved.id]: saved.name }));
      await onChanged();
    } catch (cause) { setError(message(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <TagDialog title="Manage tags" onClose={onClose} busy={busy}>
    <p>Rename a tag everywhere it is used, including notes in Trash.</p>
    <input aria-label="Find tag to rename" placeholder="Find a tag" value={search} onChange={event => setSearch(event.target.value)} />
    {loading ? <p role="status">Loading tags…</p> : !tags.length ? <p>No tags yet. Add tags to a note or a selection to get started.</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>Reload tags</button></p> : null}
    <div className="note-tag-options">{tags.filter(tag => tag.name.toLowerCase().includes(search.trim().toLowerCase())).map(tag =>
      <form key={tag.id} className="note-tag-rename" onSubmit={event => { event.preventDefault(); void rename(tag); }}>
        <input aria-label={`Rename ${tag.name}`} maxLength={80} disabled={busy} value={names[tag.id] ?? tag.name} onChange={event => setNames(current => ({ ...current, [tag.id]: event.target.value }))} />
        <button type="submit" aria-label={`Save ${tag.name}`} disabled={busy || !names[tag.id]?.trim() || names[tag.id] === tag.name}>Save</button>
      </form>)}</div>
  </TagDialog>;
}

export function ReadingNoteTagEditor({ api, noteId, readOnly = false }: { api: ReaderDesktopApi['readingNotes']; noteId: string; readOnly?: boolean }) {
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([api.tags!.list(), api.get(noteId)]).then(([values, note]) => {
      if (active) { setTags(values); setIds(note?.tagIds ?? []); }
    }).catch(cause => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, noteId]);
  async function change(tag: ReadingNoteTag, action: 'add' | 'remove') {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await api.tags!.change({ noteIds: [noteId], tagId: tag.id, action });
      setIds(current => action === 'add' ? [...new Set([...current, tag.id])] : current.filter(id => id !== tag.id));
      setTags(current => current.some(item => item.id === tag.id) ? current : [...current, tag]);
      setOpen(false);
    } catch (cause) { setError(message(cause)); throw cause; }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="note-tag-editor" aria-label="Note tags">
    <strong>Tags</strong>
    {loading ? <span role="status">Loading…</span> : tags.filter(tag => ids.includes(tag.id)).map(tag => <span className="note-tag-chip" key={tag.id}>{tag.name}
      {!readOnly ? <button type="button" aria-label={`Remove ${tag.name}`} disabled={busy} onClick={() => void change(tag, 'remove').catch(() => {})}>×</button> : null}</span>)}
    {!readOnly ? <button type="button" disabled={busy || loading} onClick={() => setOpen(true)}>+ Add tag</button> : null}
    {error ? <span role="alert">{error}</span> : null}
    {open ? <ReadingNoteTagPicker api={api.tags!} title="Add tag to note" onClose={() => setOpen(false)} onPick={tag => change(tag, 'add')} /> : null}
  </div>;
}

export function ReadingNoteTagFilter({ tags, selected, onChange }: { tags: ReadingNoteTag[]; selected: string[]; onChange(ids: string[]): void }) {
  const [search, setSearch] = useState('');
  return <details className="note-tag-filter">
    <summary>Tags{selected.length ? ` · ${selected.length} selected` : ' · All'}</summary>
    <div className="note-tag-filter-menu">
      <input aria-label="Search tag filters" placeholder="Find a tag" value={search} onChange={event => setSearch(event.target.value)} />
      <small>Match any selected tag</small>
      <div>{tags.filter(tag => tag.name.toLowerCase().includes(search.trim().toLowerCase())).map(tag => <label key={tag.id}>
        <input type="checkbox" checked={selected.includes(tag.id)} onChange={() => onChange(selected.includes(tag.id) ? selected.filter(id => id !== tag.id) : [...selected, tag.id])} />{tag.name}
      </label>)}</div>
      {!tags.length ? <p>No tags yet.</p> : null}
      <button type="button" disabled={!selected.length} onClick={() => onChange([])}>Clear tags</button>
    </div>
  </details>;
}

/** Catalog-backed filter shared by the reader and whiteboard sidebars. */
export function ReadingNoteSidebarTagFilter({ api, selected, onChange, refreshKey }: {
  api: ReadingNoteTagsApi; selected: string[]; onChange(ids: string[]): void; refreshKey?: unknown;
}) {
  const [tags, setTags] = useState<ReadingNoteTag[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.list().then(values => { if (active) setTags(values); })
      .catch(cause => { if (active) setError(message(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refreshKey, retry]);
  return <div className="note-tag-sidebar-filter">
    <ReadingNoteTagFilter tags={tags} selected={selected} onChange={onChange} />
    {loading ? <small role="status">Loading tags…</small> : null}
    {error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry tags</button></div> : null}
  </div>;
}
