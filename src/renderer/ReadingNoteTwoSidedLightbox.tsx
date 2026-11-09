import { useEffect, useRef, useState } from "react";
import type { MemoryImageSide, ReadingNote, ReadingNoteSummary } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";
import { ReadingNoteDefaultVisualIcon } from "./ReadingNoteDefaultVisualIcon";

export function ReadingNoteTwoSidedLightbox({
  side,
  url,
  alt,
  failed = false,
  onFlip,
  onClose
}: {
  side: MemoryImageSide;
  url?: string;
  alt: string;
  failed?: boolean;
  onFlip(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const face = side === "understand" ? "Front" : "Back";
  const purpose = side === "understand" ? "Understanding" : "Recall";
  const otherFace = side === "understand" ? "Back" : "Front";

  useEffect(() => { dialog.current?.showModal?.(); }, []);

  return (
    <dialog
      ref={dialog}
      open={typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal}
      className="reading-note-two-sided-lightbox"
      aria-label={`Enlarged image: ${alt}`}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onFlip();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="reading-note-two-sided-lightbox-surface">
        <header>
          <span className="reading-note-two-sided-lightbox-face"><strong>{face}</strong><small>{purpose}</small></span>
          <span className="reading-note-two-sided-lightbox-hint">Click image to show {otherFace.toLowerCase()}</span>
          <button className="reading-note-image-lightbox-close" type="button" autoFocus aria-label="Close image" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></svg>
          </button>
        </header>
        <button className={`reading-note-two-sided-lightbox-content${url ? "" : " is-empty"}`} type="button" aria-label={`Flip to ${otherFace.toLowerCase()} image`} onClick={onFlip}>
          {url ? (
            <img src={url} alt={`${purpose} image: ${alt}`} />
          ) : (
            <span className="reading-note-two-sided-lightbox-empty" role="status">
              <ReadingNoteDefaultVisualIcon side={side} />
              <strong>{failed ? "Image unavailable" : `No ${face.toLowerCase()} image yet`}</strong>
            </span>
          )}
        </button>
      </div>
    </dialog>
  );
}

export function ReadingNoteSingleImageLightbox({ url, alt, failed = false, onClose }: {
  url?: string;
  alt: string;
  failed?: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal?.(); }, []);

  return (
    <dialog
      ref={dialog}
      open={typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal}
      className="reading-note-two-sided-lightbox reading-note-single-image-lightbox"
      aria-label={`Enlarged image: ${alt}`}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="reading-note-two-sided-lightbox-surface">
        <header>
          <span className="reading-note-two-sided-lightbox-face"><strong>Image</strong><small>{alt}</small></span>
          <button className="reading-note-image-lightbox-close" type="button" autoFocus aria-label="Close image" onClick={onClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></svg>
          </button>
        </header>
        <div className={`reading-note-two-sided-lightbox-content${url ? "" : " is-empty"}`}>
          {url ? <img src={url} alt={alt} /> : (
            <span className="reading-note-two-sided-lightbox-empty" role="status">
              <strong>{failed ? "Image unavailable" : "Loading image…"}</strong>
            </span>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Shared note-level lightbox used anywhere a two-sided visual can be enlarged. */
export function ReadingNoteVisualLightbox({
  note,
  initialSide,
  readAttachmentDataUrl,
  onClose
}: {
  note: ReadingNote | ReadingNoteSummary;
  initialSide: MemoryImageSide;
  readAttachmentDataUrl?: (attachmentId: string) => Promise<string>;
  onClose(): void;
}) {
  const [side, setSide] = useState<MemoryImageSide>(initialSide);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const image = readingNoteImage(note, side);

  useEffect(() => {
    let current = true;
    setUrl(undefined);
    setFailed(false);
    if (image && readAttachmentDataUrl) {
      void readAttachmentDataUrl(image.attachmentId)
        .then((next) => { if (current) setUrl(next); })
        .catch(() => { if (current) setFailed(true); });
    }
    return () => { current = false; };
  }, [image?.attachmentId, readAttachmentDataUrl]);

  return <ReadingNoteTwoSidedLightbox
    side={side}
    url={url}
    failed={failed}
    alt={note.title}
    onFlip={() => setSide(current => current === "understand" ? "recall" : "understand")}
    onClose={onClose}
  />;
}
