import { HeptabaseImportProvider, HeptabaseImportPanel } from "./HeptabaseImport";
import { readingChapters, readingChapterId, adjacentReadingChapters } from '../shared/chapter-navigation';
import { MyBookshelf } from "./MyBookshelf";
import { ReaderNoteTrashDialog } from "./ReaderNoteTrashDialog";
import { createPortal } from "react-dom";
import { ReadingNoteSourceContext } from "./reading-note-source-context";
import { ConversationReadingNoteCanvas } from "./ConversationReadingNoteCanvas";
import { quizSession, quizAction } from '../shared/quiz-workflow';
import { readingCoachPrompt } from "../shared/reading-coach";
import { readingSuggestions, stripReadingSuggestion } from "../shared/reading-input-suggestion";
import { NoteReferencePicker, NoteReferenceHistory, NoteUpdateCard, type NoteDecision } from "./ReadingConversationNotes";
import { stripNoteUpdateArtifacts } from "../shared/reading-note-reference";
import { CardNoteUploadPanel, CardNoteUploadProvider } from "./CardNoteUploadPanel";
import { ReaderVideosPanel } from './ReaderVideosPanel';
import { BookMemoryImageSettings } from "./BookMemoryImageSettings";
import { ConceptVideoActivity, useConceptVideoActivity } from './ConceptVideoActivity';
import { PracticeWorkspace } from "./PracticeWorkspace";
import { ConceptVideoEditor, ConceptVideoLibrary } from './ConceptVideoWorkspace';
import type { ConceptVideo, ConceptVideoSource } from '../shared/concept-video';
import { WhiteboardWorkspace } from "./WhiteboardWorkspace";
import { ReadingVoiceButton, ReadingVoiceNotice, ReadingVoicePanel, useReadingVoice } from "./ReadingVoiceControls";
import {
  CSSProperties,
  ClipboardEvent as ReactClipboardEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  forwardRef,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type {
  Annotation,
  AnnotationColor,
  BookView,
  ChapterContent,
  ChatConversationSummary,
  ChatIntent,
  ChatMessage,
  ChatSnapshot,
  CodexChatModel,
  LibraryBook,
  MemoryImageSide,
  ReaderDesktopApi,
  ReadingNote,
  ReadingNoteSummary,
  ReadingRange
} from "../shared/contracts";
import {
  ANNOTATION_COLORS,
  CODEX_CHAT_MODELS,
  availableChatModel,
  DEFAULT_ANNOTATION_COLOR,
  isCodexChatModel
} from "../shared/contracts";
import { normalizeBackslashMathDelimiters } from "./markdown-math";
import { LearningQuestionCard } from "./LearningQuestionCard";
import { SelfRetellingCard } from "./SelfRetellingCard";
import { ReadingNoteCard } from "./ReadingNoteCard";
import { ReadingNoteLibrary } from "./ReadingNoteLibrary";
import { SpacedReviewWorkspace } from "./SpacedReviewWorkspace";
import { useReviewSummary } from "./use-review-summary";
import { ReaderNotesPanel } from "./ReaderNotesPanel";
import { ChapterScratchpad } from "./ChapterScratchpad";
import { useReaderNotes } from "./use-reader-notes";
import { ReadingNoteEditorDialog } from "./ReadingNoteEditorDialog";
import { MemoryImageGenerationProgress } from "./MemoryImageGenerationProgress";
import { ReviewSettings } from "./ReviewSettings";
import { MemoryImageSettings } from "./MemoryImageSettings";
import {
  learningQuestionArtifacts,
  learningQuestionSubmissionAnswers,
  stripLearningQuestionArtifacts
} from "./learning-question-artifact";
import {
  selfRetellingAnswers,
  selfRetellingArtifacts,
  stripSelfRetellingArtifacts
} from "./self-retelling-artifact";
import {
  bookImagesForDraft,
  readingNoteArtifacts,
  readingNoteWorkflowPending,
  stripReadingNoteArtifacts
} from "./reading-note-artifact";
import { prepareReadingNoteAwareMessage } from "./reading-note-workflow";
import {
  buildReadingStructure,
  inferReadingPreference,
  nextAdaptiveReadingSegment,
  type ReadingPreference,
  type ReadingStructure
} from "./adaptive-reading-segment";
import {
  annotationRangeFromSelection,
  expandReadingRangeToVisualLines,
  extractReadingSegment,
  extractReadingSegmentWithImages,
  initialReadingRange,
  hasAnnotationOverlap,
  markerTopForTextOffset,
  originalSelectionAtContextOffset,
  originalSelectionWithinReadingRange,
  rangeAfterMovingBoundary,
  rangeMarkerScrollTop,
  renderAnnotationHighlights,
  shouldCreateAnnotation,
  shouldDismissRangeContextMenu,
  textOffsetAtPoint
} from "./reading-range";
import { readingSourceSnapshot, prepareReadingSegmentDelivery } from "./reading-segment-delivery";
import { copyReadingConversation } from "./reading-conversation-export";
import {
  readingSegmentShortcutFallbackError,
  readingSegmentShortcutsDisabled,
  readingSegmentShortcutText
} from "./reading-segment-shortcuts";

export function readingSegmentContextForArticle(
  article: HTMLElement,
  range: ReadingRange,
  readImages = true
): { contextRange: ReadingRange; readingSegment: string; plainReadingSegment: string; images: { dataUrl: string }[] } {
  const contextRange = expandReadingRangeToVisualLines(article, range);
  const content = extractReadingSegmentWithImages(article, contextRange);
  const plainReadingSegment = extractReadingSegment(article.textContent ?? "", contextRange);
  return {
    contextRange,
    readingSegment: readImages ? content.readingSegment : [plainReadingSegment,
      ...(content.images.length ? ["[Images omitted: image reading is disabled. Use only the supplied text.]"] : [])
    ].filter(Boolean).join("\n\n"),
    images: readImages ? content.images : [],
    plainReadingSegment
  };
}

export interface ReadingLayout {
  fontSize: number;
  lineHeight: number;
  paperWidth: number;
}

export function ReadingRangeContextMenu({
  x,
  y,
  onMoveStart,
  onMoveEnd,
  annotationId,
  annotationColor,
  onChangeAnnotationColor,
  onRemoveAnnotation,
  selectedText,
  selectionValid = false,
  explainDisabled = false,
  onExplainSelection,
  onElaborateSelection
}: {
  x: number;
  y: number;
  onMoveStart(): void;
  onMoveEnd(): void;
  annotationId?: string;
  annotationColor?: AnnotationColor;
  onChangeAnnotationColor?(annotationId: string, color: AnnotationColor): void;
  onRemoveAnnotation?(annotationId: string): void;
  selectedText?: string;
  selectionValid?: boolean;
  explainDisabled?: boolean;
  onExplainSelection?(): void;
  onElaborateSelection?(): void;
}) {
  return (
    <div
      className="reading-range-context-menu"
      role="menu"
      aria-label="Set reading range"
      style={{ left: x, top: y }}
    >
      <button type="button" role="menuitem" onClick={onMoveStart}>
        <svg className="context-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 4v12M8.5 7.5 12 4l3.5 3.5M12 4v12" />
        </svg>
        <span>Move start here</span>
      </button>
      <button type="button" role="menuitem" onClick={onMoveEnd}>
        <svg className="context-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 4v12M8.5 12.5 12 16l3.5-3.5M12 4v12" />
        </svg>
        <span>Move end here</span>
      </button>
      {selectedText && onExplainSelection ? (
        <button
          className="context-menu-explain"
          type="button"
          role="menuitem"
          disabled={!selectionValid || explainDisabled}
          onClick={onExplainSelection}
        >
          <svg className="context-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3M4.7 4.7l2.1 2.1M13.2 13.2l2.1 2.1M15.3 4.7l-2.1 2.1M6.8 13.2l-2.1 2.1" />
            <circle cx="10" cy="10" r="3.2" />
          </svg>
          <span>白話說明</span>
        </button>
      ) : null}
      {selectedText && onElaborateSelection ? (
        <button
          className="context-menu-elaborate"
          type="button"
          role="menuitem"
          disabled={!selectionValid || explainDisabled}
          onClick={onElaborateSelection}
        >
          <svg className="context-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 3.5h12v13H4zM7 7h6M7 10h6M7 13h3" />
          </svg>
          <span>詳細闡明</span>
        </button>
      ) : null}
      {annotationId && onChangeAnnotationColor ? (
        <div
          className="context-menu-annotation-colors"
          role="group"
          aria-label="Annotation color"
        >
          {ANNOTATION_COLORS.map((color) => (
            <button
              className={`context-menu-color-button annotation-color-${color}`}
              key={color}
              type="button"
              role="menuitemradio"
              aria-label={`Change annotation color to ${color}`}
              aria-checked={(annotationColor ?? DEFAULT_ANNOTATION_COLOR) === color}
              onClick={() => onChangeAnnotationColor(annotationId, color)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
      {annotationId && onRemoveAnnotation ? (
        <button
          className="context-menu-danger"
          type="button"
          role="menuitem"
          onClick={() => onRemoveAnnotation(annotationId)}
        >
          <svg className="context-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 6h13M8 3.5h4M6 6l.7 10.5h6.6L14 6M8.3 9v4.5M11.7 9v4.5" />
          </svg>
          <span>Remove annotation</span>
        </button>
      ) : null}
    </div>
  );
}

export function ReadingRangeBoundary({
  marker,
  top,
  overlapping = false,
  onPointerDown
}: {
  marker: "start" | "end";
  top: number;
  overlapping?: boolean;
  onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
}) {
  const label = marker.toUpperCase();
  return (
    <div
      className={`range-boundary ${marker}${overlapping ? " is-overlapping" : ""}`}
      data-range-boundary={marker}
      style={{ top }}
    >
      <button
        className="range-boundary-handle"
        type="button"
        aria-label={`Drag ${label}`}
        onPointerDown={onPointerDown}
      >
        <span aria-hidden="true" />
      </button>
      <span className="range-boundary-label">
        <b>{label}</b>
      </span>
    </div>
  );
}

const ChapterArticle = memo(forwardRef<HTMLElement, {
  content: ChapterContent;
}>(function ChapterArticle({ content }, ref) {
  return (
    <article
      ref={ref}
      className="chapter-content"
      aria-label={`${content.title} chapter content`}
      dangerouslySetInnerHTML={{ __html: content.contentHtml }}
    />
  );
}));

const defaultReadingLayout: ReadingLayout = {
  fontSize: 19,
  lineHeight: 1.9,
  paperWidth: 760
};

const defaultChatPanelWidth = 380;
const minimumChatPanelWidth = 380;
const maximumChatPanelWidth = 720;

export function chatPanelWidthFromPointer(
  pointerX: number,
  viewportWidth: number,
  libraryCollapsed: boolean
): number {
  const compactLayout = viewportWidth <= 1180;
  const libraryWidth = libraryCollapsed ? 46 : compactLayout ? 210 : 230;
  const minimumReaderWidth = compactLayout ? 480 : 520;
  const layoutMaximum = Math.max(
    minimumChatPanelWidth,
    viewportWidth - libraryWidth - minimumReaderWidth
  );
  return Math.round(Math.min(
    maximumChatPanelWidth,
    layoutMaximum,
    Math.max(minimumChatPanelWidth, viewportWidth - pointerX)
  ));
}

export function chatPanelWidthFromStorage(value: string | null): number {
  if (value === null || value.trim() === "") return defaultChatPanelWidth;
  return bounded(
    Number(value),
    minimumChatPanelWidth,
    maximumChatPanelWidth,
    defaultChatPanelWidth
  );
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function loadReadingLayout(): ReadingLayout {
  if (typeof window === "undefined") return defaultReadingLayout;
  try {
    const saved = JSON.parse(window.localStorage.getItem("reader-example-layout") ?? "null") as Partial<ReadingLayout> | null;
    return {
      fontSize: bounded(saved?.fontSize, 15, 28, defaultReadingLayout.fontSize),
      lineHeight: bounded(saved?.lineHeight, 1.5, 2.5, defaultReadingLayout.lineHeight),
      paperWidth: bounded(saved?.paperWidth, 560, 920, defaultReadingLayout.paperWidth)
    };
  } catch {
    return defaultReadingLayout;
  }
}

function loadChatPanelWidth(): number {
  if (typeof window === "undefined") return defaultChatPanelWidth;
  return chatPanelWidthFromStorage(
    window.localStorage.getItem("reader-example-chat-width")
  );
}

const emptyChat: ChatSnapshot = {
  connection: "disconnected",
  connectionDetail: "Codex is not connected.",
  account: null,
  allowance: {
    phase: "unavailable",
    fiveHour: null,
    weekly: null,
    detail: "AI usage allowance is not available yet."
  },
  threadId: null,
  activeTurnId: null,
  messages: [],
  conversations: [],
  activeConversationId: null,
  managementBusy: false,
  conversationError: null
};

function PanelToggleIcon({ edge }: { edge: "left" | "right" }) {
  const dividerX = edge === "left" ? 9 : 15;
  return (
    <svg className="panel-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3" />
      <path d={`M${dividerX} 4v16`} />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g transform="translate(0 2.5)">
        <path d="M9.7 3.8 10.3 2h3.4l.6 1.8 1.5.9 1.9-.4 1.7 2.9-1.3 1.4v1.8l1.3 1.4-1.7 2.9-1.9-.4-1.5.9-.6 1.8h-3.4l-.6-1.8-1.5-.9-1.9.4-1.7-2.9 1.3-1.4V8.6L4.6 7.2l1.7-2.9 1.9.4 1.5-.9Z" />
        <circle cx="12" cy="9.5" r="2.5" />
      </g>
    </svg>
  );
}

function connectionLabel(connection: ChatSnapshot["connection"]): string {
  if (connection === "ready") return "Connected";
  if (connection === "auth-required") return "Sign in";
  if (connection === "connecting") return "Connecting";
  if (connection === "error") return "Error";
  return "Offline";
}

function resetLabel(resetsAt: number): string {
  return new Date(resetsAt * 1_000).toLocaleString();
}

export function CodexAccountStatus({ snapshot }: { snapshot: ChatSnapshot }) {
  return (
    <section
      className={`codex-account-card ${snapshot.connection}`}
      aria-label="Codex status"
      title={snapshot.connectionDetail}
    >
      <div className="codex-account-heading">
        <div className="codex-account-brand">
          <span className={`codex-status-dot ${snapshot.connection}`} aria-hidden="true" />
          <strong className="codex-account-name">Codex</strong>
        </div>
        <span className="codex-connection-label">
          {connectionLabel(snapshot.connection)}
        </span>
      </div>
      <div className="allowance-summary">
        {([
          ["5 hours", snapshot.allowance.fiveHour],
          ["Weekly", snapshot.allowance.weekly]
        ] as const).map(([label, allowance]) => {
          const unavailable = snapshot.allowance.phase === "loading" ? "Loading…" : "Unavailable";
          const detail = allowance
            ? `${label}: ${allowance.remainingPercent}% remaining, resets ${resetLabel(allowance.resetsAt)}`
            : `${label}: ${unavailable}`;
          return (
            <div className="allowance-summary-row" key={label} title={detail} aria-label={detail}>
              <span>{label}</span>
              <strong className={`allowance-value ${allowance ? "available" : snapshot.allowance.phase}`}>
                {allowance ? `${allowance.remainingPercent}%` : unavailable}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ChatMessageList({
  messages,
  activeTurnId,
  actionsDisabled = false,
  onSubmitLearningQuestion = () => false,
  onSubmitSelfRetelling = () => false,
  onSubmitReadingNote = () => false,
  onDecideNoteUpdate,
  onOpenReferencedNote,
  notesApi,
  chatApi,
  onNoteCreated,
  source
}: {
  messages: ChatMessage[];
  activeTurnId: string | null;
  actionsDisabled?: boolean;
  onSubmitLearningQuestion?(text: string): Promise<boolean> | boolean;
  onSubmitSelfRetelling?(text: string): Promise<boolean> | boolean;
  onSubmitReadingNote?(draftId: string): Promise<boolean> | boolean;
  onDecideNoteUpdate?: NoteDecision;
  onOpenReferencedNote?: (note: ReadingNote) => void;
  notesApi?: ReaderDesktopApi["readingNotes"];
  chatApi?: ReaderDesktopApi["chat"];
  onNoteCreated?(note: ReadingNote): void;
  source?: { bookTitle?: string; chapterTitle?: string } | null;
}) {
  const [expandedLearningQuestionQuizId, setExpandedLearningQuestionQuizId] = useState<string>();
  const [expandedSelfRetellingId, setExpandedSelfRetellingId] = useState<string>();
  const [expandedReadingNoteId, setExpandedReadingNoteId] = useState<string>();
  const selfRetelling = useMemo(() => selfRetellingArtifacts(messages), [messages]);
  const readingNotes = useMemo(() => readingNoteArtifacts(messages), [messages]);
  const initialCompletedNotes = useRef(new Set(messages.filter(m => m.status === "completed").map(m => m.id)));
  const conversationId = useRef(messages[0]?.id);
  const liveNoteRequests = useRef(new Set<string>());
  useEffect(() => {
    // Loading another conversation restores its actions without opening historical drafts.
    if (conversationId.current && messages[0]?.id !== conversationId.current) {
      setExpandedReadingNoteId(undefined);
      liveNoteRequests.current.clear();
      initialCompletedNotes.current = new Set(messages.filter(m => m.status === "completed").map(m => m.id));
    }
    conversationId.current = messages[0]?.id;
    if (activeTurnId) {
      const user = messages.findLast(m => m.role === "user");
      if (user) liveNoteRequests.current.add(user.id);
    }
    if (!notesApi || !chatApi || activeTurnId || actionsDisabled) return;
    const completed = messages.filter(m => m.status === "completed" && !initialCompletedNotes.current.has(m.id));
    completed.forEach(m => initialCompletedNotes.current.add(m.id));
    const latest = completed.findLast(m => {
      const user = messages.slice(0, messages.indexOf(m)).findLast(u => u.role === "user");
      return m.role === "assistant" && user && liveNoteRequests.current.has(user.id) && readingNoteArtifacts([m]).drafts.length;
    });
    const draft = latest && readingNoteArtifacts([latest]).drafts[0];
    if (draft && !readingNotes.saved.some(s => s.draftId === draft.draftId)) setExpandedReadingNoteId(draft.draftId);
  }, [messages, activeTurnId, actionsDisabled, notesApi, chatApi, readingNotes]);

  const messageScroller = useRef<HTMLDivElement>(null);
  const currentMessageTurn = useRef<HTMLDivElement>(null);
  const latestUserMessage = useRef<HTMLElement>(null);
  const lastSentMessageId = useRef<string | undefined>(undefined);
  const latestUserMessageIndex = messages.findLastIndex(message => message.role === "user");
  const latestUserMessageId = messages[latestUserMessageIndex]?.id;
  useLayoutEffect(() => {
    const scroller = messageScroller.current;
    const turn = currentMessageTurn.current;
    if (!scroller) return;

    // CSS keeps a short turn at least one viewport tall throughout layout,
    // including when the responding status disappears before layout effects run.
    const updateTurnHeight = () => {
      if (!turn) return;
      const style = getComputedStyle(scroller);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      turn.style.minHeight = `${Math.max(0, scroller.clientHeight - padding)}px`;
    };
    updateTurnHeight();
    if (latestUserMessageId !== lastSentMessageId.current && latestUserMessage.current) {
      const paddingTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      scroller.scrollTop += latestUserMessage.current.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top - scroller.clientTop - paddingTop;
    }
    lastSentMessageId.current = latestUserMessageId;

    // Natural content growth needs no measurements. Only viewport resizing
    // updates the minimum height, without re-positioning the reader.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateTurnHeight);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [messages, activeTurnId, latestUserMessageId]);
  const renderedMessages = messages.map((message, messageIndex) => {
        const messageQuiz = learningQuestionArtifacts([message]).quiz;
        const quizState = messageQuiz ? quizSession(messages, messageQuiz.quizId) : undefined;
        const action = message.role === 'user' ? quizAction(message.text) : undefined;
        const actionState = action ? quizSession(messages, action.quizId) : undefined;
        const questionId = message.text.split('\n').find(line => line.startsWith('Question ID: '))?.slice(13);
        const questionNumber = actionState?.quiz.questions.find(q => q.id === questionId)?.number;
        const readableAction = actionState?.quiz.version === 2 && action
          ? action.kind === 'hint' ? `已要求第 ${questionNumber ?? ''} 題提示 · ${actionState.quiz.title}`
          : action.kind === 'guide' ? `開始錯題引導學習 · ${actionState.quiz.title}`
          : `已提交小考作答 · ${actionState.quiz.title}` : undefined;
        const previousUser = messages.slice(0, messageIndex).findLast(m => m.role === 'user');
        const previousAction = previousUser ? quizAction(previousUser.text) : undefined;
        const messageRetelling = selfRetellingArtifacts([message]).task;
        const currentRetelling = messageRetelling?.practiceId === selfRetelling.task?.practiceId;
        const messageReadingNote = readingNoteArtifacts([message]).drafts[0];
        const messageNoteSource = previousUser?.readingSource ?? source;
        const savedReadingNote = messageReadingNote
          ? readingNotes.saved.find(({ draftId }) => draftId === messageReadingNote.draftId)
          : undefined;
        const assistantText = message.role === "assistant"
          ? stripReadingNoteArtifacts(
              stripSelfRetellingArtifacts(
                stripLearningQuestionArtifacts(stripNoteUpdateArtifacts(stripReadingSuggestion(message.text)))
              )
            )
          : "";
        const displayedAssistantText = assistantText ||
          (message.role === "assistant" && !message.text.trim() ? "…" : "");
        return (
        <article
          className={`message ${message.role}`}
          key={message.id}
          ref={message.id === latestUserMessageId ? latestUserMessage : undefined}
          data-quiz-id={messageQuiz?.quizId}
          aria-label={message.role === "user" ? "Your message" : "AI Tutor response"}
        >
          {message.role === "assistant" ? (
            displayedAssistantText ? (
              <div className="message-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[[rehypeKatex, {
                    strict: false,
                    throwOnError: false,
                    trust: false
                  }]]}
                >
                  {normalizeBackslashMathDelimiters(displayedAssistantText)}
                </ReactMarkdown>
              </div>
            ) : null
          ) : (
            <div className="user-message-content">
              {message.quote ? (
                <details className="message-quote">
                  <summary>引用原文</summary>
                  <blockquote>{message.quote.text}</blockquote>
                </details>
              ) : null}
              {message.noteReferences?.length && notesApi ? <NoteReferenceHistory references={message.noteReferences} api={notesApi} onOpen={onOpenReferencedNote} /> : null}
              {readableAction ? <p>{readableAction}</p> : message.intent === "readingCoach" ? (
                <details className="reading-coach-instructions">
                  <summary>AI 深度閱讀與理解教練 · 查看完整指令</summary>
                  <pre>{message.text || readingCoachPrompt}</pre>
                </details>
              ) : <p>{message.text || "…"}</p>}
              {message.images?.length ? <div className="message-images">
                {message.images.map((image, index) => <img key={index} src={image.dataUrl} alt={`貼上的圖片 ${index + 1}`} />)}
              </div> : null}
            </div>
          )}
          {message.noteUpdateError ? <p className="error" role="alert">{message.noteUpdateError}</p> : null}
          {message.status === "completed" && notesApi ? message.noteUpdates?.map(proposal => <NoteUpdateCard key={proposal.id} proposal={proposal} api={notesApi} onDecide={onDecideNoteUpdate} disabled={Boolean(activeTurnId)} />) : null}
          {messageQuiz ? (
            <LearningQuestionCard
              open={expandedLearningQuestionQuizId === messageQuiz.quizId}
              quiz={messageQuiz}
              grade={quizState?.grade}
              disabled={Boolean(activeTurnId) || actionsDisabled}
              hinted={quizState?.hinted}
              afterCoaching={quizState?.afterCoaching}
              source={quizState?.source}
              onHint={onSubmitLearningQuestion}
              onGuide={onSubmitLearningQuestion}
              initialAnswers={learningQuestionSubmissionAnswers(messages, messageQuiz)}
              onOpen={() => setExpandedLearningQuestionQuizId(messageQuiz.quizId)}
              onClose={() => setExpandedLearningQuestionQuizId(undefined)}
              onSubmit={onSubmitLearningQuestion}
            />
          ) : null}
          {message.role === 'assistant' && previousAction?.kind === 'hint' ? <button type="button" className="quiz-return-button" onClick={() => {
            setExpandedLearningQuestionQuizId(previousAction.quizId);
            requestAnimationFrame(() => {
              const target = [...(messageScroller.current?.querySelectorAll<HTMLElement>('[data-quiz-id]') ?? [])].find(node => node.dataset.quizId === previousAction.quizId);
              target?.scrollIntoView?.({block:'start', behavior:'smooth'});
              const questionId = previousUser?.text.split('\n').find(line => line.startsWith('Question ID: '))?.slice(13);
              const number = quizSession(messages, previousAction.quizId)?.quiz.questions.find(q => q.id === questionId)?.number;
              target?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="第 ${number} 題答案"]`)?.focus({preventScroll:true});
            });
          }}>返回小考作答</button> : null}
          {currentRetelling && messageRetelling ? (
            <SelfRetellingCard
              open={expandedSelfRetellingId === messageRetelling.practiceId}
              task={messageRetelling}
              grades={selfRetelling.grades}
              initialAnswers={selfRetellingAnswers(messages, messageRetelling.practiceId)}
              onOpen={() => setExpandedSelfRetellingId(messageRetelling.practiceId)}
              onClose={() => setExpandedSelfRetellingId(undefined)}
              onSubmit={onSubmitSelfRetelling}
            />
          ) : null}
          {messageReadingNote && message.status === "completed" && messageNoteSource?.bookTitle && messageNoteSource.chapterTitle ? (
            <ReadingNoteCard
              open={!chatApi && expandedReadingNoteId === messageReadingNote.draftId}
              draft={messageReadingNote}
              saved={savedReadingNote}
              sourceImages={bookImagesForDraft(messages, messageIndex)}
              source={{ bookTitle: messageNoteSource.bookTitle, chapterTitle: messageNoteSource.chapterTitle }}
              onOpen={() => {
                if (savedReadingNote && notesApi && onOpenReferencedNote) {
                  void notesApi.get(savedReadingNote.note.id).then(note => { if (note) onOpenReferencedNote(note); });
                } else setExpandedReadingNoteId(messageReadingNote.draftId);
              }}
              onClose={() => setExpandedReadingNoteId(undefined)}
              onSubmit={onSubmitReadingNote}
            />
          ) : null}
        </article>
        );
      });
  const responding = activeTurnId ? (
    <div className="responding" role="status">
      <span aria-hidden="true" />
      <strong>Codex is responding…</strong>
    </div>
  ) : null;
  // Stable turn containers preserve card state and expanded quotes on the next send.
  const messageTurns: { id: string; start: number; end: number }[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user" || !messageTurns.length) {
      messageTurns.push({ id: message.id, start: index, end: index + 1 });
    } else {
      messageTurns[messageTurns.length - 1]!.end = index + 1;
    }
  });
  return (
    <div className="messages" aria-live="polite" ref={messageScroller}>
      {expandedReadingNoteId && notesApi && chatApi ? createPortal(<ConversationReadingNoteCanvas key={expandedReadingNoteId}
        draftId={expandedReadingNoteId} api={notesApi} chat={chatApi}
        onClose={() => setExpandedReadingNoteId(undefined)} onSaved={note => { onNoteCreated?.(note); }} />, document.querySelector(".reader-panel") ?? document.body) : null}
      <div className={`message-content${messages.length ? "" : " is-empty"}`}>
        {!messages.length ? (
          <div className="chat-empty">
            <span>✦</span>
            <strong>Ask to understand</strong>
            <p>Try “What is the author’s central claim?” or “Explain the reasoning in this passage.”</p>
          </div>
        ) : null}
        {messageTurns.map((turn, index) => {
          const isCurrent = turn.start === latestUserMessageIndex;
          return (
            <div key={turn.id}
              className={`message-turn${isCurrent ? " message-current-turn" : ""}`}
              ref={isCurrent ? currentMessageTurn : undefined}
              style={{ minHeight: isCurrent ? undefined : 0 }}>
              {renderedMessages.slice(turn.start, turn.end)}
              {index === messageTurns.length - 1 ? responding : null}
            </div>
          );
        })}
        {!messages.length ? responding : null}
      </div>
    </div>
  );
}

export function ReadingContextNotice({
  hasRange,
  hasMessages
}: {
  hasRange: boolean;
  hasMessages: boolean;
}) {
  if (hasMessages) return null;
  return (
    <div className="range-notice">
      <span>AI context</span>
      <strong>{hasRange ? "START → END only" : "No book passage"}</strong>
      <small>Each question includes only the current marked segment.</small>
    </div>
  );
}

export function ReadingSegmentShortcutBar({
  disabled,
  onGenerateGuide,
  onStartReadingCoach,
  onStartLearningQuestionQuiz,
  onStartSelfRetelling,
  onCreateReadingNote,
  onConceptVideo
}: {
  disabled: boolean;
  onGenerateGuide(): void;
  onStartReadingCoach?(): void;
  /** Deprecated compatibility prop; no Explain button is rendered. */
  onExplainReadingSegment?(): void;
  onStartLearningQuestionQuiz(): void;
  onStartSelfRetelling(): void;
  onCreateReadingNote(): void;
  onConceptVideo?(): void;
}) {
  return (
    <div
      className="chat-preset-bar reader-chat-preset-bar"
      role="toolbar"
      aria-label="閱讀區段快捷功能"
    >
      <button
        className="annotation-analysis-preset reading-guide-preset"
        type="button"
        aria-label="Reading Guide"
        data-tooltip="Reading Guide"
        onClick={onGenerateGuide}
        disabled={disabled}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M2.75 3.25c2.55 0 4.55.8 6.25 2.35v9.15c-1.7-1.4-3.7-2.1-6.25-2.1v-9.4Z" />
          <path d="M15.25 3.25c-2.55 0-4.55.8-6.25 2.35v9.15c1.7-1.4 3.7-2.1 6.25-2.1v-9.4Z" />
        </svg>
        <span>Reading Guide</span>
      </button>
      <button
        className="annotation-analysis-preset detailed-segment-preset"
        type="button"
        aria-label="Guided Learning"
        data-tooltip="Understand this passage step by step"
        onClick={onStartReadingCoach}
        disabled={disabled}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M9 2.25l1.15 3.6L13.75 7l-3.6 1.15L9 11.75 7.85 8.15 4.25 7l3.6-1.15L9 2.25Z" />
          <path d="M14.25 11.25l.55 1.7 1.7.55-1.7.55-.55 1.7-.55-1.7-1.7-.55 1.7-.55.55-1.7Z" />
        </svg>
        <span>Guided Learning</span>
      </button>
      <button
        className="annotation-analysis-preset learning-question-preset"
        type="button"
        aria-label="Take a Quiz"
        data-tooltip="Answer independently, then review your understanding"
        onClick={onStartLearningQuestionQuiz}
        disabled={disabled}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M3.25 2.75h11.5v12.5H3.25z" />
          <path d="m5.25 6 1 1 1.5-1.75M9.25 6.25h3.25M5.25 10.75l1 1 1.5-1.75M9.25 11h3.25" />
        </svg>
        <span>Take a Quiz</span>
      </button>
      <button
        className="annotation-analysis-preset self-retelling-preset"
        type="button"
        aria-label="Retell"
        data-tooltip="Explain the passage in your own words"
        onClick={onStartSelfRetelling}
        disabled={disabled}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M2.75 3.25h9v6.5H6.5l-3.75 2.5v-9Z" />
          <path d="M7.25 11.5h4.25l3.75 2.5V7.5H13.5" />
          <path d="M5.25 5.75h4M5.25 7.5h2.5" />
        </svg>
        <span>Retell</span>
      </button>
      <button
        className="annotation-analysis-preset concept-video-preset"
        type="button"
        aria-label="Create Video"
        data-tooltip="Create Video"
        onClick={onConceptVideo}
      ><svg aria-hidden="true" viewBox="0 0 18 18"><path d="M2 3h10v12H2zM12 7l4-3v10l-4-3M5 6l4 3-4 3z" /></svg><span>Create Video</span></button>
      <button
        className="annotation-analysis-preset reading-note-preset"
        type="button"
        aria-label="Create Note"
        data-tooltip="Create Note"
        onClick={onCreateReadingNote}
        disabled={disabled}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M3.75 2.75h7L14.25 6v9.25H3.75z" />
          <path d="M10.75 2.75V6h3.5M6 8.5h6M9 10.75v3M7.5 12.25h3" />
        </svg>
        <span>Create Note</span>
      </button>

    </div>
  );
}

function pinnedBookPosition(book: LibraryBook): number {
  if (book.shelfStatus === "finished") return 1;
  const { chapterId, scrollProgress } = book.readingState;
  const chapters = readingChapters(book);
  const index = chapters.findIndex(chapter => chapter.id === readingChapterId(book, chapterId ?? book.lastChapterId));
  return index < 0 ? 0 : (index + (chapterId ? scrollProgress : 0)) / chapters.length;
}

export function BookShelf({
  books,
  selectedBookId,
  onSelect,
  onCollapse,
  mode = "books",
  reviewCount,
  reviewEnabled = false,
  onModeChange
}: {
  books: LibraryBook[];
  selectedBookId?: string;
  onSelect(book: LibraryBook): void;
  onCollapse?(): void;
  mode?: AppPage;
  reviewCount?: number;
  reviewEnabled?: boolean;
  onModeChange?(mode: AppPage): void;
}) {
  const pinned = books.filter(book => book.pinned);
  return (
    <section className="book-library" aria-label="Book library">
      <header className="book-library-heading">
        <h2>Library</h2>
        {onCollapse && <button type="button" className="sidebar-toggle" aria-label="Collapse library" onClick={onCollapse}><PanelToggleIcon edge="right" /></button>}
      </header>
      <nav className="book-library-navigation" aria-label="Library pages">
        <button type="button" className={`reading-note-library-navigation${mode === "bookshelf" ? " active" : ""}`}
          aria-current={mode === "bookshelf" ? "page" : undefined} onClick={() => onModeChange?.("bookshelf")}>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 3h4v13H2zM7 3h3v13H7zm4 1 3-1 4 12-3 1z" /></svg>
          <span>Bookshelf</span>
        </button>
        <button
          className={`reading-note-library-navigation${mode === "reading-notes" ? " active" : ""}`}
          type="button"
          aria-current={mode === "reading-notes" ? "page" : undefined}
          onClick={() => onModeChange?.("reading-notes")}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M3.25 3.75h5.5a2 2 0 0 1 2 2v10.5a2 2 0 0 0-2-2h-5.5z" />
            <path d="M16.75 3.75h-4a2 2 0 0 0-2 2v10.5a2 2 0 0 1 2-2h4z" />
          </svg>
          <span>Notes</span>
        </button>
        {reviewEnabled ? <button type="button"
          className={`reading-note-library-navigation review-navigation${mode === "spaced-review" ? " active" : ""}`}
          aria-current={mode === "spaced-review" ? "page" : undefined}
          onClick={() => onModeChange?.("spaced-review")}>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M16.5 8a6.5 6.5 0 1 0-.5 5M16.5 3.5V8H12M10 6v4l2.5 1.5" /></svg>
          <span>Review</span><strong className="review-nav-count">{reviewCount ?? "—"}</strong>
        </button> : null}
        <button type="button" className={`reading-note-library-navigation${mode === "practice" ? " active" : ""}`} aria-current={mode === "practice" ? "page" : undefined} onClick={() => onModeChange?.("practice")}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6" /></svg><span>Pinned Notes</span></button>
        <button type="button" className={`reading-note-library-navigation${mode === "whiteboards" ? " active" : ""}`} aria-current={mode === "whiteboards" ? "page" : undefined} onClick={() => onModeChange?.("whiteboards")}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 3h16v12H2zM7 15l-2 3m8-3 2 3M5 6h4v4H5zm8 0h2v2h-2zm-2 5h4v2h-4z" /></svg><span>Whiteboards</span></button>
        <button type="button" className={`reading-note-library-navigation video-library-navigation${mode === 'concept-videos' ? ' active' : ''}`} aria-current={mode === 'concept-videos' ? 'page' : undefined} onClick={() => onModeChange?.('concept-videos')}><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 4h12v12H2zM14 8l4-3v10l-4-3M6 7l4 3-4 3z" /></svg><span>Videos</span></button>
      </nav>
      {pinned.length > 0 && <div className="book-library-panel">
        <h2 id="sidebar-pinned-heading" className="pinned-label">Pinned books</h2>
        <nav className="book-list" aria-labelledby="sidebar-pinned-heading">
          {pinned.map(book => (
            <div key={book.id} data-book-id={book.id} className="book-item">
              <button type="button" className="book-item-select" aria-label={book.title} title={book.title}
                aria-pressed={mode === "books" && book.id === selectedBookId} onClick={() => onSelect(book)}>
                <span className="book-item-cover" aria-hidden="true">{book.coverDataUrl
                  ? <img src={book.coverDataUrl} alt="" /> : book.title.slice(0, 1)}</span>
                <span className="pinned-copy">
                  <strong className="pinned-title">{book.title}</strong>
                  <span className="pinned-author" title={book.author}>{book.author}</span>
                  <progress className="pinned-progress" aria-label="Estimated book position" max={1} value={pinnedBookPosition(book)} />
                </span>
              </button>
            </div>
          ))}
        </nav>
      </div>}
    </section>
  );
}

export function BookOverview({
  book,
  memoryImageTemplates,
  onContinue,
  onDelete,
  onOpenChapter
}: {
  book: LibraryBook;
  memoryImageTemplates?: NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>["templates"];
  onContinue(): void;
  onDelete(): void;
  onOpenChapter(chapterId: string): void;
}) {
  const chapters = readingChapters(book);
  const lastReadId = readingChapterId(book, book.lastChapterId);
  let chapterNumber = 0;
  const markedChapterCount = Object.keys(book.chapterRanges).length;
  const hasReadingProgress = book.chapters.some(({ id }) => id === book.lastChapterId);
  return (
    <section className="book-overview" aria-labelledby="book-overview-title">
      <div className="overview-hero">
        <div className="overview-cover">
          {book.coverDataUrl
            ? <img src={book.coverDataUrl} alt={`${book.title} cover`} />
            : <span>Aa</span>}
        </div>
        <div className="overview-details">
          <span className="eyebrow">Book overview</span>
          <h1 id="book-overview-title">{book.title}</h1>
          <p className="book-author">{book.author}</p>
          <div className="book-facts">
            <span>{chapters.length} chapters</span>
            <span>{markedChapterCount} AI {markedChapterCount === 1 ? "range" : "ranges"} saved</span>
          </div>
          <div className="overview-actions">
            <button className="primary-action" type="button" onClick={onContinue}>
              {hasReadingProgress ? "Continue reading" : "Start reading"}
            </button>
            <button className="delete-book-button" type="button" onClick={onDelete}>
              Delete book
            </button>
          </div>
        </div>
      </div>
      {memoryImageTemplates ? <BookMemoryImageSettings key={book.id} api={memoryImageTemplates} bookTitle={book.title} /> : null}
      <div className="chapter-list">
        <div>
          <span className="eyebrow">Contents</span>
          <h2>Chapters</h2>
        </div>
        <ol>
          {chapters.map((item) => {
            const depth = Math.max(0, item.depth ?? 0);
            if (depth === 0) chapterNumber++;
            const isLastRead = item.id === lastReadId;
            return (
              <li
                className={[depth > 0 ? "subchapter" : "", isLastRead ? "last-read-chapter" : ""].filter(Boolean).join(" ") || undefined}
                data-depth={depth}
                style={{ "--chapter-depth": depth } as CSSProperties}
                key={item.id}
              >
                <button type="button" aria-current={isLastRead ? "location" : undefined} onClick={() => onOpenChapter(item.id)}>
                  <span className="chapter-marker">
                    {depth > 0 ? null : String(chapterNumber).padStart(2, "0")}
                  </span>
                  <span className="chapter-title">
                    {depth > 0 ? <small>Section</small> : null}
                    <strong>{item.title}</strong>
                  </span>
                  <em>
                    <span>{isLastRead ? "Last read" : depth > 0 ? "Read section" : "Open chapter"}</span>
                    <b aria-hidden="true">→</b>
                  </em>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export function resumeChapterId(book: LibraryBook): string | undefined {
  return readingChapterId(book, book.lastChapterId) ?? readingChapters(book)[0]?.id;
}

export interface BookNavigationState {
  selectedBookId?: string;
  activeChapterId?: string;
  view: "overview" | "reader";
}

type AppPage = "bookshelf" | "books" | "reading-notes" | "spaced-review" | "whiteboards" | "practice" | "concept-videos";

interface AppLocation {
  mode: AppPage;
  bookId?: string;
  whiteboardId?: string;
}

const APP_LOCATION_KEY = "deep-reader-last-location";
const CHAT_MODEL_KEY = "deep-reader-last-chat-model";
const READ_IMAGES_KEY = "deep-reader-read-book-images";

function loadReadImages(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(READ_IMAGES_KEY) !== "false";
  } catch {
    return true;
  }
}

function loadChatModel(): CodexChatModel {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(CHAT_MODEL_KEY);
      if (isCodexChatModel(saved)) return saved;
    } catch {
      // The model selector remains usable if renderer storage is unavailable.
    }
  }
  return "gpt-5.6-sol";
}

function loadAppLocation(): AppLocation | undefined {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(APP_LOCATION_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return undefined;
    const value = saved as Record<string, unknown>;
    if (value.mode !== "bookshelf" && value.mode !== "books" && value.mode !== "reading-notes" &&
        value.mode !== "spaced-review" && value.mode !== "whiteboards" && value.mode !== "practice" && value.mode !== 'concept-videos') return undefined;
    return {
      mode: value.mode,
      ...(typeof value.bookId === "string" && value.bookId.trim() ? { bookId: value.bookId } : {}),
      ...(typeof value.whiteboardId === "string" && value.whiteboardId.trim() ? { whiteboardId: value.whiteboardId } : {})
    };
  } catch {
    return undefined;
  }
}

export function navigationAfterBookSelection(
  current: BookNavigationState,
  selectedBook: LibraryBook
): BookNavigationState {
  if (current.selectedBookId === selectedBook.id) return current;
  const state = selectedBook.readingState;
  const activeChapterId = state.view === "reader" && state.chapterId &&
    selectedBook.chapters.some(({ id }) => id === state.chapterId)
    ? readingChapterId(selectedBook, state.chapterId)
    : undefined;
  return {
    selectedBookId: selectedBook.id,
    activeChapterId,
    view: activeChapterId ? "reader" : "overview"
  };
}

export function scrollProgressForReader(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const maximum = scrollHeight - clientHeight;
  return maximum > 0 && Number.isFinite(scrollTop)
    ? Math.min(1, Math.max(0, scrollTop / maximum))
    : 0;
}

export function scrollTopForReadingProgress(
  progress: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  const normalized = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return maximum * normalized;
}

export function nextBookIdAfterDeletion(
  books: LibraryBook[],
  deletedBookId: string
): string | undefined {
  const deletedIndex = books.findIndex(({ id }) => id === deletedBookId);
  if (deletedIndex < 0) return undefined;
  const remaining = books.filter(({ id }) => id !== deletedBookId);
  return remaining[deletedIndex]?.id ?? remaining[deletedIndex - 1]?.id;
}

export function DeleteBookDialog({
  book,
  pending,
  onCancel,
  onConfirm
}: {
  book: LibraryBook;
  pending: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div className="dialog-backdrop">
      <section
        className="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        <span className="delete-dialog-icon" aria-hidden="true">!</span>
        <h2 id="delete-dialog-title">Delete book?</h2>
        <p>
          “{book.title}”, its local EPUB, reading ranges, and annotations will be
          permanently deleted. This action cannot be undone.
        </p>
        <div className="delete-dialog-actions">
          <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className="danger-action" type="button" onClick={onConfirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReaderToolbar({
  chapterTitle,
  noteCount,
  notesOpen = false,
  onOpenNotes,
  layout,
  layoutOpen,
  hasPreviousChapter,
  hasNextChapter,
  onBack,
  onToggleLayout,
  onCloseLayout,
  onChangeLayout,
  onResetLayout,
  onPreviousChapter,
  onNextChapter
}: {
  chapterTitle: string;
  noteCount?: number;
  notesOpen?: boolean;
  onOpenNotes?(): void;
  layout: ReadingLayout;
  layoutOpen: boolean;
  hasPreviousChapter: boolean;
  hasNextChapter: boolean;
  onBack(): void;
  onToggleLayout(): void;
  onCloseLayout(): void;
  onChangeLayout(next: ReadingLayout): void;
  onResetLayout(): void;
  onPreviousChapter(): void;
  onNextChapter(): void;
}) {
  return (
    <header className="reader-toolbar reading-toolbar">
      <div className="reader-toolbar-inner">
        <button className="reader-back-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to overview
        </button>
        <div className="reader-toolbar-context">
          <span>Reading</span>
          <strong title={chapterTitle}>{chapterTitle}</strong>
        </div>
        <div className="reader-toolbar-actions">
          {onOpenNotes ? <button className="reader-notes-entry" type="button"
            aria-label={noteCount === undefined ? "Notes" : `Notes ${noteCount}`}
            aria-expanded={notesOpen} aria-controls="reader-notes-tabpanel" onClick={onOpenNotes}>
            Notes{noteCount !== undefined ? <span>{noteCount}</span> : null}
          </button> : null}
          <div className="reading-layout-anchor">
            <button
              className="reading-layout-button"
              type="button"
              aria-label="Reading layout"
              aria-controls="reading-layout-panel"
              aria-expanded={layoutOpen}
              onClick={onToggleLayout}
            >
              Aa
            </button>
            {layoutOpen ? (
              <section
                id="reading-layout-panel"
                className="reading-layout-panel"
                role="dialog"
                aria-label="Reading layout"
              >
                <div className="reading-layout-heading">
                  <div>
                    <span>Reading layout</span>
                    <strong>Text settings</strong>
                  </div>
                  <button type="button" aria-label="Close reading layout" onClick={onCloseLayout}>×</button>
                </div>
                <label className="reading-layout-control">
                  <span><b>Text size</b><output>{layout.fontSize}px</output></span>
                  <input
                    type="range"
                    min="15"
                    max="28"
                    step="1"
                    value={layout.fontSize}
                    onChange={(event) => onChangeLayout({
                      ...layout,
                      fontSize: Number(event.target.value)
                    })}
                  />
                </label>
                <label className="reading-layout-control">
                  <span><b>Line spacing</b><output>{layout.lineHeight.toFixed(1)}×</output></span>
                  <input
                    type="range"
                    min="1.5"
                    max="2.5"
                    step="0.1"
                    value={layout.lineHeight}
                    onChange={(event) => onChangeLayout({
                      ...layout,
                      lineHeight: Number(event.target.value)
                    })}
                  />
                </label>
                <label className="reading-layout-control">
                  <span><b>Page width</b><output>{layout.paperWidth}px</output></span>
                  <input
                    type="range"
                    min="560"
                    max="920"
                    step="20"
                    value={layout.paperWidth}
                    onChange={(event) => onChangeLayout({
                      ...layout,
                      paperWidth: Number(event.target.value)
                    })}
                  />
                </label>
                <button className="reading-layout-reset" type="button" onClick={onResetLayout}>
                  Restore defaults
                </button>
              </section>
            ) : null}
          </div>
          <div className="chapter-navigation" role="group" aria-label="Chapter navigation">
            <button type="button" onClick={onPreviousChapter} disabled={!hasPreviousChapter}>
              <span aria-hidden="true">‹</span> Previous chapter
            </button>
            <button type="button" onClick={onNextChapter} disabled={!hasNextChapter}>
              Next chapter <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export function AnnotationTool({
  activeColor,
  count,
  onSelectColor
}: {
  activeColor: AnnotationColor | null;
  count: number;
  onSelectColor(color: AnnotationColor | null): void;
}) {
  return (
    <div
      className="annotation-tool"
      role="group"
      aria-label={`Annotation colors; ${count} annotations in this chapter`}
    >
      <span className="annotation-tool-icon" aria-hidden="true">✎</span>
      {ANNOTATION_COLORS.map((color) => {
        const active = activeColor === color;
        return (
          <button
            className={`annotation-color-button annotation-color-${color}${active ? " active" : ""}`}
            key={color}
            type="button"
            aria-label={active ? `Turn off ${color} annotation mode` : `Use ${color} annotation`}
            aria-pressed={active}
            onClick={() => onSelectColor(active ? null : color)}
          >
            <span aria-hidden="true" />
          </button>
        );
      })}
      {count ? <em>{count}</em> : null}
    </div>
  );
}

export function AccountSettings({
  snapshot,
  memoryImageTemplates,
  review,
  initialTab = "account",
  onReconnect,
  onClose
}: {
  snapshot: ChatSnapshot;
  review?: ReaderDesktopApi["readingNotes"]["review"];
  initialTab?: "account" | "memory-images" | "review";
  memoryImageTemplates?: NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>["templates"];
  onReconnect(): void;
  onClose(): void;
}) {
  const connected = snapshot.connection === "ready";
  const [activeTab, setActiveTab] = useState<"account" | "memory-images" | "review">(initialTab);
  const accountTabRef = useRef<HTMLButtonElement>(null);
  const memoryImagesTabRef = useRef<HTMLButtonElement>(null);

  const reviewTabRef = useRef<HTMLButtonElement>(null);

  function selectTab(tab: "account" | "memory-images" | "review", focus = false) {
    setActiveTab(tab);
    if (focus) {
      (tab === "account" ? accountTabRef : tab === "review" ? reviewTabRef : memoryImagesTabRef).current?.focus();
    }
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const tabs: ("account" | "memory-images" | "review")[] = ["account", ...(memoryImageTemplates ? ["memory-images" as const] : []), ...(review ? ["review" as const] : [])];
    let nextTab: typeof tabs[number] | undefined;
    if (event.key === "Home") nextTab = tabs[0];
    if (event.key === "End") nextTab = tabs.at(-1);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextTab = tabs[(tabs.indexOf(activeTab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    }
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab, true);
  }

  return (
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header>
        <div>
          <span>Settings</span>
          <h2 id="settings-title">Settings</h2>
        </div>
        <button type="button" aria-label="Close settings" onClick={onClose}>×</button>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="horizontal">
        <button
          ref={accountTabRef}
          role="tab"
          id="settings-tab-account"
          type="button"
          aria-selected={activeTab === "account"}
          aria-controls="settings-panel-account"
          tabIndex={activeTab === "account" ? 0 : -1}
          onClick={() => selectTab("account")}
          onKeyDown={handleTabKeyDown}
        >Account</button>
        {memoryImageTemplates ? (
          <button
            ref={memoryImagesTabRef}
            role="tab"
            id="settings-tab-memory-images"
            type="button"
            aria-selected={activeTab === "memory-images"}
            aria-controls="settings-panel-memory-images"
            tabIndex={activeTab === "memory-images" ? 0 : -1}
            onClick={() => selectTab("memory-images")}
            onKeyDown={handleTabKeyDown}
          >Memory Images</button>
        ) : null}
        {review ? <button ref={reviewTabRef} role="tab" id="settings-tab-review" type="button"
          aria-selected={activeTab === "review"} aria-controls="settings-panel-review" tabIndex={activeTab === "review" ? 0 : -1}
          onClick={() => selectTab("review")} onKeyDown={handleTabKeyDown}>Spaced Review</button> : null}
      </nav>
      <div className="settings-content">
        {review ? <section className="settings-panel" role="tabpanel" id="settings-panel-review"
          aria-labelledby="settings-tab-review" hidden={activeTab !== "review"}>
          <ReviewSettings api={review} />
        </section> : null}
        <section
          className="settings-panel settings-panel-account"
          role="tabpanel"
          id="settings-panel-account"
          aria-labelledby="settings-tab-account"
          hidden={activeTab !== "account"}
        >
          <div className="account-settings-section">
            <h3 id="account-settings-heading">Account</h3>
            <div className="account-card">
              <div className="account-avatar" aria-hidden="true">
                {snapshot.account?.email?.slice(0, 1).toUpperCase() ?? "C"}
              </div>
              <div className="account-identity">
                <span className={`account-state ${snapshot.connection}`}>
                  {connected ? "Connected" : snapshot.connection.replace("-", " ")}
                </span>
                <strong>{snapshot.account?.email ?? "No Codex account connected"}</strong>
                <small>{snapshot.account?.type ?? snapshot.connectionDetail}</small>
              </div>
            </div>
            <p className="account-detail">{snapshot.connectionDetail}</p>
            <button
              className="reconnect-button"
              type="button"
              onClick={onReconnect}
              disabled={snapshot.connection === "connecting"}
            >
              {snapshot.connection === "connecting" ? "Connecting…" : "Reconnect Codex"}
            </button>
          </div>
        </section>
        {memoryImageTemplates ? (
          <section
            className="settings-panel settings-panel-memory-images"
            role="tabpanel"
            id="settings-panel-memory-images"
            aria-labelledby="settings-tab-memory-images"
            hidden={activeTab !== "memory-images"}
          >
            <MemoryImageSettings api={memoryImageTemplates} />
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function App() {
  const [savedLocation] = useState(loadAppLocation);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | undefined>(savedLocation?.bookId);
  const [activeChapterId, setActiveChapterId] = useState<string>();
  const [view, setView] = useState<"overview" | "reader">("overview");
  const whiteboardLeave = useRef<((next: () => void) => void) | undefined>(undefined);
  const [selectedWhiteboardId, setSelectedWhiteboardId] = useState<string | undefined>(savedLocation?.whiteboardId);
  const [libraryMode, setLibraryModeRaw] = useState<AppPage>(savedLocation?.mode ?? "books");
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  function setLibraryMode(mode: typeof libraryMode) {
    const next = () => setLibraryModeRaw(mode);
    if (libraryMode === "whiteboards" && mode !== "whiteboards" && whiteboardLeave.current) whiteboardLeave.current(next);
    else next();
  }
  const reviewApi = typeof window === "undefined" ? undefined : window.readerExample?.readingNotes?.review;
  const reviewSummary = useReviewSummary(reviewApi);
  const [chapter, setChapter] = useState<ChapterContent>();
  const [range, setRange] = useState<ReadingRange>();
  const [markerTops, setMarkerTops] = useState({ start: 0, end: 0 });
  const [chat, setChat] = useState(emptyChat);
  const [draft, setDraft] = useState("");
  const [nextInputSuggestion, setNextInputSuggestion] = useState<{ scope: string; userId?: string; text: string }>();
  const [followUpSuggestion, setFollowUpSuggestion] = useState<{ scope: string; text: string }>();
  const [dismissedSuggestion, setDismissedSuggestion] = useState("");
  const [draftNoteReferences, setDraftNoteReferences] = useState<ReadingNoteSummary[]>([]);
  const [sendingQuestion, setSendingQuestion] = useState(false);
  const [draftImages, setDraftImages] = useState<Array<{ dataUrl: string }>>([]);
  const draftImageEpoch = useRef(0);
  const [readImages, setReadImages] = useState(loadReadImages);
  const [selectedChatModel, setChatModel] = useState<CodexChatModel>(loadChatModel);
  const chatModels = chat.models ?? CODEX_CHAT_MODELS;
  const chatModel = availableChatModel(chatModels, selectedChatModel);
  const [libraryError, setLibraryError] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatView, setChatView] = useState<"conversation" | "history">("conversation");
  const [conversationActionPending, setConversationActionPending] = useState(false);
  const [copiedConversationId, setCopiedConversationId] = useState<string | null>(null);
  useEffect(() => { setCopiedConversationId(null); }, [chat.activeConversationId, chat.messages]);
  const previousConversationId = useRef(chat.activeConversationId);
  useEffect(() => {
    if (previousConversationId.current !== chat.activeConversationId && previousConversationId.current !== null) setDraftNoteReferences([]);
    previousConversationId.current = chat.activeConversationId;
  }, [chat.activeConversationId]);
  const [importing, setImporting] = useState(false);
  const [bookPendingDeletionId, setBookPendingDeletionId] = useState<string>();
  const [deletingBook, setDeletingBook] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"account" | "review">("account");
  const [readingNoteDraftSource, setReadingNoteDraftSource] = useState<{
    bookId: string;
    chapterId: string;
    bookTitle: string;
    chapterTitle: string;
    readingSegment: string;
    images?: { dataUrl: string }[];
  }>();
  const [readingLayoutOpen, setReadingLayoutOpen] = useState(false);
  const [readingLayout, setReadingLayout] = useState<ReadingLayout>(loadReadingLayout);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeAnnotationColor, setActiveAnnotationColor] = useState<AnnotationColor | null>(null);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [rightPanel, setRightPanel] = useState<"chat" | "notes" | "videos">("chat");
  const [videoPanelOpen, setVideoPanelOpen] = useState(false);
  const [videoSessions, setVideoSessions] = useState<{ key: string; source?: ConceptVideoSource; video?: ConceptVideo; previewId?: string }[]>([]);
  const [selectedVideoSession, setSelectedVideoSession] = useState<string>();
  const [videoLibraryRevision, setVideoLibraryRevision] = useState(0);
  const [videoSourceJump, setVideoSourceJump] = useState<ConceptVideoSource>();
  const videoActivity = useConceptVideoActivity(typeof window === 'undefined' ? undefined : window.readerExample?.conceptVideos);
  const videoApi = videoActivity.api;
  const [selectedReaderNoteId, setSelectedReaderNoteId] = useState<string>();
  const [completedReaderNote, setCompletedReaderNote] = useState<{ note: ReadingNote; side: MemoryImageSide; requestId: number }>();
  const [readerNoteEditorView, setReaderNoteEditorView] = useState<"note" | "visual">("note");
  const [editingReaderNote, setEditingReaderNote] = useState<ReadingNote>();
  const [readerNoteTrashConfirming, setReaderNoteTrashConfirming] = useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(loadChatPanelWidth);
  const [chatResizing, setChatResizing] = useState(false);
  const [rangeContextMenu, setRangeContextMenu] = useState<{
    x: number;
    y: number;
    startOffset: number;
    endOffset: number;
    annotationId?: string;
    selection?: Omit<Annotation, "id">;
    selectionValid?: boolean;
  }>();
  const articleRef = useRef<HTMLElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<ReadingRange | undefined>(undefined);
  const segmentStructureRef = useRef<{
    chapter: ChapterContent;
    index: ReadingStructure;
    preference?: ReadingPreference;
  } | undefined>(undefined);
  const annotationCounterRef = useRef(0);
  const lastProvidedReadingSegmentRef = useRef<string | undefined>(undefined);
  const readingStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinRequestVersionRef = useRef(new Map<string, number>());

  const selectedBook = useMemo(
    () => books.find(({ id }) => id === selectedBookId),
    [books, selectedBookId]
  );
  const bookPendingDeletion = books.find(({ id }) => id === bookPendingDeletionId);
  const activeChapter = selectedBook?.chapters.find(({ id }) => id === activeChapterId);
  const voice = useReadingVoice(typeof window === "undefined" ? undefined : window.readerExample?.chat.voice, chat.voice,
    [selectedBookId, activeChapterId, range?.start, range?.end, view, libraryMode, rightPanel, chatCollapsed, chatView].join("|"));
  const inputSuggestionScope = JSON.stringify([selectedBookId, activeChapterId, range?.start, range?.end, chat.activeConversationId]);
  const latestInputUserId = chat.messages.findLast(m => m.role === "user")?.id;
  useEffect(() => {
    const article = articleRef.current;
    if (!chat.messages.length || chat.activeTurnId || !article || !range || !selectedBook || !activeChapter) {
      setFollowUpSuggestion(undefined);
      return;
    }
    const context = readingSegmentContextForArticle(article, range, readImages);
    const text = readingSuggestions(chat.messages, {
      bookTitle: selectedBook.title, chapterTitle: activeChapter.title, readingSegment: context.readingSegment
    }).followUp;
    setFollowUpSuggestion(previous => previous?.scope === inputSuggestionScope && previous.text === text
      ? previous : { scope: inputSuggestionScope, text });
  }, [inputSuggestionScope, chat.messages, chat.activeTurnId, chapter, readImages]);
  const proposedInputSuggestion = nextInputSuggestion?.scope === inputSuggestionScope && nextInputSuggestion.userId === latestInputUserId
    ? nextInputSuggestion.text
    : followUpSuggestion?.scope === inputSuggestionScope ? followUpSuggestion.text : "";
  const inputSuggestionKey = JSON.stringify([inputSuggestionScope, latestInputUserId, proposedInputSuggestion]);
  const inputSuggestion = !draft && !draftImages.length && !draftNoteReferences.length && !sendingQuestion && !chat.activeTurnId &&
    !chat.managementBusy && chat.connection === "ready" && !voice.busy && dismissedSuggestion !== inputSuggestionKey
    ? proposedInputSuggestion : "";
  const voiceDisabledReason = !voice.peer ? "請重新啟動軟體以使用語音聊天"
    : view !== "reader" || !range || range.end <= range.start || !selectedBook || !activeChapter ? "請先設定 START／END 閱讀範圍"
    : chat.connection !== "ready" ? "請先連接 Codex"
    : chat.activeTurnId || chat.managementBusy || conversationActionPending ? "請等目前回覆完成" : undefined;

  const readerNoteContext = `${selectedBookId}:${activeChapterId}`;
  const readerNotes = useReaderNotes(typeof window === "undefined" ? undefined : window.readerExample.readingNotes,
    selectedBook?.title, `${readerNoteContext}:${libraryMode}`);
  const notesAvailable = Boolean(completedReaderNote) || libraryMode === "books" && view === "reader" && Boolean(selectedBook && activeChapter);
  const showingNotes = !videoPanelOpen && notesAvailable && rightPanel === "notes";
  const showingVideos = !videoPanelOpen && notesAvailable && rightPanel === "videos";
  const chapterNoteCount = readerNotes.notes.filter((note) => note.chapterTitle === activeChapter?.title).length;
  useEffect(() => {
    setSelectedReaderNoteId(undefined);
    setCompletedReaderNote(undefined);
  }, [readerNoteContext]);

  function openReaderNotes(noteId?: string) {
    setVideoPanelOpen(false);
    setRightPanel("notes");
    setChatCollapsed(false);
    if (noteId) setSelectedReaderNoteId(noteId);
  }
  const { previous: previousChapter, next: nextChapter } = selectedBook
    ? adjacentReadingChapters(selectedBook, activeChapterId)
    : { previous: undefined, next: undefined };
  function videoSourceFromReader(): ConceptVideoSource | undefined {
    if (libraryMode !== 'books' || view !== 'reader' || !selectedBook || !activeChapter || !range || !articleRef.current || chapter?.chapterId !== activeChapter.id || range.end <= range.start) return;
    const visual = readingSegmentContextForArticle(articleRef.current, range, readImages);
    if (!visual.readingSegment.trim()) return;
    return { bookId: selectedBook.id, chapterId: activeChapter.id, bookTitle: selectedBook.title, chapterTitle: activeChapter.title, range: { ...range }, contextRange: visual.contextRange, readingSegment: visual.readingSegment, images: visual.images };
  }
  function openVideoPreparation() {
    const source = videoSourceFromReader(), key = crypto.randomUUID();
    setVideoSessions(sessions => [...sessions, { key, source }]); setSelectedVideoSession(key);
    setVideoPanelOpen(true); setRightPanel('chat'); setChatCollapsed(false);
  }
  function openSavedVideo(video: ConceptVideo, previewId?: string) {
    const existing = videoSessions.find(s => s.video?.id === video.id);
    if (existing) { setSelectedVideoSession(existing.key); setVideoSessions(sessions => sessions.map(s => s.key === existing.key ? { ...s, video, previewId } : s)); }
    else { const key = crypto.randomUUID(); setVideoSessions(sessions => [...sessions, { key, video, previewId }]); setSelectedVideoSession(key); }
    setVideoPanelOpen(true); setRightPanel('chat'); setChatCollapsed(false);
  }
  function openVideoLibrary() { saveCurrentReaderPosition(); setLibraryMode('concept-videos'); }
  function jumpToVideoSource(source: ConceptVideoSource) {
    const book = books.find(b => b.id === source.bookId);
    if (!book?.chapters.some(c => c.id === source.chapterId)) return;
    saveCurrentReaderPosition(); setLibraryMode('books'); setSelectedBookId(book.id); setActiveChapterId(source.chapterId); setView('reader'); setVideoSourceJump(source);
  }
  const rangeBoundariesOverlap = Boolean(range)
    && Math.abs(markerTops.start - markerTops.end) < 28;

  useEffect(() => {
    void window.readerExample.library.listBooks().then((loadedBooks) => {
      setBooks(loadedBooks);
      const firstBook = loadedBooks[0];
      const restoredBook = loadedBooks.find(({ id }) => id === savedLocation?.bookId) ?? firstBook;
      if (restoredBook) {
        const navigation = navigationAfterBookSelection({ view: "overview" }, restoredBook);
        setSelectedBookId(navigation.selectedBookId);
        setActiveChapterId(navigation.activeChapterId);
        setView(navigation.view);
      } else {
        setSelectedBookId(undefined);
      }
    }).catch((reason) =>
      setLibraryError(reason instanceof Error ? reason.message : "Unable to load the library.")
    ).finally(() => setLibraryLoaded(true));
    const unsubscribe = window.readerExample.chat.onStateChanged(setChat);
    void window.readerExample.chat.getState().then(setChat);
    void window.readerExample.chat.connect().then(setChat);
    return () => {
      unsubscribe();
      if (readingStateSaveTimerRef.current) {
        clearTimeout(readingStateSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!libraryLoaded) return;
    try {
      window.localStorage.setItem(APP_LOCATION_KEY, JSON.stringify({
        mode: libraryMode,
        bookId: selectedBookId,
        whiteboardId: selectedWhiteboardId
      } satisfies AppLocation));
    } catch {
      // The app remains usable if renderer storage is unavailable.
    }
  }, [libraryLoaded, libraryMode, selectedBookId, selectedWhiteboardId]);

  useLayoutEffect(() => {
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    window.localStorage.setItem("reader-example-layout", JSON.stringify(readingLayout));
  }, [readingLayout]);

  useEffect(() => {
    window.localStorage.setItem("reader-example-chat-width", String(chatPanelWidth));
  }, [chatPanelWidth]);

  useEffect(() => {
    const fitChatPanelToViewport = () => {
      setChatPanelWidth((current) => chatPanelWidthFromPointer(
        window.innerWidth - current,
        window.innerWidth,
        libraryCollapsed
      ));
    };
    fitChatPanelToViewport();
    window.addEventListener("resize", fitChatPanelToViewport);
    return () => window.removeEventListener("resize", fitChatPanelToViewport);
  }, [libraryCollapsed]);

  useEffect(() => {
    setActiveAnnotationColor(null);
    setAnnotations([]);
    setReadingLayoutOpen(false);
  }, [activeChapterId]);

  useEffect(() => {
    setAnnotations(activeChapterId
      ? selectedBook?.chapterAnnotations[activeChapterId] ?? []
      : []);
  }, [activeChapterId, selectedBook]);

  useEffect(() => {
    if (view !== "reader" || !selectedBookId || !activeChapterId) {
      setChapter(undefined);
      setRange(undefined);
      return;
    }
    let cancelled = false;
    setChapter(undefined);
    setRange(undefined);
    void window.readerExample.library
      .getChapterContent(selectedBookId, activeChapterId)
      .then((content) => {
        if (!cancelled) setChapter(content);
      })
      .catch((reason) => setLibraryError(
        reason instanceof Error ? reason.message : "Unable to load this chapter."
      ));
    return () => {
      cancelled = true;
    };
  }, [view, selectedBookId, activeChapterId]);

  useEffect(() => {
    const article = articleRef.current;
    if (!chapter || !article || !selectedBook) return;
    const text = article.textContent ?? "";
    const saved = selectedBook.chapterRanges[chapter.chapterId];
    setRange(saved && saved.end <= text.length ? saved : initialReadingRange(text));
  }, [chapter, selectedBook, libraryMode]);

  useEffect(() => {
    segmentStructureRef.current = chapter && articleRef.current
      ? { chapter, index: buildReadingStructure(articleRef.current) }
      : undefined;
  }, [chapter, libraryMode]);

  useLayoutEffect(() => {
    const scroller = readerScrollRef.current;
    if (libraryMode !== "books" || view !== "reader" || !selectedBook || chapter?.bookId !== selectedBook.id || chapter.chapterId !== activeChapterId || !scroller) {
      return;
    }
    const progress = selectedBook.readingState.chapterId === chapter.chapterId
      ? selectedBook.readingState.scrollProgress
      : 0;
    scroller.scrollTop = scrollTopForReadingProgress(
      progress,
      scroller.scrollHeight,
      scroller.clientHeight
    );
  }, [chapter, activeChapterId, selectedBookId, libraryMode, view]);

  useEffect(() => {
    if (!videoSourceJump || libraryMode !== 'books' || chapter?.bookId !== videoSourceJump.bookId || chapter?.chapterId !== videoSourceJump.chapterId || !articleRef.current || !readerScrollRef.current) return;
    const jump = videoSourceJump;
    const frame = requestAnimationFrame(() => {
      const article = articleRef.current, scroller = readerScrollRef.current;
      if (article && scroller) scroller.scrollTop = Math.max(0, article.offsetTop + markerTopForTextOffset(article, jump.range.start) - 40);
      setVideoSourceJump(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [videoSourceJump, libraryMode, chapter]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !range) return;
    const update = () => setMarkerTops({
      start: markerTopForTextOffset(article, range.start),
      end: markerTopForTextOffset(article, range.end, "after")
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(article);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [chapter, range]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !chapter) return;
    const valid = annotations.filter(({ start, end, text }) =>
      end <= (article.textContent?.length ?? 0) &&
      article.textContent?.slice(start, end) === text
    );
    renderAnnotationHighlights(article, valid);
  }, [chapter, annotations]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !chapter || !activeAnnotationColor) return;
    const handleMouseUp = () => {
      const selection = article.ownerDocument.getSelection();
      const selected = annotationRangeFromSelection(article, selection);
      if (!shouldCreateAnnotation(Boolean(activeAnnotationColor), annotations, selected)) return;
      createAnnotation(selected, activeAnnotationColor);
    };
    article.addEventListener("mouseup", handleMouseUp);
    return () => article.removeEventListener("mouseup", handleMouseUp);
  }, [chapter, activeAnnotationColor, annotations]);

  useEffect(() => {
    const article = articleRef.current;
    if (libraryMode !== "books" || view !== "reader" || !article || !chapter) return;
    article.addEventListener("contextmenu", handleArticleContextMenu);
    return () => article.removeEventListener("contextmenu", handleArticleContextMenu);
  }, [chapter, libraryMode, view]);

  function handleArticleContextMenu(event: MouseEvent) {
    const article = articleRef.current;
    if (!article) return;
    const offset = textOffsetAtPoint(
      article,
      event.clientX,
      event.clientY,
      event.target
    );
    if (offset === null) return;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    const annotationId = target
      ?.closest<HTMLElement>("[data-annotation-id]")
      ?.dataset.annotationId;
    const selection = originalSelectionAtContextOffset(
      annotationRangeFromSelection(article, article.ownerDocument.getSelection()),
      offset
    );
    const selectionValid = Boolean(
      selection && rangeRef.current &&
      originalSelectionWithinReadingRange(
        selection,
        readingSegmentContextForArticle(article, rangeRef.current).contextRange
      )
    );
    const extraHeight = Number(Boolean(annotationId)) * 88 + Number(Boolean(selection)) * 48;
    setRangeContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - (116 + extraHeight))),
      startOffset: offset,
      endOffset: offset,
      ...(annotationId ? { annotationId } : {}),
      ...(selection ? { selection, selectionValid } : {})
    });
  }

  useEffect(() => {
    if (!rangeContextMenu) return;
    const close = () => {
      if (shouldDismissRangeContextMenu("outside-click")) setRangeContextMenu(undefined);
    };
    const closeOnScroll = () => {
      if (shouldDismissRangeContextMenu("scroll")) setRangeContextMenu(undefined);
    };
    const closeOnResize = () => {
      if (shouldDismissRangeContextMenu("resize")) setRangeContextMenu(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (shouldDismissRangeContextMenu("keydown", event.key)) setRangeContextMenu(undefined);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [rangeContextMenu]);

  async function importBook() {
    setImporting(true);
    setLibraryError("");
    try {
      const result = await window.readerExample.library.importBook();
      if (result.status === "cancelled") return;
      setBooks((current) => [
        ...current.filter(({ id }) => id !== result.book.id),
        result.book
      ]);
      setSelectedBookId(result.book.id);
      setActiveChapterId(undefined);
      setView("overview");
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "Unable to import this EPUB.");
    } finally {
      setImporting(false);
    }
  }

  function currentReaderScrollProgress(): number {
    const scroller = readerScrollRef.current;
    return scroller
      ? scrollProgressForReader(
          scroller.scrollTop,
          scroller.scrollHeight,
          scroller.clientHeight
        )
      : 0;
  }

  function persistBookReadingState(
    book: LibraryBook,
    nextView: BookView,
    chapterId: string | null,
    scrollProgress: number
  ) {
    const normalizedProgress = Number.isFinite(scrollProgress)
      ? Math.min(1, Math.max(0, scrollProgress))
      : 0;
    const savedChapterId = chapterId && book.chapters.some(({ id }) => id === chapterId)
      ? chapterId
      : book.readingState.chapterId;
    const input = {
      bookId: book.id,
      view: nextView,
      chapterId: savedChapterId,
      scrollProgress: normalizedProgress
    };
    setBooks((current) => current.map((candidate) => candidate.id === book.id
      ? {
          ...candidate,
          ...(savedChapterId ? { lastChapterId: savedChapterId } : {}),
          ...(nextView === "reader" && savedChapterId && candidate.shelfStatus === "unread" ? { shelfStatus: "reading" as const } : {}),
          readingState: {
            view: nextView,
            chapterId: savedChapterId,
            scrollProgress: normalizedProgress
          }
        }
      : candidate));
    void window.readerExample.library.saveReadingState(input)
      .then((saved) => setBooks((current) => current.map((candidate) =>
        candidate.id === saved.id ? saved : candidate
      )))
      .catch((reason) => setLibraryError(
        reason instanceof Error ? reason.message : "Unable to save the reading position."
      ));
  }

  function saveCurrentReaderPosition() {
    if (readingStateSaveTimerRef.current) {
      clearTimeout(readingStateSaveTimerRef.current);
      readingStateSaveTimerRef.current = undefined;
    }
    if (libraryMode !== "books" || view !== "reader" || !selectedBook || !activeChapterId) {
      return;
    }
    persistBookReadingState(
      selectedBook,
      "reader",
      activeChapterId,
      currentReaderScrollProgress()
    );
  }

  function handleReaderScroll() {
    if (libraryMode !== "books" || view !== "reader" || !selectedBook || !activeChapterId) {
      return;
    }
    if (readingStateSaveTimerRef.current) {
      clearTimeout(readingStateSaveTimerRef.current);
    }
    readingStateSaveTimerRef.current = setTimeout(() => {
      persistBookReadingState(
        selectedBook,
        "reader",
        activeChapterId,
        currentReaderScrollProgress()
      );
      readingStateSaveTimerRef.current = undefined;
    }, 300);
  }

  function readBookFromShelf(book: LibraryBook) {
    if (libraryMode === "books" && view === "reader" && selectedBookId === book.id) return;
    const id = resumeChapterId(book);
    if (!id) return;
    saveCurrentReaderPosition();
    persistBookReadingState(book, "reader", id, book.readingState.chapterId === id ? book.readingState.scrollProgress : 0);
    setSelectedBookId(book.id);
    setActiveChapterId(id);
    setView("reader");
    setLibraryMode("books");
  }

  function toggleBookPinned(book: LibraryBook) {
    const pinned = book.pinned !== true;
    const version = (pinRequestVersionRef.current.get(book.id) ?? 0) + 1;
    pinRequestVersionRef.current.set(book.id, version);
    setLibraryError("");
    setBooks((current) => current.map((candidate) => candidate.id === book.id
      ? { ...candidate, pinned }
      : candidate));
    void window.readerExample.library.setPinned({ bookId: book.id, pinned })
      .then((saved) => {
        if (pinRequestVersionRef.current.get(book.id) !== version) return;
        setBooks((current) => current.map((candidate) =>
          candidate.id === saved.id ? saved : candidate
        ));
      })
      .catch((reason) => {
        if (pinRequestVersionRef.current.get(book.id) !== version) return;
        setBooks((current) => current.map((candidate) => candidate.id === book.id
          ? { ...candidate, pinned: book.pinned === true }
          : candidate));
        setLibraryError(reason instanceof Error
          ? reason.message
          : "Unable to save the pinned book.");
      });
  }

  function openChapter(chapterId: string) {
    if (!selectedBook?.chapters.some(({ id }) => id === chapterId)) return;
    saveCurrentReaderPosition();
    if (readerScrollRef.current) readerScrollRef.current.scrollTop = 0;
    persistBookReadingState(selectedBook, "reader", chapterId, 0);
    setActiveChapterId(chapterId);
    setView("reader");
  }

  function continueReading() {
    if (!selectedBook) return;
    const chapterId = resumeChapterId(selectedBook);
    if (chapterId) openChapter(chapterId);
  }

  async function deleteBook() {
    const target = bookPendingDeletion;
    if (!target || deletingBook) return;
    setDeletingBook(true);
    setLibraryError("");
    try {
      await window.readerExample.library.deleteBook(target.id);
      const replacementId = nextBookIdAfterDeletion(books, target.id);
      const replacementBook = books.find(({ id }) => id === replacementId);
      const navigation = replacementBook
        ? navigationAfterBookSelection({ selectedBookId: target.id, view: "overview" }, replacementBook)
        : { selectedBookId: undefined, activeChapterId: undefined, view: "overview" as const };
      setBooks((current) => current.filter(({ id }) => id !== target.id));
      setSelectedBookId(navigation.selectedBookId);
      setActiveChapterId(navigation.activeChapterId);
      setView(navigation.view);
      setChapter(undefined);
      setRange(undefined);
      setBookPendingDeletionId(undefined);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : "Unable to delete this book.");
      setBookPendingDeletionId(undefined);
    } finally {
      setDeletingBook(false);
    }
  }

  function returnToOverview() {
    if (selectedBook) {
      persistBookReadingState(
        selectedBook,
        "overview",
        activeChapterId ?? selectedBook.readingState.chapterId,
        currentReaderScrollProgress()
      );
    }
    setView("overview");
    setReadingLayoutOpen(false);
    setChapter(undefined);
    setRange(undefined);
  }

  function persistReadingRange(next: ReadingRange, source: "manual" | "automatic" = "manual") {
    if (!selectedBook || !chapter) return;
    const structure = segmentStructureRef.current;
    if (source === "manual" && structure?.chapter === chapter) {
      const visibleRange = articleRef.current
        ? expandReadingRangeToVisualLines(articleRef.current, next) : next;
      structure.preference = inferReadingPreference(structure.index, next, visibleRange);
    }
    rangeRef.current = next;
    setRange(next);
    void window.readerExample.library.saveReadingRange({
      bookId: selectedBook.id,
      chapterId: chapter.chapterId,
      range: next
    }).then((saved) => setBooks((current) => current.map((book) =>
      book.id === saved.id ? saved : book
    ))).catch((reason) => setLibraryError(
      reason instanceof Error ? reason.message : "Unable to save the range."
    ));
  }

  function scrollToRangeMarker(marker: "start" | "end") {
    const markerElement = document.querySelector<HTMLElement>(
      `[data-range-boundary="${marker}"]`
    );
    const container = markerElement?.closest<HTMLElement>(".reader-scroll");
    if (!markerElement || !container) return;
    container.scrollTo({
      top: rangeMarkerScrollTop({
        containerScrollTop: container.scrollTop,
        containerTop: container.getBoundingClientRect().top,
        containerHeight: container.clientHeight,
        markerTop: markerElement.getBoundingClientRect().top,
        marker
      }),
      behavior: "smooth"
    });
  }

  function advanceToNextSegment() {
    const article = articleRef.current;
    const current = rangeRef.current;
    const structure = segmentStructureRef.current;
    if (!article || !current || !structure || structure.chapter !== chapter) return;
    // END and AI context include its whole visual line (B24), even for a mid-line offset.
    const visibleRange = expandReadingRangeToVisualLines(article, current);
    structure.preference ??= inferReadingPreference(structure.index, current, visibleRange);
    const next = nextAdaptiveReadingSegment(structure.index, current, structure.preference, visibleRange.end);
    if (next) {
      const context = readingSegmentContextForArticle(article, current, readImages);
      const repeat = selectedBook && activeChapter
        ? readingSuggestions(chat.messages, { bookTitle: selectedBook.title, chapterTitle: activeChapter.title, readingSegment: context.readingSegment }).repeat : "";
      setNextInputSuggestion({
        scope: JSON.stringify([selectedBookId, activeChapterId, next.start, next.end, chat.activeConversationId]),
        userId: latestInputUserId,
        text: repeat
      });
      persistReadingRange(next, "automatic");
    }
  }

  function persistAnnotations(next: Annotation[]) {
    if (!selectedBook || !chapter) return;
    setAnnotations(next);
    setBooks((current) => current.map((book) => book.id === selectedBook.id
      ? {
          ...book,
          chapterAnnotations: { ...book.chapterAnnotations, [chapter.chapterId]: next }
        }
      : book));
    void window.readerExample.library.saveAnnotations({
      bookId: selectedBook.id,
      chapterId: chapter.chapterId,
      annotations: next
    }).then((saved) => setBooks((current) => current.map((book) =>
      book.id === saved.id ? saved : book
    ))).catch((reason) => setLibraryError(
      reason instanceof Error ? reason.message : "Unable to save the annotation."
    ));
  }

  function createAnnotation(
    selected: Pick<Annotation, "start" | "end" | "text">,
    color: AnnotationColor = activeAnnotationColor ?? DEFAULT_ANNOTATION_COLOR
  ) {
    if (hasAnnotationOverlap(annotations, selected)) return;
    annotationCounterRef.current += 1;
    persistAnnotations([
      ...annotations,
      {
        id: `annotation-${Date.now()}-${annotationCounterRef.current}`,
        color,
        ...selected
      }
    ].sort((left, right) => left.start - right.start || left.end - right.end));
    articleRef.current?.ownerDocument.getSelection()?.removeAllRanges();
  }

  function removeAnnotation(annotationId: string) {
    persistAnnotations(annotations.filter(({ id }) => id !== annotationId));
    setRangeContextMenu(undefined);
  }

  function changeAnnotationColor(annotationId: string, color: AnnotationColor) {
    persistAnnotations(annotations.map((annotation) => annotation.id === annotationId
      ? { ...annotation, color }
      : annotation));
    setRangeContextMenu(undefined);
  }

  function moveAndPersistRange(marker: "start" | "end", offset: number) {
    const current = rangeRef.current;
    if (!current) return;
    persistReadingRange(rangeAfterMovingBoundary(current, marker, offset));
    setRangeContextMenu(undefined);
  }

  function startDragging(
    marker: "start" | "end",
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    event.preventDefault();
    const article = articleRef.current;
    const initialRange = rangeRef.current;
    if (!article || !chapter || !selectedBook || !initialRange) return;
    let lastValidRange = initialRange;
    let hasMoved = false;

    const updateFromPoint = (pointer: PointerEvent) => {
      const offset = textOffsetAtPoint(article, pointer.clientX, pointer.clientY);
      if (offset === null) return;
      const next = rangeAfterMovingBoundary(initialRange, marker, offset);
      lastValidRange = next;
      hasMoved = next.start !== initialRange.start || next.end !== initialRange.end;
      rangeRef.current = next;
      setRange(next);
    };
    const stopListening = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
    const handlePointerMove = (pointer: PointerEvent) => updateFromPoint(pointer);
    const handlePointerUp = (pointer: PointerEvent) => {
      stopListening();
      updateFromPoint(pointer);
      if (hasMoved) persistReadingRange(lastValidRange);
      setRangeContextMenu(undefined);
    };
    const handlePointerCancel = () => {
      stopListening();
      rangeRef.current = initialRange;
      setRange(initialRange);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }

  async function startVoiceChat() {
    if (voiceDisabledReason || voice.busy || !voice.peer || !selectedBook || !activeChapter || !range || !articleRef.current) return;
    const visualContext = readingSegmentContextForArticle(articleRef.current, range);
    if (!visualContext.plainReadingSegment.trim()) { setChatError("請先設定 START／END 閱讀範圍。"); return; }
    setChatError("");
    await voice.peer.start({ bookTitle: selectedBook.title, chapterTitle: activeChapter.title, readingSegment: visualContext.plainReadingSegment });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const question = draft.trim() || inputSuggestion || (draftImages.length ? "請幫我解讀這張圖片。" : "");
    if (!question || sendingQuestion || chat.activeTurnId || voice.busy) return;
    const article = articleRef.current;
    const visualContext = range && article
      ? readingSegmentContextForArticle(article, range, readImages)
      : undefined;
    const segment = visualContext?.readingSegment && selectedBook && activeChapter && range
      ? {
          bookId: selectedBook.id,
          bookTitle: selectedBook.title,
          chapterId: activeChapter.id,
          chapterTitle: activeChapter.title,
          range,
          contextRange: visualContext.contextRange,
          readingSegment: visualContext.readingSegment,
          images: visualContext.images
        }
      : undefined;
    const readingNotePending = readingNoteWorkflowPending(chat.messages);
    const prepared = segment
      ? prepareReadingNoteAwareMessage({
          text: question,
          model: chatModel,
          segment,
          lastProvidedKey: lastProvidedReadingSegmentRef.current,
          readingNotePending
        })
      : undefined;
    const fallbackContext = {
          ...(selectedBook?.title ? { bookTitle: selectedBook.title } : {}),
          ...(view === "reader" && activeChapter?.title
            ? { chapterTitle: activeChapter.title }
            : {})
        };
    const input = prepared?.input ?? {
      text: question,
      model: chatModel,
      ...(readingNotePending ? { intent: "createReadingNote" as const } : {}),
      ...(Object.keys(fallbackContext).length ? { context: fallbackContext } : {})
    };
    setChatError("");
    setSendingQuestion(true);
    try {
      setChat(await window.readerExample.chat.sendMessage({ ...input, ...(draftNoteReferences.length ? { noteReferenceIds: draftNoteReferences.map(n => n.id) } : {}), ...(draftImages.length ? { images: draftImages } : {}) }));
      if (inputSuggestion) setDismissedSuggestion(inputSuggestionKey);
      setDraftNoteReferences([]);
      draftImageEpoch.current += 1;
      setDraft("");
      setDraftImages([]);
      if (prepared?.delivery.shouldRemember) {
        lastProvidedReadingSegmentRef.current = prepared.delivery.key;
      }
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to send the question.");
    } finally { setSendingQuestion(false); }
  }

  async function pasteChatImages(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const epoch = draftImageEpoch.current;
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
    if (!files.length) return;
    event.preventDefault();
    if (files.some(file => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))) {
      setChatError("僅支援貼上 PNG、JPEG、WebP 或 GIF 圖片。");
      return;
    }
    if (draftImages.length + files.length > 4 || files.some(file => file.size > 5 * 1024 * 1024) ||
      files.reduce((total, file) => total + file.size, 0) +
        draftImages.reduce((total, image) => total + Math.ceil(image.dataUrl.length * 3 / 4), 0) > 10 * 1024 * 1024) {
      setChatError("每則訊息最多 4 張圖片，單張 5 MiB、合計 10 MiB。");
      return;
    }
    try {
      const images = await Promise.all(files.map(file => new Promise<{ dataUrl: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve({ dataUrl: reader.result }) : reject(new Error("無法讀取貼上的圖片。"));
        reader.onerror = () => reject(new Error("無法讀取貼上的圖片。"));
        reader.readAsDataURL(file);
      })));
      if (draftImageEpoch.current === epoch) {
        setDraftImages(current => [...current, ...images]);
        setChatError("");
      }
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "無法讀取貼上的圖片。");
    }
  }

  async function explainSelectedPassage(selected: Omit<Annotation, "id">, elaborate = false) {
    const currentRange = rangeRef.current;
    const article = articleRef.current;
    if (!selected || !currentRange || !article || !selectedBook || !activeChapter ||
      voice.busy || chat.activeTurnId || chat.managementBusy || conversationActionPending || chat.connection !== "ready" ||
      article.textContent?.slice(selected.start, selected.end) !== selected.text) return;
    const visualContext = readingSegmentContextForArticle(article, currentRange, readImages);
    if (!originalSelectionWithinReadingRange(selected, visualContext.contextRange)) return;
    const readingSegment = visualContext.readingSegment;
    if (!readingSegment) return;
    const segment = {
      bookId: selectedBook.id,
      bookTitle: selectedBook.title,
      chapterId: activeChapter.id,
      chapterTitle: activeChapter.title,
      range: currentRange,
      contextRange: visualContext.contextRange,
      readingSegment,
      images: visualContext.images
    };
    const delivery = prepareReadingSegmentDelivery(segment);
    setChatError("");
    setRangeContextMenu(undefined);
    setChatCollapsed(false);
    setChatView("conversation");
    try {
      setChat(await window.readerExample.chat.sendMessage({
        text: elaborate ? "請詳細闡明這段原文，補足簡略帶過的背景、推理與例子" : "請用白話說明這段內容",
        ...(elaborate ? { intent: "explainReadingSegment" as const } : {}),
        model: chatModel,
        readingSource: readingSourceSnapshot(segment),
        context: delivery.context,
        quote: { text: selected.text }
      }));
      lastProvidedReadingSegmentRef.current = delivery.key;
      article.ownerDocument.getSelection()?.removeAllRanges();
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : elaborate ? "無法送出詳細闡明請求。" : "無法送出白話說明請求。");
    }
  }

  async function sendReadingSegmentShortcut(intent: ChatIntent) {
    const currentRange = rangeRef.current;
    const article = articleRef.current;
    if (!currentRange || !article || !selectedBook || !activeChapter || voice.busy || chat.activeTurnId ||
      chat.managementBusy || conversationActionPending || chat.connection !== "ready") return;
    const visualContext = readingSegmentContextForArticle(article, currentRange, readImages);
    const readingSegment = visualContext.readingSegment;
    if (!readingSegment) return;
    const segment = {
      bookId: selectedBook.id,
      bookTitle: selectedBook.title,
      chapterId: activeChapter.id,
      chapterTitle: activeChapter.title,
      range: currentRange,
      contextRange: visualContext.contextRange,
      readingSegment,
      images: visualContext.images
    };
    const delivery = prepareReadingSegmentDelivery(segment);
    const text = readingSegmentShortcutText(intent);
    setChatError("");
    setChatView("conversation");
    try {
      setChat(await window.readerExample.chat.sendMessage({
        text,
        intent,
        model: chatModel,
        readingSource: readingSourceSnapshot(segment),
        context: delivery.context
      }));
      lastProvidedReadingSegmentRef.current = delivery.key;
    } catch (reason) {
      setChatError(reason instanceof Error
        ? reason.message
        : readingSegmentShortcutFallbackError(intent));
    }
  }

  function openReadingNoteDraft() {
    const currentRange = rangeRef.current;
    const article = articleRef.current;
    if (!currentRange || !article || !selectedBook || !activeChapter) return;
    const { readingSegment, images } = readingSegmentContextForArticle(article, currentRange, readImages);
    if (!readingSegment) return;
    setReadingNoteDraftSource({
      bookId: selectedBook.id,
      chapterId: activeChapter.id,
      bookTitle: selectedBook.title,
      chapterTitle: activeChapter.title,
      readingSegment,
      ...(images.length ? { images } : {})
    });
  }

  async function submitLearningQuestion(text: string): Promise<boolean> {
    if (!text.trim() || chat.activeTurnId || chat.managementBusy ||
      conversationActionPending || chat.connection !== "ready") return false;
    setChatError("");
    setChatView("conversation");
    try {
      setChat(await window.readerExample.chat.sendMessage({ text, model: chatModel }));
      return true;
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "無法送出理解測驗答案。");
      return false;
    }
  }

  async function submitSelfRetelling(text: string): Promise<boolean> {
    if (!text.trim() || chat.activeTurnId || chat.managementBusy ||
      conversationActionPending || chat.connection !== "ready") return false;
    setChatError("");
    setChatView("conversation");
    try {
      setChat(await window.readerExample.chat.sendMessage({ text, model: chatModel }));
      return true;
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "無法送出自我復述內容。");
      return false;
    }
  }

  async function submitReadingNote(draftId: string): Promise<boolean> {
    if (!draftId.trim() || chat.activeTurnId || chat.managementBusy ||
      conversationActionPending) return false;
    setChatError("");
    try {
      setChat(await window.readerExample.chat.submitReadingNote(draftId));
      readerNotes.refresh();
      return true;
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to save the reading note.");
      return false;
    }
  }

  async function reconnectCodex() {
    setChatError("");
    try {
      setChat(await window.readerExample.chat.connect());
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to connect to Codex.");
    }
  }

  async function stopResponse() {
    if (!chat.activeTurnId || chat.activeTurnId === "starting") return;
    setChatError("");
    try {
      setChat(await window.readerExample.chat.stopResponse());
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to stop the response.");
    }
  }

  async function startNewConversation() {
    if (voice.busy || chat.activeTurnId || chat.managementBusy || conversationActionPending) return;
    setConversationActionPending(true);
    setChatError("");
    try {
      setChat(await window.readerExample.chat.startNewConversation());
      draftImageEpoch.current += 1;
      setDraft("");
      setDraftImages([]);
      setDraftNoteReferences([]);
      setChatView("conversation");
      lastProvidedReadingSegmentRef.current = undefined;
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to create a new conversation.");
    } finally {
      setConversationActionPending(false);
    }
  }

  async function selectConversation(conversationId: string) {
    if (voice.busy || chat.activeTurnId || chat.managementBusy || conversationActionPending) return;
    setConversationActionPending(true);
    setChatError("");
    try {
      setChat(await window.readerExample.chat.selectConversation(conversationId));
      draftImageEpoch.current += 1;
      setDraft("");
      setDraftImages([]);
      setDraftNoteReferences([]);
      setChatView("conversation");
      lastProvidedReadingSegmentRef.current = undefined;
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to open the AI conversation.");
    } finally {
      setConversationActionPending(false);
    }
  }

  async function removeConversation(target: ChatConversationSummary) {
    if (voice.busy || chat.activeTurnId || chat.managementBusy || conversationActionPending) return;
    setConversationActionPending(true);
    setChatError("");
    try {
      setChat(await window.readerExample.chat.removeConversation(target.id));
      if (target.id === chat.activeConversationId) {
        draftImageEpoch.current += 1;
        setDraft("");
        setDraftImages([]);
        setChatView("conversation");
        lastProvidedReadingSegmentRef.current = undefined;
      }
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Unable to remove the AI conversation.");
    } finally {
      setConversationActionPending(false);
    }
  }

  async function copyConversation() {
    if (chatView !== "conversation") return;
    setChatError("");
    try {
      const copied = await copyReadingConversation(chat, value => navigator.clipboard.writeText(value));
      if (copied) setCopiedConversationId(chat.activeConversationId);
    } catch (reason) {
      setCopiedConversationId(null);
      setChatError(reason instanceof Error ? `Unable to copy conversation: ${reason.message}` : "Unable to copy conversation.");
    }
  }

  function startResizingChat(event: ReactPointerEvent<HTMLDivElement>) {
    if (chatCollapsed) return;
    event.preventDefault();
    setChatResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (pointer: PointerEvent) => {
      setChatPanelWidth(chatPanelWidthFromPointer(
        pointer.clientX,
        window.innerWidth,
        libraryCollapsed
      ));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setChatResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  return (
    <ReadingNoteSourceContext.Provider value={{ books, open: ({ bookId, chapterId }) => {
      const book = books.find(item => item.id === bookId);
      if (!book?.chapters.some(item => item.id === chapterId)) return;
      const navigate = () => {
        saveCurrentReaderPosition();
        if (readerScrollRef.current) readerScrollRef.current.scrollTop = 0;
        persistBookReadingState(book, "reader", chapterId, 0);
        setLibraryModeRaw("books"); setSelectedBookId(bookId); setActiveChapterId(chapterId); setView("reader");
      };
      if (libraryMode === "whiteboards" && whiteboardLeave.current) whiteboardLeave.current(navigate);
      else navigate();
    } }}>
    <HeptabaseImportProvider api={typeof window === "undefined" ? undefined : window.readerExample.readingNotes.heptabase}><CardNoteUploadProvider api={typeof window === "undefined" ? undefined : window.readerExample.readingNotes.cardPool}>
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src="./app-icon.png" alt="" width="38" height="38" />
          </span>
          <div>
            <strong>Deep Reader</strong>
            <span>Read deeply. Think clearly.</span>
          </div>
        </div>
      </header>

      <div
        className={`workspace-shell${libraryMode === "bookshelf" ? " bookshelf-active" : ""}${libraryMode === "practice" ? " practice-active" : ""}${libraryMode === "whiteboards" ? " whiteboards-active" : ""}${libraryCollapsed ? " library-collapsed" : ""}${chatCollapsed ? " chat-collapsed" : ""}${chatResizing ? " chat-resizing" : ""}${settingsOpen ? " settings-modal-open" : ""}`}
        style={{ "--chat-panel-width": `${chatPanelWidth}px` } as CSSProperties}
      >
        <aside className="library-panel">
          <BookShelf
            books={books}
            selectedBookId={selectedBookId}
            onSelect={(id) => { if (libraryMode === "whiteboards" && whiteboardLeave.current) whiteboardLeave.current(() => { whiteboardLeave.current = undefined; readBookFromShelf(id); }); else readBookFromShelf(id); }}
            onCollapse={() => setLibraryCollapsed(true)}
            mode={libraryMode}
            reviewEnabled={Boolean(reviewApi)}
            reviewCount={reviewSummary.summary?.available}
            onModeChange={(mode) => {
              if (mode === "reading-notes" || mode === "bookshelf") saveCurrentReaderPosition();
              if (mode === "whiteboards" || mode === "practice" || mode === 'concept-videos') saveCurrentReaderPosition();
              if (mode === "spaced-review") saveCurrentReaderPosition();
              setLibraryMode(mode);
            }}
          />
          {libraryError ? <p className="library-error" role="alert">{libraryError}</p> : null}
          <div className="library-footer">
            <button className="settings-button" type="button" onClick={() => { setSettingsTab("account"); setSettingsOpen(true); }}>
              <SettingsIcon />
              <span>Settings</span>
            </button>
            <CodexAccountStatus snapshot={chat} />
          </div>
          {libraryCollapsed ? (
            <button className="collapsed-sidebar-toggle left" type="button" aria-label="Expand library" title="Expand library" onClick={() => setLibraryCollapsed(false)}>
              <PanelToggleIcon edge="left" />
            </button>
          ) : null}
        </aside>

        <section className={`reader-panel ${libraryMode === "bookshelf" ? "bookshelf-view" : libraryMode === "concept-videos" ? "concept-videos-view" : libraryMode === "practice" ? "practice-view" : libraryMode === "whiteboards" ? "whiteboards-view" : libraryMode === "spaced-review" ? "spaced-review-view" : libraryMode === "reading-notes" ? "reading-notes-view" : view === "reader" ? "reading-view" : "overview-view"}`}>
        {libraryMode === "books" && view === "reader" ? (
          <ReaderToolbar
            chapterTitle={activeChapter?.title ?? "Loading chapter…"}
            noteCount={readerNotes.loading || readerNotes.error ? undefined : chapterNoteCount}
            notesOpen={showingNotes && !chatCollapsed}
            onOpenNotes={() => openReaderNotes()}
            layout={readingLayout}
            layoutOpen={readingLayoutOpen}
            hasPreviousChapter={Boolean(previousChapter)}
            hasNextChapter={Boolean(nextChapter)}
            onBack={returnToOverview}
            onToggleLayout={() => setReadingLayoutOpen((open) => !open)}
            onCloseLayout={() => setReadingLayoutOpen(false)}
            onChangeLayout={setReadingLayout}
            onResetLayout={() => setReadingLayout(defaultReadingLayout)}
            onPreviousChapter={() => previousChapter && openChapter(previousChapter.id)}
            onNextChapter={() => nextChapter && openChapter(nextChapter.id)}
          />
        ) : null}
        <div className="reader-scroll" ref={readerScrollRef} onScroll={handleReaderScroll}>
          {libraryMode === "bookshelf" ? (
            <MyBookshelf tagsApi={globalThis.window?.readerExample?.readingNotes?.tags} bookTagsApi={globalThis.window?.readerExample?.readingNotes?.bookTags} books={books} onImport={importBook} importing={importing} onPin={toggleBookPinned} onRead={readBookFromShelf} onStatus={async input => {
              const saved = await window.readerExample.library.setShelfStatus(input);
              setBooks(current => current.map(book => book.id === saved.id ? { ...book, shelfStatus: saved.shelfStatus } : book));
            }} />
          ) : libraryMode === 'concept-videos' ? (
            videoApi ? <ConceptVideoLibrary api={videoApi} books={books} onOpen={openSavedVideo} refreshKey={videoLibraryRevision} liveVideos={videoActivity.videos} /> : <p role="alert">Restart the app to use the Video Library.</p>
          ) : libraryMode === "practice" ? (
            window.readerExample.practice ? <PracticeWorkspace api={window.readerExample.practice} notesApi={window.readerExample.readingNotes} /> : <p role="alert">Restart the app to enable Practice.</p>
          ) : libraryMode === "whiteboards" ? (
            window.readerExample.whiteboards ? <WhiteboardWorkspace api={window.readerExample.whiteboards} notesApi={window.readerExample.readingNotes} initialBoardId={selectedWhiteboardId} onBoardChange={setSelectedWhiteboardId} registerGuard={guard => { whiteboardLeave.current = guard; }} /> : <p role="alert">Restart the app to enable Whiteboards.</p>
          ) : libraryMode === "spaced-review" ? (
            <SpacedReviewWorkspace api={window.readerExample.readingNotes}
              summary={reviewSummary.summary} summaryError={reviewSummary.error} refresh={reviewSummary.refresh}
              onNotes={() => setLibraryMode("reading-notes")}
              onSettings={() => { setSettingsTab("review"); setSettingsOpen(true); }} />
          ) : libraryMode === "reading-notes" ? (
            <ReadingNoteLibrary
              api={window.readerExample.readingNotes}
              onReturnToBooks={() => setLibraryMode("books")}
            />
          ) : view === "reader" && chapter ? (
            <div
              className="reading-range-shell"
              style={{
                "--reading-paper-width": `${readingLayout.paperWidth}px`,
                "--reader-font-size": `${readingLayout.fontSize}px`,
                "--reader-line-height": readingLayout.lineHeight
              } as CSSProperties}
            >
              <div className="reader-segment-toolbar">
                <div className="reading-range-actions-group">
                  <div className="range-jump-controls" role="group" aria-label="Reading segment quick navigation">
                    <button type="button" onClick={() => scrollToRangeMarker("start")}>
                      <span aria-hidden="true">↑</span> Start
                    </button>
                    <button className="end" type="button" onClick={() => scrollToRangeMarker("end")}>
                      <span aria-hidden="true">↓</span> End
                    </button>
                  </div>
                  <button
                    className="range-advance-action"
                    type="button"
                    onClick={advanceToNextSegment}
                    disabled={!range || range.end >= (articleRef.current?.textContent?.length ?? 0)}
                  >
                    Next segment <span aria-hidden="true">→</span>
                  </button>
                </div>
                <AnnotationTool
                  activeColor={activeAnnotationColor}
                  count={annotations.length}
                  onSelectColor={setActiveAnnotationColor}
                />
              </div>
              {range ? (
                <div className="range-layer" aria-label="AI-readable START and END range">
                  <ReadingRangeBoundary
                    marker="start"
                    top={markerTops.start}
                    overlapping={rangeBoundariesOverlap}
                    onPointerDown={(event) => startDragging("start", event)}
                  />
                  <ReadingRangeBoundary
                    marker="end"
                    top={markerTops.end}
                    overlapping={rangeBoundariesOverlap}
                    onPointerDown={(event) => startDragging("end", event)}
                  />
                </div>
              ) : null}
              <ChapterArticle
                ref={articleRef}
                content={chapter}
              />
              {rangeContextMenu ? (
                <ReadingRangeContextMenu
                  x={rangeContextMenu.x}
                  y={rangeContextMenu.y}
                  onMoveStart={() => moveAndPersistRange("start", rangeContextMenu.startOffset)}
                  onMoveEnd={() => moveAndPersistRange("end", rangeContextMenu.endOffset)}
                  annotationId={rangeContextMenu.annotationId}
                  annotationColor={annotations.find(({ id }) => id === rangeContextMenu.annotationId)?.color}
                  onChangeAnnotationColor={changeAnnotationColor}
                  onRemoveAnnotation={removeAnnotation}
                  selectedText={rangeContextMenu.selection?.text}
                  selectionValid={rangeContextMenu.selectionValid}
                  explainDisabled={chat.connection !== "ready" || Boolean(chat.activeTurnId) || chat.managementBusy || conversationActionPending}
                  onElaborateSelection={rangeContextMenu.selection
                    ? () => void explainSelectedPassage(rangeContextMenu.selection!, true)
                    : undefined}
                  onExplainSelection={rangeContextMenu.selection
                    ? () => void explainSelectedPassage(rangeContextMenu.selection!)
                    : undefined}
                />
              ) : null}
            </div>
          ) : view === "reader" ? (
            <div className="reader-empty compact">
              <span>···</span>
              <h1>Loading chapter</h1>
            </div>
          ) : selectedBook ? (
            <BookOverview
              book={selectedBook}
              memoryImageTemplates={window.readerExample.readingNotes.memoryImage?.templates}
              onContinue={continueReading}
              onDelete={() => setBookPendingDeletionId(selectedBook.id)}
              onOpenChapter={openChapter}
            />
          ) : (
            <div className="reader-empty">
              <span>↗</span>
              <h1>Read for understanding</h1>
              <p>Open Bookshelf to import an EPUB, drag START and END around the passage you want Codex to read, then ask about its ideas.</p>
            </div>
          )}
        </div>
        {libraryMode === "books" && view === "reader" && selectedBook && activeChapter && window.readerExample.chapterScratchpad ?
          <ChapterScratchpad api={window.readerExample.chapterScratchpad} bookId={selectedBook.id} chapterId={activeChapter.id}
            chapterTitle={activeChapter.title} suspended={Boolean(readingNoteDraftSource || editingReaderNote || settingsOpen)} /> : null}
        {readingNoteDraftSource ? (
          <ReadingNoteEditorDialog
            api={window.readerExample.readingNotes}
            mode="create"
            source={readingNoteDraftSource}
            onClose={() => setReadingNoteDraftSource(undefined)}
            onSaved={(note) => {
              readerNotes.saved(note);
              setReadingNoteDraftSource(undefined);
            }}
          />
        ) : null}
        {editingReaderNote ? <ReadingNoteEditorDialog
          key={editingReaderNote.id}
          api={window.readerExample.readingNotes}
          mode="manual-edit" note={editingReaderNote} initiallyEditing={readerNoteEditorView === "note"}
          initialView={readerNoteEditorView}
          onClose={() => { setEditingReaderNote(undefined); setReaderNoteTrashConfirming(false); }}
          onDelete={() => setReaderNoteTrashConfirming(true)}
          onSaved={(note) => { setEditingReaderNote(note); readerNotes.saved(note); setCompletedReaderNote(current => current?.note.id === note.id ? { ...current, note } : current); }}
        /> : null}
        {editingReaderNote && readerNoteTrashConfirming ? <ReaderNoteTrashDialog
          key={`trash-${editingReaderNote.id}`}
          api={window.readerExample.readingNotes}
          note={editingReaderNote}
          onCancel={() => setReaderNoteTrashConfirming(false)}
          onTrashed={note => {
            readerNotes.saved(note);
            setSelectedReaderNoteId(current => current === note.id ? undefined : current);
            setCompletedReaderNote(current => current?.note.id === note.id ? undefined : current);
            setEditingReaderNote(undefined);
            setReaderNoteTrashConfirming(false);
          }}
        /> : null}
        <div className="generation-activity-stack">
        <HeptabaseImportPanel />
        {typeof window !== "undefined" && window.readerExample.readingNotes.cardPool ? <CardNoteUploadPanel api={window.readerExample.readingNotes.cardPool} noteIds={[]} /> : null}
        <ConceptVideoActivity activity={videoActivity} onOpen={video => { openSavedVideo(video, video.generation?.status === 'completed' ? video.versions.at(-1)?.id : undefined); }} />
        <MemoryImageGenerationProgress
          onView={(note, side) => { setCompletedReaderNote(current => ({ note, side, requestId: (current?.requestId ?? 0) + 1 })); openReaderNotes(note.id); }}
          api={typeof window === "undefined" ? undefined : window.readerExample.readingNotes}
          memoryImage={typeof window === "undefined"
            ? undefined
            : window.readerExample.readingNotes.memoryImage}
        />
        </div>
        </section>

        <aside className="chat-panel">
          <div
            className="chat-resize-handle"
            role="separator"
            aria-label="Resize AI Tutor panel"
            aria-orientation="vertical"
            aria-valuemin={minimumChatPanelWidth}
            aria-valuemax={maximumChatPanelWidth}
            aria-valuenow={chatPanelWidth}
            tabIndex={0}
            onPointerDown={startResizingChat}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const pointerX = window.innerWidth - chatPanelWidth +
                (event.key === "ArrowLeft" ? -20 : 20);
              setChatPanelWidth(chatPanelWidthFromPointer(
                pointerX,
                window.innerWidth,
                libraryCollapsed
              ));
            }}
          />
          <header className="chat-header">
            {notesAvailable ? <div className="reader-companion-tabs" role="tablist" aria-label="Reading companion"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = videoApi ? ['chat', 'notes', 'videos'] as const : ['chat', 'notes'] as const;
                const index = tabs.findIndex(tab => tab === rightPanel);
                const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1]
                  : tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                setRightPanel(next); setVideoPanelOpen(false);
                document.getElementById(`reader-${next}-tab`)?.focus();
              }}>
              <button type="button" role="tab" id="reader-chat-tab" aria-label="AI Tutor" title="AI Tutor" aria-controls="reader-chat-tabpanel"
                aria-selected={!showingNotes && !showingVideos} tabIndex={showingNotes || showingVideos ? -1 : 0} onClick={() => { setRightPanel("chat"); setVideoPanelOpen(false); }}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h12v10H9l-5 3v-13Z" /><path d="M7 7h6M7 10h4" /></svg>
                <span>AI Tutor</span>
              </button>
              <button type="button" role="tab" id="reader-notes-tab" aria-label="Notes" title="Notes" aria-controls="reader-notes-tabpanel"
                aria-selected={showingNotes} tabIndex={showingNotes ? 0 : -1} onClick={() => { setRightPanel("notes"); setVideoPanelOpen(false); }}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h8l3 3v11H5V3Z" /><path d="M12 3v4h4M8 10h5M8 13h5" /></svg>
                <span>Notes</span>
              </button>
              {videoApi ? <button type="button" role="tab" id="reader-videos-tab" aria-label="Videos" title="Videos" aria-controls="reader-videos-tabpanel"
                aria-selected={showingVideos} tabIndex={showingVideos ? 0 : -1} onClick={() => { setRightPanel("videos"); setVideoPanelOpen(false); }}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3z M8 7l5 3-5 3z" /></svg>
                <span>Videos</span>
              </button> : null}
            </div> : <>
            <div className="chat-title"><span className={`status ${chat.connection}`} /><strong>AI Tutor</strong></div>
            <small>Reading segment context</small>
            </>}
            <div className="reader-companion-tools">
            {notesAvailable ? <span className={`reader-companion-connection status ${chat.connection}`}
              role="img" aria-label={`AI Tutor connection: ${chat.connection}`}
              title={`AI Tutor: ${chat.connectionDetail || chat.connection}`} /> : null}
            <button className="sidebar-toggle" type="button" aria-label={notesAvailable ? "Collapse side panel" : "Collapse AI Tutor"} title="Collapse side panel" onClick={() => setChatCollapsed(true)}>
              <PanelToggleIcon edge="left" />
            </button>
            </div>
          </header>
        <div className={`reader-chat-tabpanel${videoPanelOpen ? ' concept-video-chat-hidden' : ''}`} id="reader-chat-tabpanel" role={notesAvailable ? "tabpanel" : undefined}
          aria-labelledby={notesAvailable ? "reader-chat-tab" : undefined} hidden={showingNotes || showingVideos || videoPanelOpen}>
        <div className="chat-content">
          <div className="chat-management-bar">
            <div className="chat-management-navigation">
              <button
                className="chat-management-new"
                type="button"
                aria-label="New conversation"
                title="New conversation"
                onClick={() => void startNewConversation()}
                disabled={voice.busy || Boolean(chat.activeTurnId) || chat.managementBusy || conversationActionPending}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
                <span>New</span>
              </button>
              <button
                className="chat-management-history"
                type="button"
                aria-label="Conversation history"
                title="Conversation history"
                aria-pressed={chatView === "history"}
                onClick={() => {
                  setCopiedConversationId(null);
                  setChatView((current) => current === "history" ? "conversation" : "history");
                }}
                disabled={voice.busy || Boolean(chat.activeTurnId) || chat.managementBusy || conversationActionPending}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 9.5a6.5 6.5 0 1 1 1.8 4.5M3.5 14v-4.5H8M10 6.5v3.7l2.5 1.6" /></svg>
                <span>History</span>
              </button>
            </div>
            <div className="chat-management-utility">
              <label className="chat-read-images" title="是否讀取書中圖片；套用到接下來的提問、新建筆記與影片。已傳送的圖片仍保留在對話中。">
                <input
                  type="checkbox"
                  checked={readImages}
                  disabled={voice.busy || Boolean(chat.activeTurnId) || chat.managementBusy || conversationActionPending}
                  onChange={event => {
                    const checked = event.currentTarget.checked;
                    setReadImages(checked);
                    lastProvidedReadingSegmentRef.current = undefined;
                    try { window.localStorage.setItem(READ_IMAGES_KEY, String(checked)); } catch { /* Keep the toggle usable without storage. */ }
                  }}
                />
                <span>讀取圖片</span>
              </label>
              <button
                className="chat-management-copy"
                type="button"
                aria-label="Copy conversation"
                title={chatView === "conversation" ? "Copy conversation" : "Open a conversation to copy it"}
                onClick={() => void copyConversation()}
                disabled={chatView !== "conversation" || !chat.activeConversationId || !chat.messages.some(message => message.status === "completed")}
              >
                {copiedConversationId && copiedConversationId === chat.activeConversationId
                  ? <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
                  : <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5" /><path d="M12.5 6V4.5A1.5 1.5 0 0 0 11 3H5a1.5 1.5 0 0 0-1.5 1.5V12A1.5 1.5 0 0 0 5 13.5h2" /></svg>}
                <span>{copiedConversationId && copiedConversationId === chat.activeConversationId ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
          {chatView === "history" ? (
            <section className="conversation-history" aria-labelledby="conversation-history-title">
              <div className="conversation-history-heading">
                <div>
                  <span>Conversation history</span>
                  <h2 id="conversation-history-title">10 most recent conversations</h2>
                </div>
                <em>{chat.conversations.length}</em>
              </div>
              {chat.conversations.length ? (
                <div className="conversation-list">
                  {chat.conversations.map((conversation) => {
                    const source = [
                      conversation.source?.bookTitle,
                      conversation.source?.chapterTitle
                    ].filter(Boolean).join(" • ");
                    return (
                      <article
                        className={`conversation-list-item${conversation.id === chat.activeConversationId ? " active" : ""}`}
                        key={conversation.id}
                      >
                        <button
                          className="conversation-open-button"
                          type="button"
                          aria-label={`Open ${conversation.title}`}
                          onClick={() => void selectConversation(conversation.id)}
                          disabled={conversationActionPending}
                        >
                          <strong>{conversation.title}</strong>
                          <span>{source || "General conversation"}</span>
                          <small>{new Date(conversation.updatedAt).toLocaleString()}</small>
                        </button>
                        <button
                          className="conversation-remove-button"
                          type="button"
                          aria-label={`Remove ${conversation.title}`}
                          title="Remove conversation"
                          onClick={() => void removeConversation(conversation)}
                          disabled={conversationActionPending}
                        >×</button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="conversation-empty">
                  <strong>No conversation history yet</strong>
                  <p>Your conversations will be saved here after you send your first question.</p>
                </div>
              )}
            </section>
          ) : (
            <>
              <ReadingContextNotice
                hasRange={Boolean(range)}
                hasMessages={chat.messages.length > 0}
              />
              <ChatMessageList
                messages={chat.messages}
                activeTurnId={chat.activeTurnId}
                actionsDisabled={chat.connection !== "ready" || chat.managementBusy || conversationActionPending || voice.busy}
                onSubmitLearningQuestion={submitLearningQuestion}
                onSubmitSelfRetelling={submitSelfRetelling}
                onSubmitReadingNote={submitReadingNote}
                chatApi={typeof window === "undefined" ? undefined : window.readerExample.chat}
                onNoteCreated={note => readerNotes.saved(note)}
                notesApi={typeof window === "undefined" ? undefined : window.readerExample.readingNotes}
                onOpenReferencedNote={note => { setReaderNoteEditorView("note"); setEditingReaderNote(note); }}
                onDecideNoteUpdate={async (id, decision) => {
                  const decide = window.readerExample.chat.decideReadingNoteUpdate;
                  if (!decide) throw new Error("筆記更新服務無法使用。");
                  setChat(await decide(id, decision));
                  if (decision === "apply") readerNotes.refresh();
                }}
                source={chat.conversations.find(({ id }) =>
                  id === chat.activeConversationId)?.source}
              />
            </>
          )}
        </div>
        {view === "reader" && chatView === "conversation" ? (
          <ReadingSegmentShortcutBar
            disabled={readingSegmentShortcutsDisabled({
              hasReadingSegment: Boolean(range && articleRef.current && extractReadingSegmentWithImages(
                articleRef.current,
                range
              ).readingSegment),
              connection: chat.connection,
              activeTurnId: chat.activeTurnId,
              managementBusy: chat.managementBusy || voice.busy,
              conversationActionPending
            })}
            onGenerateGuide={() => void sendReadingSegmentShortcut("readingGuide")}
            onStartReadingCoach={() => void sendReadingSegmentShortcut("readingCoach")}
            onStartLearningQuestionQuiz={() => void sendReadingSegmentShortcut("learningQuestionQuiz")}
            onStartSelfRetelling={() => void sendReadingSegmentShortcut("selfRetelling")}
            onCreateReadingNote={openReadingNoteDraft}
            onConceptVideo={() => openVideoPreparation()}
          />
        ) : null}
        {chatView === "conversation" ? (
        <form className="chat-form reading-chat-form" onSubmit={sendMessage}>
          <div className={`chat-composer-card${voice.busy ? " has-voice-chat" : ""}`}>
            {voice.busy ? <ReadingVoicePanel state={voice.state} source={activeChapter?.title}
              onMute={() => voice.peer?.toggleMuted()} onStop={() => void voice.peer?.stop()} /> : <>
            <NoteReferencePicker api={typeof window === "undefined" ? undefined : window.readerExample.readingNotes} selected={draftNoteReferences} onChange={setDraftNoteReferences}
              disabled={sendingQuestion || Boolean(chat.activeTurnId) || chat.managementBusy} />
            <div className="chat-composer-input">
              {draftImages.length ? <div className="chat-draft-images" aria-label="待送出的圖片">
                {draftImages.map((image, index) => <div className="chat-draft-image" key={index}>
                  <img src={image.dataUrl} alt={`待送出的圖片 ${index + 1}`} />
                  <button type="button" aria-label={`移除圖片 ${index + 1}`} onClick={() => setDraftImages(current => current.filter((_, at) => at !== index))}>×</button>
                </div>)}
              </div> : null}
              <textarea
                aria-label="Ask about the current reading range"
                rows={4}
                value={draft}
                placeholder={inputSuggestion || "Ask about the marked passage…"}
                aria-describedby={inputSuggestion ? "reading-input-suggestion-hint" : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => { void pasteChatImages(event); }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (inputSuggestion && event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    setDraft(inputSuggestion);
                    setDismissedSuggestion(inputSuggestionKey);
                    return;
                  }
                  if (inputSuggestion && event.key === "Escape") {
                    event.preventDefault();
                    setDismissedSuggestion(inputSuggestionKey);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={sendingQuestion || chat.connection !== "ready" || Boolean(chat.activeTurnId) || chat.managementBusy}
              />
            </div>
            <div className="chat-composer-actions">
              <select
                aria-label="Choose AI model"
                value={chatModel}
                onChange={(event) => {
                  const model = event.target.value;
                  setChatModel(model);
                  try {
                    window.localStorage.setItem(CHAT_MODEL_KEY, model);
                  } catch {
                    // The selection still works for this session if storage is unavailable.
                  }
                }}
                disabled={Boolean(chat.activeTurnId) || chat.managementBusy}
              >
                {chatModels.map(({ id, label }) => (
                  <option value={id} key={id}>{label}</option>
                ))}
              </select>
              <div className="chat-composer-buttons">
              <ReadingVoiceButton disabledReason={voiceDisabledReason} onStart={() => void startVoiceChat()} />
              <button
                className={`chat-send-button${chat.activeTurnId ? " stop-response" : ""}`}
                type={chat.activeTurnId ? "button" : "submit"}
                aria-label={chat.activeTurnId ? "Stop response" : "Send question"}
                title={chat.activeTurnId ? "Stop response" : "Send question"}
                onClick={chat.activeTurnId ? () => void stopResponse() : undefined}
                disabled={chat.activeTurnId
                  ? chat.activeTurnId === "starting"
                  : sendingQuestion || (!draft.trim() && !draftImages.length && !inputSuggestion) || chat.connection !== "ready" || chat.managementBusy}
              >
                <span aria-hidden="true">{chat.activeTurnId ? "" : "↑"}</span>
              </button>
              </div>
            </div>
            </>}
          </div>
          {voice.state.error ? <ReadingVoiceNotice error={voice.state.error} onDismiss={voice.dismissError} /> : null}
          <small id="reading-input-suggestion-hint" className="chat-composer-hint">{inputSuggestion ? "Enter 直接送出建議 · Tab 填入修改 · Esc 隱藏" : voice.busy ? "語音內容會保留在目前閱讀對話" : "Enter 送出 · Shift+Enter 換行 · 可直接貼上圖片"}</small>
        </form>
        ) : null}
        {chatError || chat.conversationError
          ? <p className="error" role="alert">{chatError || chat.conversationError}</p>
          : null}
        </div>
        <div className="concept-video-side-panel" hidden={!videoPanelOpen}>
          {videoApi ? videoSessions.map(session => {
            const source = session.video?.source ?? session.source;
            return <div key={session.key} className="concept-video-session" hidden={session.key !== selectedVideoSession}>
              <ConceptVideoEditor api={videoApi} source={session.source} initialVideo={session.video} requestedPreviewId={session.previewId}
                sourceAvailable={Boolean(source && books.some(b => b.id === source.bookId && b.chapters.some(c => c.id === source.chapterId)))}
                onBack={() => { setVideoPanelOpen(false); setRightPanel('chat'); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Create Video"]')?.focus()); }}
                onOpenLibrary={openVideoLibrary} onSource={jumpToVideoSource}
                onChanged={video => { videoActivity.receive([video]); setVideoSessions(sessions => sessions.map(s => s.key === session.key ? { ...s, video } : s)); setVideoLibraryRevision(r => r + 1); }} />
            </div>;
          }) : videoPanelOpen ? <p role="alert">Restart the app to use AI Video.</p> : null}
        </div>
        <div className="reader-notes-tabpanel" id="reader-notes-tabpanel" role={notesAvailable ? "tabpanel" : undefined}
          aria-labelledby={notesAvailable ? "reader-notes-tab" : undefined} hidden={!showingNotes}>
          {(selectedBook && activeChapter) || completedReaderNote ? <ReaderNotesPanel key={readerNoteContext}
            api={window.readerExample.readingNotes} notes={readerNotes.notes} allNotes={readerNotes.allNotes} chapterTitle={activeChapter?.title ?? completedReaderNote?.note.chapterTitle ?? ""}
            loading={readerNotes.loading} error={readerNotes.error}
            selectedId={selectedReaderNoteId} focusedNote={completedReaderNote?.note} initialImageSide={completedReaderNote?.side} focusRequest={completedReaderNote?.requestId}
            onSelect={id => { setCompletedReaderNote(undefined); setSelectedReaderNoteId(id); }}
            onEdit={note => { setReaderNoteEditorView("note"); setEditingReaderNote(note); }}
            onVisual={note => { setReaderNoteEditorView("visual"); setEditingReaderNote(note); }}
            onSaved={note => { readerNotes.saved(note); setCompletedReaderNote(current => current?.note.id === note.id ? { ...current, note } : current); }} onCreate={openReadingNoteDraft}
            canCreate={Boolean(range && chapter?.chapterId === activeChapterId && range.end > range.start)}
            onRefresh={readerNotes.refresh}
          /> : null}
        </div>
        <div className="reader-notes-tabpanel reader-videos-tabpanel" id="reader-videos-tabpanel" role={notesAvailable ? "tabpanel" : undefined}
          aria-labelledby={notesAvailable ? "reader-videos-tab" : undefined} hidden={!showingVideos}>
          {videoApi && selectedBook && activeChapter ? <ReaderVideosPanel key={readerNoteContext}
            api={videoApi} videos={videoActivity.videos ?? []} bookId={selectedBook.id} chapterId={activeChapter.id} chapterTitle={activeChapter.title}
            loading={!videoActivity.videos} error={videoActivity.error} active={showingVideos && !chatCollapsed}
            onRefresh={videoActivity.refresh} onOpen={openSavedVideo} onCreate={openVideoPreparation}
            canCreate={Boolean(range && chapter?.chapterId === activeChapterId && range.end > range.start)} /> : null}
        </div>
          {chatCollapsed ? (
            <button className="collapsed-sidebar-toggle right" type="button" aria-label={notesAvailable ? "Expand side panel" : "Expand AI Tutor"} onClick={() => setChatCollapsed(false)}>
              <PanelToggleIcon edge="right" />
            </button>
          ) : null}
        </aside>
      </div>
      {settingsOpen ? (
        <div className="settings-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <div onMouseDown={(event) => event.stopPropagation()}>
            <AccountSettings
              snapshot={chat}
              review={window.readerExample.readingNotes.review}
              initialTab={settingsTab}
              memoryImageTemplates={window.readerExample.readingNotes.memoryImage?.templates}
              onReconnect={() => void reconnectCodex()}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </div>
      ) : null}
      {bookPendingDeletion ? (
        <DeleteBookDialog
          book={bookPendingDeletion}
          pending={deletingBook}
          onCancel={() => setBookPendingDeletionId(undefined)}
          onConfirm={() => void deleteBook()}
        />
      ) : null}
    </main>
    </CardNoteUploadProvider></HeptabaseImportProvider>
    </ReadingNoteSourceContext.Provider>
  );
}
