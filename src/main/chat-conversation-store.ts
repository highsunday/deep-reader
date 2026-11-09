import { parseNoteReferences, parseNoteUpdates } from "../shared/reading-note-reference";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isChatIntent, type ChatMessage } from "../shared/contracts";

export interface StoredConversationSource {
  bookTitle?: string;
  chapterTitle?: string;
}

export interface StoredChatConversation {
  id: string;
  threadId: string;
  title: string;
  topicTitleVersion?: 1;
  createdAt: number;
  updatedAt: number;
  source: StoredConversationSource | null;
  messages: ChatMessage[];
}

export interface StoredChatState {
  version: 1;
  selectedConversationId: string | null;
  conversations: StoredChatConversation[];
}

export interface ChatConversationStore {
  load(): StoredChatState;
  save(state: StoredChatState): void;
}

export const MAX_STORED_CHAT_CONVERSATIONS = 10;

export function limitStoredChatConversations(
  conversations: StoredChatConversation[]
): StoredChatConversation[] {
  if (conversations.length <= MAX_STORED_CHAT_CONVERSATIONS) return conversations;
  const retained = new Set(conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) =>
      right.conversation.updatedAt - left.conversation.updatedAt ||
      right.conversation.createdAt - left.conversation.createdAt ||
      right.index - left.index)
    .slice(0, MAX_STORED_CHAT_CONVERSATIONS)
    .map(({ index }) => index));
  return conversations.filter((_conversation, index) => retained.has(index));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown): ChatMessage {
  if (!object(value) || typeof value.id !== "string" ||
    !(typeof value.turnId === "string" || value.turnId === null) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.text !== "string" ||
    (value.status !== "streaming" && value.status !== "completed" && value.status !== "failed")) {
    throw new Error("Invalid local AI conversation history.");
  }
  if ((value.noteReferences !== undefined && value.role !== "user") ||
    ((value.noteUpdates !== undefined || value.noteUpdateError !== undefined) && value.role !== "assistant")) throw new Error("Invalid local AI conversation history.");
  let quote: ChatMessage["quote"];
  if (value.quote !== undefined) {
    if (!object(value.quote) || typeof value.quote.text !== "string" || !value.quote.text.trim()) {
      throw new Error("Invalid local AI conversation history.");
    }
    quote = { text: value.quote.text };
  }
  let readingSource: ChatMessage["readingSource"];
  if (value.readingSource !== undefined) {
    const source = value.readingSource;
    if (value.role !== "user" || !object(source) ||
      typeof source.bookTitle !== "string" || !source.bookTitle.trim() ||
      typeof source.chapterTitle !== "string" || !source.chapterTitle.trim() ||
      typeof source.readingSegment !== "string" || !source.readingSegment.trim() ||
      (source.bookImageCount !== undefined &&
        (!Number.isInteger(source.bookImageCount) || Number(source.bookImageCount) < 0))) {
      throw new Error("Invalid local AI conversation history.");
    }
    readingSource = {
      ...(typeof source.bookId === "string" ? { bookId: source.bookId } : {}),
      ...(typeof source.chapterId === "string" ? { chapterId: source.chapterId } : {}),
      bookTitle: source.bookTitle,
      chapterTitle: source.chapterTitle,
      readingSegment: source.readingSegment,
      ...(source.bookImageCount !== undefined ? { bookImageCount: Number(source.bookImageCount) } : {})
    };
  }
  if (value.intent !== undefined && !isChatIntent(value.intent)) {
    throw new Error("Invalid local AI conversation history.");
  }
  let images: ChatMessage["images"];
  if (value.images !== undefined) {
    if (value.role !== "user" || !Array.isArray(value.images) || value.images.length > 4 ||
      value.images.some(image => !object(image) || typeof image.dataUrl !== "string" ||
        image.dataUrl.length > 7_000_000 ||
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))) {
      throw new Error("Invalid local AI conversation history.");
    }
    images = value.images.map(image => ({ dataUrl: image.dataUrl as string }));
  }
  let bookImages: ChatMessage["bookImages"];
  if (value.bookImages !== undefined) {
    if (value.role !== "user" || !Array.isArray(value.bookImages) ||
      value.bookImages.reduce((size: number, image: unknown) =>
        size + (object(image) && typeof image.dataUrl === "string" ? image.dataUrl.length : 30_000_001), 0) > 30_000_000 ||
      value.bookImages.some(image => !object(image) || typeof image.dataUrl !== "string" ||
        !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))) {
      throw new Error("Invalid local AI conversation history.");
    }
    bookImages = value.bookImages.map(image => ({ dataUrl: image.dataUrl as string }));
  }
  return {
    id: value.id,
    turnId: value.turnId,
    role: value.role,
    text: value.text,
    ...(value.intent !== undefined ? { intent: value.intent } : {}),
    ...(quote ? { quote } : {}),
    ...(readingSource ? { readingSource } : {}),
    ...(images ? { images } : {}),
    ...(bookImages ? { bookImages } : {}),
    ...(value.noteReferences !== undefined ? { noteReferences: parseNoteReferences(value.noteReferences) } : {}),
    ...(value.noteUpdates !== undefined ? { noteUpdates: parseNoteUpdates(value.noteUpdates) } : {}),
    ...(typeof value.noteUpdateError === "string" ? { noteUpdateError: value.noteUpdateError } : {}),
    status: value.status === "streaming" ? "failed" : value.status
  };
}

