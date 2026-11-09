import { createContext, useContext, useEffect, useState, type ComponentProps } from "react";
import { createImageBlockConfig, imageParse } from "@blocknote/core";
import { createReactBlockSpec, ImageBlock, ImageToExternalHTML } from "@blocknote/react";
import type { ReaderDesktopApi, ReadingNote } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";
import { ReadingNoteSingleImageLightbox, ReadingNoteTwoSidedLightbox } from "./ReadingNoteTwoSidedLightbox";

type Side = "understand" | "recall";
type VisualContext = {
  api: ReaderDesktopApi["readingNotes"];
  note?: ReadingNote;
  browsing: boolean;
  onEditVisual?(side: Side): void;
};

export const ReadingNoteVisualContext = createContext<VisualContext | undefined>(undefined);

/** Display-only state: flipping never changes a document block or attachment. */
export function ReadingNoteInlineVisual({ api, frontId, backId, alt, initialSide = "understand", onEditVisual }: {
  api: ReaderDesktopApi["readingNotes"];
  frontId?: string;
  backId?: string;
  alt: string;
  initialSide?: Side;
  onEditVisual?(side: Side): void;
}) {
  const [side, setSide] = useState(initialSide);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; url?: string }>();
  const [ratio, setRatio] = useState(1);
  const id = side === "understand" ? frontId : backId;
  const url = loaded?.id === id ? loaded?.url : undefined;
  const loading = Boolean(id && loaded?.id !== id);
  const next = side === "understand" ? "recall" : "understanding";
  const nextFace = side === "understand" ? "back" : "front";
  function flip() {
    setSide(current => current === "understand" ? "recall" : "understand");
  }
  useEffect(() => {
    let active = true;
    if (id) void api.attachments.readDataUrl(id)
      .then(url => { if (active) setLoaded({ id, url }); })
      .catch(() => { if (active) setLoaded({ id }); });
    return () => { active = false; };
  }, [api, id]);

  return <figure className="reading-note-inline-visual" contentEditable={false}>
    <button type="button" className="reading-note-inline-visual-image"
      style={{ aspectRatio: ratio }} aria-label="Enlarge image"
      onClick={() => setExpanded(true)}>
      {url ? <img src={url} alt={side === initialSide ? alt : `${side === "recall" ? "Recall" : "Understanding"} image`}
        onLoad={event => {
          const image = event.currentTarget;
          if (side === initialSide && image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight);
        }} /> : <span className="reading-note-inline-visual-empty" role="status">
        {loading ? "Loading image…" : id ? "Image unavailable" : `No ${side === "recall" ? "recall" : "understanding"} image yet`}
        {!loading ? <small>{id ? "Use the flip button to view the other side." : "Create it in Visual, or view the other side."}</small> : null}
      </span>}
    </button>
    <figcaption>
      <span>{side === "understand" ? "Understanding · Front" : "Recall · Back"}</span>
      <span className="reading-note-inline-visual-actions">
        {onEditVisual ? (
          <button type="button" aria-label="Edit visual" title="Edit visual" onClick={() => onEditVisual(side)}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4.75 19.25h3.5L18.5 9l-3.5-3.5L4.75 15.75v3.5Z" /><path d="m13.5 7 3.5 3.5M4.75 19.25l3.5-3.5" /></svg>
          </button>
        ) : null}
        <button type="button" aria-label="Enlarge image" title="View large image" onClick={() => setExpanded(true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.25" cy="10.25" r="5.75" /><path d="m14.5 14.5 5 5" /></svg>
        </button>
        <button type="button" aria-label={`Flip to ${next} image`} title={`Show ${nextFace}`} onClick={flip}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7.25 6.25h8.5a3 3 0 0 1 3 3v7.5" /><path d="m15.75 14 3 2.75 2.75-3" /><path d="M16.75 17.75h-8.5a3 3 0 0 1-3-3v-7.5" /><path d="m8.25 10-3-2.75L2.5 10" /></svg>
        </button>
      </span>
    </figcaption>
    {expanded ? <ReadingNoteTwoSidedLightbox side={side} url={url} alt={alt}
      failed={Boolean(id && !loading && !url)} onFlip={flip} onClose={() => setExpanded(false)} /> : null}
  </figure>;
}

function ReadingNoteInlineImage({ api, assetId, alt }: {
  api: ReaderDesktopApi["readingNotes"];
  assetId: string;
  alt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(undefined);
    setFailed(false);
    void api.attachments.readDataUrl(assetId)
      .then(next => { if (active) setUrl(next); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [api, assetId]);

  return <figure className="reading-note-inline-visual reading-note-inline-image" contentEditable={false}>
    <button type="button" className="reading-note-inline-visual-image" aria-label={`Enlarge ${alt}`} onClick={() => setExpanded(true)}>
      {url ? <img src={url} alt={alt} /> : <span className="reading-note-inline-visual-empty" role="status">{failed ? "Image unavailable" : "Loading image…"}</span>}
    </button>
    {expanded ? <ReadingNoteSingleImageLightbox url={url} alt={alt} failed={failed} onClose={() => setExpanded(false)} /> : null}
  </figure>;
}

function NoteImageBlock(props: ComponentProps<typeof ImageBlock>) {
  const context = useContext(ReadingNoteVisualContext);
  const image = props.block.props;
  if (!context?.browsing || !image.url.startsWith("reading-note-asset:") || !image.showPreview) return <ImageBlock {...props} />;
  const assetId = image.url.slice("reading-note-asset:".length);
  const frontId = readingNoteImage(context.note, "understand")?.attachmentId;
  const backId = readingNoteImage(context.note, "recall")?.attachmentId;
  const isFront = assetId === frontId;
  const isBack = assetId === backId;
  return <div className="reading-note-embedded-visual" style={{
    width: image.previewWidth || "100%", maxWidth: "100%",
    marginInlineStart: image.textAlignment === "left" ? 0 : "auto",
    marginInlineEnd: image.textAlignment === "right" ? 0 : "auto"
  }}>
    {isFront || isBack ? <ReadingNoteInlineVisual key={`${context.note?.id}:${assetId}`} api={context.api}
      frontId={frontId} backId={backId} initialSide={isBack ? "recall" : "understand"} alt={image.name || "Note illustration"}
      onEditVisual={context.onEditVisual} />
      : <ReadingNoteInlineImage api={context.api} assetId={assetId} alt={image.name || "Note illustration"} />}
    {image.caption ? <p className="bn-file-caption">{image.caption}</p> : null}
  </div>;
}

export const readingNoteImageBlock = createReactBlockSpec(createImageBlockConfig, {
  meta: { fileBlockAccept: ["image/*"] },
  render: NoteImageBlock,
  parse: imageParse(),
  toExternalHTML: ImageToExternalHTML,
  runsBefore: ["file"]
})();
