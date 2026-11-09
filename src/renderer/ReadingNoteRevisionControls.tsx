export type RevisionMode = 'changes' | 'before' | 'after';
export function ReadingNoteRevisionModes({ value, onChange }: { value: RevisionMode; onChange(value: RevisionMode): void }) {
  return <div className="revision-modes" role="group" aria-label="預覽模式">
    {([['changes', '追蹤修訂'], ['before', '修改前'], ['after', '修改後']] as const).map(([mode, label]) =>
      <button key={mode} type="button" aria-pressed={value === mode} onClick={() => onChange(mode)}>{label}</button>)}
  </div>;
}
export function ReadingNoteRevisionLegend() {
  return <div className="revision-legend" aria-label="修訂標記說明"><ins title="新增文字以底線標示">新增</ins><del title="刪除文字以刪除線標示">刪除</del></div>;
}
