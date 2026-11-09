import type {
  CodexChatModel,
  SendChatMessageInput
} from "../shared/contracts";
import {
  prepareReadingSegmentDelivery,
  readingSourceSnapshot,
  type ReadingSegmentDelivery,
  type ReadingSegmentDeliveryInput
} from "./reading-segment-delivery";

export function prepareReadingNoteAwareMessage({
  text,
  model,
  segment,
  lastProvidedKey,
  readingNotePending
}: {
  text: string;
  model: CodexChatModel;
  segment: ReadingSegmentDeliveryInput;
  lastProvidedKey?: string;
  readingNotePending: boolean;
}): { input: SendChatMessageInput; delivery: ReadingSegmentDelivery } {
  const delivery = prepareReadingSegmentDelivery(
    segment,
    // Natural-language creation is routed by the model, so every visual turn needs its current images.
    readingNotePending || segment.images?.length ? undefined : lastProvidedKey
  );
  return {
    input: {
      text,
      model,
      ...(readingNotePending ? { intent: "createReadingNote" as const } : {}),
      ...(delivery.context ? { context: delivery.context } : {}),
      readingSource: readingSourceSnapshot(segment)
    },
    delivery
  };
}
