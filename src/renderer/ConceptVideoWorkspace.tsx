import { videoJobLabel } from './ConceptVideoActivity';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConceptVideo, ConceptVideoApi, ConceptVideoSource, ConceptVideoVersion } from '../shared/concept-video';
import { VIDEO_ENGINES, VIDEO_ENGINE_LABELS, videoEngine, type VideoEngine } from '../shared/concept-video';
import './concept-video.css';

const VIDEO_ENGINE_DESCRIPTIONS: Record<VideoEngine, string> = {
  canvas: 'Basic diagrams & flows',
  remotion: 'Text, charts & visual stories',
  manim: 'Math & geometry'
};

interface VideoBook { id: string; title: string; chapters: { id: string }[] }
export function currentVersion(video: ConceptVideo) {
  return video.versions.find(version => version.id === video.currentVersionId) ?? video.versions.at(-1);
}
export function videoLastChangedAt(video: ConceptVideo) {
  return Math.max(video.createdAt, video.updatedAt, ...video.versions.map(version => version.createdAt));
}
export function videoCardTitle(video: ConceptVideo) {
  return currentVersion(video)?.plan.title || video.plan.title;
}
export function videoCardDescription(video: ConceptVideo) {
  const version = currentVersion(video);
  return version?.plan.description || version?.plan.goal || video.plan.goal;
}

export function ConceptVideoCover({ api, video, onWatch }: { api: ConceptVideoApi; video: ConceptVideo; onWatch(trigger: HTMLButtonElement): void }) {
  const version = currentVersion(video);
  const [url, setUrl] = useState(''), [loading, setLoading] = useState(Boolean(version));
  useEffect(() => {
    if (!version) return;
    let active = true, objectUrl = '';
    setUrl(''); setLoading(true);
    void api.poster({ id: video.id, versionId: version.id }).then(bytes => {
      if (!active) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      setUrl(objectUrl); setLoading(false);
    }).catch(() => { if (active) { setUrl(''); setLoading(false); } });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, video.id, version?.id]);
  const image = <>{url ? <img src={url} alt="" onError={() => { setUrl(''); setLoading(false); }} /> : <span aria-hidden="true" className="concept-video-cover-placeholder">{version ? loading ? 'Loading cover…' : 'Preview unavailable' : 'Video draft'}</span>}{version ? <span className="concept-video-cover-play" aria-hidden="true">▶</span> : null}</>;
  return version ? <button type="button" className="concept-video-cover" aria-label={`Play preview: ${videoCardTitle(video)}`} onClick={event => onWatch(event.currentTarget)}>{image}</button> : <div className="concept-video-cover">{image}</div>;
}

function ConceptVideoWatchDialog({ api, video, onClose }: { api: ConceptVideoApi; video: ConceptVideo; onClose(): void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const version = currentVersion(video);
  useEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  if (!version) return null;
  return createPortal(<div className="concept-video-watch-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`Watch video: ${version.plan.title}`} className="concept-video-watch-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), video[controls]') ?? [])];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        if (index < 0) return;
        event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    }}>
      <header className="concept-video-watch-heading"><div><span className="concept-video-eyebrow">Now playing</span><h2>{version.plan.title}</h2><p>{video.source.bookTitle} / {video.source.chapterTitle}</p></div><button type="button" aria-label="Close video" className="concept-video-watch-close" onClick={onClose}>×</button></header>
      <ConceptVideoPlayer api={api} videoId={video.id} version={version} autoPlay />
    </div>
  </div>, document.body);
}

