import type { RefObject } from 'react';

/** Shared compact disclosure and dismissal controls for image, video and upload jobs. */
export function GenerationActivitySummary({ kind, active, completed, attention, expanded, panelId, trigger, onToggle, onDismiss, secondary, uploadDestination = "Card pool", allowDismissWhileActive = false }: {
  kind: 'image' | 'video' | 'upload'; secondary?: string; uploadDestination?: 'Card pool' | 'Heptabase'; allowDismissWhileActive?: boolean; active: number; completed: number; attention: number;
  expanded: boolean; panelId: string; trigger: RefObject<HTMLButtonElement | null>;
  onToggle(): void; onDismiss(): void;
}) {
  const activity = kind === 'upload' && uploadDestination === 'Heptabase' ? 'Heptabase import' : kind;
  const importing = kind === 'upload' && uploadDestination === 'Heptabase';
  return <div className="memory-image-activity-row">
    <button ref={trigger} type="button" className="memory-image-activity-toggle"
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${activity} activity`} aria-expanded={expanded}
      aria-controls={expanded ? panelId : undefined} onClick={onToggle}>
      {active ? <span className="memory-image-activity-generating" aria-label={`${active} active`}>
        <span aria-hidden="true" className="memory-image-activity-spinner" />{active} {kind === 'upload' ? (importing ? 'importing' : 'uploading') : 'generating'}
      </span> : <span aria-hidden="true">{attention ? '!' : '✓'}</span>}
      <span className="memory-image-activity-completed">{kind === 'upload' ? `${uploadDestination} · ` : ''}{completed}{kind === 'video' ? ' videos' : ''} {kind === 'upload' ? (importing ? 'imported' : 'saved') : 'completed'}</span>
      {secondary ? <span>{secondary}</span> : null}
      {attention ? <span>{attention} need attention</span> : null}
      <svg className="memory-image-activity-chevron" aria-hidden="true" viewBox="0 0 16 16" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}><path d="m4 10 4-4 4 4" /></svg>
    </button>
    <button type="button" className="memory-image-activity-dismiss" aria-label={`Dismiss ${activity} notifications`}
      disabled={active > 0 && !allowDismissWhileActive} title={active && allowDismissWhileActive ? "Hide notification; work continues in the background" : active ? `Wait for ${kind === 'upload' ? 'upload' : `${kind} generation`} to finish before dismissing` : `Dismiss ${activity} notifications`} onClick={onDismiss}>×</button>
  </div>;
}
