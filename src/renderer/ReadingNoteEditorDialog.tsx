import { ReadingNoteTagEditor } from "./ReadingNoteTags";
import { ReadingNoteReviewControl } from "./ReadingNoteReviewControl";
import { MissingVisualSettings } from "./MissingVisualSettings";
import type { MemoryImageSide, MissingVisualOptions } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";
import { ReadingNoteDefaultVisualIcon } from "./ReadingNoteDefaultVisualIcon";
import { ReadingNoteVisualLightbox } from "./ReadingNoteTwoSidedLightbox";
import { useEffect, useRef, useState, type WheelEvent, type ReactNode } from "react";
import type {
  ReaderDesktopApi,
  MemoryImagePromptSnapshot,
  MemoryImageGenerationMode,
  MemoryImageTemplate,
  MemoryImageTemplateSettings,
  ReadingNote,
  ReadingNoteMemoryImageSnapshot,
  StartReadingNoteDraftInput
} from "../shared/contracts";
import {
  CloseIcon,
  MemoryImageIcon,
  ReadingNoteCanvas,
  ReadingNoteFaceSwitch,
  RestoreIcon,
  TrashIcon
} from "./ReadingNoteCanvas";

import { CURRENT_IMAGE_PURPOSE, CURRENT_IMAGE_STYLE, MemoryImageTemplateChooser } from "./MemoryImageTemplateChooser";
import { bookMemoryImageDefaults, rememberBookMemoryImageChoices, readMemoryImageGenerationMode, rememberMemoryImageGenerationMode } from "./memory-image-preferences";
import { MemoryImageWorkflowChoice } from "./MemoryImageWorkflowChoice";
import { memoryImagePurposeGuide } from "../shared/memory-image-templates";

interface MemoryImageEditorState {
  adjustment?: string;
  id: string;
  text: string;
  request: string;
  choices?: {
    noteId: string;
    attachmentId?: string;
    purposeValue: string;
    styleValue: string;
    styleExplicit: boolean;
    extraInstruction: string;
  };
}

interface MemoryImageWorkflowState {
  mode?: MemoryImageGenerationMode;
  saveFailed?: boolean;
}

export type ReadingNoteEditorStage = "draft" | "ai" | "manual";

export function readingNoteEditorDirty(input: {
  stage: ReadingNoteEditorStage;
  userDraft: string;
  hasSession?: boolean;
  draft?: unknown;
  original?: unknown;
}): boolean {
  if (input.userDraft.trim() || input.hasSession) return true;
  if (input.stage !== "manual" || input.draft === undefined || input.original === undefined) return false;
  return JSON.stringify(input.draft) !== JSON.stringify(input.original);
}

function canScrollInDirection(element: HTMLElement, deltaY: number): boolean {
  return deltaY < 0
    ? element.scrollTop > 0
    : element.scrollTop + element.clientHeight < element.scrollHeight;
}

function scrollByWheel(element: HTMLElement, event: WheelEvent<HTMLElement>): boolean {
  const previousScrollTop = element.scrollTop;
  const multiplier = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? element.clientHeight
      : 1;
  element.scrollTop += event.deltaY * multiplier;
  if (element.scrollTop === previousScrollTop) return false;
  event.preventDefault();
  return true;
}

