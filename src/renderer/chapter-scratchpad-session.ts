import { emptyScratchpadContent, parseScratchpadSave, type ChapterScratchpadApi, type ChapterScratchpadKey } from "../shared/chapter-scratchpad";
import { parseReadingNoteDocument, type ReadingNoteDocument } from "../shared/reading-note-document";

export interface ScratchpadState {
  phase: "loading" | "ready";
  content: ReadingNoteDocument;
  revision: number;
  dirty: boolean;
  saving: boolean;
  error: string;
  recoveryWarning: string;
}

/** Lives beyond a mounted editor, so chapter changes cannot redirect pending writes. */
export class ChapterScratchpadSession {
  private state: ScratchpadState = { phase: "loading", content: emptyScratchpadContent(), revision: 0, dirty: false, saving: false, error: "", recoveryWarning: "" };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;
  private loading?: Promise<void>;
  private generation = 0;
  readonly recoveryKey: string;

  constructor(private api: ChapterScratchpadApi, readonly key: ChapterScratchpadKey, private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    this.recoveryKey = `deep-reader:scratchpad-draft:${JSON.stringify([key.bookId, key.chapterId])}`;
    void this.load();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(next: Partial<ScratchpadState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }
  private recovery() {
    try {
      if (!this.storage) throw new Error("Recovery storage unavailable");
      if (this.state.dirty) this.storage.setItem(this.recoveryKey, JSON.stringify({ ...this.key, baseRevision: this.state.revision, content: this.state.content }));
      else this.storage.removeItem(this.recoveryKey);
      if (this.state.recoveryWarning) this.patch({ recoveryWarning: "" });
    } catch {
      this.patch({ recoveryWarning: "Local recovery is unavailable. Keep the app open until Saved appears." });
    }
  }
  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.patch({ error: "" });
      try {
        const saved = await this.api.get(this.key);
        let draft;
        try {
          const raw = this.storage?.getItem(this.recoveryKey);
          if (raw) {
            draft = parseScratchpadSave(JSON.parse(raw));
            if (draft.bookId !== this.key.bookId || draft.chapterId !== this.key.chapterId) throw new Error("Invalid recovery source");
          }
        } catch { this.patch({ recoveryWarning: "Unable to read the local recovery draft." }); }
        const recover = draft && JSON.stringify(draft.content) !== JSON.stringify(saved.content);
        this.patch({ phase: "ready", revision: saved.revision, content: recover ? draft!.content : saved.content, dirty: Boolean(recover),
          error: recover && draft!.baseRevision !== saved.revision ? "A recovered draft differs from the saved version. Use Save my draft to keep the recovered content." : "" });
        if (recover && !this.state.error) { this.recovery(); void this.flush(); }
        else if (draft && !recover) this.recovery();
      } catch (cause) { this.patch({ error: cause instanceof Error ? cause.message : "Unable to load scratchpad." }); }
    })();
    await this.loading;
    this.loading = undefined;
  }
  update(content: ReadingNoteDocument) {
    if (this.state.phase !== "ready") return;
    const parsed = parseReadingNoteDocument(content);
    if (JSON.stringify(parsed) === JSON.stringify(this.state.content)) return;
    this.generation++;
    this.patch({ content: parsed, dirty: true });
    this.recovery();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 400);
  }
  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    if (!this.state.dirty || this.state.error || this.state.phase !== "ready") return;
    this.saving = (async () => {
      this.patch({ saving: true });
      while (this.state.dirty && !this.state.error) {
        const generation = this.generation;
        try {
          const saved = await this.api.save({ ...this.key, baseRevision: this.state.revision, content: this.state.content });
          const current = generation === this.generation;
          this.patch({ revision: saved.revision, ...(current ? { content: saved.content, dirty: false } : {}) });
          this.recovery();
        } catch (cause) { this.patch({ error: cause instanceof Error ? cause.message : "Unable to save scratchpad." }); }
      }
      this.patch({ saving: false });
    })();
    await this.saving;
    this.saving = undefined;
  };
  retry = async () => {
    if (this.state.phase === "loading") return this.load();
    if (this.saving) await this.saving;
    try {
      // Explicit retry keeps the user's visible draft after a revision conflict.
      const saved = await this.api.get(this.key);
      this.patch({ revision: saved.revision, error: "" });
      this.recovery();
      await this.flush();
    } catch (cause) { this.patch({ error: cause instanceof Error ? cause.message : "Unable to retry save." }); }
  };
}

const sessions = new WeakMap<ChapterScratchpadApi, Map<string, ChapterScratchpadSession>>();
export function chapterScratchpadSession(api: ChapterScratchpadApi, key: ChapterScratchpadKey) {
  let cache = sessions.get(api);
  if (!cache) { cache = new Map(); sessions.set(api, cache); }
  const id = JSON.stringify([key.bookId, key.chapterId]);
  let session = cache.get(id);
  if (!session) {
    let storage;
    try { storage = window.localStorage; } catch { /* Main storage remains available. */ }
    session = new ChapterScratchpadSession(api, key, storage);
    cache.set(id, session);
  }
  return session;
}
