import { memoryImageDefaults, purposeMatchesSide } from "../shared/memory-image-defaults";
import { useEffect, useId, useRef, useState } from "react";
import { memoryImagePurposeGuide, memoryImageStyleGuide } from "../shared/memory-image-templates";
import { MemoryImageStyleSample, MemoryImageTemplatePreview } from "./MemoryImageTemplatePreview";
import type {
  MemoryImageSide,
  MemoryImageTemplate,
  MemoryImageTemplateKind,
  MemoryImageTemplateSettings,
  ReaderDesktopApi
} from "../shared/contracts";

type TemplatesApi = NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>["templates"];

interface EditingTemplate {
  kind: MemoryImageTemplateKind;
  id?: string;
  side?: MemoryImageSide;
  name: string;
  prompt: string;
}

export function MemoryImageSettings({ api }: { api: TemplatesApi }) {
  const [side, setSide] = useState<MemoryImageSide>("understand");
  const [savedMessage, setSavedMessage] = useState("");
  const sideTabs = useRef<Partial<Record<MemoryImageSide, HTMLButtonElement | null>>>({});
  const id = useId();
  const [settings, setSettings] = useState<MemoryImageTemplateSettings>();
  const [editing, setEditing] = useState<EditingTemplate>();
  const [pendingDeletion, setPendingDeletion] = useState<MemoryImageTemplate>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    void api.get()
      .then((next) => { if (current) setSettings(next); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Unable to load memory image settings."); });
    return () => { current = false; };
  }, [api]);

  useEffect(() => {
    if (editorFocusRequest > 0) nameInputRef.current?.focus();
  }, [editorFocusRequest]);

  useEffect(() => {
    if (pendingDeletion) deleteCancelRef.current?.focus();
  }, [pendingDeletion]);

  async function mutate(operation: () => Promise<MemoryImageTemplateSettings>, message = "") {
    setBusy(true);
    setError("");
    setSavedMessage("");
    try {
      setSettings(await operation());
      setSavedMessage(message);
      setEditing(undefined);
      setPendingDeletion(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update memory image settings.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing?.name.trim() || !editing.prompt.trim()) return;
    const input = {
      kind: editing.kind,
      ...(editing.kind === "purpose" ? { side: editing.side } : {}),
      name: editing.name.trim(),
      prompt: editing.prompt.trim()
    };
    await mutate(() => editing.id
      ? api.update({ ...input, id: editing.id })
      : api.create(input));
  }

  function startCreate(kind: MemoryImageTemplateKind) {
    setEditing({ kind, side: kind === "purpose" ? side : undefined, name: "", prompt: "" });
    setEditorFocusRequest((request) => request + 1);
  }

  function startCopy(item: MemoryImageTemplate) {
    setEditing({ kind: item.kind, side: item.kind === "purpose" ? side : undefined, name: `${item.name} copy`, prompt: item.prompt });
    setEditorFocusRequest((request) => request + 1);
  }

  function startEdit(item: MemoryImageTemplate) {
    setEditing({ kind: item.kind, id: item.id, side: item.side ?? side, name: item.name, prompt: item.prompt });
    setEditorFocusRequest((request) => request + 1);
  }

  function list(
    kind: MemoryImageTemplateKind,
    title: string,
    items: MemoryImageTemplate[],
    defaultId: string
  ) {
    return (
      <section className="memory-image-template-section" aria-labelledby={`memory-image-${kind}-title`}>
        <header>
          <div>
            <h3 id={`memory-image-${kind}-title`}>{title}</h3>
            <p>{kind === "purpose" ? "How the note becomes a useful visual." : "How the final image looks and feels."}</p>
          </div>
          <button type="button" aria-label={`Add ${kind}`} onClick={() => startCreate(kind)}>Add</button>
        </header>
        <div className="memory-image-template-list">
          {items.map((item) => (
            <article className="memory-image-template-card" key={item.id}>
              <header>
                <strong>{item.name}</strong>
                <span>{item.builtIn ? "Built-in" : item.id === defaultId ? "Default" : "Custom"}</span>
              </header>
              {kind === "purpose" && memoryImagePurposeGuide(item.id) ? <>
                <MemoryImageTemplatePreview diagram={memoryImagePurposeGuide(item.id)!.diagram} />
                <p>{memoryImagePurposeGuide(item.id)!.title}. {memoryImagePurposeGuide(item.id)!.description}</p>
              </> : kind === "style" && memoryImageStyleGuide(item.id) ? <>
                <MemoryImageStyleSample appearance={memoryImageStyleGuide(item.id)!.appearance} />
                <p>{memoryImageStyleGuide(item.id)!.description}</p>
              </> : <p>{item.builtIn ? "Additional built-in template." : "Your custom template."}</p>}
              <details className="memory-template-instructions">
                <summary>View instructions</summary>
                <p>{item.prompt}</p>
              </details>
              <div>
                <button
                  type="button"
                  aria-label={`Set ${item.name} as default`}
                  disabled={busy}
                  aria-pressed={item.id === defaultId}
                  onClick={() => void mutate(() => api.setDefault({ kind, id: item.id, side }))}
                >{item.id === defaultId ? "Default" : "Set default"}</button>
                {item.builtIn ? (
                  <button type="button" aria-label={`Copy ${item.name}`} onClick={() => startCopy(item)}>Copy</button>
                ) : (
                  <>
                    <button type="button" aria-label={`Edit ${item.name}`} onClick={() => startEdit(item)}>Edit</button>
                    <button type="button" aria-label={`Delete ${item.name}`} onClick={() => setPendingDeletion(item)}>Delete</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  const defaults = settings ? memoryImageDefaults(settings, side) : undefined;
  const label = side === "understand" ? "Front" : "Back";
  const purposes = settings?.purposes.filter(item => purposeMatchesSide(item, side)) ?? [];
  const purposeGuide = memoryImagePurposeGuide(defaults?.purposeId);
  const styleGuide = memoryImageStyleGuide(defaults?.styleId);
  function saveDefault(kind: MemoryImageTemplateKind, templateId: string) {
    void mutate(() => api.setDefault({ kind, id: templateId, side }), `${label} defaults saved.`);
  }
  function selectSide(next: MemoryImageSide, focus = false) {
    setSide(next);
    setSavedMessage("");
    if (focus) sideTabs.current[next]?.focus();
  }

  return (
    <div className="memory-image-settings" aria-label="Memory image settings">
      <p className="memory-settings-hint">Choose the default look for new card images.</p>
      <div className="memory-settings-side-tabs" role="tablist" aria-label="Card side settings">
        {(["understand", "recall"] as const).map(item => <button key={item} type="button" role="tab"
          ref={element => { sideTabs.current[item] = element; }}
          disabled={busy} id={`${id}-tab-${item}`} aria-controls={`${id}-panel`} aria-selected={side === item}
          tabIndex={side === item ? 0 : -1} onClick={() => selectSide(item)}
          onKeyDown={event => {
            if (busy) return;
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            selectSide(event.key === "Home" ? "understand" : event.key === "End" ? "recall" : side === "understand" ? "recall" : "understand", true);
          }}>
          <strong>{item === "understand" ? "Front · Understanding" : "Back · Recall"}</strong>
        </button>)}
      </div>
      <section className="memory-settings-side-page" role="tabpanel" tabIndex={0} id={`${id}-panel`} aria-labelledby={`${id}-tab-${side}`}>
        <p className="memory-settings-side-description">{side === "understand" ? "Front: explain the idea with a clear visual." : "Back: use a visual cue to recall the idea."}</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {settings && defaults ? <>
          <div className="memory-settings-fields">
            <div className="memory-settings-field">
              <div className="memory-settings-sample" aria-hidden="true"><MemoryImageTemplatePreview diagram={purposeGuide?.diagram} /></div>
              <label htmlFor={`${id}-purpose`}>
                <span id={`${id}-purpose-label`}>Image type</span>
                <select id={`${id}-purpose`} aria-labelledby={`${id}-purpose-label`} aria-describedby={purposeGuide ? `${id}-purpose-description` : undefined} value={defaults.purposeId} disabled={busy}
                  onChange={event => saveDefault("purpose", event.target.value)}>
                  {purposes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                {purposeGuide ? <small id={`${id}-purpose-description`}>{purposeGuide.title}</small> : null}
              </label>
            </div>
            <div className="memory-settings-field">
              <div className="memory-settings-sample" aria-hidden="true"><MemoryImageStyleSample appearance={styleGuide?.appearance} /></div>
              <label htmlFor={`${id}-style`}>
                <span>Style</span>
                <select id={`${id}-style`} value={defaults.styleId} disabled={busy}
                  onChange={event => saveDefault("style", event.target.value)}>
                  {settings.styles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </div>
          </div>
          <p className="memory-settings-save-status" role="status">{busy ? "Saving…" : savedMessage || "Saved automatically"}</p>
          <details className="memory-settings-template-library" key={`library-${side}`}>
            <summary>Advanced</summary>
            <p>Purpose templates belong to one side. Style templates are shared. Each side keeps its own defaults.</p>
            {list("purpose", "Purposes", settings.purposes.filter(item => purposeMatchesSide(item, side)), defaults.purposeId)}
            {list("style", "Styles", settings.styles, defaults.styleId)}
          </details>
        </> : <p role="status">Loading memory image settings…</p>}
      </section>
      {editing ? (
        <div
          className="dialog-backdrop memory-image-template-dialog-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setEditing(undefined);
          }}
        >
          <section
            className="memory-image-template-editor memory-image-template-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${editing.id ? "Edit" : "Create"} ${editing.kind} template`}
          >
            <header>
              <h3>{editing.id ? "Edit" : "Create"} {editing.kind}</h3>
              <button type="button" aria-label="Cancel template editing" onClick={() => setEditing(undefined)}>×</button>
            </header>
            {editing.kind === "purpose" ? <label>
              <span>Card side</span>
              <select aria-label="Template card side" value={editing.side}
                onChange={event => setEditing({ ...editing, side: event.target.value as MemoryImageSide })}>
                <option value="understand">Front · Understanding</option>
                <option value="recall">Back · Recall</option>
              </select>
            </label> : null}
            <label>
              <span>Name</span>
              <input
                ref={nameInputRef}
                aria-label="Template name"
                value={editing.name}
                maxLength={60}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>
            <label>
              <span>Prompt</span>
              <textarea
                aria-label="Template prompt"
                value={editing.prompt}
                maxLength={4_000}
                onChange={(event) => setEditing({ ...editing, prompt: event.target.value })}
              />
            </label>
            <button
              type="button"
              aria-label="Save template"
              disabled={busy || !editing.name.trim() || !editing.prompt.trim()}
              onClick={() => void save()}
            >{busy ? "Saving…" : "Save"}</button>
          </section>
        </div>
      ) : null}
      {pendingDeletion ? (
        <div
          className="dialog-backdrop memory-image-template-dialog-backdrop"
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setPendingDeletion(undefined);
          }}
        >
          <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-label="Delete memory image template?">
            <span className="delete-dialog-icon" aria-hidden="true">!</span>
            <h2>Delete {pendingDeletion.name}?</h2>
            <p>Existing memory images keep their saved prompt snapshot.</p>
            <div className="delete-dialog-actions">
              <button
                ref={deleteCancelRef}
                type="button"
                aria-label="Cancel template deletion"
                onClick={() => setPendingDeletion(undefined)}
              >Cancel</button>
              <button
                type="button"
                className="danger-action"
                aria-label="Confirm delete template"
                disabled={busy}
                onClick={() => void mutate(() => api.remove({ kind: pendingDeletion.kind, id: pendingDeletion.id }))}
              >Delete</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