const legacyGenerationStages: Record<string, string> = {
  '正在本機製作動畫與旁白': 'Rendering animation and narration locally',
  '上次生成已中斷，可重新生成': 'The previous generation was interrupted. You can try again.',
  '尚未保存，請重新載入後重試': 'Not saved. Reload and try again.',
  '上次生成尚未保存，可重試': 'The previous generation was not saved. You can try again.',
  '生成失敗，可重試': 'Generation failed. You can try again.',
  '生成已取消，可重試': 'Generation cancelled. You can try again.'
};
export function ConceptVideoLibrary({ api, books, onOpen, refreshKey = 0, liveVideos }: { liveVideos?: ConceptVideo[]; api: ConceptVideoApi; books: VideoBook[]; onOpen(video: ConceptVideo): void; refreshKey?: number }) {
  const [videos, setVideos] = useState<ConceptVideo[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [bookId, setBookId] = useState(''), [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  const [deleting, setDeleting] = useState<ConceptVideo>(), [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState<ConceptVideo>();
  const cancelRef = useRef<HTMLButtonElement>(null), deleteRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLElement | null>(null);
  const watchTriggerRef = useRef<HTMLButtonElement | null>(null);
  function closeWatch() { setWatching(undefined); requestAnimationFrame(() => watchTriggerRef.current?.isConnected && watchTriggerRef.current.focus()); }
  useEffect(() => { if (!deleting) return; cancelRef.current?.focus(); return () => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); }; }, [deleting]);
  useEffect(() => { if (liveVideos) { setVideos(liveVideos); setLoading(false); return; } let cancelled = false; setLoading(true); void api.list().then(v => { if (!cancelled) { setVideos(v); setError(''); } }).catch(e => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [api, refreshKey, liveVideos]);
  const options = new Map(videos.map(v => [v.source.bookId, v.source.bookTitle]));
  const query = search.trim().toLocaleLowerCase();
  const filtered = videos.filter(v => (!bookId || v.source.bookId === bookId) && (status === 'all' || v.status === status) && `${videoCardTitle(v)}\n${v.plan.goal}\n${videoCardDescription(v)}`.toLocaleLowerCase().includes(query)).sort((a, b) => videoLastChangedAt(b) - videoLastChangedAt(a) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  async function remove() {
    if (!deleting || busy) return; setBusy(true); setError('');
    try { await api.remove({ id: deleting.id, baseRevision: deleting.revision }); setVideos(v => v.filter(item => item.id !== deleting.id)); setDeleting(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the video. Reload and try again.'); }
    finally { setBusy(false); }
  }
  return <section className="concept-video-library" aria-label="Video Library">
    <div inert={Boolean(deleting || watching)}><header className="concept-video-library-heading library-page-heading"><div><span className="library-page-eyebrow">Explore your ideas</span><h1>Videos</h1><p>Discuss your video idea with AI. Your drafts and finished videos stay here.</p></div><span className="concept-video-count">{videos.length} videos and drafts</span></header>
    <div className="concept-video-filters">
      <label>Book<select aria-label="Filter by book" value={bookId} onChange={e => setBookId(e.target.value)}><option value="">All books</option>{[...options].map(([id, title]) => <option key={id} value={id}>{title}{[...options.values()].filter(name => name === title).length > 1 ? ` (${[...options.keys()].indexOf(id) + 1})` : ''}{books.some(b => b.id === id) ? '' : ' (source removed)'}</option>)}</select></label>
      <label>Search<input type="search" aria-label="Search videos" placeholder="Search titles or concepts" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Status<select aria-label="Video status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All</option><option value="completed">Completed ({videos.filter(v => v.status === "completed").length})</option><option value="draft">Drafts ({videos.filter(v => v.status === "draft").length})</option></select></label>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading videos…</p> : !videos.length ? <div className="concept-video-empty"><span aria-hidden="true">▤</span><h2>Start with something you want to understand</h2><p>Open AI Video while reading and describe what you want to see. Your draft will appear here.</p></div> : !filtered.length ? <div className="concept-video-empty"><h2>No matching videos</h2><button type="button" onClick={() => { setSearch(''); setBookId(''); setStatus('all'); }}>Clear filters</button></div> :
      <div className="concept-video-grid">{filtered.map(video => <article className="concept-video-card" key={video.id}>
        <div className="concept-video-card-toolbar">
          <span className="concept-video-card-status" data-state={video.generation?.status === "running" ? "generating" : currentVersion(video) ? "completed" : "draft"}><i aria-hidden="true" />{video.generation?.status === "running" ? "Generating" : currentVersion(video) ? `Completed · ${video.versions.length} ${video.versions.length === 1 ? 'version' : 'versions'}` : "Draft"}</span>
          {currentVersion(video) ? <button type="button" className="concept-video-card-tool" title="Edit video" aria-label={`Edit: ${videoCardTitle(video)}`} onClick={() => onOpen(video)}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 3.5 4 4M4 13l9.5-9.5a2.1 2.1 0 0 1 3 3L7 16l-4 1z" /></svg></button> : null}
          <button type="button" className="concept-video-card-tool concept-video-card-delete" title="Delete video" aria-label={`Delete: ${videoCardTitle(video)}`} disabled={video.generation?.status === "running"} onClick={e => { triggerRef.current = e.currentTarget; setDeleting(video); }}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3.5 5.25h13M8 2.75h4M5.25 5.25l.75 11h8l.75-11M8 8v5.5M12 8v5.5" /></svg></button>
        </div>
        <ConceptVideoCover api={api} video={video} onWatch={trigger => { watchTriggerRef.current = trigger; setWatching(video); }} />
        <h2>{videoCardTitle(video)}</h2>
        <div className="concept-video-card-source" title={`${video.source.bookTitle} / ${video.source.chapterTitle}`}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h8.25a2 2 0 0 1 2 2v11.5H6a2.25 2.25 0 0 0-2.25 2.25V4.5ZM6 2.25v13.5M3.75 18A2.25 2.25 0 0 1 6 15.75" /></svg><span>{video.source.bookTitle}</span></div>
        {video.generation && video.generation.status !== "completed" ? <p role="status" className="video-card-job">{videoJobLabel(video)}</p> : null}
        <details className="concept-video-card-details"><summary>Details{video.generation?.error ? ' · Generation error' : ''}</summary><p className="concept-video-card-description">{videoCardDescription(video)}</p><small>{video.source.chapterTitle}</small>{video.generation?.error ? <p className="concept-video-card-error">{video.generation.error}</p> : null}
          {!books.some(b => b.id === video.source.bookId && b.chapters.some(c => c.id === video.source.chapterId)) ? <p>The source is unavailable; its saved snapshot is still here.</p> : null}
        </details>
        <div className="concept-video-card-actions"><time dateTime={new Date(videoLastChangedAt(video)).toISOString()} title={`Updated ${new Date(videoLastChangedAt(video)).toLocaleString()}`}>{new Date(videoLastChangedAt(video)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time>{currentVersion(video) ? <button type="button" className="concept-video-card-open" aria-label={`Watch: ${videoCardTitle(video)}`} onClick={event => { watchTriggerRef.current = event.currentTarget; setWatching(video); }}>Watch video <span aria-hidden="true">→</span></button> : <button type="button" className="concept-video-card-open" aria-label={`Continue: ${videoCardTitle(video)}`} onClick={() => onOpen(video)}>Continue <span aria-hidden="true">→</span></button>}</div>
      </article>)}</div>}
    </div>
    {watching ? <ConceptVideoWatchDialog api={api} video={watching} onClose={closeWatch} /> : null}
    {deleting ? <div className="concept-video-delete-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setDeleting(undefined); }}><div ref={deleteRef} role="dialog" aria-modal="true" aria-label="Delete video" className="concept-video-delete" onKeyDown={e => {
      if (e.key === 'Escape' && !busy) { e.preventDefault(); setDeleting(undefined); }
      if (e.key === 'Tab') {
        const buttons = [...(deleteRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); (buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length] ?? deleteRef.current)?.focus();
      }
    }} tabIndex={-1}><span className="concept-video-eyebrow">Delete video</span><h2>Delete “{videoCardTitle(deleting)}”?</h2><p>This will permanently delete the video, its versions, discussion, plan, and source snapshot.</p>{error ? <p role="alert">{error}</p> : null}<div className="concept-video-actions"><button type="button" className="video-danger" disabled={busy} onClick={() => void remove()}>Delete video</button><button ref={cancelRef} type="button" disabled={busy} onClick={() => setDeleting(undefined)}>Cancel</button></div></div></div> : null}
  </section>;
}

export function ConceptVideoPlayer({ api, videoId, version, autoPlay = false }: { api: ConceptVideoApi; videoId: string; version: ConceptVideoVersion; autoPlay?: boolean }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [playBlocked, setPlayBlocked] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let alive = true, objectUrl = ''; setUrl(''); setError('');
    void api.media({ id: videoId, versionId: version.id }).then(bytes => {
      if (!alive) return; objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })); setUrl(objectUrl);
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the saved video'); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, videoId, version.id]);
  useEffect(() => {
    if (!autoPlay || !url || !player.current) return;
    let active = true;
    try { void player.current.play().then(() => { if (active) setPlayBlocked(false); }).catch(() => { if (active) setPlayBlocked(true); }); }
    catch { setPlayBlocked(true); }
    return () => { active = false; };
  }, [autoPlay, url]);
  return <div className="concept-video-player">
    {error ? <p role="alert">{error}</p> : url ? <div className="concept-video-screen"><video ref={player} src={url} controls autoPlay={autoPlay} playsInline preload={autoPlay ? 'auto' : 'metadata'} tabIndex={0} aria-label={`Video preview: ${version.plan.title}`} onPlay={() => setPlayBlocked(false)} />{playBlocked ? <button type="button" className="concept-video-play-fallback" onClick={() => { void player.current?.play().catch(() => setPlayBlocked(true)); }}>▶ Play video</button> : null}</div> : <p role="status">Loading video…</p>}
    <div className="concept-video-player-tools"><small>{VIDEO_ENGINE_LABELS[videoEngine(version.plan)]} · {Math.round(version.durationSeconds)} sec · {version.plan.narration ? 'Chinese narration · subtitles' : 'No narration · subtitles'}</small><button type="button" disabled={!url} onClick={() => { void player.current?.requestFullscreen?.().catch(() => setError('Could not open fullscreen.')); }}>Fullscreen</button></div>
  </div>;
}

function ConceptVideoComparison({ api, video, canRetry, onChanged, onWorkingChange }: {
  api: ConceptVideoApi; video: ConceptVideo; canRetry: boolean;
  onChanged?(video: ConceptVideo): void; onWorkingChange(value: boolean): void;
}) {
  const [results, setResults] = useState<{ video?: ConceptVideo; error?: string }[]>([]);
  const [retrying, setRetrying] = useState(false), [retryError, setRetryError] = useState(''), [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const ids = video.comparison!.videoIds, key = ids.join(':');
  const running = video.generation?.status === 'running' || results.some(result => result.video?.generation?.status === 'running');
  useEffect(() => { onWorkingChange(retrying || running); return () => onWorkingChange(false); }, [retrying, running, onWorkingChange]);
  async function retry(saved: ConceptVideo) {
    if (pending.current || running || !canRetry) return;
    pending.current = true; setRetrying(true); setRetryError('');
    try {
      const next = await api.generate({ id: saved.id, baseRevision: saved.revision });
      setResults(current => current.map(result => result.video?.id === next.id ? { video: next } : result));
      onChanged?.(next); setRefresh(value => value + 1);
    } catch (e) { setRetryError(e instanceof Error ? e.message : 'Could not retry this engine.'); setRefresh(value => value + 1); }
    finally { pending.current = false; setRetrying(false); }
  }
  async function cancel(saved: ConceptVideo) {
    if (pending.current) return;
    pending.current = true; setRetrying(true); setRetryError('');
    try {
      const next = await api.cancel(saved.id);
      setResults(current => current.map(result => result.video?.id === next.id ? { video: next } : result));
      onChanged?.(next); setRefresh(value => value + 1);
    } catch (e) { setRetryError(e instanceof Error ? e.message : 'Could not cancel this retry.'); }
    finally { pending.current = false; setRetrying(false); }
  }
  useEffect(() => {
    let alive = true, fetching = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (fetching) return; fetching = true;
      const next = await Promise.all(ids.map(async id => {
        try { return { video: await api.get(id) }; }
        catch (e) { return { error: e instanceof Error ? e.message : 'Could not load comparison video.' }; }
      }));
      if (alive) {
        setResults(next);
        if (video.generation?.status === 'running' || next.some(result => result.video?.generation?.status === 'running')) timer = setTimeout(() => void load(), 1000);
      }
      fetching = false;
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [api, key, video.generation?.status, refresh]);
  return <section className="concept-video-comparison" aria-label="Engine comparison results">
    <h3>Engine comparison</h3><p>Same idea, three independent AI animations. Results are saved in Video Library.</p>
    {retryError ? <p role="alert">{retryError}</p> : null}
    <div className="concept-video-comparison-grid">{VIDEO_ENGINES.map((engine, index) => {
      const result = results[index], saved = result?.video, version = saved && currentVersion(saved);
      return <article key={ids[index]} aria-label={`${VIDEO_ENGINE_LABELS[engine]} comparison`}>
        <h4>{VIDEO_ENGINE_LABELS[engine]}</h4>
        {version && saved ? <ConceptVideoPlayer api={api} videoId={saved.id} version={version} /> : <p role={result?.error || saved?.generation?.status === 'failed' ? 'alert' : 'status'}>{result?.error || saved?.generation?.stage || 'Loading comparison…'}</p>}
        {saved?.generation?.error ? <p role="alert">{saved.generation.error}</p> : null}
        {saved?.generation?.status === 'running' && video.generation?.status !== 'running' ? <button type="button" disabled={retrying} onClick={() => void cancel(saved)}>Cancel {VIDEO_ENGINE_LABELS[engine]} retry</button> : null}
        {saved?.generation && ['failed', 'cancelled', 'interrupted'].includes(saved.generation.status) ? <button type="button" disabled={!canRetry || retrying || running} onClick={() => void retry(saved)}>Retry {VIDEO_ENGINE_LABELS[engine]}</button> : null}
      </article>;
    })}</div>
  </section>;
}

export function ConceptVideoEditor({ api, source, initialVideo, requestedPreviewId, sourceAvailable, onBack, onOpenLibrary, onChanged }: {
  api: ConceptVideoApi; source?: ConceptVideoSource; initialVideo?: ConceptVideo; requestedPreviewId?: string; sourceAvailable: boolean;
  onBack(): void; onOpenLibrary(): void; onSource(source: ConceptVideoSource): void; onChanged?(video: ConceptVideo): void;
}) {
  const [video, setVideo] = useState(initialVideo);
  const [newEngine, setNewEngine] = useState<VideoEngine>('canvas');
  const [compareAll, setCompareAll] = useState(false);
  const [question, setQuestion] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false), [comparisonWorking, setComparisonWorking] = useState(false);
  const [capability, setCapability] = useState<Awaited<ReturnType<ConceptVideoApi['capability']>>>();
  const [capabilityError, setCapabilityError] = useState(''), [retry, setRetry] = useState(0);
  const [previewId, setPreviewId] = useState(requestedPreviewId ?? initialVideo?.currentVersionId);
  useEffect(() => { if (initialVideo) setVideo(current => !current || initialVideo.revision > current.revision ? initialVideo : current); }, [initialVideo]);
  useEffect(() => { if (requestedPreviewId) setPreviewId(requestedPreviewId); }, [requestedPreviewId]);
  const pending = useRef(false), end = useRef<HTMLDivElement>(null);
  const effectiveSource = video?.source ?? source;
  const generating = video?.generation?.status === 'running';
  const working = busy || generating || comparisonWorking;
  const engine = video ? videoEngine(video.plan) : newEngine;
  const engineCapability = capability?.engines?.[engine];
  const canGenerate = capability?.generationAllowed && engineCapability?.available !== false;
  const missingComparisonEngines = VIDEO_ENGINES.filter(value => capability?.engines?.[value]?.available === false);
  const canCompare = capability?.aiAllowed && capability.generationAllowed && missingComparisonEngines.length === 0;
  const awaitingReply = video?.discussion.at(-1)?.role === 'user';
  const hasContent = video?.plan.scenes.every(scene => scene.visual.trim() || scene.narration.trim());
  const preview = video?.versions?.find(v => v.id === previewId) ?? video?.versions?.find(v => v.id === video.currentVersionId);
  useEffect(() => {
    let alive = true;
    setCapabilityError('');
    void api.capability().then(value => { if (alive) setCapability(value); }).catch(() => { if (alive) setCapabilityError('Could not connect. Try again.'); });
    return () => { alive = false; };
  }, [api, retry]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [video?.discussion.length, busy]);
  function saved(next: ConceptVideo) { setVideo(next); onChanged?.(next); }
  useEffect(() => {
    if (!video || !generating) return;
    let alive = true, fetching = false;
    const timer = setInterval(() => {
      if (fetching) return; fetching = true;
      void api.get(video.id).then(next => {
        if (!alive) return;
        saved(next);
        if (next.generation?.status === 'completed') setPreviewId(next.versions.at(-1)?.id);
      }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not update video status'); }).finally(() => { fetching = false; });
    }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [api, video?.id, generating]);
  async function discuss(retryReply = false) {
    if (pending.current || generating || !effectiveSource || !capability?.aiAllowed || (!retryReply && !question.trim())) return;
    pending.current = true; setBusy(true); setError('');
    try {
      let current = video;
      if (!retryReply) {
        current = current
          ? await api.append({ id: current.id, baseRevision: current.revision, question: question.trim() })
          : await api.create({ source: effectiveSource, question: question.trim(), ...(newEngine === 'canvas' ? {} : { engine: newEngine }) });
        saved(current); setQuestion('');
      }
      if (current) saved(await api.requestAi({ id: current.id, baseRevision: current.revision, operation: 'discuss' }));
    } catch (e) { setError(e instanceof Error ? e.message : 'AI could not reply. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function generate() {
    if (!video || pending.current || generating || !hasContent || !canGenerate) return;
    pending.current = true; setBusy(true); setPreparing(true); setError('');
    try {
      // Older manual drafts may request a voice unavailable on this computer.
      const current = video.plan.narration && capability.narrationAllowed === false
        ? await api.save({ id: video.id, baseRevision: video.revision, plan: { ...video.plan, narration: false } }) : video;
      saved(current);
      const next = await api.generate({ id: current.id, baseRevision: current.revision }); saved(next);
      if (next.generation?.status === 'completed') setPreviewId(next.versions.at(-1)?.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Generation failed. Your work is saved.'); }
    finally { pending.current = false; setBusy(false); setPreparing(false); }
  }
  async function compare() {
    if (!video || pending.current || generating || !hasContent || awaitingReply || question.trim() || !canCompare) return;
    pending.current = true; setBusy(true); setPreparing(true); setError('');
    try { saved(await api.compare({ id: video.id, baseRevision: video.revision })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start engine comparison.'); }
    finally { pending.current = false; setBusy(false); setPreparing(false); }
  }
  async function action(run: () => Promise<ConceptVideo>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { saved(await run()); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function selectEngine(next: VideoEngine | 'all') {
    if (working || pending.current) return;
    setCompareAll(next === 'all');
    if (next === 'all') return;
    if (!video) { setNewEngine(next); return; }
    if (next === engine) return;
    const { program: _program, ...plan } = video.plan;
    void action(() => api.save({ id: video.id, baseRevision: video.revision, plan: {
      ...plan, engine: next, animation: 'flow', scenes: plan.scenes.map(({ code: _code, ...scene }) => scene)
    } }));
  }
  return <section className="concept-video-editor concept-video-simple" aria-label="AI Video">
    <header className="concept-video-editor-heading">
      <nav className="concept-video-editor-nav" aria-label="Video discussion navigation"><button className="video-quiet" type="button" aria-label="Back to reading chat" onClick={onBack}>← Reading chat</button><h2>AI Video</h2><button className="video-quiet" type="button" aria-label="Open Video Library" onClick={onOpenLibrary}>Video Library ↗</button></nav>
    </header>
    <div className="concept-video-conversation">
    {effectiveSource ? <details className="concept-video-source"><summary>Source: {effectiveSource.bookTitle} / {effectiveSource.chapterTitle}</summary><pre>{effectiveSource.readingSegment}</pre>{effectiveSource.images.map((image, i) => <img key={i} src={image.dataUrl} alt={`Source image ${i + 1}`} />)}{!sourceAvailable ? <p>The source is unavailable; its saved snapshot is still here.</p> : null}</details> : <p className="concept-video-muted">Mark a reading range first</p>}
    {!video ? <div className="concept-video-welcome chat-empty"><span aria-hidden="true">✦</span><strong>Bring this idea to life</strong><p>Tell AI what you want to understand,<br />and turn this passage into a short video.</p></div> : null}
    <div className="concept-video-discussion" role="log" aria-label="Video discussion" aria-live="polite">
      {video?.discussion.map(message => <div className={`concept-video-message message ${message.role}`} key={message.id}>{message.role === 'assistant' ? <small>✦ AI Tutor</small> : null}<p>{message.text}</p></div>)}
      {busy && !generating ? <div className="responding" role="status"><span /><strong>{preparing ? 'Codex is designing the animation…' : 'Thinking about your video…'}</strong></div> : null}
    </div>
    {preview && video ? <section className="concept-video-preview" aria-label="Saved video"><div className="concept-video-result-heading"><span>✦ Your video is ready</span><small>Saved to Video Library</small></div><ConceptVideoPlayer api={api} videoId={video.id} version={preview} />
      {video.versions.length > 1 ? <details><summary>Other versions</summary><select aria-label="Preview video version" value={preview.id} onChange={e => setPreviewId(e.target.value)}>{video.versions.map((version, i) => <option key={version.id} value={version.id}>v{i + 1} · {VIDEO_ENGINE_LABELS[videoEngine(version.plan)]}{version.id === video.currentVersionId ? ' · Current' : ''}</option>)}</select></details> : null}
      {preview.id !== video.currentVersionId ? <button type="button" disabled={working} onClick={() => void action(() => api.adopt({ id: video.id, baseRevision: video.revision, versionId: preview.id }))}>Use this version</button> : null}
    </section> : null}
    {video?.comparison ? <ConceptVideoComparison api={api} video={video} canRetry={Boolean(capability?.aiAllowed && capability.generationAllowed && !busy)} onChanged={onChanged} onWorkingChange={setComparisonWorking} /> : null}
    {video?.generation && video.generation.status !== 'completed' ? <div className="concept-video-job" data-state={video.generation.status}>
      <div className="concept-video-job-status" role={video.generation.status === 'failed' ? 'alert' : 'status'}>
        <span className="concept-video-job-icon" aria-hidden="true">{generating
          ? <svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="3" /><path d="m10 9 5 3-5 3Z" /></svg>
          : video.generation.status === 'failed' ? '!' : '−'}</span>
        <div className="concept-video-job-copy">
          <strong>{generating ? 'Creating your video' : video.generation.status === 'failed' ? 'Generation failed' : video.generation.status === 'cancelled' ? 'Generation cancelled' : 'Generation interrupted'}</strong>
          <p>{legacyGenerationStages[video.generation.stage] ?? video.generation.stage}</p>
          {video.generation.error ? <p className="concept-video-job-error">{video.generation.error}</p> : null}
        </div>
      </div>
      {generating ? <button className="concept-video-job-cancel" type="button" disabled={busy} onClick={() => void action(() => api.cancel(video.id))}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" /></svg>Cancel generation</button> : null}
    </div> : null}
    {error ? <div role="alert"><p>{error}</p>{video ? <button type="button" disabled={working} onClick={() => void action(() => api.get(video.id))}>Reload</button> : null}</div> : null}
    {awaitingReply && !working && capability?.aiAllowed ? <button type="button" onClick={() => void discuss(true)}>{error ? 'Retry AI reply' : 'Ask AI to describe the video'}</button> : null}
    <div ref={end} />
    </div>
    <form className="concept-video-composer chat-form" onSubmit={e => { e.preventDefault(); void discuss(); }}>
      <div className="chat-composer-card">
        <textarea aria-label="Describe your video idea" maxLength={5000} placeholder={video ? 'What would you like to change? Keep discussing with AI…' : 'Describe the idea you want to understand…'} value={question} disabled={working} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void discuss(); } }} />
        <div className="chat-composer-actions">
          <select className="concept-video-engine" aria-label="Animation engine" title={compareAll ? 'Generate Canvas, Remotion and Manim from this idea, one after another.' : `Animation engine · ${VIDEO_ENGINE_LABELS[engine]}: ${VIDEO_ENGINE_DESCRIPTIONS[engine]}`} value={compareAll ? 'all' : engine} disabled={working} onChange={e => selectEngine(e.target.value as VideoEngine | 'all')}>
            {VIDEO_ENGINES.map(value => <option key={value} value={value} title={VIDEO_ENGINE_DESCRIPTIONS[value]}>✧ {VIDEO_ENGINE_LABELS[value]}</option>)}
            <option value="all">general all (test)</option>
          </select>
          <div className="concept-video-composer-buttons">
          {hasContent && !awaitingReply ? <button className="concept-video-generate" type="button" disabled={working || !(compareAll ? canCompare : canGenerate) || Boolean(question.trim())} onClick={() => void (compareAll ? compare() : generate())}><span aria-hidden="true">▷</span> Generate video</button> : null}
          <button className="chat-send-button" type="submit" aria-label="Send" title="Send" disabled={working || !effectiveSource || !question.trim() || !capability?.aiAllowed}><span aria-hidden="true">↑</span></button>
          </div>
        </div>
      </div>
      <div className="chat-composer-hint">Enter to send · Shift+Enter for a new line{video ? ' · Discussion saved' : ''}</div>
    {compareAll ? <>
      {!hasContent || awaitingReply ? <p role="status">Discuss your idea with AI first. This test becomes available after AI describes the video.</p> : null}
      {missingComparisonEngines.map(value => <p role="status" key={value}>{VIDEO_ENGINE_LABELS[value]}: {capability?.engines?.[value]?.reason}</p>)}
    </> : null}
    {capabilityError || capability && !capability.aiAllowed ? <p role="status">{capabilityError || 'AI discussion is unavailable. Restart the app.'}<button type="button" onClick={() => setRetry(n => n + 1)}>Check again</button></p> : null}
    {capability && (!capability.generationAllowed || !compareAll && engineCapability?.available === false) ? <p className="concept-video-muted">{(!compareAll && engineCapability?.reason) || capability.reason}<button type="button" onClick={() => setRetry(n => n + 1)}>Check generation again</button></p> : null}
    </form>
  </section>;
}
