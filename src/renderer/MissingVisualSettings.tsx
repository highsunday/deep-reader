import { MemoryImageTemplateChooser } from "./MemoryImageTemplateChooser";
import { useEffect, useRef, useState } from "react";
import type { MemoryImageSide, MemoryImageTemplateSettings, MissingVisualOptions, ReaderDesktopApi, ReadingNote } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";

import { purposeMatchesSide } from "../shared/memory-image-defaults";
import { bookMemoryImageDefaults, rememberBookMemoryImageChoices } from "./memory-image-preferences";

type Choice = { purposeId: string; styleId: string; extraInstruction: string; styleExplicit: boolean };

export function MissingVisualSettings({ api, note, previous, onCancel, onGenerate }: {
  api: ReaderDesktopApi["readingNotes"]; note: ReadingNote; previous?: MissingVisualOptions;
  onCancel(): void; onGenerate(options: MissingVisualOptions, preferenceSaveFailed?: boolean): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [templates, setTemplates] = useState<MemoryImageTemplateSettings>();
  const [choices, setChoices] = useState<Partial<Record<MemoryImageSide, Choice>>>({});
  const [error, setError] = useState("");
  const [selectedSide, setSelectedSide] = useState<MemoryImageSide>("understand");
  const [detailsOpen, setDetailsOpen] = useState<Partial<Record<MemoryImageSide, boolean>>>({});
  const [retry, setRetry] = useState(0);
  const submitted = useRef(false);
  const sides = (["understand", "recall"] as const).filter(side => !readingNoteImage(note, side));
  const activeSide = sides.includes(selectedSide) ? selectedSide : sides[0];
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal?.();
    return () => { focus?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    void api.memoryImage!.templates.get().then(settings => {
      if (!active) return;
      const next: Partial<Record<MemoryImageSide, Choice>> = {};
      for (const side of sides) {
        const defaults = bookMemoryImageDefaults(settings, side, note.bookTitle);
        const purposes = settings.purposes.filter(item => purposeMatchesSide(item, side));
        const purpose = purposes.find(item => item.id === previous?.[side]?.purpose.id)
          ?? purposes.find(item => item.id === defaults.purposeId) ?? purposes[0];
        const style = settings.styles.find(item => item.id === previous?.[side]?.style.id)
          ?? settings.styles.find(item => item.id === defaults.styleId)
          ?? settings.styles.find(item => item.id === settings.defaultStyleId) ?? settings.styles[0];
        next[side] = { purposeId: purpose?.id ?? "", styleId: style?.id ?? "", extraInstruction: previous?.[side]?.extraInstruction ?? "", styleExplicit: Boolean(previous?.[side]?.style) || defaults.styleExplicit };
      }
      setChoices(next); setTemplates(settings);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load image settings."); });
    return () => { active = false; };
  }, [api, note.id, retry]);
  function change(side: MemoryImageSide, updates: Partial<Choice>) {
    setChoices(current => ({ ...current, [side]: { ...current[side]!, ...updates } }));
  }
  return <dialog ref={dialog} open={typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal}
    className="missing-visual-settings" aria-labelledby="missing-visual-settings-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onCancel(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!templates || submitted.current) return;
      const options: MissingVisualOptions = {};
      for (const side of sides) {
        const choice = choices[side]!;
        const purpose = templates.purposes.find(item => item.id === choice.purposeId);
        const style = templates.styles.find(item => item.id === choice.styleId);
        if (!purpose || !style) return;
        options[side] = { purpose: { id: purpose.id, name: purpose.name, prompt: purpose.prompt },
          style: { id: style.id, name: style.name, prompt: style.prompt },
          ...(choice.extraInstruction.trim() ? { extraInstruction: choice.extraInstruction.trim() } : {}) };
      }
      let remembered = true;
      for (const side of sides) {
        const choice = choices[side]!;
        if (!rememberBookMemoryImageChoices(note.bookTitle, side, {
          purposeId: choice.purposeId, styleId: choice.styleId, styleExplicit: choice.styleExplicit
        })) remembered = false;
      }
      submitted.current = true; onGenerate(options, !remembered);
    }}>
      <header><h2 id="missing-visual-settings-title">Generate visuals</h2><p className="missing-visual-note-title">{note.title}</p>
        {sides.length > 1 ? <div className="missing-visual-side-switch" role="group" aria-label="Visual settings side">
          {sides.map(side => <button key={side} type="button" aria-pressed={side === activeSide}
            onClick={() => setSelectedSide(side)}>{side === "understand" ? "Front · Understanding" : "Back · Recall"}</button>)}
        </div> : <span className="reading-note-visual-face">{activeSide === "understand" ? "Understanding · Front" : "Recall · Back"}</span>}
      </header>
      <div className="missing-visual-settings-body">
        <p className="memory-choice-summary">Selections apply to this book. Saved when you generate.</p>
        {error ? <div role="alert">{error} <button className="missing-visual-retry" type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div>
          : !templates ? <p role="status">Loading image settings…</p> : sides.map(side => {
            const label = side === "understand" ? "Front" : "Back";
            const choice = choices[side]!;
            const expanded = detailsOpen[side] ?? Boolean(choice.extraInstruction);
            return <section key={side} hidden={side !== activeSide} aria-label={`${label} visual settings`}>
              <MemoryImageTemplateChooser templates={templates} purposeValue={choice.purposeId} styleValue={choice.styleId}
                fixedGoal={side === "understand" ? "understand" : "remember"} styleExplicit={choice.styleExplicit} disabled={false}
                onChange={(purposeId, styleId, styleExplicit) => change(side, { purposeId, styleId, styleExplicit })} />
              <button type="button" className="missing-visual-details-toggle" aria-expanded={expanded}
                onClick={() => setDetailsOpen(current => ({ ...current, [side]: !expanded }))}>{expanded ? "Hide optional details" : "Add optional details"}</button>
              {expanded ? <label className="missing-visual-details">Optional details<textarea aria-label={`${label} image details`} rows={3} maxLength={2000} value={choice.extraInstruction}
                placeholder="Anything you would like the image to emphasize…" onChange={event => change(side, { extraInstruction: event.target.value })} /></label> : null}
            </section>;
          })}
      </div>
      <footer><p>AI designs → Images saved</p><button type="button" onClick={onCancel}>Cancel</button><button className="missing-visual-submit" type="submit"
        disabled={!templates || Boolean(error) || !sides.length || sides.some(side => !choices[side]?.purposeId || !choices[side]?.styleId)}>
        {sides.length === 2 ? "Generate 2 images" : "Generate 1 image"}
      </button></footer>
    </form>
  </dialog>;
}
