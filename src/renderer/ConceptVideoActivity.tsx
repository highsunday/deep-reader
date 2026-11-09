import { GenerationActivitySummary } from './GenerationActivitySummary';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ConceptVideo, ConceptVideoApi } from '../shared/concept-video';

export function videoJobLabel(video: ConceptVideo): string {
  const job = video.generation;
  if (!job) return video.status === 'completed' ? 'Ready to watch' : 'Draft';
  if (job.status === 'running') return job.stage;
  if (job.status === 'completed') return 'Video ready';
  if (job.status === 'failed') return video.versions.length ? 'New version failed' : 'Generation failed';
  return job.status === 'cancelled' ? 'Generation cancelled' : 'Generation interrupted';
}
const jobKey = (video: ConceptVideo) => `${video.id}:${video.generation?.id}`;

/** App-owned observer: navigation does not unmount it. Revision guards cover late list responses. */
export function useConceptVideoActivity(baseApi: ConceptVideoApi | undefined) {
  const latest = useRef(new Map<string, ConceptVideo>());
  const tracked = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const [videos, setVideos] = useState<ConceptVideo[]>();
  const [notices, setNotices] = useState<ConceptVideo[]>([]);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const receive = useCallback((incoming: ConceptVideo[]) => {
    let changed = false;
    for (let video of incoming) {
      const old = latest.current.get(video.id);
      if (old && (old.revision > video.revision || old.revision === video.revision && old.generation?.id === video.generation?.id && old.generation?.status !== 'running')) {
        if (old.generation?.id !== video.generation?.id) continue;
        video = old;
      }
      const terminalOverlay = old?.revision === video.revision && old.generation?.id === video.generation?.id && old.generation?.status === 'running' && video.generation?.status !== 'running';
      if (!old || old.revision < video.revision || terminalOverlay) { latest.current.set(video.id, video); changed = true; }
      const job = video.generation, key = jobKey(video);
      if (job?.status === 'running') {
        if (tracked.current.has(key)) continue;
        tracked.current.add(key);
        setNotices(items => items.filter(item => item.id !== video.id));
      } else if (job && tracked.current.has(key) && !seen.current.has(key)) {
        seen.current.add(key); tracked.current.delete(key);
        setNotices(items => [...items.filter(item => item.id !== video.id), video]);
      }
    }
    if (changed) setVideos([...latest.current.values()]);
  }, []);
  useEffect(() => {
    if (!baseApi) return;
    let alive = true, fetching = false;
    let token: string | undefined;
    const refresh = async () => {
      if (fetching) return; fetching = true;
      const before = new Map([...latest.current].map(([id, video]) => [id, video.revision]));
      try {
        const snapshot = baseApi.poll ? await baseApi.poll(token) : undefined;
        if (!alive) return;
        if (snapshot && snapshot.videos === undefined) { token = snapshot.token; setError(''); return; }
        const result = snapshot ? snapshot.videos : await baseApi.list();
        if (!alive || !Array.isArray(result)) return;
        token = snapshot?.token;
        receive(result);
        const ids = new Set(result.map(v => v.id));
        let removed = false;
        for (const [id, video] of latest.current) if (!ids.has(id) && video.revision === before.get(id)) { latest.current.delete(id); removed = true; }
        if (removed || !latest.current.size) setVideos([...latest.current.values()]);
        setError('');
      } catch { if (alive) setError('Could not update video activity. Retrying…'); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [baseApi, receive, refreshKey]);
  const api = useMemo(() => baseApi ? { ...baseApi,
    generate: async (input: Parameters<ConceptVideoApi['generate']>[0]) => {
      const video = await baseApi.generate(input);
      // Mark before merging: a very short job may already have reached a terminal state.
      if (video.generation) tracked.current.add(jobKey(video));
      receive([video]); return video;
    }
  } : undefined, [baseApi, receive]);
  return { api, videos, notices, error, receive, refresh: () => setRefreshKey(key => key + 1), dismiss: (key?: string) => setNotices(items => key ? items.filter(item => jobKey(item) !== key) : []) };
}

function VideoResultThumbnail({ video, api }: { video: ConceptVideo; api?: ConceptVideoApi }) {
  const versionId = video.versions.at(-1)?.id;
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    if (!versionId || !api?.poster) return;
    let alive = true, objectUrl = '';
    void api.poster({ id: video.id, versionId }).then(bytes => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, video.id, versionId]);
  return <span className="memory-image-results-icon" aria-hidden="true">{url
    ? <img src={url} alt="" onError={() => setUrl('')} />
    : <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="3" /><path d="m8 7 5 3-5 3Z" /></svg>}</span>;
}

export function ConceptVideoActivity({ activity, onOpen }: {
  activity: ReturnType<typeof useConceptVideoActivity>; onOpen(video: ConceptVideo): void;
}) {
  const [expanded, setExpanded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const opening = useRef(false), request = useRef(0);
  const panelId = useId();
  const active = (activity.videos ?? []).filter(v => v.generation?.status === 'running');
  const results = activity.notices.filter(v => !active.some(a => a.id === v.id));
  const completed = results.filter(v => v.generation?.status === 'completed').length;
  const attention = results.length - completed;
  useEffect(() => {
    if (!expanded) return;
    root.current?.querySelector<HTMLButtonElement>('.memory-image-results-view')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  useEffect(() => () => { request.current += 1; }, []);
  function dismiss(key?: string) {
    if (!key && active.length) return;
    request.current += 1; opening.current = false; setLoading(false); setError('');
    activity.dismiss(key);
    if (!key) setExpanded(false);
    trigger.current?.focus();
  }
  async function open(video: ConceptVideo) {
    if (!activity.api || opening.current) return;
    const ticket = ++request.current;
    opening.current = true; setLoading(true); setError('');
    try {
      const fresh = await activity.api.get(video.id);
      if (ticket !== request.current) return;
      onOpen(fresh); setExpanded(false);
      setViewed(keys => new Set([...keys, jobKey(video)]));
    } catch { if (ticket === request.current) setError('This video could not be opened. It may have been removed.'); }
    finally { if (ticket === request.current) { opening.current = false; setLoading(false); } }
  }
  if (!active.length && !results.length) return null;
  return <aside ref={root} className="memory-image-generation-progress video-generation-activity" aria-label="Video activity"
    onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
    {expanded ? <section id={panelId} className="memory-image-results" aria-label="Video results">
      <div className="memory-image-results-heading"><span>Video results</span><span className="memory-image-results-count">{results.length}</span></div>
      {active.length ? <ul className="video-activity-jobs" aria-label="Generating videos">{active.map(video => <li key={jobKey(video)} className="video-activity-job">
        <span className="video-activity-job-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="3" /><path d="m8 7 5 3-5 3Z" /></svg></span>
        <div className="video-activity-job-copy"><strong title={video.plan.title}>{video.plan.title.replace(/^(.*) · (Canvas|Remotion|Manim) test$/, '$2 · $1')}</strong><p role="status">{videoJobLabel(video)}</p></div>
      </li>)}</ul> : null}
      {results.length ? <div className="memory-image-results-list">{results.map(video => <div className="memory-image-results-row" key={jobKey(video)}>
        <button className="memory-image-results-view" type="button" aria-label={`Open video: ${video.plan.title}`} disabled={loading || !activity.api} onClick={() => void open(video)}>
          <VideoResultThumbnail video={video} api={activity.api} />
          <span className="memory-image-results-copy"><strong>{video.plan.title}</strong><small>{videoJobLabel(video)}<span className="memory-image-results-viewed">{viewed.has(jobKey(video)) ? ' · Viewed' : ' · Open in sidebar'}</span></small>{video.generation?.error ? <small className="video-activity-error">{video.generation.error}</small> : null}</span>
        </button>
        <button type="button" aria-label={`Dismiss ${video.plan.title} notification`} onClick={() => dismiss(jobKey(video))}>×</button>
      </div>)}</div> : !active.length ? <p className="memory-image-results-empty">Videos will appear here when ready.</p> : null}
    </section> : null}
    {error || activity.error ? <p role="alert" className="memory-image-activity-error">{error || activity.error}</p> : null}
    <GenerationActivitySummary kind="video" active={active.length} completed={completed} attention={attention}
      expanded={expanded} panelId={panelId} trigger={trigger} onToggle={() => setExpanded(value => !value)} onDismiss={() => dismiss()} />
    <span className="visually-hidden" role="status">{active.length} videos generating, {completed} completed, {attention} need attention.</span>
    {active.length ? <progress aria-label="Video generation in progress" /> : null}
  </aside>;
}
