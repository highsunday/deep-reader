import type { MemoryImageSide, ReaderDesktopApi, ReadingNote, ReadingNoteMemoryImageSnapshot } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";

export function ReadingNoteVisualTools({ note, side, api, status, pending, readOnly, controlsOpen, onQuick, onToggleEditor }: {
  note: ReadingNote;
  side: MemoryImageSide;
  api: ReaderDesktopApi["readingNotes"];
  status?: ReadingNoteMemoryImageSnapshot;
  pending: boolean;
  readOnly: boolean;
  controlsOpen: boolean;
  onQuick(): void;
  onToggleEditor(): void;
}) {
  const missing = (["understand", "recall"] as const).filter(value => !readingNoteImage(note, value));
  const active = pending || status?.phase === "generating" || status?.phase === "preparing" || status?.batch?.phase === "running";
  const failed = status?.batch?.phase === "error" || status?.batch?.phase === "stopped";
  const currentImage = readingNoteImage(note, side);
  return <section className="reading-note-visual-tools" aria-label="Visual workspace">
      {!readOnly ? <div className="visual-workspace-actions">
        {api.memoryImage?.generateMissing && missing.length && !active ? <button type="button" className="visual-quick-generate" onClick={onQuick}>
          <span aria-hidden="true">✦</span> {failed ? "Retry missing visuals" : missing.length === 2 ? "Generate both visuals" : "Generate missing visual"}
        </button> : null}
        {active && !controlsOpen ? <button type="button" className="visual-stop" onClick={() => void api.memoryImage?.stop(note.id)}>Stop generation</button> : null}
        <button type="button" className="visual-edit-side" aria-expanded={controlsOpen}
          aria-label={controlsOpen ? "Hide image controls" : currentImage ? `Adjust ${side} image` : `Generate ${side} image`}
          onClick={onToggleEditor}>{controlsOpen ? "Done editing" : "Edit visual"}</button>
      </div> : null}
    <p className="visual-workspace-help" role={status?.phase === "error" ? "alert" : "status"}>
      {active ? "Creating your visuals. You can switch sides or close this view; generation continues."
        : status?.phase === "error" ? status.status
        : missing.length && !readOnly && api.memoryImage?.generateMissing ? "Choose the image type and style before generating missing visuals."
        : "Front explains the idea. Back helps you recall it. Click the image to flip."}
    </p>
  </section>;
}
