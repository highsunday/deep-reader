import { purposeMatchesSide } from "../shared/memory-image-defaults";
import { useId, useState } from "react";
import type { MemoryImagePromptSnapshot, MemoryImageTemplateSettings } from "../shared/contracts";
import { MEMORY_IMAGE_GOAL_DEFAULTS, memoryImagePurposeGuide, memoryImageStyleGuide, type MemoryImageGoal } from "../shared/memory-image-templates";
import { MemoryImageStyleSample, MemoryImageTemplatePreview } from "./MemoryImageTemplatePreview";

export const CURRENT_IMAGE_PURPOSE = "__current-image-purpose";
export const CURRENT_IMAGE_STYLE = "__current-image-style";

export function MemoryImageTemplateChooser({ templates, purposeValue, styleValue, currentPurpose, currentStyle,
  styleExplicit, disabled, compact = false, fixedGoal, onChange }: {
  templates: MemoryImageTemplateSettings;
  purposeValue: string;
  styleValue: string;
  currentPurpose?: MemoryImagePromptSnapshot;
  currentStyle?: MemoryImagePromptSnapshot;
  styleExplicit: boolean;
  disabled: boolean;
  compact?: boolean;
  fixedGoal?: MemoryImageGoal;
  onChange(purpose: string, style: string, styleExplicit: boolean): void;
}) {
  const id = useId();
  const [showPurposes, setShowPurposes] = useState(false);
  const [showStyles, setShowStyles] = useState(false);
  const [editDraftSelection, setEditDraftSelection] = useState(false);
  const purpose = purposeValue === CURRENT_IMAGE_PURPOSE ? currentPurpose : templates.purposes.find(({ id }) => id === purposeValue);
  const style = styleValue === CURRENT_IMAGE_STYLE ? currentStyle : templates.styles.find(({ id }) => id === styleValue);
  // A saved prompt is an exact historical snapshot, not today's built-in strategy.
  const guide = purposeValue === CURRENT_IMAGE_PURPOSE ? undefined : memoryImagePurposeGuide(purpose?.id);
  const styleGuide = styleValue === CURRENT_IMAGE_STYLE ? undefined : memoryImageStyleGuide(style?.id);
  const goal = fixedGoal ?? guide?.goal;
  const recommended = goal && purposeValue === MEMORY_IMAGE_GOAL_DEFAULTS[goal];

  function choosePurpose(value: string) {
    if (disabled || value === purposeValue) return;
    const recommendation = memoryImagePurposeGuide(value)?.styleId;
    const nextStyle = !styleExplicit && recommendation && templates.styles.some(({ id }) => id === recommendation)
      ? recommendation : styleValue;
    onChange(value, nextStyle, styleExplicit);
  }

  function chooseGoal(nextGoal: MemoryImageGoal) {
    if (goal === nextGoal) return;
    choosePurpose(MEMORY_IMAGE_GOAL_DEFAULTS[nextGoal]);
    setShowPurposes(false);
  }

  const options = templates.purposes.filter((item) => {
    return !goal || purposeMatchesSide(item, goal === "understand" ? "understand" : "recall");
  });

  return (
    <section className="memory-image-chooser" aria-label="Memory image choices">
      {compact && !editDraftSelection ? <>
        <p className="memory-choice-summary">{purpose?.name} · {style?.name}</p>
        <button type="button" className="memory-choice-link" disabled={disabled} onClick={() => setEditDraftSelection(true)}>Change selection</button>
      </> : <>
        {!fixedGoal ? <p className="memory-choice-question">What should this image help you do first?</p> : null}
        <div hidden={Boolean(fixedGoal)} className="memory-choice-goals" role="group" aria-label="Memory image goal">
          {(["understand", "remember"] as const).map((item) => <button
            key={item} type="button" aria-label={item === "understand" ? "Understand the note" : "Recall it later"}
            aria-pressed={goal === item}
            disabled={disabled || !templates.purposes.some(({ id }) => id === MEMORY_IMAGE_GOAL_DEFAULTS[item])}
            onClick={() => chooseGoal(item)}
          ><strong>{item === "understand" ? "Understand the note" : "Recall it later"}</strong>
            <span>{item === "understand" ? "Ideas, differences and connections" : "A concrete cue for the concept"}</span>
          </button>)}
        </div>
        <div className="memory-choice-heading"><span>{recommended ? "Suggested starting point" : purposeValue === CURRENT_IMAGE_PURPOSE ? "Saved image settings" : "Your selection"}</span>
          <button type="button" className="memory-choice-link" disabled={disabled} aria-expanded={showPurposes} aria-controls={`${id}-purposes`}
            onClick={() => setShowPurposes(!showPurposes)}>{showPurposes ? "Hide other purposes" : "Explore other purposes"}</button>
        </div>
        <div className="memory-choice-selected" aria-live="polite">
          <div><MemoryImageTemplatePreview diagram={guide?.diagram} appearance={styleGuide?.appearance} /><small>Layout illustration</small></div>
          <div className="memory-choice-description"><strong>{guide?.title ?? purpose?.name ?? "Choose a purpose"}</strong>
            {guide ? <span>{purpose?.name}</span> : null}
            <p>{guide?.description ?? (purposeValue === CURRENT_IMAGE_PURPOSE ? "Reuse the exact purpose instructions saved with this image." : "Use your template's own instructions to arrange the note.")}</p>
            {guide ? <small>{guide.output}</small> : null}
          </div>
        </div>
        {showPurposes ? <div className="memory-choice-options" id={`${id}-purposes`} role="group" aria-label="Memory image purposes">
          {options.map((item) => {
            const info = memoryImagePurposeGuide(item.id);
            return <button key={item.id} type="button" aria-label={`Choose ${item.name}`} aria-pressed={purposeValue === item.id} disabled={disabled} onClick={() => choosePurpose(item.id)}>
              <MemoryImageTemplatePreview diagram={info?.diagram} />
              <span><strong>{info?.title ?? item.name}</strong><small>{info ? item.name : item.builtIn ? "Other built-in template" : "Custom template"}</small></span>
            </button>;
          })}
          {currentPurpose ? <button type="button" aria-pressed={purposeValue === CURRENT_IMAGE_PURPOSE} disabled={disabled} onClick={() => choosePurpose(CURRENT_IMAGE_PURPOSE)}>
            <span><strong>Use saved image purpose</strong><small>{currentPurpose.name} · exact saved instructions</small></span>
          </button> : null}
        </div> : null}
        <div className="memory-choice-style-heading"><p>Style <strong>{style?.name}</strong></p>
          <button type="button" className="memory-choice-link" disabled={disabled} aria-expanded={showStyles} aria-controls={`${id}-styles`}
            onClick={() => setShowStyles(!showStyles)}>{showStyles ? "Hide styles" : "Change style"}</button>
        </div>
        {showStyles ? <div id={`${id}-styles`} className="memory-choice-style-options" role="group" aria-label="Memory image styles">
          {templates.styles.map((item) => <button key={item.id} type="button" aria-label={`Choose ${item.name}`} aria-pressed={styleValue === item.id} disabled={disabled}
            onClick={() => { onChange(purposeValue, item.id, true); }}>
            <MemoryImageStyleSample appearance={memoryImageStyleGuide(item.id)?.appearance} /><span>{item.name}</span>
          </button>)}
          {currentStyle ? <button type="button" aria-pressed={styleValue === CURRENT_IMAGE_STYLE} disabled={disabled}
            onClick={() => { onChange(purposeValue, CURRENT_IMAGE_STYLE, true); }}>Use saved image style · {currentStyle.name}</button> : null}
          <p>{styleGuide?.description ?? "Use the style instructions from your selected template."}</p>
        </div> : null}
      </>}
    </section>
  );
}
