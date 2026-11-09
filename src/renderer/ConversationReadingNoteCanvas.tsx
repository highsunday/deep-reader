import { useEffect, useState } from "react";
import type { PreparedConversationReadingNote, ReaderDesktopApi, ReadingNote } from "../shared/contracts";
import { ReadingNoteEditorDialog } from "./ReadingNoteEditorDialog";

/** Preparation stages selected source images; it never creates a formal note. */
export function ConversationReadingNoteCanvas({ draftId, api, chat, onClose, onSaved }: {
  draftId: string;
  api: ReaderDesktopApi["readingNotes"];
  chat: ReaderDesktopApi["chat"];
  onClose(): void;
  onSaved?(note: ReadingNote): void;
}) {
  const [prepared, setPrepared] = useState<PreparedConversationReadingNote>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void chat.prepareReadingNoteDraft(draftId).then(value => {
      if (active) setPrepared(value);
      else void api.attachments.discardStaged(value.stagedAttachmentIds).catch(() => undefined);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "無法開啟筆記草稿。"); });
    return () => { active = false; };
  }, [draftId, api, chat, attempt]);

  if (!prepared) return <div className="reading-note-reader-overlay">
    <section className="reading-note-editor-dialog reading-note-reader-card" role="dialog" aria-modal="true" aria-label="準備筆記畫布">
      {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(n => n + 1)}>重試</button></> : <p role="status">正在準備可編輯的筆記…</p>}
      <button onClick={onClose}>關閉</button>
    </section>
  </div>;
  return <ReadingNoteEditorDialog api={api} mode="create" source={prepared.source}
    initialDraft={{ markdown: prepared.markdown, title: prepared.title, content: prepared.content, stagedAttachmentIds: prepared.stagedAttachmentIds,
      save: input => chat.saveReadingNoteDraft({ draftId, ...input }) }}
    onClose={onClose} onSaved={note => onSaved?.(note)} />;
}
