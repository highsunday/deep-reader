import { useEffect, useRef, useState } from "react";

/** Shared full-image view; the surrounding note owns its face and edit state. */
export function ReadingNoteImage({ src, alt, onFlip, flipLabel }: {
  src: string;
  alt: string;
  onFlip?: () => void;
  flipLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (expanded) dialog.current?.showModal?.(); }, [expanded]);
  useEffect(() => { setExpanded(false); }, [src]);
  return <>
    <button type="button" className={`reading-note-image-expand${onFlip ? " reading-note-image-flip" : ""}`}
      aria-label={onFlip ? flipLabel ?? "Flip reading note" : `Enlarge ${alt}`}
      onClick={() => { if (onFlip) onFlip(); else setExpanded(true); }}>
      <img src={src} alt={alt} />
    </button>
    {expanded ? <dialog ref={dialog} open={typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal}
      className="reading-note-image-lightbox" aria-label="Enlarged image"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setExpanded(false); } }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); setExpanded(false); }}>
      <button className="reading-note-image-lightbox-close" type="button" autoFocus aria-label="Close image" onClick={() => setExpanded(false)}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></svg>
      </button>
      <img src={src} alt={alt} />
    </dialog> : null}
  </>;
}
