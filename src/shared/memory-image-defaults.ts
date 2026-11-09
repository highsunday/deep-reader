import type { MemoryImageSide, MemoryImageTemplate, MemoryImageTemplateSettings } from "./contracts";
import { MEMORY_IMAGE_GOAL_DEFAULTS, memoryImagePurposeGuide } from "./memory-image-templates";

export function purposeMatchesSide(template: Pick<MemoryImageTemplate, "id" | "side">, side: MemoryImageSide): boolean {
  const goal = memoryImagePurposeGuide(template.id)?.goal;
  const assigned = goal ? (goal === "understand" ? "understand" : "recall") : template.side ?? "recall";
  return assigned === side;
}

/** Resolve older shared preferences and newer independent side preferences consistently. */
export function memoryImageDefaults(settings: MemoryImageTemplateSettings, side: MemoryImageSide) {
  const saved = settings.defaultsBySide?.[side];
  const purposes = settings.purposes.filter(item => purposeMatchesSide(item, side));
  const purpose = purposes.find(item => item.id === saved?.purposeId)
    ?? purposes.find(item => item.id === settings.defaultPurposeId)
    ?? purposes.find(item => item.id === MEMORY_IMAGE_GOAL_DEFAULTS[side === "understand" ? "understand" : "remember"])
    ?? purposes[0];
  const legacyStyle = settings.defaultStyleId !== "style-minimal-vector" ? settings.defaultStyleId : undefined;
  const style = settings.styles.find(item => item.id === saved?.styleId)
    ?? settings.styles.find(item => item.id === legacyStyle)
    ?? settings.styles.find(item => item.id === memoryImagePurposeGuide(purpose?.id ?? "")?.styleId)
    ?? settings.styles.find(item => item.id === settings.defaultStyleId)
    ?? settings.styles[0];
  return { purposeId: purpose?.id ?? "", styleId: style?.id ?? "", styleExplicit: Boolean(saved?.styleId || legacyStyle) };
}
