import type { MemoryImageTemplate } from "./contracts";

export type MemoryImageGoal = "understand" | "remember";
export type MemoryImageDiagram = "structure" | "contrast" | "cause" | "process" | "association" | "space" | "process-contrast";

interface PurposeGuide {
  goal: MemoryImageGoal;
  title: string;
  description: string;
  output: string;
  diagram: MemoryImageDiagram;
  styleId: string;
}

export const MEMORY_IMAGE_GOAL_DEFAULTS: Record<MemoryImageGoal, string> = {
  understand: "purpose-concept-structure",
  remember: "purpose-surreal-association"
};

export const MEMORY_IMAGE_PURPOSE_GUIDES: Record<string, PurposeGuide> = {
  "purpose-concept-structure": {
    goal: "understand", title: "See the key ideas and relationships",
    description: "Bring the core idea and its related points into one clear overview.",
    output: "Icons, groups and connections with short labels.", diagram: "structure", styleId: "style-minimal-vector"
  },
  "purpose-concept-contrast": {
    goal: "understand", title: "See how the concepts differ",
    description: "Compare easily confused ideas side by side using the same criteria.",
    output: "Matching scenes that make the differences visible.", diagram: "contrast", styleId: "style-minimal-vector"
  },
  "purpose-cause-effect": {
    goal: "understand", title: "Connect causes to outcomes",
    description: "Trace why something happens and the conditions that influence it.",
    output: "A causal chain or a fishbone diagram for multiple causes.", diagram: "cause", styleId: "style-hand-drawn"
  },
  "purpose-process-sequence": {
    goal: "understand", title: "Follow the steps and changes",
    description: "Follow the same subject through a process, one clear stage at a time.",
    output: "Three to five ordered scenes with brief step labels.", diagram: "process", styleId: "style-hand-drawn"
  },
  "purpose-surreal-association": {
    goal: "remember", title: "Give the concept a memorable scene",
    description: "Connect one core concept to a concrete scene you can recall later.",
    output: "One meaningful visual metaphor, without text.", diagram: "association", styleId: "style-warm-illustration"
  },
  "purpose-process-contrast": {
    goal: "understand", title: "Let AI choose a process or comparison",
    description: "AI chooses steps, a before-and-after view, or a side-by-side comparison to suit the note.",
    output: "An automatic layout choice; use Concept comparison for a fixed side-by-side comparison.",
    diagram: "process-contrast", styleId: "style-minimal-vector"
  },
  "purpose-memory-palace": {
    goal: "remember", title: "Recall the points by their locations",
    description: "Place a few points in fixed locations and revisit them in the same order.",
    output: "One room, a clear route and a visual cue at each location.", diagram: "space", styleId: "style-clay-miniature"
  }
};

export const MEMORY_IMAGE_STYLE_GUIDES: Record<string, { description: string; appearance: string; primary: boolean }> = {
  "style-minimal-vector": { description: "Crisp shapes and limited colors keep relationships easy to scan.", appearance: "vector", primary: true },
  "style-hand-drawn": { description: "Light pen strokes and restrained highlights feel like personal notes.", appearance: "sketch", primary: true },
  "style-warm-illustration": { description: "Simple figures and warm colors make a scene feel approachable.", appearance: "warm", primary: true },
  "style-clay-miniature": { description: "Soft, tactile objects make spatial positions easy to distinguish.", appearance: "dimensional", primary: true },
  "style-storybook-watercolor": { description: "Gentle washes and clear contours give the image a quiet paper feel.", appearance: "watercolor", primary: true },
  "style-vintage-encyclopedia": { description: "Detailed linework and muted paper tones evoke a printed field guide.", appearance: "vintage", primary: false }
};

const grounded = "Use only the saved note's information. Preserve distinctions, qualifications and exceptions needed for the core meaning. Do not invent facts or causal links. If the chosen structure does not fit, describe the mismatch in the text draft and propose a faithful simpler arrangement. In the text draft explain the core idea, the meaning of each main element and the relationships shown. Keep the square composition readable at thumbnail size. ";
const appearanceOnly = " Preserve the purpose's information, object meanings, grouping, sequence and text policy. Style changes appearance only. Maintain readable contrast, distinguish elements by shape as well as color, and avoid decorative detail that competes with the concept.";