export function ReadingNoteEditorDialog({
  api,
  mode,
  source,
  initialDraft,
  note: suppliedNote,
  readOnly = false,
  initiallyEditing = false,
  initialView = "visual",
  onClose,
  onSaved,
  onDelete,
  onRestore,
  previewControls,
  previewContent
}: {
  api: ReaderDesktopApi["readingNotes"];
  mode: "create" | "manual-edit" | "ai-edit";
  source?: Omit<StartReadingNoteDraftInput, "userDraft">;
  note?: ReadingNote;
  initialDraft?: import("./ReadingNoteCanvas").InitialReadingNoteDraft;
  readOnly?: boolean;
  initiallyEditing?: boolean;
  initialView?: "note" | "visual";
  onClose(): void;
  onSaved(note: ReadingNote): void | Promise<void>;
  onDelete?(): void;
  onRestore?(): void;
  previewControls?: ReactNode;
  previewContent?: ReactNode;
}) {
  const [savedNote, setSavedNote] = useState<ReadingNote>();
  const note = savedNote && savedNote.id === suppliedNote?.id && savedNote.revision > suppliedNote.revision ? savedNote : suppliedNote;
  const [imageStatus, setImageStatus] = useState<ReadingNoteMemoryImageSnapshot>();
  const [quickPending, setQuickPending] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const quickChoices = useRef<MissingVisualOptions | undefined>(undefined);
  const quickRef = useRef(false);
  const saveCallback = useRef(onSaved);
  saveCallback.current = onSaved;
  function receiveImageNote(value: ReadingNote) {
    setSavedNote(current => current?.id === value.id && current.revision > value.revision ? current : value);
    void saveCallback.current(value);
  }
  useEffect(() => {
    const memory = api.memoryImage;
    if (!note || !memory || previewControls) return;
    let active = true;
    setImageStatus(undefined);
    const unsubscribe = memory.onStateChanged(state => {
      if (!active || state.noteId !== note.id) return;
      setImageStatus(state);
      if (state.note) receiveImageNote(state.note);
    });
    return () => { active = false; unsubscribe(); };
  }, [api, note?.id, Boolean(previewControls)]);
  async function generateMissingVisuals(options: MissingVisualOptions) {
    if (!note || readOnly || !api.memoryImage?.generateMissing || quickRef.current) return;
    quickRef.current = true;
    setQuickPending(true);
    try {
      const state = await api.memoryImage.generateMissing(note.id, options);
      setImageStatus(state);
      if (state.note) receiveImageNote(state.note);
    } catch (cause) {
      setImageStatus({ noteId: note.id, phase: "error", available: true,
        status: cause instanceof Error ? cause.message : "Unable to generate visuals." });
    } finally {
      quickRef.current = false;
      setQuickPending(false);
    }
  }
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAi, setPendingAi] = useState(false);
  const [aiSessionId, setAiSessionId] = useState<string>();
  const [discardConfirming, setDiscardConfirming] = useState(false);
  const supportsTwoSided = Boolean(api.memoryImage);
  const [quickPreferenceSaveFailed, setQuickPreferenceSaveFailed] = useState(false);
  const [face, setFace] = useState<"front" | "back">(
    initialView === "note" ? "front" : note && supportsTwoSided && !initiallyEditing ? "back" : "front"
  );
  const [editing, setEditing] = useState(mode === "create" || Boolean(note && !supportsTwoSided) || initiallyEditing);
  const [side, setSide] = useState<MemoryImageSide>("recall");
  const overlayRef = useRef<HTMLDivElement>(null);
  const memoryDraftEditor = useRef<Record<MemoryImageSide, MemoryImageEditorState>>({ recall: { id: "", text: "", request: "" }, understand: { id: "", text: "", request: "" } });
  const memoryWorkflow = useRef<MemoryImageWorkflowState>({});
  useEffect(() => () => {
    if (note && !readOnly) void api.memoryImage?.discard?.(note.id).catch(() => undefined);
  }, [api, note?.id, readOnly]);
  const creating = mode === "create";
  const dialogTitle = creating ? "Create a reading note" : readOnly ? "Read-only reading note" : "Edit reading note";

  function handleCanvasBack() {
    if (pendingAi || (creating && dirty)) setDiscardConfirming(true);
    else onClose();
  }

  function triggerCanvasClose() {
    if (busy) return;
    const closeTrigger = overlayRef.current
      ?.querySelector<HTMLButtonElement>(".reading-note-canvas-close-trigger");
    if (closeTrigger) closeTrigger.click();
    else handleCanvasBack();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      if (discardConfirming) setDiscardConfirming(false);
      else triggerCanvasClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      ref={overlayRef}
      className="reading-note-reader-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) triggerCanvasClose();
      }}
    >
      <section
        className={`reading-note-editor-dialog reading-note-reader-card${previewControls ? " has-preview-controls" : ""}${note && api.tags ? " has-tag-editor" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-note-floating-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={event => {
          if (!previewControls || event.key !== 'Tab') return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length);
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
      >
        <h1 id="reading-note-floating-dialog-title" className="visually-hidden">{dialogTitle}</h1>
        {previewControls ? <div className="reading-note-preview-controls">{previewControls}</div> : null}
        {readOnly && previewContent ? (
          <div className="revision-preview-body">
            <button type="button" className="revision-close" aria-label="關閉編修預覽" onClick={onClose}>關閉 ×</button>
            <div className="reading-note-revision-scroll">{previewContent}</div>
          </div>
        ) : note && !editing && face === "back" ? (
          <ReadingNoteMemoryImageBack
            key={side}
            side={side}
            workStatus={imageStatus}
            onWorkState={setImageStatus}
            quickPending={quickPending}
            onQuickGenerate={() => setQuickSetupOpen(true)}
            onSelectSide={setSide}
            draftEditor={memoryDraftEditor.current[side]}
            workflow={memoryWorkflow.current}
            api={api}
            note={note}
            readOnly={readOnly}
            onFlip={() => setFace("front")}
            onImageFlip={() => {
              const next = side === "recall" ? "understand" : "recall";
              setSide(next);
            }}
            onClose={handleCanvasBack}
            onSaved={receiveImageNote}
            onDelete={onDelete}
            onRestore={onRestore}
          />
        ) : (
          <ReadingNoteCanvas
            api={api}
            note={note}
            source={source}
            initialDraft={initialDraft}
            persistence={creating ? "explicit" : "autosave"}
            readOnly={readOnly}
            browseMode={Boolean(note && !editing)}
            onBack={handleCanvasBack}
            onFlip={note && supportsTwoSided ? (nextSide) => {
              setEditing(false);
              if (nextSide) setSide(nextSide);
              setFace("back");
            } : undefined}
            onEdit={!readOnly && note && !editing ? () => setEditing(true) : undefined}
            onDone={supportsTwoSided && note && editing ? () => setEditing(false) : undefined}
            onSaved={(saved) => {
              void onSaved(saved);
              if (creating) onClose();
            }}
            onDirtyChange={setDirty}
            onBusyChange={setBusy}
            onAiPendingChange={setPendingAi}
            onAiSessionChange={setAiSessionId}
            onDelete={onDelete}
            onRestore={onRestore}
          />
        )}
        {note && api.tags ? <ReadingNoteTagEditor key={note.id} api={api} noteId={note.id} readOnly={readOnly} /> : null}
        {quickPreferenceSaveFailed ? <small role="status" className="memory-workflow-save-warning">These choices apply now, but could not be remembered for this book.</small> : null}
        {quickSetupOpen && note && !readOnly ? <MissingVisualSettings api={api} note={note} previous={quickChoices.current}
          onCancel={() => setQuickSetupOpen(false)} onGenerate={(options, saveFailed) => {
            setQuickPreferenceSaveFailed(Boolean(saveFailed));
            quickChoices.current = options; setQuickSetupOpen(false); void generateMissingVisuals(options);
          }} /> : null}
        {discardConfirming ? (
          <div className="reading-note-discard-backdrop" onMouseDown={(event) => event.stopPropagation()}>
            <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-reading-note-editor-title">
              <span className="delete-dialog-icon" aria-hidden="true">!</span>
              <h2 id="discard-reading-note-editor-title">{pendingAi ? "Discard unapplied AI changes?" : "Discard this reading-note draft?"}</h2>
              <p>{pendingAi ? "The AI conversation and its unapplied suggestion will be cleared. Your note will stay at the last applied version." : "Your writing and AI changes will be lost."}</p>
              <div className="delete-dialog-actions">
                <button type="button" onClick={() => setDiscardConfirming(false)}>Keep editing</button>
                <button className="danger-action" type="button" onClick={() => {
                  if (aiSessionId) void Promise.resolve(api.ai.discard(aiSessionId)).catch(() => undefined);
                  onClose();
                }}>Discard changes</button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ReadingNoteMemoryImageBack({
  side,
  workStatus, quickPending, onQuickGenerate, onSelectSide, onWorkState,
  draftEditor, workflow,
  api,
  note,
  readOnly,
  onFlip,
  onImageFlip,
  onClose,
  onSaved,
  onDelete,
  onRestore
}: {
  side: MemoryImageSide;
  workStatus?: ReadingNoteMemoryImageSnapshot;
  onWorkState(state: ReadingNoteMemoryImageSnapshot): void;
  quickPending: boolean;
  onQuickGenerate(): void;
  onSelectSide(side: MemoryImageSide): void;
  draftEditor: MemoryImageEditorState;
  workflow: MemoryImageWorkflowState;
  api: ReaderDesktopApi["readingNotes"];
  note: ReadingNote;
  readOnly: boolean;
  onFlip(): void;
  onImageFlip(): void;
  onClose(): void;
  onSaved(note: ReadingNote): void | Promise<void>;
  onDelete?(): void;
  onRestore?(): void;
}) {
  const currentImage = readingNoteImage(note, side);
  const controlsOpen = !readOnly;
  const [snapshot, setSnapshot] = useState<ReadingNoteMemoryImageSnapshot>({
    noteId: note.id,
    phase: "ready",
    available: true,
    status: "Loading memory image capability…"
  });
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageExpanded, setImageExpanded] = useState(false);
  const [draftText, setDraftText] = useState(draftEditor.text);
  const [followUp, setFollowUp] = useState(draftEditor.request);
  const [pending, setPending] = useState(false);
  const submittingRef = useRef(false);
  useEffect(() => {
    if (snapshot.draft && snapshot.draft.id !== draftEditor.id) {
      draftEditor.id = snapshot.draft.id;
      draftEditor.text = snapshot.draft.text;
      setDraftText(snapshot.draft.text);
    }
  }, [snapshot.draft?.id, snapshot.draft?.text, draftEditor]);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [templates, setTemplates] = useState<MemoryImageTemplateSettings>();
  const loadedChoicesFor = useRef<{ noteId: string; attachmentId?: string } | undefined>(undefined);
  const [purposeValue, setPurposeValue] = useState("");
  const [styleValue, setStyleValue] = useState("");
  const [styleExplicit, setStyleExplicit] = useState(false);
  const [extraInstruction, setExtraInstruction] = useState(currentImage?.recipe?.extraInstruction ?? "");
  const [adjustment, setAdjustment] = useState(draftEditor.adjustment ?? "");
  const [extraExpanded, setExtraExpanded] = useState(false);
  const [generationMode, setGenerationMode] = useState<MemoryImageGenerationMode>(() => workflow.mode ?? readMemoryImageGenerationMode(note.bookTitle));
  const [preferenceSaveFailed, setPreferenceSaveFailed] = useState(workflow.saveFailed ?? false);
  const [composerMode, setComposerMode] = useState<"adjust" | "generate">(currentImage ? "adjust" : "generate");
  useEffect(() => { setComposerMode(currentImage ? "adjust" : "generate"); }, [currentImage?.attachmentId]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const imagePurposeValue = CURRENT_IMAGE_PURPOSE;
  const imageStyleValue = CURRENT_IMAGE_STYLE;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    const memoryImage = api.memoryImage;
    if (!memoryImage) {
      setSnapshot({ noteId: note.id, phase: "unavailable", available: false, status: "Memory image generation is unavailable." });
      return () => { current = false; };
    }
    void memoryImage.getState(note.id, side).then((state) => {
      if (current) { setSnapshot(state.side && state.side !== side ? { ...state, draft: undefined } : state); onWorkState(state); }
    });
    void memoryImage.templates.get().then((settings) => {
      if (!current) return;
      loadedChoicesFor.current = { noteId: note.id, attachmentId: currentImage?.attachmentId };
      setTemplates(settings);
      const saved = draftEditor.choices;
      const cached = saved?.noteId === note.id && saved.attachmentId === currentImage?.attachmentId ? saved : undefined;
      const validPurpose = cached && (cached.purposeValue === imagePurposeValue && currentImage?.recipe || settings.purposes.some(({ id }) => id === cached.purposeValue));
      const validStyle = cached && (cached.styleValue === imageStyleValue && currentImage?.recipe || settings.styles.some(({ id }) => id === cached.styleValue));
      const defaults = bookMemoryImageDefaults(settings, side, note.bookTitle);
      setPurposeValue(validPurpose ? cached!.purposeValue : currentImage?.recipe ? imagePurposeValue : defaults.purposeId);
      setStyleValue(validStyle ? cached!.styleValue : currentImage?.recipe ? imageStyleValue : defaults.styleId);
      setStyleExplicit(cached?.styleExplicit ?? Boolean(currentImage?.recipe || defaults.styleExplicit));
      setExtraInstruction(cached?.extraInstruction ?? currentImage?.recipe?.extraInstruction ?? "");
      setExtraExpanded(Boolean(cached?.extraInstruction ?? currentImage?.recipe?.extraInstruction));
    }).catch((cause) => {
      if (current) setSnapshot({
        noteId: note.id,
        phase: "error",
        available: true,
        status: cause instanceof Error ? cause.message : "Unable to load memory image templates."
      });
    });
    const unsubscribe = memoryImage.onStateChanged((state) => {
      if (current && state.noteId === note.id) {
        setSnapshot(state.side && state.side !== side ? { ...state, draft: undefined } : state);
      }
    });
    return () => { current = false; unsubscribe(); };
  }, [api, note.id, currentImage?.attachmentId]);

  useEffect(() => {
    if (!templates || !purposeValue || !styleValue || loadedChoicesFor.current?.noteId !== note.id ||
      loadedChoicesFor.current.attachmentId !== currentImage?.attachmentId) return;
    draftEditor.choices = { noteId: note.id, attachmentId: currentImage?.attachmentId,
      purposeValue, styleValue, styleExplicit, extraInstruction };
  }, [templates, purposeValue, styleValue, styleExplicit, extraInstruction, note.id, currentImage?.attachmentId, draftEditor]);

  useEffect(() => {
    let current = true;
    setImageUrl(undefined);
    if (currentImage) {
      void api.attachments.readDataUrl(currentImage.attachmentId)
        .then((url) => { if (current) setImageUrl(url); })
        .catch(() => undefined);
    }
    return () => { current = false; };
  }, [api, currentImage?.attachmentId]);


  function selectedSnapshot(
    value: string,
    items: MemoryImageTemplate[],
    current: MemoryImagePromptSnapshot | undefined,
    currentValue: string
  ): MemoryImagePromptSnapshot | undefined {
    if (value === currentValue && current) return current;
    const selected = items.find(({ id }) => id === value);
    return selected
      ? { id: selected.id, name: selected.name, prompt: selected.prompt }
      : undefined;
  }

  async function generate() {
    if (!api.memoryImage || !templates) return;
    const purpose = selectedSnapshot(
      purposeValue, templates.purposes, currentImage?.recipe?.purpose, imagePurposeValue);
    const style = selectedSnapshot(
      styleValue, templates.styles, currentImage?.recipe?.style, imageStyleValue);
    if (!purpose || !style) return;
    try {
      const next = await api.memoryImage.generate({
        noteId: note.id, side,
        ...(generationMode === "direct" ? { generationMode } : {}),
        purpose,
        style,
        ...(extraInstruction.trim() ? { extraInstruction: extraInstruction.trim() } : {})
      });
      if (mountedRef.current) setSnapshot(next);
    } catch (cause) {
      if (mountedRef.current) setSnapshot({
        noteId: note.id,
        phase: "error",
        available: true,
        status: cause instanceof Error ? cause.message : "Unable to generate the memory image."
      });
    }
  }

  async function adjustMemoryImage() {
    if (!api.memoryImage || !adjustment.trim()) return;
    try {
      const next = await api.memoryImage.adjust({ noteId: note.id, side, instruction: adjustment.trim(), ...(generationMode === "direct" ? { generationMode } : {}) });
      if (mountedRef.current) {
        setSnapshot(next);
        if (next.phase === "ready") { setAdjustment(""); draftEditor.adjustment = ""; }
      }
    } catch (cause) {
      if (mountedRef.current) setSnapshot({
        noteId: note.id,
        phase: "error",
        available: true,
        status: cause instanceof Error ? cause.message : "Unable to adjust the memory image."
      });
    }
  }

  async function removeMemoryImage() {
    if (!api.memoryImage || removing) return;
    setRemoving(true);
    try {
      const next = await api.memoryImage.remove(note.id, side);
      if (!mountedRef.current) return;
      setSnapshot(next);
      setRemoveConfirming(false);
      if (next.note) await onSaved(next.note);
    } catch (cause) {
      if (mountedRef.current) {
        setSnapshot({
          noteId: note.id,
          phase: "error",
          available: true,
          status: cause instanceof Error ? cause.message : "Unable to remove the memory image."
        });
      }
    } finally {
      if (mountedRef.current) setRemoving(false);
    }
  }

  const effectiveMode = snapshot.draft?.mode ?? (currentImage ? composerMode : "generate");
  const composerValue = snapshot.draft ? followUp : effectiveMode === "adjust" ? adjustment : extraInstruction;
  const generating = pending || quickPending || workStatus?.batch?.phase === "running" || snapshot.phase === "generating" || snapshot.phase === "preparing";
  const currentPurpose = currentImage?.recipe?.purpose ??
    templates?.purposes.find(({ id }) => id === templates.defaultPurposeId);
  const currentStyle = currentImage?.recipe?.style ??
    templates?.styles.find(({ id }) => id === templates.defaultStyleId);
  const submitLabel = snapshot.draft ? "Revise text draft" : generationMode === "review" ? "Prepare text draft" : effectiveMode === "adjust" ? "Adjust image" : currentImage ? "Regenerate image" : "Generate image";
  const optionalRequest = !snapshot.draft && effectiveMode === "generate";
  const requestCollapsed = optionalRequest && !extraExpanded;
  const missingSides = (["understand", "recall"] as const).filter(value => !readingNoteImage(note, value));
  const failedMissing = workStatus?.batch?.phase === "error" || workStatus?.batch?.phase === "stopped";
  const missingLabel = failedMissing ? "Retry missing visuals" : missingSides.length === 2 ? "Generate both visuals" : "Generate missing visual";
  const missingDescription = missingSides.length === 2
    ? "Front and back visuals are missing"
    : `${missingSides[0] === "understand" ? "Front" : "Back"} visual is missing`;

  function setComposerValue(value: string) {
    if (snapshot.draft) { setFollowUp(value); draftEditor.request = value; }
    else if (effectiveMode === "adjust") { setAdjustment(value); draftEditor.adjustment = value; }
    else setExtraInstruction(value);
  }

  async function draftAction(action: "revise" | "confirm") {
    if (!snapshot.draft || !api.memoryImage) return;
    try {
      const next = await api.memoryImage[action]({ noteId: note.id, side, draftId: snapshot.draft.id,
        text: draftText, ...(action === "revise" ? { instruction: followUp } : {}) });
      if (mountedRef.current) { setSnapshot(next); if (next.phase === "ready") { setFollowUp(""); draftEditor.request = ""; } }
    } catch (cause) {
      if (mountedRef.current) setSnapshot((previous) => ({ ...previous, phase: "error",
        status: cause instanceof Error ? cause.message : "Unable to process the text draft." }));
    }
  }

  async function runAction(action: () => Promise<void>) {
    if (readOnly || submittingRef.current || generating) return;
    submittingRef.current = true;
    setPending(true);
    try { await action(); } finally { submittingRef.current = false; if (mountedRef.current) setPending(false); }
  }

  function submitMemoryImage() {
    if (snapshot.draft ? !followUp.trim() || !draftText.trim() : effectiveMode === "adjust" && !adjustment.trim()) return;
    void runAction(() => snapshot.draft ? draftAction("revise") : effectiveMode === "adjust" ? adjustMemoryImage() : generate());
  }

  async function discardDraft(requireSuccess = false) {
    if (requireSuccess) await api.memoryImage?.discard?.(note.id, side);
    setSnapshot((previous) => ({ ...previous, draft: undefined }));
    draftEditor.id = ""; draftEditor.text = ""; draftEditor.request = "";
    setDraftText(""); setFollowUp("");
    if (!requireSuccess) await api.memoryImage?.discard?.(note.id, side).catch(() => undefined);
  }

  function changeGenerationMode(mode: MemoryImageGenerationMode) {
    if (mode === generationMode || generating || readOnly) return;
    const applyMode = () => {
      setGenerationMode(mode);
      workflow.mode = mode;
      workflow.saveFailed = !rememberMemoryImageGenerationMode(mode, note.bookTitle);
      setPreferenceSaveFailed(workflow.saveFailed);
    };
    if (!snapshot.draft) { applyMode(); return; }
    void runAction(async () => {
      try {
        await discardDraft(true);
        if (!mountedRef.current) return;
        applyMode();
        setSnapshot((previous) => ({ ...previous, phase: "ready", status: "Text draft discarded." }));
      } catch (cause) {
        if (mountedRef.current) setSnapshot((previous) => ({ ...previous, phase: "error",
          status: cause instanceof Error ? cause.message : "Unable to change generation workflow." }));
      }
    });
  }

  function changeImageChoices(purpose: string, style: string, explicitStyle: boolean) {
    if (purpose === purposeValue && style === styleValue) { setStyleExplicit(explicitStyle); return; }
    void runAction(async () => {
      try {
        if (snapshot.draft) await discardDraft(true);
        if (!mountedRef.current) return;
        setPurposeValue(purpose);
        setStyleValue(style);
        setStyleExplicit(explicitStyle);
        // Historical image snapshots are note-specific, never book templates.
        const purposeId = templates?.purposes.find(item => item.id === purpose)?.id;
        const styleId = templates?.styles.find(item => item.id === style)?.id;
        if (purposeId || styleId) setPreferenceSaveFailed(!rememberBookMemoryImageChoices(note.bookTitle, side, {
          ...(purposeId ? { purposeId } : {}), ...(styleId ? { styleId, styleExplicit: explicitStyle } : {})
        }));
      } catch (cause) {
        if (mountedRef.current) setSnapshot((previous) => ({ ...previous, phase: "error",
          status: cause instanceof Error ? cause.message : "Unable to change the image selection. Try again." }));
      }
    });
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content || !event.deltaY) return;

    const target = event.target instanceof Node ? event.target : null;
    const textarea = event.target instanceof Element
      ? event.target.closest<HTMLTextAreaElement>("textarea")
      : null;
    if (textarea && canScrollInDirection(textarea, event.deltaY)) return;

    const composer = event.target instanceof Element ? event.target.closest<HTMLElement>(".reading-note-memory-composer") : null;
    if (composer && canScrollInDirection(composer, event.deltaY)) return;
    const targetIsInContent = Boolean(target && content.contains(target));
    if (targetIsInContent && canScrollInDirection(content, event.deltaY)) return;

    if (canScrollInDirection(body, event.deltaY) && scrollByWheel(body, event)) return;
    if (!targetIsInContent && canScrollInDirection(content, event.deltaY)) {
      scrollByWheel(content, event);
    }
  }

  return (
    <article
      className={`reading-note-memory-back has-visual-tools ${controlsOpen ? "image-controls-open" : "image-controls-closed"} ${currentImage ? "has-memory-image" : "is-empty"}`}
      role="region"
      aria-label={side === "recall" ? "Reading note back" : "Understanding image editor"}
      onWheel={handleWheel}
    >
      <header className="reading-note-canvas-toolbar">
        <ReadingNoteFaceSwitch face="back" onSelect={onFlip} />
        <div className="reading-note-canvas-actions">
          {!readOnly ? <ReadingNoteReviewControl api={api.review} note={note} /> : null}
          {!readOnly && onDelete ? (
            <button
              type="button"
              className="reading-note-canvas-tool-button reading-note-canvas-trash"
              aria-label="Move to Trash"
              title="Move to Trash"
              onClick={onDelete}
            ><TrashIcon /></button>
          ) : null}
          <button
            type="button"
            className="reading-note-canvas-tool-button reading-note-canvas-close reading-note-canvas-close-trigger"
            aria-label="Close reading note"
            title="Close reading note"
            onClick={onClose}
          ><CloseIcon /></button>
        </div>
      </header>
      <div ref={bodyRef} className="reading-note-memory-back-body">
        <section className="reading-note-memory-visual" aria-label="Memory image" data-side={side}>
          <div className="reading-note-visual-caption">
            <span className="reading-note-visual-face" role="status">{side === "recall" ? "Recall · Back" : "Understanding · Front"}</span>
            {controlsOpen ? <button type="button" className="reading-note-visual-switch"
              aria-label={side === "recall" ? "Select front visual" : "Select back visual"}
              onClick={() => onSelectSide(side === "recall" ? "understand" : "recall")}>
              {side === "recall" ? "Edit front ↔" : "Edit back ↔"}
            </button> : <span className="reading-note-visual-hint">Click image to flip</span>}
          </div>
          <div className="reading-note-memory-image-frame">
            {imageUrl ? <button type="button" className="reading-note-image-expand"
              aria-label={`Enlarge ${side === "recall" ? "recall" : "understanding"} image for ${note.title}`}
              onClick={() => setImageExpanded(true)}>
              <img src={imageUrl} alt={`Memory image for ${note.title}`} />
            </button> : (
              <button type="button" className="reading-note-memory-empty reading-note-empty-flip"
                disabled={controlsOpen} onClick={onImageFlip}
                aria-label={side === "recall" ? "Flip to understanding image" : "Flip to recall image"}>
                <ReadingNoteDefaultVisualIcon side={side} />
                <strong>No {side === "recall" ? "recall" : "understanding"} image yet</strong>
                <p>Generate one when you want a visual cue for this note.</p>
              </button>
            )}
          </div>
          {imageExpanded ? <ReadingNoteVisualLightbox
            note={note}
            initialSide={side}
            readAttachmentDataUrl={api.attachments.readDataUrl}
            onClose={() => setImageExpanded(false)}
          /> : null}
          {readOnly && onRestore ? <button type="button" onClick={onRestore}>Restore</button> : null}

        </section>
        <aside hidden={readOnly} className={`reading-note-memory-ai-panel${effectiveMode === "adjust" ? " is-adjusting" : ""}`} aria-label="Memory Image AI">
          <header className="chat-header reading-note-memory-ai-header">
            <div className="chat-title">
              <span className={`status ${snapshot.phase === "ready" ? "ready" : snapshot.phase}`} />
              <strong>{side === "understand" ? "Front visual" : "Back visual"}</strong>
            </div>
            {!readOnly && api.memoryImage?.generateMissing && missingSides.length ? (
              <span className="reading-note-memory-header-action">
                {generating ? (
                  <span className="reading-note-memory-generation-status" role="status">✦ Generating…</span>
                ) : (
                  <button type="button" title={missingDescription} onClick={onQuickGenerate}>
                    <span aria-hidden="true">✦</span>{missingLabel}
                  </button>
                )}
              </span>
            ) : <span className="reading-note-memory-ai-icon" aria-hidden="true"><MemoryImageIcon /></span>}
          </header>
          {failedMissing ? <p className="reading-note-missing-visual-error" role="alert">{workStatus?.status || "Visual generation stopped."}</p> : null}
          <div ref={contentRef} className="reading-note-memory-ai-content">
            {!readOnly && currentImage ? (
              <div className="reading-note-memory-mode-switch" role="group" aria-label="Memory image operation">
                <button
                  type="button"
                  aria-label="Use Adjust current mode"
                  aria-pressed={effectiveMode === "adjust"}
                  disabled={generating}
                  onClick={() => { void discardDraft(); setComposerMode("adjust"); }}
                >Adjust current</button>
                <button
                  type="button"
                  aria-label="Use Generate new mode"
                  aria-pressed={effectiveMode === "generate"}
                  disabled={generating}
                  onClick={() => { void discardDraft(); setComposerMode("generate"); }}
                >Generate new</button>
              </div>
            ) : null}
            <section className="reading-note-memory-context" aria-label="Memory image context" role="note">
              <span className="reading-note-memory-eyebrow">{currentImage ? "Current visual" : "Create from this note"}</span>
              <strong>{note.title}</strong>
              {templates ? (
                effectiveMode === "generate" && !readOnly ? (
                  <MemoryImageTemplateChooser
                    fixedGoal={side === "recall" ? "remember" : "understand"}
                    templates={templates} purposeValue={purposeValue} styleValue={styleValue}
                    currentPurpose={currentImage?.recipe?.purpose} currentStyle={currentImage?.recipe?.style}
                    styleExplicit={styleExplicit} disabled={generating} compact={Boolean(snapshot.draft)}
                    onChange={changeImageChoices}
                  />
                ) : currentPurpose && currentStyle ? (
                  <p className="reading-note-memory-current-template">
                    <strong>{currentPurpose.name} · {currentStyle.name}</strong>
                  </p>
                ) : null
              ) : null}
              {!readOnly && effectiveMode === "generate" ? <p className="memory-choice-summary">Choices are remembered for this book.</p> : null}
              {!readOnly && currentImage && !generating ? (
                <div className="reading-note-memory-context-actions">
                  <button
                    type="button"
                    className="reading-note-memory-remove"
                    aria-label="Remove memory image"
                    onClick={() => setRemoveConfirming(true)}
                  >Remove image</button>
                </div>
              ) : null}
            </section>
            {effectiveMode === "adjust" && currentImage?.recipe?.adjustments.length ? (
              <details className="reading-note-memory-last-adjustment">
                <summary>Last adjustment</summary>
                <p>{currentImage.recipe.adjustments.at(-1)}</p>
              </details>
            ) : null}
          </div>
          {snapshot.phase !== "ready" ? <div className="reading-note-memory-feedback">
            <div className={`reading-note-memory-state ${snapshot.phase}`}>
              <span aria-hidden="true" />
              <p className="reading-note-memory-status" role="status">{snapshot.status}</p>
            </div>
            {!readOnly && (snapshot.phase === "unavailable" || snapshot.phase === "error") ? (
              <button
                type="button"
                aria-label="Retry memory image availability"
                onClick={() => void api.memoryImage?.getState(note.id, side).then(setSnapshot)}
              >Retry</button>
            ) : null}
          </div> : null}
          {!readOnly ? (
            <form className={`chat-form reading-note-memory-composer${requestCollapsed ? " request-collapsed" : ""}`} onSubmit={(event) => {
              event.preventDefault();
              submitMemoryImage();
            }}>
              <MemoryImageWorkflowChoice value={generationMode} disabled={generating}
                hasDraft={Boolean(snapshot.draft)} onChange={changeGenerationMode} />
              {preferenceSaveFailed ? <small role="status" className="memory-workflow-save-warning">This choice applies now, but could not be remembered for next time.</small> : null}
              {snapshot.draft ? (
                <section className="reading-note-memory-draft" aria-label="Memory image text draft">
                  <div className="memory-draft-heading">
                    <span className="memory-draft-badge">Text draft</span>
                    <label htmlFor="memory-image-draft">Make the image your own</label>
                  </div>
                  <textarea id="memory-image-draft" aria-label="Memory image text draft" rows={7}
                    maxLength={12_000} value={snapshot.draft.id === draftEditor.id ? draftText : snapshot.draft.text} disabled={generating}
                    onChange={(event) => { draftEditor.id = snapshot.draft!.id; setDraftText(event.target.value); draftEditor.text = event.target.value; }} />
                  <div className="reading-note-memory-draft-actions">
                    <button type="button" disabled={generating} onClick={() => void discardDraft()}>Discard draft</button>
                    <button type="button" className="reading-note-memory-submit"
                      disabled={generating || !draftText.trim() || snapshot.draft.baseRevision !== note.revision}
                      onClick={() => void runAction(() => draftAction("confirm"))}>Confirm and apply</button>
                  </div>
                  <small>{snapshot.draft.baseRevision !== note.revision
                    ? "This note changed. Discard this draft and prepare a new one."
                    : "The image changes only after you confirm."}</small>
                </section>
              ) : null}
              {snapshot.draft ? <p className="reading-note-memory-request-hint">{
                memoryImagePurposeGuide(purposeValue)?.goal === "remember"
                  ? "Want a more familiar association? Ask AI to revise the draft."
                  : "Want to refine an idea or relationship? Ask AI to revise the draft."}</p> : null}
              <div className="chat-composer-card">
                <textarea
                  aria-label="Memory image request"
                  hidden={requestCollapsed}
                  rows={3}
                  value={composerValue}
                  maxLength={2_000}
                  disabled={generating}
                  placeholder={snapshot.draft ? "How should AI revise this description?" : effectiveMode === "adjust"
                    ? "What would you like to change? For example, make the categories more distinct."
                    : "Optional details for a new image…"}
                  onChange={(event) => setComposerValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="chat-composer-actions">
                  {optionalRequest ? <button type="button" className="memory-optional-request-toggle"
                    disabled={generating} aria-expanded={!requestCollapsed}
                    onClick={() => setExtraExpanded(!extraExpanded)}
                  >{requestCollapsed ? extraInstruction.trim() ? "Edit optional details" : "Add optional details" : "Hide optional details"}</button> : null}
                  <button
                    type={generating ? "button" : "submit"}
                    className={`reading-note-memory-submit${generating ? " stop-response" : ""}`}
                    aria-label={generating ? "Stop generation" : submitLabel}
                    title={generating ? "Stop generation" : submitLabel}
                    disabled={!generating && (snapshot.draft ? !followUp.trim() || !draftText.trim() : effectiveMode === "adjust" ? !adjustment.trim() : !templates)}
                    onClick={generating ? () => void api.memoryImage?.stop(note.id) : undefined}
                  >{generating ? "Stop generation" : submitLabel}</button>
                </div>
              </div>
              {!requestCollapsed ? <small className="chat-composer-hint">Enter to send · Shift+Enter for a new line</small> : null}
            </form>
          ) : onRestore ? (
            <div className="reading-note-memory-read-only-actions">
              <button type="button" className="reading-note-canvas-tool-button reading-note-canvas-restore" onClick={onRestore}><RestoreIcon /><span>Restore</span></button>
            </div>
          ) : null}
        </aside>
      </div>
      {removeConfirming ? (
        <div className="reading-note-discard-backdrop" onMouseDown={(event) => event.stopPropagation()}>
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-memory-image-title">
            <span className="delete-dialog-icon" aria-hidden="true">!</span>
            <h2 id="remove-memory-image-title">Remove memory image?</h2>
            <p>The note content will stay unchanged. You can generate a new memory image later.</p>
            <div className="delete-dialog-actions">
              <button type="button" disabled={removing} onClick={() => setRemoveConfirming(false)}>Cancel</button>
              <button className="danger-action" type="button" disabled={removing} onClick={() => void removeMemoryImage()}>
                {removing ? "Removing…" : "Remove image"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}
