import { HeptabaseImportAction } from "./HeptabaseImport";
import { useContext } from "react";
import { ReadingNoteSourceContext } from "./reading-note-source-context";
import { resolveReadingNoteSource } from "../shared/reading-note-source";
import { ReadingNoteRevision, type RevisionProposal } from "./ReadingNoteRevision";
import { ReadingNoteReadOnlyContent } from "./ReadingNoteReadOnlyContent";
import { ReadingNoteRevisionModes, ReadingNoteRevisionLegend, type RevisionMode } from "./ReadingNoteRevisionControls";
import { readingNoteImage } from "../shared/reading-note-images";
import { ReadingNoteReviewControl } from "./ReadingNoteReviewControl";
import { ReadingNoteReviewSchedule } from "./ReadingNoteReviewSchedule";
import { ReadingNoteInlineVisual, ReadingNoteVisualContext } from "./ReadingNoteInlineVisual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { CODEX_CHAT_MODELS, availableChatModel, isCodexChatModel, type CodexModelOption } from "../shared/contracts";
import type {
  StartReadingNoteDraftInput,
  CodexChatModel,
  ReaderDesktopApi,
  ReadingNote,
  ReadingNoteAiDraft,
  ReadingNoteAiMessage
} from "../shared/contracts";
import type { ReadingNoteDocument } from "../shared/reading-note-document";
import {
  readingNoteDocumentAttachmentIds,
  readingNoteDocumentIsEmpty,
  readingNoteDocumentToMarkdown
} from "../shared/reading-note-document";
import {
  blockNoteBlocksToReadingNoteDocument,
  protectedAttachmentIdsMatch,
  readingNoteDocumentToBlockNoteBlocks
} from "./reading-note-editor-adapter";
import { normalizeBackslashMathDelimiters } from "./markdown-math";
import { parseReadingNoteMarkdownToBlocks } from "./reading-note-markdown";
import { materializedSourceImageMarkdown, validatedSourceImageReferences } from "../shared/reading-note-book-images";

import { readingNoteSchema } from "./reading-note-schema";
export { readingNoteSchema } from "./reading-note-schema";

const AI_MODEL_KEY = "deep-reader-last-note-ai-model";

function loadNoteAiModel(): CodexChatModel {
  try {
    const saved = window.localStorage.getItem(AI_MODEL_KEY);
    if (isCodexChatModel(saved)) return saved;
  } catch {
    // The selector remains usable when storage is unavailable.
  }
  return "gpt-5.6-sol";
}

const emptyDocument: ReadingNoteDocument = {
  version: 1,
  blocks: [{ id: "initial-paragraph", type: "paragraph", props: {}, content: [], children: [] }]
};

function ReadingNotePreviewImage({ src, alt, api, sourceImages }: {
  src?: string;
  alt?: string;
  api: ReaderDesktopApi["readingNotes"];
  sourceImages?: StartReadingNoteDraftInput["images"];
}) {
  const [managed, setManaged] = useState<{ src: string; url: string }>();
  useEffect(() => {
    if (!src?.startsWith("reading-note-asset:")) return;
    let current = true;
    void api.attachments.readDataUrl(src.slice("reading-note-asset:".length))
      .then(url => { if (current) setManaged({ src, url }); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [api, src]);
  const bookNumber = src?.match(/^book-image:([1-9]\d*)$/);
  const url = bookNumber ? sourceImages?.[Number(bookNumber[1]) - 1]?.dataUrl
    : managed && managed.src === src ? managed.url : undefined;
  return url
    ? <img className="reading-note-ai-source-image" src={url} alt={alt || "原文圖片"} />
    : <span className="reading-note-ai-note-preview-image">Image: {alt || "protected attachment"}</span>;
}

export const READING_NOTE_DRAFT_COMPLETION_REQUEST =
  [
    "請以我的草稿為主，結合目前閱讀區段與本次閱讀對話中已釐清的理解，整理成一份可繼續編輯的卡片筆記。保留我的核心觀點、思考方向與語氣，並聚焦於一個核心概念。",
    "撰寫時請假設讀者不熟悉這本書、相關術語與前置背景。採用類似費曼法的方式，用自己的話和簡單、具體的語言把概念說清楚，避免用另一串抽象詞解釋抽象詞。若有無法省略的術語，請在第一次出現時自然說明，但不要為此固定增加章節。",
    "請根據草稿與閱讀脈絡，自行判斷需要整理、保留或補充什麼，不預設任何必備內容類型。唯一原則是：讓一位不熟悉這個概念的人，以及隔一段時間後回看的我，都能只靠這份筆記充分理解核心概念並有效複習。",
    "請用金字塔原理自上而下組織筆記內容：先用一個短段落直接說出核心結論或定義，再用 2–4 個符合內容的 Markdown `##` 副標題，分組展開彼此不重疊的支撐觀點。副標題本身要表達該段的觀點或問題，不要使用「說明」「細節」「其他」等空泛名稱。",
    "標題會由 App 獨立顯示，因此筆記內容不要使用 `#`、`###` 或更深層標題，只使用 2–4 個 `##` 副標題，維持單一概念卡片的淺層結構。每段通常 2–4 句；三個以上的平行要點請改用條列，避免形成大段文字。這只是呈現結構，不代表套用固定內容欄位；仍應依概念需要選擇支撐面向。",
    "不要精簡到失去重要的理解線索，也不要延伸到核心概念之外。其他相關概念若值得保留，可以簡短提及，但不要在這份筆記中展開。",
    "只有在加入書中未明確提出的推論或外部知識，而且來源差異會影響理解時，才就近標示為「AI 補充」。簡化說明時仍須保持原意與準確性。"
  ].join("\n\n");
const READING_NOTE_DRAFT_COMPLETION_LABEL = "Complete from Draft";

export function BackIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m11.75 4.5-5.5 5.5 5.5 5.5M6.5 10h8" /></svg>;
}

export function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4 5.5h12M8 3h4M6 5.5l.65 10h6.7l.65-10M8.25 8v4.75M11.75 8v4.75" /></svg>;
}

export function RestoreIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5.4 7.2H2.75V4.55M3.15 7a7 7 0 1 1 .2 6.35M3.1 7l3.15-3.1" /></svg>;
}

function NoteIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4.25 3.25h8l3.5 3.5v10H4.25V3.25Z" /><path d="M12.25 3.25v3.5h3.5M7 10h6M7 13h4.5" /></svg>;
}

export function MemoryImageIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="3" y="3.5" width="14" height="13" rx="2" /><circle cx="7.25" cy="7.75" r="1.25" /><path d="m5.25 14 3.3-3.5 2.3 2.2 1.7-1.65L15 14" /></svg>;
}

function EditIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.75 3.75 3.5 3.5-8.5 8.5-4.25.75.75-4.25 8.5-8.5Z" /><path d="m10.75 5.75 3.5 3.5" /></svg>;
}

function ExportIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2.75v9.5m-3.25-3.25L10 12.25 13.25 9M4 13.5v2.75c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V13.5" /></svg>;
}

function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4.5 10.25 3.75 3.75L15.5 6.75" /></svg>;
}

function SparkleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2.75c.35 3.85 2.4 5.9 6.25 6.25-3.85.35-5.9 2.4-6.25 6.25C9.65 11.4 7.6 9.35 3.75 9 7.6 8.65 9.65 6.6 10 2.75Z" /><path d="M15.5 13.5c.12 1.35.85 2.08 2.2 2.2-1.35.12-2.08.85-2.2 2.2-.12-1.35-.85-2.08-2.2-2.2 1.35-.12 2.08-.85 2.2-2.2Z" /></svg>;
}

export function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8" /></svg>;
}

function singleLineTitle(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function readingNoteDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function ReadingNoteMetadata({ note, onSource, busy }: { note: ReadingNote; onSource(): void; busy: boolean }) {
  const navigation = useContext(ReadingNoteSourceContext);
  const resolved = resolveReadingNoteSource(note, navigation?.books ?? []);
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="reading-note-metadata" aria-label="Reading note metadata">
      <div className="reading-note-source-entry">
        <button type="button" className="reading-note-source-link" disabled={busy || !navigation || !resolved.target}
          aria-label="開啟原文章節" title={resolved.reason ?? "開啟原文章節"} onClick={onSource}>
          <span>{note.bookTitle}</span><strong>{note.chapterTitle}</strong>
        </button>
        {navigation && resolved.reason ? <small>{resolved.reason}</small> : null}
      </div>
      <div className="reading-note-metadata-summary">
        <small>Updated <time dateTime={new Date(note.updatedAt).toISOString()}>{readingNoteDate(note.updatedAt)}</time></small>
        <button
          type="button"
          aria-label="Reading note details"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >{expanded ? "Hide details" : "Details"}</button>
      </div>
      {expanded ? (
        <div className="reading-note-metadata-details">
          <dl>
            <div><dt>Book</dt><dd>{note.bookTitle}</dd></div>
            <div><dt>Chapter</dt><dd>{note.chapterTitle}</dd></div>
            <div><dt>Created</dt><dd><time dateTime={new Date(note.createdAt).toISOString()}>{readingNoteDate(note.createdAt)}</time></dd></div>
            <div><dt>Last updated</dt><dd><time dateTime={new Date(note.updatedAt).toISOString()}>{readingNoteDate(note.updatedAt)}</time></dd></div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

export function ReadingNoteFaceSwitch({
  face,
  onSelect
}: {
  face: "front" | "back";
  onSelect(face: "front" | "back"): void;
}) {
  const oppositeFace = face === "front" ? "back" : "front";

  return (
    <div className="reading-note-face-switch" role="group" aria-label="Reading note sides">
      <button
        type="button"
        className="reading-note-face-switch-trigger"
        aria-label={face === "front" ? "View memory image" : "View note content"}
        onClick={() => onSelect(oppositeFace)}
      >
        <span className={face === "front" ? "active" : ""} aria-hidden="true">
          <NoteIcon /><span>Note</span>
        </span>
        <span className={face === "back" ? "active" : ""} aria-hidden="true">
          <MemoryImageIcon /><span>Visual</span>
        </span>
      </button>
    </div>
  );
}

export interface InitialReadingNoteDraft {
  markdown?: string;
  title: string;
  content: ReadingNoteDocument;
  stagedAttachmentIds?: string[];
  save(input: { title: string; content: ReadingNoteDocument }): Promise<ReadingNote>;
}

export function ReadingNoteCanvas({
  api,
  note,
  source,
  initialDraft,
  persistence = "autosave",
  readOnly = false,
  browseMode = false,
  onBack,
  onFlip,
  onEdit,
  onDone,
  onSaved,
  onDirtyChange,
  onBusyChange,
  onAiPendingChange,
  onAiSessionChange,
  onDelete,
  onRestore
}: {
  api: ReaderDesktopApi["readingNotes"];
  note?: ReadingNote;
  source?: Omit<StartReadingNoteDraftInput, "userDraft">;
  initialDraft?: InitialReadingNoteDraft;
  persistence?: "autosave" | "explicit";
  readOnly?: boolean;
  browseMode?: boolean;
  onBack(): void;
  onFlip?(side?: "understand" | "recall"): void;
  onEdit?(): void;
  onDone?(): void;
  onSaved?(note: ReadingNote): void;
  onDirtyChange?(dirty: boolean): void;
  onBusyChange?(busy: boolean): void;
  onAiPendingChange?(pending: boolean): void;
  onAiSessionChange?(sessionId: string | undefined): void;
  onDelete?(): void;
  onRestore?(): void;
}) {
  const sourceNavigation = useContext(ReadingNoteSourceContext);
  const [sourceOpening, setSourceOpening] = useState(false);
  const sourceOpeningRef = useRef(false);
  const effectiveReadOnly = readOnly || browseMode;
  const explicitDraft = persistence === "explicit" && !note;
  const initialDocument = note?.content ?? initialDraft?.content ?? emptyDocument;
  const [title, setTitle] = useState(note?.title ?? initialDraft?.title ?? "");
  const [document, setDocument] = useState<ReadingNoteDocument>(initialDocument);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");

  const [dirty, setDirty] = useState(Boolean(initialDraft));
  const [aiRequest, setAiRequest] = useState("");
  const [selectedAiModel, setAiModel] = useState<CodexChatModel>(loadNoteAiModel);
  const [aiModels, setAiModels] = useState<readonly CodexModelOption[]>(CODEX_CHAT_MODELS);
  const aiModel = availableChatModel(aiModels, selectedAiModel);
  useEffect(() => {
    const chat = window.readerExample?.chat;
    if (!chat) return;
    let active = true;
    let notified = false;
    const unsubscribe = chat.onStateChanged((snapshot) => {
      notified = true;
      if (snapshot.models) setAiModels(snapshot.models);
    });
    void chat.getState().then((snapshot) => {
      if (active && !notified && snapshot.models) setAiModels(snapshot.models);
    }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiSessionId, setAiSessionId] = useState<string>();
  const [aiMessages, setAiMessages] = useState<ReadingNoteAiMessage[]>([]);
  const [aiRevision, setAiRevision] = useState<RevisionProposal>();
  const [aiRevisionMode, setAiRevisionMode] = useState<RevisionMode>('changes');
  const revisionPreviewApi = useMemo(() => ({ ...api, attachments: { ...api.attachments,
    readDataUrl: (id: string) => {
      const match = id.match(/^preview-source-(\d+)$/);
      if (!match) return api.attachments.readDataUrl(id);
      const url = source?.images?.[Number(match[1]) - 1]?.dataUrl;
      return url ? Promise.resolve(url) : Promise.reject(new Error('原文圖片無法顯示。'));
    }
  } }), [api, source?.images]);
  const [aiDraft, setAiDraft] = useState<ReadingNoteAiDraft>();
  const [aiStreamingDraft, setAiStreamingDraft] = useState<ReadingNoteAiDraft>();
  const [showUndoAi, setShowUndoAi] = useState(false);
  const [sourceCompletionDone, setSourceCompletionDone] = useState(Boolean(initialDraft));
  const [memoryImageUrl, setMemoryImageUrl] = useState<string>();
  const initialImageSide = readingNoteImage(note, "understand") ? "understand" : "recall";
  const initialImageId = readingNoteImage(note, initialImageSide)?.attachmentId;
  const embeddedImageIds = readingNoteDocumentAttachmentIds(document);
  const showStandaloneVisual = initialImageSide === "understand"
    ? !embeddedImageIds.includes(initialImageId!) : embeddedImageIds.length === 0;
  const optimisticAiMessageIdRef = useRef(0);
  const noteIdRef = useRef(note?.id);
  const revisionRef = useRef(note?.revision ?? 0);
  const draftPromiseRef = useRef<Promise<string> | undefined>(undefined);
  const draftSourceKeyRef = useRef<string | undefined>(undefined);
  const draftDiscardTimerRef = useRef<number | undefined>(undefined);
  const stagedAttachmentIdsRef = useRef<string[]>(initialDraft?.stagedAttachmentIds ?? []);
  const dirtyRef = useRef(false);
  const latestRef = useRef({ title, document });
  const saveQueueRef = useRef(Promise.resolve());
  const canvasRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [imagePasteError, setImagePasteError] = useState("");
  const aiUndoTitleRef = useRef<string | undefined>(undefined);
  const aiSessionIdRef = useRef<string | undefined>(undefined);
  const aiDiscardTimerRef = useRef<number | undefined>(undefined);
  const aiBaselineRef = useRef<ReadingNoteAiDraft | undefined>(undefined);

  const initialBlocks = useMemo(
    () => readingNoteDocumentToBlockNoteBlocks(initialDocument),
    [note?.id]
  );
  async function uploadImage(file: File) {
    const uploaded = await api.attachments.upload({
      name: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer())
    });
    stagedAttachmentIdsRef.current.push(uploaded.id);
    return uploaded.url;
  }

  const editor = useCreateBlockNote({
    schema: readingNoteSchema,
    initialContent: initialBlocks as never,
    tables: { headers: true, splitCells: false, cellBackgroundColor: false, cellTextColor: false },
    uploadFile: uploadImage,
    resolveFileUrl: async (url) => {
      if (!url.startsWith("reading-note-asset:")) throw new Error("Remote reading-note images are not allowed.");
      return api.attachments.readDataUrl(url.slice("reading-note-asset:".length));
    },
    pasteHandler: ({ event, editor: pasteEditor, defaultPasteHandler }) => {
      const images = Array.from(event.clipboardData?.items ?? [])
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (!images.length) return defaultPasteHandler({
        prioritizeMarkdownOverHTML: false,
        plainTextAsMarkdown: true
      });
      event.preventDefault();
      setImagePasteError("");
      let anchorId = pasteEditor.getTextCursorPosition().block.id;
      const canvas = canvasRef.current;
      // The default handler inserts an empty-URL placeholder that cannot be saved.
      // Insert only after staging, keeping the original paste location across awaits.
      void (async () => {
        for (const file of images) {
          const url = await uploadImage(file);
          const anchor = pasteEditor.getBlock(anchorId);
          if (!canvas?.isConnected || canvasRef.current !== canvas || !anchor) {
            const id = url.slice("reading-note-asset:".length);
            await api.attachments.discardStaged([id]);
            stagedAttachmentIdsRef.current = stagedAttachmentIdsRef.current.filter(value => value !== id);
            return;
          }
          const image = { type: "image" as const, props: { url, name: file.name } };
          if (anchor.type === "paragraph" && Array.isArray(anchor.content) && !anchor.content.length) {
            anchorId = pasteEditor.updateBlock(anchor, image).id;
          } else {
            anchorId = pasteEditor.insertBlocks([image], anchor, "after")[0].id;
          }
        }
      })().catch(cause => {
        if (canvas?.isConnected && canvasRef.current === canvas) {
          setImagePasteError(cause instanceof Error ? cause.message : "Unable to paste image.");
        }
      });
      return true;
    }
  }, [note?.id]);

  const initialMarkdownApplied = useRef(false);
  useLayoutEffect(() => {
    if (!initialDraft?.markdown || initialMarkdownApplied.current) return;
    initialMarkdownApplied.current = true;
    editor.replaceBlocks(editor.document, parseReadingNoteMarkdownToBlocks(editor, initialDraft.markdown) as never);
    const content = blockNoteBlocksToReadingNoteDocument(editor.document as unknown[]);
    setDocument(content);
    latestRef.current = { title: initialDraft.title, document: content };
  }, [editor, initialDraft]);

  useEffect(() => {
    latestRef.current = { title, document };
    dirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [title, document, dirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(aiBusy || saveState === "saving");
  }, [aiBusy, onBusyChange, saveState]);

  useEffect(() => {
    let current = true;
    setMemoryImageUrl(undefined);
    const attachmentId = initialImageId;
    if (!attachmentId) return () => { current = false; };

    void api.attachments.readDataUrl(attachmentId)
      .then((url) => { if (current) setMemoryImageUrl(url); })
      .catch(() => { if (current) setMemoryImageUrl(undefined); });
    return () => { current = false; };
  }, [api, initialImageId]);

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "0px";
      element.style.height = `${Math.max(element.scrollHeight, 52)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [aiDraft, aiStreamingDraft, title]);

  useEffect(() => {
    aiSessionIdRef.current = aiSessionId;
  }, [aiSessionId]);

  useEffect(() => api.ai.onStateChanged?.((snapshot) => {
    if (snapshot.sessionId !== aiSessionIdRef.current) return;
    setAiStreamingDraft(snapshot.streamingDraft);
  }), [api]);

  useEffect(() => {
    if (aiDiscardTimerRef.current !== undefined) {
      window.clearTimeout(aiDiscardTimerRef.current);
      aiDiscardTimerRef.current = undefined;
    }
    return () => {
      aiDiscardTimerRef.current = window.setTimeout(() => {
        aiDiscardTimerRef.current = undefined;
        const sessionId = aiSessionIdRef.current;
        aiSessionIdRef.current = undefined;
        if (sessionId) void Promise.resolve(api.ai.discard(sessionId)).catch(() => undefined);
      }, 0);
    };
  }, [api]);

  useEffect(() => {
    if (initialDraft) {
      if (draftDiscardTimerRef.current !== undefined) window.clearTimeout(draftDiscardTimerRef.current);
      return () => {
        draftDiscardTimerRef.current = window.setTimeout(() => {
          const ids = stagedAttachmentIdsRef.current;
          if (!noteIdRef.current && ids.length) void api.attachments.discardStaged(ids).catch(() => undefined);
        }, 0);
      };
    }
    if (!source || noteIdRef.current) return;
    if (draftDiscardTimerRef.current !== undefined) {
      window.clearTimeout(draftDiscardTimerRef.current);
      draftDiscardTimerRef.current = undefined;
    }

    const sourceKey = JSON.stringify([source.bookId, source.chapterId, source.bookTitle, source.chapterTitle, source.readingSegment]);
    if (draftSourceKeyRef.current !== sourceKey) {
      const staleDraft = draftPromiseRef.current;
      if (staleDraft) void staleDraft.then((draftId) => api.discardDraft(draftId)).catch(() => undefined);
      const staged = [...stagedAttachmentIdsRef.current];
      stagedAttachmentIdsRef.current = [];
      if (staged.length) void api.attachments.discardStaged(staged).catch(() => undefined);
      draftSourceKeyRef.current = sourceKey;
      draftPromiseRef.current = api.beginDraft({
        ...(source.bookId ? { bookId: source.bookId } : {}),
        ...(source.chapterId ? { chapterId: source.chapterId } : {}),
        bookTitle: source.bookTitle,
        chapterTitle: source.chapterTitle,
        readingSegment: source.readingSegment
      }).then(({ draftId }) => draftId);
    }

    return () => {
      draftDiscardTimerRef.current = window.setTimeout(() => {
        draftDiscardTimerRef.current = undefined;
        if (noteIdRef.current) return;
        const pending = draftPromiseRef.current;
        draftPromiseRef.current = undefined;
        draftSourceKeyRef.current = undefined;
        if (pending) void pending.then((draftId) => api.discardDraft(draftId)).catch(() => undefined);
        const staged = [...stagedAttachmentIdsRef.current];
        stagedAttachmentIdsRef.current = [];
        if (staged.length) void api.attachments.discardStaged(staged).catch(() => undefined);
      }, 0);
    };
  }, [api, source?.bookId, source?.chapterId, source?.bookTitle, source?.chapterTitle, source?.readingSegment]);

  const persist = useCallback(async () => {
    if (readOnly || !dirtyRef.current) return;
    const snapshot = latestRef.current;
    setSaveState("saving");
    setSaveError("");
    const operation = async () => {
      let saved: ReadingNote;
      if (!noteIdRef.current && initialDraft) {
        saved = await initialDraft.save({ title: snapshot.title, content: snapshot.document });
        noteIdRef.current = saved.id;
      } else if (!noteIdRef.current) {
        if (!draftPromiseRef.current) throw new Error("Reading-note source is not ready.");
        const draftId = await draftPromiseRef.current;
        saved = await api.create({
          draftId,
          title: snapshot.title,
          content: snapshot.document
        });
        noteIdRef.current = saved.id;
      } else {
        saved = await api.update({
          id: noteIdRef.current,
          baseRevision: revisionRef.current,
          title: snapshot.title,
          content: snapshot.document
        });
      }
      revisionRef.current = saved.revision;
      if (latestRef.current.title === snapshot.title && latestRef.current.document === snapshot.document) {
        setDirty(false);
        dirtyRef.current = false;
      }
      setSaveState("saved");
      onSaved?.(saved);
    };
    saveQueueRef.current = saveQueueRef.current.then(operation, operation).catch((cause) => {
      setSaveState("error");
      setSaveError(cause instanceof Error ? cause.message : "Unable to save this reading note.");
      throw cause;
    });
    await saveQueueRef.current;
  }, [api, onSaved, readOnly, initialDraft]);

  useEffect(() => {
    if (!dirty || readOnly || explicitDraft) return;
    const timer = window.setTimeout(() => {
      if (!sourceOpeningRef.current) void persist().catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirty, document, explicitDraft, persist, readOnly, title]);

  async function openSource() {
    if (!note || !sourceNavigation || sourceOpeningRef.current) return;
    const resolved = resolveReadingNoteSource(note, sourceNavigation.books);
    if (!resolved.target) return;
    sourceOpeningRef.current = true; setSourceOpening(true);
    try {
      if (aiBusy || aiDraft) return;
      do {
        if (dirtyRef.current) await persist();
        await saveQueueRef.current;
      } while (dirtyRef.current);
      onBack();
      sourceNavigation.open(resolved.target);
    } catch { /* persist keeps the note open and exposes its retry error. */ }
    finally { sourceOpeningRef.current = false; setSourceOpening(false); }
  }

  async function back() {
    if (!explicitDraft && dirtyRef.current) {
      try { await persist(); } catch { return; }
    }
    onBack();
  }

  async function doneEditing() {
    if (!onDone) return;
    if (!explicitDraft && dirtyRef.current) {
      try { await persist(); } catch { return; }
    }
    onDone();
  }

  async function showMemoryImage(side?: "understand" | "recall") {
    if (!onFlip) return;
    if (!explicitDraft && dirtyRef.current) {
      try { await persist(); } catch { return; }
    }
    onFlip(side);
  }

  async function saveDraft() {
    if (!explicitDraft || aiBusy || aiDraft || saveState === "saving" ||
      (!title.trim() && readingNoteDocumentIsEmpty(document))) return;
    try {
      await persist();
    } catch {
      // persist owns the visible error state and keeps the draft open for retry.
    }
  }

  async function sendAiMessage(requestOverride?: string) {
    const firstSourceCompletion = Boolean(source && !sourceCompletionDone && !noteIdRef.current);
    const request = (requestOverride ?? aiRequest).trim();
    if (aiBusy || !request) return;
    const beforeDocument = blockNoteBlocksToReadingNoteDocument(editor.document as unknown[]);
    const beforeMarkdown = await editor.blocksToMarkdownLossy(editor.document);
    const sourceDraft = [
      title.trim() ? `Title: ${title.trim()}` : "",
      beforeMarkdown.trim() ? `Note content:\n${beforeMarkdown.trim()}` : ""
    ].filter(Boolean).join("\n\n");
    if (!firstSourceCompletion && !beforeMarkdown.trim() &&
      readingNoteDocumentAttachmentIds(document).length === 0) return;
    optimisticAiMessageIdRef.current += 1;
    setAiMessages((messages) => [...messages, {
      id: `pending-user-${optimisticAiMessageIdRef.current}`,
      role: "user",
      text: request
    }]);
    setAiRequest("");
    setAiBusy(true);
    setAiStreamingDraft(undefined);
    setAiStatus("AI is responding…");
    try {
      let sessionId = aiSessionIdRef.current;
      if (!sessionId) {
        const started = firstSourceCompletion
          ? await api.ai.startCreate({
              ...source!,
              userDraft: sourceDraft || `Reader wants help with a new note: ${request}`
            })
          : await api.ai.startTransform({
              title: title.trim() || "Untitled",
              content: beforeMarkdown
            });
        sessionId = started.sessionId;
        aiSessionIdRef.current = sessionId;
        setAiSessionId(sessionId);
        onAiSessionChange?.(sessionId);
        aiBaselineRef.current = {
          title: title.trim() || "Untitled",
          content: beforeMarkdown
        };
      }
      const result = await api.ai.send(sessionId, request, aiModel);
      if (result.draft) {
        const baseline = aiBaselineRef.current;
        const currentMarkdown = await editor.blocksToMarkdownLossy(editor.document);
        if (!baseline || baseline.title !== (title.trim() || "Untitled") ||
          baseline.content !== currentMarkdown) {
          await Promise.resolve(api.ai.reject(sessionId)).catch(() => undefined);
          throw new Error("The note changed while AI was responding. Send the request again from the current version.");
        }
        if (!protectedAttachmentIdsMatch(baseline.content, result.draft.content)) {
          await Promise.resolve(api.ai.reject(sessionId)).catch(() => undefined);
          throw new Error("AI changed protected image attachments, so the preview was rejected.");
        }
        try {
          validatedSourceImageReferences(result.draft.content,
            firstSourceCompletion ? source?.images : undefined);
        } catch (cause) {
          await Promise.resolve(api.ai.reject(sessionId)).catch(() => undefined);
          throw cause;
        }
        try {
          // Source markers are materialized only after the reader accepts the preview.
          const previewBlocks = parseReadingNoteMarkdownToBlocks(editor, result.draft.content.replace(
            /book-image:([1-9]\d*)/g, "reading-note-asset:preview-source-$1"));
          setAiRevision({ originalTitle: title, originalContent: beforeDocument,
            title: result.draft.title, content: blockNoteBlocksToReadingNoteDocument(previewBlocks as unknown[]) });
          setAiRevisionMode('changes');
        } catch {
          await Promise.resolve(api.ai.reject(sessionId)).catch(() => undefined);
          throw new Error("AI returned content that cannot be shown safely in this note.");
        }
      }
      setAiMessages(result.messages);
      setAiDraft(result.draft);
      setAiStreamingDraft(undefined);
      onAiPendingChange?.(Boolean(result.draft));
      setAiStatus(result.status);
    } catch (cause) {
      setAiStreamingDraft(undefined);
      setAiStatus(cause instanceof Error ? cause.message : "AI could not respond.");
    } finally {
      setAiBusy(false);
    }
  }

  function requestDraftCompletion() {
    setAiOpen(true);
    void sendAiMessage(READING_NOTE_DRAFT_COMPLETION_REQUEST);
  }

  async function applyAiProposal() {
    if (!aiSessionId || !aiDraft || aiBusy) return;
    setAiBusy(true);
    setAiStatus("Applying proposed changes…");
    const newlyStaged: string[] = [];
    try {
      const currentMarkdown = await editor.blocksToMarkdownLossy(editor.document);
      const baseline = aiBaselineRef.current;
      if (!baseline || baseline.title !== (title.trim() || "Untitled") ||
        baseline.content !== currentMarkdown) {
        throw new Error("The note changed during the AI conversation. Start a new AI conversation to avoid overwriting it.");
      }
      if (!protectedAttachmentIdsMatch(baseline.content, aiDraft.content)) {
        throw new Error("AI changed protected image attachments, so the proposal was not applied.");
      }
      const references = validatedSourceImageReferences(aiDraft.content,
        source && !sourceCompletionDone ? source.images : undefined);
      const assetIds = new Map<number, string>();
      for (const { index } of references) {
        if (assetIds.has(index)) continue;
        const dataUrl = source?.images?.[index - 1]?.dataUrl;
        const match = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw new Error(`Book image ${index} is unavailable in this reading segment.`);
        const bytes = Uint8Array.from(atob(match[2]!), character => character.charCodeAt(0));
        const uploaded = await api.attachments.upload({
          name: `book-image-${index}.${match[1]!.split("/")[1]}`,
          mimeType: match[1]!,
          bytes
        });
        newlyStaged.push(uploaded.id);
        assetIds.set(index, uploaded.id);
      }
      const materialized = materializedSourceImageMarkdown(aiDraft.content, assetIds);
      const replacement = parseReadingNoteMarkdownToBlocks(editor, materialized);
      const accepted = references.length
        ? await api.ai.accept(aiSessionId, materialized)
        : await api.ai.accept(aiSessionId);
      aiUndoTitleRef.current = title;
      editor.replaceBlocks(editor.document, replacement as never);
      const appliedDocument = blockNoteBlocksToReadingNoteDocument(editor.document as unknown[]);
      setTitle(aiDraft.title);
      setDocument(appliedDocument);
      setSourceCompletionDone(true);
      setDirty(true);
      dirtyRef.current = true;
      aiBaselineRef.current = {
        title: aiDraft.title,
        content: await editor.blocksToMarkdownLossy(editor.document)
      };
      setAiDraft(undefined);
      setAiStreamingDraft(undefined);
      setAiMessages(accepted.messages);
      onAiPendingChange?.(false);
      setAiStatus("AI changes applied.");
      setShowUndoAi(true);
      stagedAttachmentIdsRef.current.push(...newlyStaged);
    } catch (cause) {
      if (newlyStaged.length) void api.attachments.discardStaged(newlyStaged).catch(() => undefined);
      setAiStatus(cause instanceof Error ? cause.message : "The AI proposal could not be applied.");
    } finally {
      setAiBusy(false);
    }
  }

  async function rejectAiProposal() {
    if (!aiSessionId || !aiDraft || aiBusy) return;
    setAiBusy(true);
    setAiStatus("Restoring the last applied version…");
    try {
      const rejected = await api.ai.reject(aiSessionId);
      setAiDraft(undefined);
      setAiStreamingDraft(undefined);
      setAiMessages(rejected.messages);
      onAiPendingChange?.(false);
      setAiStatus(rejected.status);
    } catch (cause) {
      setAiStatus(cause instanceof Error ? cause.message : "The AI preview could not be dismissed.");
    } finally {
      setAiBusy(false);
    }
  }

  async function stopAi() {
    if (!aiSessionId) return;
    try {
      const stopped = await api.ai.stop(aiSessionId);
      setAiMessages(stopped.messages);
      setAiDraft(stopped.draft);
      setAiStreamingDraft(stopped.streamingDraft);
      onAiPendingChange?.(Boolean(stopped.draft));
      setAiStatus(stopped.status);
    } finally {
      setAiBusy(false);
    }
  }

  const visuallyEmpty = readingNoteDocumentIsEmpty(document);
  const canSaveDraft = explicitDraft && (Boolean(title.trim()) || !visuallyEmpty);
  const firstSourceCompletion = Boolean(source && !sourceCompletionDone && !noteIdRef.current);
  const showDraftCompletion = firstSourceCompletion && !visuallyEmpty && !aiDraft;
  const canRequestDraftCompletion = showDraftCompletion && !aiBusy && !aiDraft && saveState !== "saving";
  const canSubmitAi = !aiBusy && Boolean(aiRequest.trim());
  const displayedAiDraft = aiDraft ?? aiStreamingDraft;
  const duplicatePreviewStatus = Boolean(aiDraft && ['Previewing AI changes.', 'Previewing AI changes. Apply them to keep this version.'].includes(aiStatus));
  const showAiStatus = Boolean(aiStatus && !aiBusy && !duplicatePreviewStatus);
  const isStreamingPreview = Boolean(aiStreamingDraft && !aiDraft);
  const previewVisual = memoryImageUrl && showStandaloneVisual ? (
    <div className="reading-note-inline-memory-image">
      <ReadingNoteInlineVisual key={`${note?.id}:${initialImageSide}`} api={api} initialSide={initialImageSide}
        frontId={readingNoteImage(note, "understand")?.attachmentId} backId={readingNoteImage(note, "recall")?.attachmentId}
        alt={`Memory image for ${displayedAiDraft?.title || "Untitled"}`} onEditVisual={!readOnly ? showMemoryImage : undefined} />
    </div>
  ) : null;
  const revisionNote: ReadingNote | undefined = aiDraft && aiRevision ? {
    ...(note ?? { id: 'ai-preview', sourceDraftId: 'ai-preview', revision: 0, bookTitle: '', chapterTitle: '', createdAt: 0, updatedAt: 0 }),
    title: aiRevisionMode === 'before' ? aiRevision.originalTitle : aiRevision.title,
    content: aiRevisionMode === 'before' ? aiRevision.originalContent! : aiRevision.content
  } : undefined;
  return (
    <article
      ref={canvasRef}
      className={`reading-note-canvas${aiOpen ? " ai-open" : ""}`}
      aria-label={browseMode ? "Reading note front" : readOnly ? "Read-only reading note" : "Editable reading note"}
    >
      <header className="reading-note-canvas-toolbar">
        {explicitDraft ? (
          <button
            type="button"
            className="reading-note-canvas-tool-button reading-note-canvas-back"
            aria-label="Close reading note draft"
            onClick={() => void back()}
          ><BackIcon /><span>Close</span></button>
        ) : note && onFlip ? (
          <ReadingNoteFaceSwitch face="front" onSelect={(nextFace) => { if (nextFace === "back") void showMemoryImage(); }} />
        ) : <span aria-hidden="true" />}
        {explicitDraft && source ? (
          <div className="reading-note-canvas-source">
            <span>{source.bookTitle}</span>
            <span>·</span>
            <span>{source.chapterTitle}</span>
          </div>
        ) : <div className="reading-note-canvas-review">
          {note && !readOnly && !explicitDraft ? <ReadingNoteReviewControl api={api.review} note={note} /> : null}
        </div>}
        <div className="reading-note-canvas-actions">
          <span className={`reading-note-save-state ${saveState}`} role="status">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : ""}
          </span>
          {explicitDraft ? (
            <button
              type="button"
              className="reading-note-canvas-tool-button reading-note-canvas-save"
              aria-label="Save note"
              disabled={!canSaveDraft || aiBusy || Boolean(aiDraft) || saveState === "saving"}
              onClick={() => void saveDraft()}
            ><span>{saveState === "saving" ? "Saving…" : "Save note"}</span></button>
          ) : null}
          {note && !readOnly ? <HeptabaseImportAction api={api.heptabase} noteIds={[note.id]} compact beforeStart={async () => {
            if (dirtyRef.current) await persist(); else await saveQueueRef.current;
          }} /> : null}
          {onEdit || onDone ? (
            <button
              type="button"
              className="reading-note-canvas-tool-button reading-note-edit-toggle"
              aria-label={onDone ? "Exit edit mode" : "Enter edit mode"}
              aria-pressed={Boolean(onDone)}
              onClick={onDone ? () => void doneEditing() : onEdit}
            ><EditIcon /><span>Edit</span></button>
          ) : null}
          {readOnly && onRestore ? <button type="button" className="reading-note-canvas-tool-button reading-note-canvas-restore" onClick={onRestore}><RestoreIcon /><span>Restore</span></button> : null}
          {!readOnly && onDelete ? (
            <button
              type="button"
              className="reading-note-canvas-tool-button reading-note-canvas-trash"
              aria-label="Move to Trash"
              title="Move to Trash"
              onClick={onDelete}
            ><TrashIcon /></button>
          ) : null}
          {!explicitDraft ? (
            <button
              type="button"
              className="reading-note-canvas-tool-button reading-note-canvas-close"
              aria-label="Close reading note"
              title="Close reading note"
              onClick={() => void back()}
            ><CloseIcon /></button>
          ) : null}
        </div>
      </header>
      {!explicitDraft ? (
        <button
          type="button"
          hidden
          className="reading-note-canvas-close-trigger"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => void back()}
        />
      ) : null}
      <div className="reading-note-canvas-body">
        <div className="reading-note-canvas-scroll">
          <div className="reading-note-canvas-paper">
            {displayedAiDraft ? (
              <section
                className={`reading-note-ai-note-preview${isStreamingPreview ? " streaming" : ""}`}
                aria-label={isStreamingPreview ? "AI streaming note preview" : "AI proposed note preview"}
              >
                {isStreamingPreview ? (
                  <div className="reading-note-ai-note-preview-status" role="status">
                    <span aria-hidden="true" />AI is editing…
                  </div>
                ) : null}
                {revisionNote && aiRevision ? <>
                  <div className="note-ai-revision-controls">
                    <ReadingNoteRevisionModes value={aiRevisionMode} onChange={setAiRevisionMode} />
                    <div className="note-ai-revision-decisions">
                      <button type="button" aria-label="Apply changes" disabled={aiBusy} onClick={() => void applyAiProposal()}>套用編修</button>
                      <button type="button" className="reject" aria-label="Don't apply changes" disabled={aiBusy} onClick={() => void rejectAiProposal()}>不套用</button>
                    </div>
                    {aiRevisionMode === 'changes' ? <ReadingNoteRevisionLegend /> : null}
                  </div>
                  {aiRevisionMode === 'changes' ? <ReadingNoteRevision proposal={aiRevision} note={revisionNote} api={revisionPreviewApi}
                    metadata={<>{note ? <ReadingNoteMetadata note={note} onSource={() => void openSource()} busy={sourceOpening || aiBusy || Boolean(aiDraft)} /> : null}{previewVisual}</>} /> : <>
                    <h1>{revisionNote.title}</h1>
                    {note ? <ReadingNoteMetadata note={note} onSource={() => void openSource()} busy={sourceOpening || aiBusy || Boolean(aiDraft)} /> : null}
                    {previewVisual}
                    <ReadingNoteReadOnlyContent key={aiRevisionMode} api={revisionPreviewApi} note={revisionNote} />
                  </>}
                </> : <>
                <h1>{displayedAiDraft.title}</h1>
                {note ? <ReadingNoteMetadata note={note} onSource={() => void openSource()} busy={sourceOpening || aiBusy || Boolean(aiDraft)} /> : null}
                {memoryImageUrl && showStandaloneVisual ? (
                  <div className="reading-note-inline-memory-image">
                    <ReadingNoteInlineVisual key={`${note?.id}:${initialImageSide}`} api={api} initialSide={initialImageSide} frontId={readingNoteImage(note, "understand")?.attachmentId}
                      backId={readingNoteImage(note, "recall")?.attachmentId} alt={`Memory image for ${displayedAiDraft.title || "Untitled"}`}
                      onEditVisual={!readOnly ? showMemoryImage : undefined} />
                  </div>
                ) : null}
                <div className="reading-note-ai-note-preview-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url, key) => key === "src" && /^(?:book-image:[1-9]\d*|reading-note-asset:[A-Za-z0-9_-]+)$/.test(url)
                      ? url : defaultUrlTransform(url)}
                    components={{
                      img: ({ src, alt }) => <ReadingNotePreviewImage src={src} alt={alt}
                        api={api} sourceImages={source?.images} />
                    }}
                  >{displayedAiDraft.content}</ReactMarkdown>
                </div>
                </>}
              </section>
            ) : null}
            {/* Keep the editor mounted: table handles retain view references across AI previews. */}
            <div hidden={Boolean(displayedAiDraft)}>
              <textarea
                ref={titleRef}
                className="reading-note-title-input"
                aria-label="Reading note title"
                rows={1}
                value={title}
                placeholder="Untitled"
                readOnly={effectiveReadOnly}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) => { setTitle(singleLineTitle(event.target.value)); setDirty(true); }}
              />
              {note && !displayedAiDraft ? <ReadingNoteMetadata note={note} onSource={() => void openSource()} busy={sourceOpening || aiBusy || Boolean(aiDraft)} /> : null}
              {memoryImageUrl && showStandaloneVisual ? (
                <div className="reading-note-inline-memory-image">
                  <ReadingNoteInlineVisual key={`${note?.id}:${initialImageSide}`} api={api} initialSide={initialImageSide} frontId={readingNoteImage(note, "understand")?.attachmentId}
                    backId={readingNoteImage(note, "recall")?.attachmentId} alt={`Memory image for ${title || "Untitled"}`}
                    onEditVisual={!readOnly ? showMemoryImage : undefined} />
                </div>
              ) : null}
              <ReadingNoteVisualContext.Provider value={{ api, note, browsing: effectiveReadOnly,
                onEditVisual: !readOnly ? showMemoryImage : undefined }}>
                <BlockNoteView
                  editor={editor}
                  editable={!effectiveReadOnly && !displayedAiDraft}
                  theme="light"
                  onChange={(_editor, { getChanges }) => {
                    // Toggling editable also emits an update, without changing any blocks.
                    if (getChanges().length === 0) return;
                    try {
                      const next = blockNoteBlocksToReadingNoteDocument(editor.document as unknown[]);
                      setDocument(next);
                      setDirty(true);
                    } catch (cause) {
                      setSaveState("error");
                      setSaveError(cause instanceof Error ? cause.message : "This block cannot be saved.");
                      window.setTimeout(() => editor.undo(), 0);
                    }
                  }}
                />
              </ReadingNoteVisualContext.Provider>
            </div>
            {note && api.review ? <ReadingNoteReviewSchedule key={note.id} api={api.review} noteId={note.id} /> : null}
          </div>
        </div>
        {!effectiveReadOnly ? (
          <div className="reading-note-canvas-ai-float">
            {imagePasteError ? <p className="reading-note-editor-error" role="alert">{imagePasteError}</p> : null}
            {saveError ? <p className="reading-note-editor-error" role="alert">{saveError} <button type="button" onClick={() => void persist()}>Retry</button></p> : null}
            <section className={`reading-note-canvas-ai reading-note-canvas-ai-collapsed${showDraftCompletion ? " with-completion" : ""}`} aria-label="AI writing tools">
              <button type="button" className="reading-note-canvas-ai-open" aria-label="Open AI editor" onClick={() => setAiOpen(true)}>
                <span className="reading-note-canvas-ai-identity">
                <span className="reading-note-canvas-ai-icon"><SparkleIcon /></span>
                <span>
                  <strong>Ask AI</strong>
                  <small>{aiDraft ? "Review AI preview · Not applied" : firstSourceCompletion ? "Create, discuss, or edit with reading context" : "Discuss, clarify, or edit this note"}</small>
                </span>
                </span>
                <span className="reading-note-canvas-ai-open-label">Open</span>
              </button>
              {showDraftCompletion ? (
                <button
                  type="button"
                  className="annotation-analysis-preset reading-note-draft-completion"
                  aria-label={READING_NOTE_DRAFT_COMPLETION_LABEL}
                  data-tooltip={READING_NOTE_DRAFT_COMPLETION_LABEL}
                  disabled={!canRequestDraftCompletion}
                  onClick={requestDraftCompletion}
                ><SparkleIcon /><span>{READING_NOTE_DRAFT_COMPLETION_LABEL}</span></button>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
      {!effectiveReadOnly && aiOpen ? (
        <aside className="reading-note-ai-panel" aria-label="AI editing conversation">
          <header className="chat-header reading-note-ai-header">
            <div className="chat-title"><span className="status ready" /><strong>AI Note Editor</strong></div>
            <small>Discuss · Preview first</small>
            <button type="button" className="reading-note-ai-panel-close" aria-label="Collapse AI editor" onClick={() => setAiOpen(false)}><CloseIcon /></button>
          </header>
          <div className="reading-note-ai-content">
            {!aiMessages.length ? (
              <section className="reading-note-ai-context range-notice" aria-label="AI context" role="note">
                <span>AI context</span>
                <strong>{firstSourceCompletion ? "Current reading" : "This note only"}</strong>
                <small>{firstSourceCompletion
                  ? "AI can use this draft, the marked passage, and your current reading conversation."
                  : "AI can use the title and content of this note."}</small>
              </section>
            ) : null}
            <div className="reading-note-ai-messages messages" aria-live="polite">
              {aiMessages.length ? aiMessages.map((message) => (
                <article key={message.id} className={`reading-note-ai-message message ${message.role}`} aria-label={message.role === "user" ? "Your message" : "AI Note Editor response"}>
                  {message.role === "assistant"
                    ? (
                        <div className="message-markdown">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[[rehypeKatex, {
                              strict: false,
                              throwOnError: false,
                              trust: false
                            }]]}
                          >
                            {normalizeBackslashMathDelimiters(message.text)}
                          </ReactMarkdown>
                        </div>
                      )
                    : <div className="user-message-content">{message.text.length > 300 ? (
                        <details className="note-ai-request-details">
                          <summary>{message.text === READING_NOTE_DRAFT_COMPLETION_REQUEST ? '根據草稿完善筆記' : `${Array.from(message.text).slice(0, 48).join('')}…`}<span>展開完整要求</span></summary>
                          <p>{message.text}</p>
                        </details>
                      ) : <p>{message.text}</p>}</div>}
                </article>
              )) : (
                <div className="reading-note-ai-empty chat-empty">
                  <span aria-hidden="true">✦</span>
                  <strong>What would you like to improve?</strong>
                  <p>Ask about the content, explore an idea, or describe the change you want.</p>
                </div>
              )}
              {aiBusy ? (
                <div className="responding" role="status">
                  <span aria-hidden="true" />
                  <strong>AI is responding…</strong>
                </div>
              ) : null}
            </div>
          </div>
          {aiDraft ? (
            <div className="reading-note-ai-proposal">
              <div><strong>修訂已備妥</strong><small>確認後才會套用</small></div>
              <div className="reading-note-ai-proposal-actions">
                <button type="button" onClick={() => {
                  setAiOpen(false);
                  window.requestAnimationFrame(() => {
                    canvasRef.current?.querySelector<HTMLElement>('.note-ai-revision-controls')?.scrollIntoView({ block: 'nearest' });
                    canvasRef.current?.querySelector<HTMLButtonElement>('.note-ai-revision-controls [aria-pressed="true"]')?.focus();
                  });
                }}>查看修訂</button>
              </div>
            </div>
          ) : null}
          {showAiStatus || showUndoAi ? (
            <div className="reading-note-ai-panel-feedback">
              {showAiStatus
                ? <p className="reading-note-ai-panel-status" role="status">{aiStatus}</p>
                : <span />}
              {showUndoAi ? <button type="button" className="reading-note-ai-secondary" onClick={() => {
                editor.undo();
                if (aiUndoTitleRef.current !== undefined) setTitle(aiUndoTitleRef.current);
                setDirty(true);
                setShowUndoAi(false);
                const sessionId = aiSessionIdRef.current;
                if (sessionId) void Promise.resolve(api.ai.discard(sessionId)).catch(() => undefined);
                aiSessionIdRef.current = undefined;
                setAiSessionId(undefined);
                onAiSessionChange?.(undefined);
                setAiMessages([]);
                aiBaselineRef.current = undefined;
              }}>Undo applied change</button> : null}
            </div>
          ) : null}
          <form className="chat-form reading-note-ai-form" onSubmit={(event) => {
            event.preventDefault();
            void sendAiMessage();
          }}>
            {showDraftCompletion ? (
              <div className="reading-note-ai-draft-action" aria-label="AI note shortcuts">
                <button
                  type="button"
                  className="annotation-analysis-preset reading-note-draft-completion"
                  aria-label={READING_NOTE_DRAFT_COMPLETION_LABEL}
                  data-tooltip={READING_NOTE_DRAFT_COMPLETION_LABEL}
                  disabled={!canRequestDraftCompletion}
                  onClick={requestDraftCompletion}
                ><SparkleIcon /><span>{READING_NOTE_DRAFT_COMPLETION_LABEL}</span></button>
              </div>
            ) : null}
            <div className="chat-composer-card reading-note-ai-composer">
              <textarea
                aria-label="Message AI about this note"
                rows={4}
                value={aiRequest}
                disabled={aiBusy}
                placeholder="Ask a question or describe the change you want…"
                onChange={(event) => setAiRequest(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="chat-composer-actions">
                <select
                  aria-label="Choose AI model"
                  value={aiModel}
                  disabled={aiBusy}
                  onChange={(event) => {
                    const model = event.target.value;
                    setAiModel(model);
                    try { window.localStorage.setItem(AI_MODEL_KEY, model); } catch {
                      // Keep the selection usable when storage is unavailable.
                    }
                  }}
                >
                  {aiModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
                <button
                  type={aiBusy ? "button" : "submit"}
                  className={`chat-send-button${aiBusy ? " stop-response" : ""}`}
                  aria-label={aiBusy ? "Stop" : "Send message"}
                  title={aiBusy ? "Stop" : "Send message"}
                  disabled={aiBusy ? !aiSessionId : !canSubmitAi}
                  onClick={aiBusy ? () => void stopAi() : undefined}
                ><span aria-hidden="true">{aiBusy ? "" : "↑"}</span></button>
              </div>
            </div>
            <small className="chat-composer-hint">Enter to send · Shift+Enter for a new line</small>
          </form>
        </aside>
      ) : null}
    </article>
  );
}
