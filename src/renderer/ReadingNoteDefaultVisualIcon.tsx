import type { MemoryImageSide } from "../shared/contracts";

/** Shared empty-state artwork for the two reading-note visual faces. */
export function ReadingNoteDefaultVisualIcon({ side }: { side: MemoryImageSide }) {
  return (
    <span className={`reading-note-default-visual-icon reading-note-default-${side}`} aria-hidden="true">
      {side === "understand" ? (
        <svg viewBox="0 0 32 32">
          <path d="M16 10.5v-4M11.5 18.5l-4 3M20.5 18.5l4 3" />
          <circle cx="16" cy="16" r="5.25" />
          <circle cx="16" cy="5" r="2.5" />
          <circle cx="6" cy="23" r="2.5" />
          <circle cx="26" cy="23" r="2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 32 32">
          <path className="reading-note-default-spark-main" d="M16 5.25c1.15 5.75 4 8.6 9.75 9.75C20 16.15 17.15 19 16 24.75 14.85 19 12 16.15 6.25 15 12 13.85 14.85 11 16 5.25Z" />
          <path className="reading-note-default-spark-small" d="M25.25 4.75c.35 1.75 1.2 2.6 2.95 2.95-1.75.35-2.6 1.2-2.95 2.95-.35-1.75-1.2-2.6-2.95-2.95 1.75-.35 2.6-1.2 2.95-2.95Z" />
        </svg>
      )}
    </span>
  );
}
