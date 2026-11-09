import { useEffect, useRef, useState } from "react";
import type { ReaderDesktopApi, ReadingNote } from "../shared/contracts";

export function ReaderNoteTrashDialog({ api, note, onCancel, onTrashed }: {
  api: ReaderDesktopApi["readingNotes"];
  note: ReadingNote;
  onCancel(): void;
  onTrashed(note: ReadingNote): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  async function moveToTrash() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      onTrashed(await api.trash(note.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to move this note to Trash.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // Disabled buttons can move focus to body; capture keys before the editor's
  // document listener so Escape cannot close the underlying note during trash.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        if (!submitting.current) onCancel();
        return;
      }
      const buttons = [...(backdropRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return <div ref={backdropRef} className="reading-note-discard-backdrop reader-note-trash-backdrop">
    <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reader-note-trash-title" aria-describedby="reader-note-trash-description" aria-busy={pending}>
      <span className="delete-dialog-icon" aria-hidden="true">!</span>
      <h2 id="reader-note-trash-title">Move this reading note to Trash?</h2>
      <p id="reader-note-trash-description">The note and its images stay recoverable until Trash is emptied.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="delete-dialog-actions">
        <button ref={cancelRef} type="button" disabled={pending} onClick={onCancel}>Cancel</button>
        <button className="danger-action" type="button" disabled={pending} onClick={() => void moveToTrash()}>{pending ? "Moving…" : "Move to Trash"}</button>
      </div>
    </section>
  </div>;
}
