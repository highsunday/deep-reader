import { useEffect, useId, useRef, useState } from "react";
import type { MemoryImageGenerationMode, MemoryImageSide, MemoryImageTemplateSettings, ReaderDesktopApi } from "../shared/contracts";
import { purposeMatchesSide } from "../shared/memory-image-defaults";
import { bookMemoryImageDefaults, readMemoryImageGenerationMode, rememberBookMemoryImageSettings } from "./memory-image-preferences";
import "./book-memory-image-settings.css";

type FormValues = {
  generationMode: MemoryImageGenerationMode;
  sides: Record<MemoryImageSide, { purposeId: string; styleId: string; styleExplicit: boolean }>;
};

export function BookMemoryImageSettings({ api, bookTitle }: {
  api: NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>["templates"];
  bookTitle: string;
}) {
  const id = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  const [templates, setTemplates] = useState<MemoryImageTemplateSettings>();
  const [saved, setSaved] = useState<FormValues>();
  const [draft, setDraft] = useState<FormValues>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setTemplates(undefined); setSaved(undefined); setDraft(undefined); setEditing(false); setError(""); setNotice("");
    void api.get().then(settings => {
      if (!active) return;
      const values: FormValues = { generationMode: readMemoryImageGenerationMode(bookTitle), sides: {
        recall: bookMemoryImageDefaults(settings, "recall", bookTitle),
        understand: bookMemoryImageDefaults(settings, "understand", bookTitle)
      } };
      setTemplates(settings); setSaved(values); setDraft(values);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load image settings."); });
    return () => { active = false; };
  }, [api, bookTitle, retry]);

  useEffect(() => {
    if (editing) firstChoice.current?.focus();
    else if (restoreFocus.current) { editButton.current?.focus(); restoreFocus.current = false; }
  }, [editing]);

  function cancel() {
    restoreFocus.current = true;
    setDraft(saved); setEditing(false); setError("");
  }

  function change(side: MemoryImageSide, field: "purposeId" | "styleId", value: string) {
    setDraft(current => current && ({ ...current, sides: { ...current.sides,
      [side]: { ...current.sides[side], [field]: value, styleExplicit: true }
    } }));
    setError("");
  }

  return <section className="book-image-settings" aria-labelledby={`${id}-title`}>
    <header className="book-image-settings-header">
      <h2 id={`${id}-title`}>Image generation</h2>
      {saved && !editing ? <button ref={editButton} type="button" className="book-image-settings-edit" aria-label="Edit image settings" aria-expanded={false} aria-controls={`${id}-form`}
        onClick={() => { setDraft(saved); setNotice(""); setError(""); setEditing(true); }}>Edit</button> : null}
    </header>
    {error && !templates ? <p role="alert" className="book-image-settings-error">{error} {!templates ? <button type="button" onClick={() => setRetry(value => value + 1)}>Retry image settings</button> : null}</p> : null}
    {!saved && !error ? <p role="status">Loading image settings…</p> : null}
    {notice ? <p role="status" className="book-image-settings-notice">{notice}</p> : null}
    {saved && templates && !editing ? <dl className="book-image-settings-summary">
      {(["recall", "understand"] as const).map(side => <div key={side}>
        <dt>{side === "recall" ? "Recall image" : "Understanding image"}</dt>
        <dd>{templates.purposes.find(item => item.id === saved.sides[side].purposeId)?.name} · {templates.styles.find(item => item.id === saved.sides[side].styleId)?.name}</dd>
      </div>)}
      <div><dt>Workflow</dt><dd>{saved.generationMode === "direct" ? "Generate directly" : "Review draft first"}</dd></div>
    </dl> : null}
    {editing && draft && templates ? <form id={`${id}-form`} aria-label="Book image settings" onSubmit={event => {
      event.preventDefault();
      if (!rememberBookMemoryImageSettings(bookTitle, draft)) { setError("Unable to save image settings. Your edits are still here; try saving again."); return; }
      restoreFocus.current = true;
      setSaved(draft); setEditing(false); setError(""); setNotice("Image settings saved for this book.");
    }}>
      <div className="book-image-settings-sides">
        {(["recall", "understand"] as const).map(side => {
          const label = side === "recall" ? "Recall" : "Understanding";
          return <div key={side} className="book-image-settings-row" role="group" aria-labelledby={`${id}-${side}-label`}>
            <h3 id={`${id}-${side}-label`}>{label} image</h3>
            <label><span>Purpose</span>
              <select ref={side === "recall" ? firstChoice : undefined} aria-label={`${label} purpose`} value={draft.sides[side].purposeId}
                onChange={event => change(side, "purposeId", event.target.value)}>
                {templates.purposes.filter(item => purposeMatchesSide(item, side)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>Style</span>
              <select aria-label={`${label} style`} value={draft.sides[side].styleId}
                onChange={event => change(side, "styleId", event.target.value)}>
                {templates.styles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>;
        })}
      </div>
      <fieldset className="book-image-settings-workflow">
        <legend>Generation</legend>
        <div>{(["direct", "review"] as const).map(mode => <label key={mode}>
          <input type="radio" name={`${id}-workflow`} checked={draft.generationMode === mode}
            onChange={() => { setDraft({ ...draft, generationMode: mode }); setError(""); }} />
          <span>{mode === "direct" ? "Generate directly" : "Review draft first"}</span>
        </label>)}</div>
      </fieldset>
      <footer>
        {error ? <p id={`${id}-save-error`} role="alert" className="book-image-settings-error">{error}</p> : null}
        <div className="book-image-settings-actions">
          <button type="button" onClick={cancel}>Cancel</button>
          <button className="primary-action" type="submit" aria-describedby={error ? `${id}-save-error` : undefined}
            disabled={(["recall", "understand"] as const).some(side => !draft.sides[side].purposeId || !draft.sides[side].styleId)}>Save settings</button>
        </div>
      </footer>
    </form> : null}
  </section>;
}
