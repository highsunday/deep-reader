import type { ChatContext, ReadingSourceSnapshot, ReadingRange, ReadingSegmentImage } from "../shared/contracts";

export interface ReadingSegmentDeliveryInput {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  range: ReadingRange;
  contextRange?: ReadingRange;
  readingSegment: string;
  images?: ReadingSegmentImage[];
}

export interface ReadingSegmentDelivery {
  key: string;
  context?: ChatContext;
  shouldRemember: boolean;
}

export function readingSourceSnapshot(input: ReadingSegmentDeliveryInput): ReadingSourceSnapshot {
  return {
    bookId: input.bookId, chapterId: input.chapterId, bookTitle: input.bookTitle, chapterTitle: input.chapterTitle,
    readingSegment: input.readingSegment,
    ...(input.images?.length ? { bookImageCount: input.images.length } : {})
  };
}

export function prepareReadingSegmentDelivery(
  input: ReadingSegmentDeliveryInput,
  lastProvidedKey?: string
): ReadingSegmentDelivery {
  const key = JSON.stringify([
    input.bookId,
    input.chapterId,
    input.range.start,
    input.range.end,
    input.contextRange?.start ?? input.range.start,
    input.contextRange?.end ?? input.range.end,
    input.readingSegment
  ]);
  if (key === lastProvidedKey) {
    return { key, shouldRemember: false };
  }
  return {
    key,
    context: {
      bookTitle: input.bookTitle,
      chapterTitle: input.chapterTitle,
      readingSegment: input.readingSegment,
      ...(input.images?.length ? { images: input.images } : {})
    },
    shouldRemember: true
  };
}
