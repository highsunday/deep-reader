import type { MemoryImageGenerationMode, MemoryImageSide, MemoryImageTemplateSettings } from "../shared/contracts";
import { memoryImageDefaults, purposeMatchesSide } from "../shared/memory-image-defaults";

const GENERATION_MODE_KEY = "reader-memory-image-generation-mode";

type BookChoices = { purposeId?: string; styleId?: string; styleExplicit?: boolean };
interface BookPreferences {
  generationMode?: MemoryImageGenerationMode;
  sides?: Partial<Record<MemoryImageSide, BookChoices>>;
}

function bookKey(bookTitle: string): string {
  return `reader-memory-image-book:${encodeURIComponent(bookTitle)}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBook(bookTitle: string): BookPreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(bookKey(bookTitle)) ?? "null");
    if (!object(value)) return {};
    const sides: BookPreferences["sides"] = {};
    for (const side of ["recall", "understand"] as const) {
      const choice = object(value.sides) ? value.sides[side] : undefined;
      if (object(choice)) sides[side] = {
        ...(typeof choice.purposeId === "string" ? { purposeId: choice.purposeId } : {}),
        ...(typeof choice.styleId === "string" ? { styleId: choice.styleId } : {}),
        ...(typeof choice.styleExplicit === "boolean" ? { styleExplicit: choice.styleExplicit } : {})
      };
    }
    return { sides, ...(value.generationMode === "direct" || value.generationMode === "review" ? { generationMode: value.generationMode } : {}) };
  } catch { return {}; }
}

function writeBook(bookTitle: string, update: (previous: BookPreferences) => BookPreferences): boolean {
  try {
    window.localStorage.setItem(bookKey(bookTitle), JSON.stringify(update(readBook(bookTitle))));
    return true;
  } catch { return false; }
}

export function bookMemoryImageDefaults(settings: MemoryImageTemplateSettings, side: MemoryImageSide, bookTitle: string) {
  const saved = readBook(bookTitle).sides?.[side];
  const purposeId = settings.purposes.find(item => item.id === saved?.purposeId && purposeMatchesSide(item, side))?.id;
  const styleId = settings.styles.find(item => item.id === saved?.styleId)?.id;
  const defaults = memoryImageDefaults({ ...settings, defaultsBySide: { ...settings.defaultsBySide,
    [side]: { ...settings.defaultsBySide?.[side], ...(purposeId ? { purposeId } : {}), ...(styleId ? { styleId } : {}) }
  } }, side);
  return { ...defaults, styleExplicit: styleId ? saved?.styleExplicit ?? true : defaults.styleExplicit };
}

export function rememberBookMemoryImageChoices(bookTitle: string, side: MemoryImageSide, choices: BookChoices): boolean {
  return writeBook(bookTitle, previous => ({ ...previous, sides: { ...previous.sides,
    [side]: { ...previous.sides?.[side], ...choices } } }));
}

/** Save the overview form in one write so a failed save cannot leave half a form applied. */
export function rememberBookMemoryImageSettings(bookTitle: string, settings: Required<BookPreferences>): boolean {
  return writeBook(bookTitle, previous => ({ ...previous, ...settings }));
}

export function readMemoryImageGenerationMode(bookTitle?: string): MemoryImageGenerationMode {
  const saved = bookTitle === undefined ? undefined : readBook(bookTitle).generationMode;
  if (saved) return saved;
  try {
    return window.localStorage.getItem(GENERATION_MODE_KEY) === "direct" ? "direct" : "review";
  } catch {
    return "review";
  }
}

export function rememberMemoryImageGenerationMode(mode: MemoryImageGenerationMode, bookTitle?: string): boolean {
  if (bookTitle !== undefined) return writeBook(bookTitle, previous => ({ ...previous, generationMode: mode }));
  try {
    window.localStorage.setItem(GENERATION_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
