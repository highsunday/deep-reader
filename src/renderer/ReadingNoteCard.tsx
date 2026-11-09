import { useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { ReadingNoteDraft, ReadingNoteSavedArtifact } from "./reading-note-artifact";
import { normalizeBackslashMathDelimiters } from "./markdown-math";
import type { ReadingSegmentImage } from "../shared/contracts";

type ReadingNoteSource = { bookTitle: string; chapterTitle: string };

function displayedNote(draft: ReadingNoteDraft, source: ReadingNoteSource, saved?: ReadingNoteSavedArtifact) {
  return saved ? {
    title: saved.note.prompt,
    content: saved.note.content,
    source: { bookTitle: saved.note.bookTitle, chapterTitle: saved.note.chapterTitle }
  } : { title: draft.title, content: draft.content, source };
}

function NoteBookImage({ src, alt, sourceImages }: {
  src?: string;
  alt?: string;
  sourceImages?: ReadingSegmentImage[];
}) {
  const [savedUrl, setSavedUrl] = useState<string>();
  useEffect(() => {
    if (!src?.startsWith("reading-note-asset:")) return;
    let current = true;
    void window.readerExample.readingNotes.attachments.readDataUrl(src.slice("reading-note-asset:".length))
      .then(url => { if (current) setSavedUrl(url); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [src]);
  const bookNumber = src?.match(/^book-image:([1-9]\d*)$/);
  const url = bookNumber ? sourceImages?.[Number(bookNumber[1]) - 1]?.dataUrl : savedUrl;
  return url ? <img className="reading-note-book-image" src={url} alt={alt || "原文圖片"} /> : null;
}

export function ReadingNoteAction({ draft, source, saved, onOpen }: {
  draft: ReadingNoteDraft;
  source?: ReadingNoteSource;
  saved?: ReadingNoteSavedArtifact;
  onOpen(): void;
}) {
  const noteSource = saved
    ? { bookTitle: saved.note.bookTitle, chapterTitle: saved.note.chapterTitle }
    : source;
  return (
    <button className="reading-note-action" type="button" onClick={onOpen}>
      <span className="reading-note-action-icon" aria-hidden="true">▤</span>
      <span className="reading-note-action-copy">
        <strong>{saved ? "Reading note saved" : "1 note to review"}</strong>
        <small>{saved?.note.prompt ?? draft.title}</small>
        {noteSource ? <small>{noteSource.bookTitle} · {noteSource.chapterTitle}</small> : null}
      </span>
      <span className="reading-note-action-open">
        {saved ? "View note" : "Review and save"} <span aria-hidden="true">›</span>
      </span>
    </button>
  );
}

export function ReadingNoteDialog({ draft, source, sourceImages, saved, onClose, onSubmit }: {
  draft: ReadingNoteDraft;
  source: ReadingNoteSource;
  sourceImages?: ReadingSegmentImage[];
  saved?: ReadingNoteSavedArtifact;
  onClose(): void;
  onSubmit(draftId: string): Promise<unknown> | unknown;
}) {
  const [submitting, setSubmitting] = useState(false);
  const note = displayedNote(draft, source, saved);

  async function submit(): Promise<void> {
    if (submitting || saved) return;
    setSubmitting(true);
    try {
      await onSubmit(draft.draftId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reading-note-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="reading-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`reading-note-title-${draft.draftId}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Reading note</span>
            <h2 id={`reading-note-title-${draft.draftId}`}>Review Reading Note</h2>
          </div>
          <button type="button" aria-label="Close reading note" onClick={onClose}>×</button>
        </header>
        <div className="reading-note-dialog-scroll">
          <section className="reading-note-title-summary">
            <h3>Title</h3>
            <p>{note.title}</p>
          </section>
          <section className="reading-note-content">
            <h3>Note Content</h3>
            <div className="reading-note-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, trust: false }]]}
                urlTransform={(url, key) => key === "src"
                  ? /^(?:book-image:[1-9]\d*|reading-note-asset:[A-Za-z0-9-]+)$/.test(url) ? url : ""
                  : defaultUrlTransform(url)}
                components={{ img: ({ src, alt }) =>
                  <NoteBookImage src={src} alt={alt} sourceImages={sourceImages} /> }}
              >
                {normalizeBackslashMathDelimiters(note.content)}
              </ReactMarkdown>
            </div>
          </section>
          <footer className="reading-note-source">
            <div><span>Book</span><strong>{note.source.bookTitle}</strong></div>
            <div><span>Chapter</span><strong>{note.source.chapterTitle}</strong></div>
          </footer>
        </div>
        <footer className="reading-note-dialog-actions">
          {saved ? (
            <p className="reading-note-saved-status">Saved to the Reading Notes Library</p>
          ) : (
            <button
              className="reading-note-submit"
              type="button"
              aria-label="Save reading note"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? "Saving…" : "Save Reading Note"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

export function ReadingNoteCard({ open, draft, source, sourceImages, saved, onOpen, onClose, onSubmit }: {
  open: boolean;
  draft: ReadingNoteDraft;
  source: ReadingNoteSource;
  sourceImages?: ReadingSegmentImage[];
  saved?: ReadingNoteSavedArtifact;
  onOpen(): void;
  onClose(): void;
  onSubmit(draftId: string): Promise<unknown> | unknown;
}) {
  return (
    <section className={`reading-note-card${open ? " open" : ""}`}>
      <span className="reading-note-legacy-label">
        {saved ? "Reading note · Saved" : "Reading note draft · Review required"}
      </span>
      <ReadingNoteAction draft={draft} source={source} saved={saved} onOpen={onOpen} />
      {open ? (
        <ReadingNoteDialog draft={draft} source={source} sourceImages={sourceImages} saved={saved} onClose={onClose} onSubmit={onSubmit} />
      ) : null}
    </section>
  );
}
