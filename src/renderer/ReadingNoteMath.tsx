import katex from "katex";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";

const katexOptions = {
  strict: false as const,
  throwOnError: false,
  trust: false,
  output: "htmlAndMathml" as const
};

function renderedLatex(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { ...katexOptions, displayMode });
}

function InlineMath({ inlineContent }: { inlineContent: { props: { latex: string } } }) {
  const latex = inlineContent.props.latex;
  return (
    <span
      className="reading-note-inline-math"
      data-reading-note-inline-math={encodeURIComponent(latex)}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: renderedLatex(latex, false) }}
    />
  );
}

export const readingNoteInlineMath = createReactInlineContentSpec(
  {
    type: "inlineMath",
    propSchema: { latex: { default: "" } },
    content: "none"
  },
  {
    render: InlineMath as never,
    toExternalHTML: InlineMath as never,
    parse: (element) => {
      const encoded = element.getAttribute("data-reading-note-inline-math");
      if (encoded === null) return undefined;
      try {
        return { latex: decodeURIComponent(encoded) };
      } catch {
        return undefined;
      }
    }
  }
);

function DisplayMath({ block }: { block: { props: { latex: string } } }) {
  const latex = block.props.latex;
  return (
    <div
      className="reading-note-display-math"
      data-reading-note-display-math={encodeURIComponent(latex)}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: renderedLatex(latex, true) }}
    />
  );
}

export const readingNoteMathBlock = createReactBlockSpec(
  {
    type: "mathBlock",
    propSchema: { latex: { default: "" } },
    content: "none"
  },
  {
    render: DisplayMath as never,
    toExternalHTML: DisplayMath as never,
    parse: (element) => {
      const encoded = element.getAttribute("data-reading-note-display-math");
      if (encoded === null) return undefined;
      try {
        return { latex: decodeURIComponent(encoded) };
      } catch {
        return undefined;
      }
    }
  }
)();
