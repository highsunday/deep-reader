import { parseScratchpadKey, parseScratchpadSave, type ChapterScratchpadKey } from "../shared/chapter-scratchpad";
import type { LocalChapterScratchpadStore } from "./chapter-scratchpad-store";

export function registerChapterScratchpadIpc(
  ipc: { handle(channel: string, handler: (event: unknown, input: unknown) => unknown): unknown },
  store: LocalChapterScratchpadStore,
  hasChapter: (key: ChapterScratchpadKey) => boolean | Promise<boolean>
) {
  async function source(input: unknown) {
    const key = parseScratchpadKey(input);
    if (!await hasChapter(key)) throw new Error("Chapter not found.");
    return key;
  }
  ipc.handle("chapter-scratchpad:get", async (_event, input) => store.get(await source(input)));
  ipc.handle("chapter-scratchpad:save", async (_event, input) => {
    await source(input);
    return store.save(parseScratchpadSave(input));
  });
}