function parseSource(value: unknown): StoredConversationSource | null {
  if (value === null) return null;
  if (!object(value)) throw new Error("Invalid local AI conversation history.");
  const source: StoredConversationSource = {};
  if (value.bookTitle !== undefined) {
    if (typeof value.bookTitle !== "string") throw new Error("Invalid local AI conversation history.");
    source.bookTitle = value.bookTitle;
  }
  if (value.chapterTitle !== undefined) {
    if (typeof value.chapterTitle !== "string") throw new Error("Invalid local AI conversation history.");
    source.chapterTitle = value.chapterTitle;
  }
  return source;
}

function parseConversation(value: unknown): StoredChatConversation {
  if (!object(value) || typeof value.id !== "string" || typeof value.threadId !== "string" ||
    typeof value.title !== "string" || typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) || typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) || !Array.isArray(value.messages)) {
    throw new Error("Invalid local AI conversation history.");
  }
  return {
    id: value.id,
    threadId: value.threadId,
    title: value.title,
    ...(value.topicTitleVersion === 1 ? { topicTitleVersion: 1 as const } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    source: parseSource(value.source),
    messages: value.messages.map(parseMessage)
  };
}

function parseState(value: unknown): StoredChatState {
  if (!object(value) || value.version !== 1 ||
    !(typeof value.selectedConversationId === "string" || value.selectedConversationId === null) ||
    !Array.isArray(value.conversations)) {
    throw new Error("Invalid local AI conversation history.");
  }
  const conversations = limitStoredChatConversations(value.conversations.map(parseConversation));
  return {
    version: 1,
    selectedConversationId: value.selectedConversationId &&
      conversations.some(({ id }) => id === value.selectedConversationId)
      ? value.selectedConversationId
      : null,
    conversations
  };
}

export class LocalChatConversationStore implements ChatConversationStore {
  readonly #directory: string;
  readonly #path: string;

  constructor(directory: string) {
    this.#directory = directory;
    this.#path = join(directory, "conversations.json");
  }

  load(): StoredChatState {
    try {
      return parseState(JSON.parse(readFileSync(this.#path, "utf8")));
    } catch (error) {
      if (object(error) && error.code === "ENOENT") {
        return { version: 1, selectedConversationId: null, conversations: [] };
      }
      if (error instanceof Error && error.message.includes("AI conversation history")) throw error;
      throw new Error("Unable to load local AI conversation history.", { cause: error });
    }
  }

  save(state: StoredChatState): void {
    const validated = parseState(state);
    mkdirSync(this.#directory, { recursive: true });
    const temporaryPath = join(this.#directory, `conversations.json.tmp-${process.pid}-${Date.now()}`);
    writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(temporaryPath, this.#path);
  }
}
