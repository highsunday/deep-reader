import { useId } from "react";
import type { MemoryImageGenerationMode } from "../shared/contracts";

const workflows = [
  { value: "direct", title: "Generate directly", description: "Let AI design and save your image." },
  { value: "review", title: "Review draft first", description: "Edit the description before generating." }
] as const;

export function MemoryImageWorkflowChoice({ value, disabled, hasDraft, onChange }: {
  value: MemoryImageGenerationMode;
  disabled: boolean;
  hasDraft: boolean;
  onChange(value: MemoryImageGenerationMode): void;
}) {
  const id = useId();
  return (
    <fieldset className="memory-workflow" disabled={disabled} aria-label="Generation workflow">
      <legend>How would you like to create?</legend>
      <div className="memory-workflow-options">
        {workflows.map((workflow) => (
          <label key={workflow.value} className="memory-workflow-option">
            <input type="radio" name={`${id}-workflow`} value={workflow.value}
              aria-label={workflow.title} aria-describedby={`${id}-${workflow.value}-description`}
              checked={value === workflow.value} onChange={() => onChange(workflow.value)} />
            <span className="memory-workflow-card">
              <span className="memory-workflow-card-top" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="memory-workflow-icon">
                  {workflow.value === "direct"
                    ? <path d="m13 3-2.5 6.5L4 12l6.5 2.5L13 21l2.5-6.5L22 12l-6.5-2.5L13 3ZM4 3v4M2 5h4" />
                    : <><path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M8 15l1-4 9-9 3 3-9 9-4 1Z" /><path d="m16 4 3 3" /></>}
                </svg>
                <span className="memory-workflow-check"><svg viewBox="0 0 16 16"><path d="m4 8 2.5 2.5L12 5" /></svg></span>
              </span>
              <strong>{workflow.title}</strong>
              <span id={`${id}-${workflow.value}-description`} className="memory-workflow-description">{workflow.description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="memory-workflow-path" aria-live="polite">
        {value === "direct"
          ? <><span>AI designs</span><span aria-hidden="true">→</span><strong>Image saved</strong></>
          : <><span>AI drafts</span><span aria-hidden="true">→</span><strong>{hasDraft ? "Review your draft" : "You review"}</strong><span aria-hidden="true">→</span><span>Generate image</span></>}
      </p>
    </fieldset>
  );
}