export const BUILT_IN_MEMORY_IMAGE_PURPOSES: MemoryImageTemplate[] = [
  { id: "purpose-concept-structure", kind: "purpose", name: "概念結構", builtIn: true,
    prompt: grounded + "Create a visual overview of one core concept and roughly 3-6 essential related points, using fewer when appropriate. Select a hierarchy, grouped arrangement or relationship map to match the note; do not force every note into a radial mind map. Use meaningful pictorial icons, proximity and connections to carry the structure. Distinguish inclusion, association and causation; use arrows only when direction matters. Allow short labels and relation words in the note's language, never paragraphs or a text-heavy poster. Keep labels near their related elements." },
  { id: "purpose-concept-contrast", kind: "purpose", name: "概念對照", builtIn: true,
    prompt: grounded + "Compare 2-3 concepts side by side along the same explicit dimensions. Use matching scale, viewpoint and corresponding objects or actions so differences are visible. Retain important shared properties and conditional differences; do not imply a false binary or a good-versus-bad judgment. Use small pictorial scenes and only short concept names or distinguishing words in the note's language. Do not reproduce prose in columns." },
  { id: "purpose-cause-effect", kind: "purpose", name: "因果拆解", builtIn: true,
    prompt: grounded + "Explain why the stated outcome occurs. Use a directed causal chain for successive influences or a fishbone arrangement for multiple contributing causes. Show only causes and conditions supported by the note; distinguish association from causation and preserve uncertainty. Use concrete visual elements and short cause, outcome and condition labels in the note's language. Keep feedback loops only where the note supports them." },
  { id: "purpose-process-sequence", kind: "purpose", name: "流程分鏡", builtIn: true,
    prompt: grounded + "Show a process in roughly 3-5 ordered scenes within one square image. Keep the same subject, objects, viewpoint and color identity across scenes so state changes can be followed. Preserve the actual sequence, required branches and loops rather than inventing a linear process. Sequence alone must not imply causation. Use arrows, optional numbers and brief step labels in the note's language; communicate primarily through visible actions and transformations." },
  { id: "purpose-surreal-association", kind: "purpose", name: "視覺聯想", builtIn: true,
    prompt: grounded + "Translate one core concept into one concrete, memorable visual metaphor using about 2-4 distinct main objects interacting meaningfully. Each object and action must map to part of the concept; avoid an unrelated collection of symbols. Prefer a reader-supplied familiar association. Exaggeration or an unusual interaction is optional, not an end in itself. Explain the mapping and any limits of the analogy in the text draft only. Do not include text, labels, captions, letters, numbers or formulas in the image." },
  { id: "purpose-memory-palace", kind: "purpose", name: "空間記憶", builtIn: true,
    prompt: grounded + "Arrange 3-5 essential points from this single note at distinct, fixed locations in one clearly visible room or familiar space. Use the reader's supplied space when available, otherwise a simple learnable room. Give each location one concrete cue with a clear meaning and a non-crossing traversal route. Describe the location-to-concept mapping and recall order in the text draft. Keep positions, viewpoint and object identity stable during adjustments unless explicitly asked to change them. No occluded cues, crowded palace, invented personal familiarity or claims of guaranteed recall. Do not include text, labels, captions, letters, numbers or formulas in the image." },
  // Retain the original combined purpose for saved defaults and explicit reuse.
  { id: "purpose-process-contrast", kind: "purpose", name: "流程與對照", builtIn: true,
    prompt: "Choose a sequential process, before-and-after transformation, or side-by-side comparison according to the note. Make steps, differences, or causal changes immediately understandable. Arrows, symbols, and a small amount of short text in the note's language are allowed." }
];

export const BUILT_IN_MEMORY_IMAGE_STYLES: MemoryImageTemplate[] = [
  { id: "style-minimal-vector", kind: "style", name: "極簡向量", builtIn: true,
    prompt: "Use clean geometric forms, flat color fields, crisp outlines, a white or light neutral background and a limited palette with clear contrast. Keep generous spacing and minimal background detail in a polished minimalist vector illustration style." + appearanceOnly },
  { id: "style-hand-drawn", kind: "style", name: "清爽手繪", builtIn: true,
    prompt: "Use clean, lightly irregular pen strokes and restrained marker highlights on uncluttered paper. Simple pictorial forms should feel like carefully organized personal study notes. Keep any permitted lettering clearly readable, not ornamental handwriting. Avoid messy scribbles and excessive texture." + appearanceOnly },
  { id: "style-warm-illustration", kind: "style", name: "溫暖插畫", builtIn: true,
    prompt: "Use contemporary editorial illustration with simplified figures and objects, warm restrained colors, subtle paper texture and a clear focal point. Aim for a mature, approachable tone with expressive but economical shapes. Avoid excessive cuteness, decorative scenery or visual clutter." + appearanceOnly },
  { id: "style-clay-miniature", kind: "style", name: "柔和立體", builtIn: true,
    prompt: "Render simplified tactile three-dimensional objects with matte clay-like surfaces, soft studio lighting and a clean background. Make spatial positions and silhouettes distinct. Keep every information-bearing object in focus; do not use shallow depth of field, occlusion, excessive reflections or realism that hides a cue." + appearanceOnly },
  { id: "style-storybook-watercolor", kind: "style", name: "淡彩水彩", builtIn: true,
    prompt: "Use gentle watercolor washes, restrained warm colors, fine clear contour lines and generous white space. Keep key edges, connections and any allowed text crisp; pigment blooms and paper texture should remain subtle. Aim for a quiet, thoughtful illustration suitable for repeated viewing." + appearanceOnly },
  { id: "style-vintage-encyclopedia", kind: "style", name: "復古百科", builtIn: true,
    prompt: "Use the visual character of a nineteenth-century encyclopedia or scientific field guide: precise linework, aged paper tones, restrained colors, and tactile printed detail." + appearanceOnly }
];

export function memoryImagePurposeGuide(id: string | undefined): PurposeGuide | undefined {
  return id && Object.hasOwn(MEMORY_IMAGE_PURPOSE_GUIDES, id) ? MEMORY_IMAGE_PURPOSE_GUIDES[id] : undefined;
}

export function memoryImageStyleGuide(id: string | undefined) {
  return id && Object.hasOwn(MEMORY_IMAGE_STYLE_GUIDES, id) ? MEMORY_IMAGE_STYLE_GUIDES[id] : undefined;
}
