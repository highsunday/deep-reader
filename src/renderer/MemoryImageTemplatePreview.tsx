import type { MemoryImageDiagram } from "../shared/memory-image-templates";
import "./memory-image-templates.css";

/** Static layout samples, never a generated preview of the reader's note. */
export function MemoryImageTemplatePreview({ diagram, appearance = "vector" }: {
  diagram?: MemoryImageDiagram;
  appearance?: string;
}) {
  const box = (x: number, y: number, width: number, height: number, tone = 0) =>
    <rect x={x} y={y} width={width} height={height} rx={7} className={`memory-preview-tone-${tone}`} />;
  return (
    <div className={`memory-template-preview appearance-${appearance}`}>
      {diagram ? (
        <svg viewBox="0 0 160 120" role="img" aria-label={`${diagram} layout illustration`}>
          {diagram === "structure" ? <>
            <path d="M80 46V25M70 65L35 91M90 65L125 91" />
            {box(58, 5, 44, 21, 1)}{box(52, 42, 56, 29, 2)}{box(7, 87, 53, 25, 3)}{box(101, 87, 53, 25, 1)}
          </> : diagram === "contrast" ? <>
            {box(7, 15, 65, 90, 1)}{box(88, 15, 65, 90, 2)}
            <path d="M20 38H58M102 38H140M20 61H58M102 61H140M20 84H45M102 84H140" />
          </> : diagram === "cause" ? <>
            <path d="M8 64H141L135 58M141 64L135 70M32 29L60 64M89 27L116 64M36 98L66 64" />
            {box(9, 13, 38, 22, 1)}{box(72, 11, 38, 22, 3)}{box(15, 91, 38, 22, 2)}
          </> : diagram === "process" ? <>
            <path d="M63 33H94L88 27M94 33L88 39M124 53V76L118 70M124 76L130 70M94 93H65L71 87M65 93L71 99" />
            {box(7, 12, 55, 40, 1)}{box(96, 12, 55, 40, 3)}{box(96, 76, 55, 38, 2)}{box(7, 76, 55, 38, 1)}
          </> : diagram === "process-contrast" ? <>
            {box(7, 9, 38, 34, 1)}{box(61, 9, 38, 34, 3)}{box(115, 9, 38, 34, 2)}
            <path d="M47 26H57L53 22M57 26L53 30M101 26H111L107 22M111 26L107 30" />
            <path d="M8 57H152" strokeDasharray="3 4" />
            {box(7, 71, 65, 40, 1)}{box(88, 71, 65, 40, 2)}
            <path d="M19 84H58M102 84H140M19 98H43M102 98H140" />
          </> : diagram === "association" ? <>
            {box(8, 11, 144, 99, 2)}
            <circle cx="83" cy="39" r="13" className="memory-preview-tone-3" />
            <path d="M62 87V69Q84 45 105 69V87" className="memory-preview-tone-1" />
            <path d="M20 72H34V67a5 5 0 0 1 10 0v5h14v27H20Z" className="memory-preview-tone-3" />
            <path d="M42 25H66V48H54v-5a5 5 0 0 0-10 0v5h-2Z" className="memory-preview-tone-1" />
            <path d="M48 51L37 59" strokeDasharray="3 3" />
          </> : <>
            <path d="M14 24H143V109H14ZM14 24L29 9H154V94L143 109M143 24L154 9" className="memory-preview-tone-2" />
            {box(26, 62, 25, 46, 3)}{box(71, 70, 29, 17, 1)}{box(114, 39, 20, 25, 1)}
            <path d="M53 98Q81 113 85 88Q124 87 124 70" strokeDasharray="3 4" />
          </>}
        </svg>
      ) : <span className="memory-template-custom-preview">Your layout</span>}
    </div>
  );
}

export function MemoryImageStyleSample({ appearance = "custom" }: { appearance?: string }) {
  return <span className={`memory-style-sample appearance-${appearance}`} aria-hidden="true"><i /><i /><i /></span>;
}
