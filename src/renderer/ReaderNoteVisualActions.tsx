import { useEffect, useRef, useState } from "react";
import type { MissingVisualOptions, ReaderDesktopApi, ReadingNote, ReadingNoteMemoryImageSnapshot } from "../shared/contracts";
import { bookMemoryImageDefaults } from "./memory-image-preferences";
import { readingNoteImage } from "../shared/reading-note-images";
import { MissingVisualSettings } from "./MissingVisualSettings";

/** The reading sidebar owns only controls; image work continues in Main. */
export function ReaderNoteVisualActions({ api, note, onSaved, onAdjust }: {
  api: ReaderDesktopApi["readingNotes"];
  note: ReadingNote;
  onSaved(note: ReadingNote): void;
  onAdjust?(): void;
}) {
  const [snapshot, setSnapshot] = useState<ReadingNoteMemoryImageSnapshot>();
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [preferenceSaveFailed, setPreferenceSaveFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const locked = useRef(false);
  const mounted = useRef(false);
  const previous = useRef<MissingVisualOptions | undefined>(undefined);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const memory = api.memoryImage;
  useEffect(() => {
    if (!memory?.generateMissing || note.trashedAt !== undefined) return;
    mounted.current = true;
    let active = true;
    let observed = false;
    setChecking(true);
    const receive = (state: ReadingNoteMemoryImageSnapshot) => {
      if (!active || state.noteId !== note.id) return;
      setSnapshot(state);
      setChecking(false);
      if (state.note) saved.current(state.note);
    };
    const unsubscribe = memory.onStateChanged(state => {
      if (state.noteId !== note.id) return;
      observed = true;
      receive(state);
    });
    void memory.getState(note.id).then(state => {
      if (!observed) receive(state);
    }).catch(cause => {
      if (active && !observed) {
        setError(cause instanceof Error ? cause.message : "Unable to check image generation.");
        setChecking(false);
      }
    });
    return () => { active = false; mounted.current = false; unsubscribe(); };
  }, [memory, note.id, note.trashedAt, retry]);

  const missing = (["understand", "recall"] as const).filter(side => !readingNoteImage(note, side));
  const active = pending || snapshot?.phase === "generating" || snapshot?.phase === "preparing" || snapshot?.batch?.phase === "running";
  const failed = Boolean(error) || snapshot?.phase === "error";
  const unavailable = snapshot?.phase === "unavailable";

  async function generate(options?: MissingVisualOptions) {
    if (!memory?.generateMissing || locked.current || active || checking) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      if (!options) {
        const templates = await memory.templates.get();
        options = {};
        for (const side of missing) {
          const defaults = bookMemoryImageDefaults(templates, side, note.bookTitle);
          const purpose = templates.purposes.find(item => item.id === defaults.purposeId);
          const style = templates.styles.find(item => item.id === defaults.styleId);
          if (!purpose || !style) throw new Error("Choose an image type and style in Image settings.");
          options[side] = { purpose: { id: purpose.id, name: purpose.name, prompt: purpose.prompt },
            style: { id: style.id, name: style.name, prompt: style.prompt } };
        }
      }
      previous.current = options;
      // Leaving the preview before settings load should not start a new job.
      if (!mounted.current) return;
      const state = await memory.generateMissing(note.id, options);
      if (mounted.current) {
        setSnapshot(state);
        if (state.note) saved.current(state.note);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to generate visuals.");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function stop() {
    try {
      const state = await memory!.stop(note.id);
      if (mounted.current) setSnapshot(state);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to stop generation.");
    }
  }

  if (!memory?.generateMissing || note.trashedAt !== undefined) return null;
  const message = error || (failed || unavailable ? snapshot?.status : undefined);
  const generateLabel = checking ? "Checking image generation…" : failed ? "Retry missing visuals"
    : missing.length === 2 ? "Generate both visuals" : `Generate ${missing[0] === "understand" ? "front" : "back"} visual`;
  return <section className="reader-note-visual-actions" aria-label="Note visuals">
    <div className="reader-note-visual-buttons">
      {active ? <>
        <span className="reader-note-visual-progress" role="status" title="Creating visuals. You can keep reading; images are saved as they finish.">
          {snapshot?.batch ? `${snapshot.batch.completed.length}/${snapshot.batch.sides.length}` : "Creating…"}
          {snapshot?.batch ? <progress aria-label="Note visuals completed" max={snapshot.batch.sides.length} value={snapshot.batch.completed.length} /> : null}
        </span>
        <button type="button" aria-label="Stop generation" title="Stop generation"
          disabled={pending && snapshot?.batch?.phase !== "running" && snapshot?.phase !== "generating" && snapshot?.phase !== "preparing"}
          onClick={() => void stop()}>Stop</button>
      </> : unavailable || (!snapshot && error) ? <button type="button" disabled={checking} onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry connection</button>
        : missing.length ? <button type="button" className="reader-note-generate-visuals" disabled={checking}
          aria-label={generateLabel} title={`${generateLabel} · Uses your saved image settings`}
          onClick={() => void generate(failed ? previous.current : undefined)}>
          <span aria-hidden="true">✦</span> {checking ? "Checking…" : failed ? "Retry visuals" : missing.length === 2 ? "Generate both" : `Generate ${missing[0] === "understand" ? "front" : "back"}`}
        </button> : <>
          <span role="status" className="visually-hidden">Both visuals ready</span>
          {onAdjust ? <button type="button" className="reader-note-visual-ready" aria-label="Adjust visuals"
            title="Both visuals ready · Adjust front or back image" onClick={onAdjust}>
            <span aria-hidden="true">✓</span> Visuals
          </button> : <span className="reader-note-visual-ready" title="Both visuals ready">✓ Visuals</span>}
        </>}
      {!active && missing.length ? <button type="button" className="reader-note-visual-settings" aria-label="Image settings" title="Image settings"
        disabled={checking || unavailable} onClick={() => setSettingsOpen(true)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /><path d="M7 3v4M13 8v4M8 13v4" /></svg>
      </button> : null}
    </div>
    {message ? <p role="alert">{message}</p> : null}
    {preferenceSaveFailed ? <p role="status">These choices apply now, but could not be remembered for this book.</p> : null}
    {settingsOpen ? <MissingVisualSettings api={api} note={note} previous={previous.current}
      onCancel={() => setSettingsOpen(false)} onGenerate={(options, saveFailed) => {
        setPreferenceSaveFailed(Boolean(saveFailed)); setSettingsOpen(false); void generate(options);
      }} /> : null}
  </section>;
}
