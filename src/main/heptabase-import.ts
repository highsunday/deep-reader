import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { ReadingNote } from "../shared/contracts";
import type {
  HeptabaseImportBatch,
  HeptabaseImportItem,
} from "../shared/heptabase-import";
import {
  readingNoteDocumentToMarkdown,
  type ReadingNoteBlock,
} from "../shared/reading-note-document";
import { readingNoteImage } from "../shared/reading-note-images";
import { HeptabaseCliError, runHeptabaseCli } from "./heptabase-cli";
interface Image {
  id: string;
  data?: string;
  snapshotFile?: string;
  fileId?: string;
  uri?: string;
}
interface Item extends HeptabaseImportItem {
  note: ReadingNote;
  images: Image[];
  creating?: boolean;
  snapshotError?: string;
}
interface Batch extends Omit<HeptabaseImportBatch, "items"> {
  items: Item[];
  unknownTitles?: string[];
}
const titleKey = (title: string) => title.trim().normalize("NFC");
const line = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const heading = (text: string) =>
  line(text).replace(/[\\`*_{}\[\]()#+.!<>$|~]/g, "\\$&");
export class HeptabaseImportController {
  private batch?: Batch;
  private busy = false;
  private historyError?: string;
  private readonly path: string;
  private readonly run: (args: string[]) => Promise<any>;
  constructor(
    private directory: string,
    private dependencies: {
      get(id: string): ReadingNote | undefined;
      readImage(id: string): string;
      run?: (args: string[]) => Promise<any>;
    },
  ) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, "heptabase-import.json");
    this.run = dependencies.run ?? runHeptabaseCli;
    if (existsSync(this.path)) {
      try {
        this.batch = JSON.parse(readFileSync(this.path, "utf8")) as Batch;
        if (
          !Array.isArray(this.batch.items) ||
          typeof this.batch.id !== "string"
        )
          throw new Error("Invalid history");
        this.batch.running = false;
        for (const item of this.batch.items)
          if (item.status === "importing" || item.status === "pending") {
            item.status = item.creating ? "uncertain" : "failed";
            item.message = item.creating
              ? "Import was interrupted. Check Heptabase before trying again."
              : "Import was interrupted. Retry this item.";
          }
        this.persist();
      } catch {
        this.batch = undefined;
        this.historyError =
          "Heptabase import history could not be read. Preserve heptabase-import.json and restore its backup before importing again.";
      }
    }
  }
  get(): HeptabaseImportBatch | undefined {
    if (this.historyError) throw new Error(this.historyError);
    return this.batch
      ? {
          id: this.batch.id,
          running: this.batch.running,
          items: this.batch.items.map(
            ({ noteId, title, status, message, cardId }) => ({
              noteId,
              title,
              status,
              message,
              cardId,
            }),
          ),
        }
      : undefined;
  }
  private persist() {
    // Keep large image bytes out of the manifest that is rewritten for each progress update.
    const imageDirectory = join(this.directory, "heptabase-import-images");
    mkdirSync(imageDirectory, { recursive: true });
    for (const item of this.batch?.items ?? [])
      for (const image of item.images)
        if (image.data !== undefined) {
          image.snapshotFile ??= randomUUID() + ".data";
          if (!/^[0-9a-f-]{36}\.data$/.test(image.snapshotFile)) throw new Error("Invalid saved image snapshot reference.");
          writeFileSync(join(imageDirectory, image.snapshotFile), image.data, {
            mode: 0o600,
          });
          delete image.data;
        }
    writeFileSync(this.path + ".tmp", JSON.stringify(this.batch), {
      mode: 0o600,
    });
    renameSync(this.path + ".tmp", this.path);
    const retained = new Set(
      this.batch?.items.flatMap((i) =>
        i.images.map((image) => image.snapshotFile),
      ),
    );
    for (const name of readdirSync(imageDirectory))
      if (/^[0-9a-f-]{36}\.data$/.test(name) && !retained.has(name))
        rmSync(join(imageDirectory, name));
  }
  private imageData(image: Image): string {
    if (image.data !== undefined) return image.data;
    if (
      !image.snapshotFile ||
      !/^[0-9a-f-]{36}\.data$/.test(image.snapshotFile)
    )
      throw new Error("The saved image snapshot is unavailable.");
    return readFileSync(
      join(this.directory, "heptabase-import-images", image.snapshotFile),
      "utf8",
    );
  }
  private async ready() {
    try {
      const version = await this.run(["--version"]);
      if (typeof version !== "string" || !/^0\.9\./.test(version))
        throw new Error(
          "Heptabase import requires CLI 0.9.x. Update the Heptabase desktop app or this app.",
        );
      const ready = await this.run(["start", "--timeout-ms", "10000"]);
      if (ready?.status !== "ready") throw new Error("Heptabase is not ready.");
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : "Unable to connect to Heptabase."} Open Heptabase and enable Settings → AI Features → CLI.`,
      );
    }
  }
  async start(ids: unknown): Promise<HeptabaseImportBatch> {
    if (this.historyError) throw new Error(this.historyError);
    if (this.busy) throw new Error("A Heptabase import is already running.");
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => typeof id !== "string" || !id.trim())
    )
      throw new Error("Select at least one reading note to import.");
    const items: Item[] = [...new Set(ids as string[])].map((id) => {
      const note = this.dependencies.get(id);
      if (!note || note.trashedAt !== undefined)
        throw new Error(
          "A selected reading note is unavailable. Refresh your selection.",
        );
      if (!line(note.title))
        throw new Error("A reading note title is required.");
      return {
        noteId: id,
        title: line(note.title),
        note: structuredClone(note),
        images: [],
        status: "pending",
      };
    });
    // Capture image bytes at start, but persist per-item failures so one missing image does not stop the batch.
    for (const item of items) {
      try {
        item.images = this.snapshotImages(item.note);
      } catch (error) {
        item.snapshotError = String(
          error instanceof Error ? error.message : error,
        );
      }
    }
    this.busy = true;
    try {
      await this.ready();
      const unknownTitles = [
        ...new Set([
          ...(this.batch?.unknownTitles ?? []),
          ...(this.batch?.items
            .filter((i) => i.status === "uncertain")
            .map((i) => titleKey(i.title)) ?? []),
        ]),
      ];
      for (const item of items)
        if (unknownTitles.includes(titleKey(item.title))) {
          item.status = "uncertain";
          item.message =
            "A previous import has an unconfirmed result. Check Heptabase before importing this title again.";
        }
      this.batch = { id: randomUUID(), running: true, items, unknownTitles };
      this.persist();
      this.launch(false);
      return this.get()!;
    } catch (error) {
      this.busy = false;
      if (this.batch) this.batch.running = false;
      throw error;
    }
  }
  private snapshotImages(note: ReadingNote): Image[] {
    const ids = new Set<string>();
    const understand = readingNoteImage(note, "understand")?.attachmentId;
    if (understand) ids.add(understand);
    const visit = (blocks: ReadingNoteBlock[]) => {
      for (const b of blocks) {
        if (b.type === "image") {
          if (typeof b.props.assetId !== "string" || !b.props.assetId)
            throw new Error("A body image is not a saved local attachment.");
          ids.add(b.props.assetId);
        }
        visit(b.children);
      }
    };
    visit(note.content.blocks);
    return [...ids].map((id) => ({
      id,
      data: this.dependencies.readImage(id),
    }));
  }
  async retry(): Promise<HeptabaseImportBatch> {
    if (this.busy || !this.batch)
      throw new Error("No completed import is available to retry.");
    this.busy = true;
    try {
      await this.ready();
      for (const item of this.batch.items)
        if (item.status === "failed") {
          item.status = "pending";
          delete item.creating;
          delete item.snapshotError;
          delete item.message;
        }
      this.batch.running = true;
      this.persist();
      this.launch(true);
      return this.get()!;
    } catch (error) {
      this.busy = false;
      if (this.batch) this.batch.running = false;
      throw error;
    }
  }
  private async existingTitles(): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    let offset = 0;
    for (;;) {
      const page = await this.run([
        "card",
        "list",
        "--card-types",
        "note",
        "--sort",
        "title",
        "--direction",
        "ascending",
        "--limit",
        "100",
        "--offset",
        String(offset),
      ]);
      if (
        !Array.isArray(page?.results) ||
        !Number.isInteger(page.total) ||
        page.total < 0
      )
        throw new Error("Heptabase returned an invalid card list.");
      for (const c of page.results) {
        if (
          c.objectType === "note" &&
          typeof c.title === "string" &&
          typeof c.id === "string"
        )
          titles.set(titleKey(c.title), c.id);
      }
      offset += page.results.length;
      if (offset >= page.total) break;
      if (!page.results.length)
        throw new Error("Heptabase returned an incomplete card list.");
    }
    return titles;
  }
  private markdown(item: Item): string {
    const uris = new Map(item.images.map((i) => [i.id, i.uri!]));
    // Random placeholders affect only image nodes, leaving ordinary text and code untouched.
    const marker = "hepta-" + randomUUID() + "-";
    const replacements = new Map<string, string>();
    const convert = (b: ReadingNoteBlock): ReadingNoteBlock => {
      let props = b.props;
      if (b.type === "image") {
        const key = marker + replacements.size;
        replacements.set(
          "reading-note-asset:" + key,
          uris.get(String(b.props.assetId))!,
        );
        props = { ...props, assetId: key };
      }
      return { ...b, props, children: b.children.map(convert) };
    };
    let body = readingNoteDocumentToMarkdown({
      ...item.note.content,
      blocks: item.note.content.blocks.map(convert),
    }).trim();
    for (const [from, to] of replacements) body = body.replaceAll(from, to);
    const understand = readingNoteImage(item.note, "understand")?.attachmentId;
    const source = [line(item.note.bookTitle), line(item.note.chapterTitle)]
      .filter(Boolean)
      .join(" · ");
    return (
      [
        "# " + heading(item.title),
        understand ? `![理解圖](${uris.get(understand)})` : "",
        body,
        source ? "---\n\nSource: " + source : "",
      ]
        .filter(Boolean)
        .join("\n\n") + "\n"
    );
  }
  private launch(retry: boolean) {
    void this.process(retry).catch(() => {
      this.busy = false;
      if (this.batch) this.batch.running = false;
      this.historyError = "Unable to save Heptabase import progress. Check available disk space and the cards in Heptabase before importing again.";
    });
  }
  private async process(retry: boolean) {
    let temp: string | undefined;
    try {
      const titles = await this.existingTitles();
      temp = mkdtempSync(join(this.directory, "temp-"));
      for (const item of this.batch!.items) {
        if (item.status === "uncertain" && retry) {
          const id = titles.get(titleKey(item.title));
          if (id) {
            item.status = "duplicate";
            item.cardId = id;
            item.message =
              "A note with this title already exists. Not changed.";
            this.batch!.unknownTitles = this.batch!.unknownTitles?.filter(
              (t) => t !== titleKey(item.title),
            );
            this.persist();
          }
          continue;
        }
        if (item.status !== "pending") continue;
        const duplicate = titles.get(titleKey(item.title));
        if (duplicate) {
          item.status = "duplicate";
          item.cardId = duplicate;
          item.message = "A note with this title already exists. Not changed.";
          this.persist();
          continue;
        }
        item.status = "importing";
        this.persist();
        try {
          if (item.snapshotError) throw new Error(item.snapshotError);
          if (!item.images.length) item.images = this.snapshotImages(item.note);
          for (const image of item.images) {
            if (image.uri) continue;
            const match =
              /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
                this.imageData(image),
              );
            if (!match)
              throw new Error("An image has an unsupported or invalid format.");
            const bytes = Buffer.from(match[2]!, "base64");
            if (!bytes.length) throw new Error("An image is empty.");
            const path = join(
              temp,
              randomUUID() + "." + (match[1] === "jpeg" ? "jpg" : match[1]),
            );
            writeFileSync(path, bytes, { mode: 0o600 });
            image.fileId ??= randomUUID();
            this.persist();
            const result = await this.run([
              "file",
              "import",
              path,
              "--file-id",
              image.fileId,
            ]);
            if (
              result?.status !== "succeeded" ||
              result?.fileKind !== "image" ||
              !/^heptabase:\/\/file\/[0-9a-f-]{36}$/i.test(result.fileUri)
            )
              throw new Error(
                "Heptabase did not confirm the image import. Retry to check the same file.",
              );
            image.uri = result.fileUri;
            this.persist();
          }
          const path = join(temp, "note.md");
          writeFileSync(path, this.markdown(item), { mode: 0o600 });
          // Persist intent before create: interruptions here must never silently re-create a note.
          item.creating = true;
          this.persist();
          const result = await this.run([
            "note",
            "create",
            "--no-created-by-ai",
            "--content-file",
            path,
          ]);
          if (typeof result?.id !== "string")
            throw new Error("Heptabase did not confirm the new card.");
          item.cardId = result.id;
          titles.set(titleKey(item.title), result.id);
          // Verify the official read path and each imported image's attachment reference.
          const read = await this.run(["note", "read", result.id]);
          const content =
            typeof read.content === "string"
              ? JSON.parse(read.content)
              : read.content;
          const foundImages = new Set<string>();
          const collect = (node: any) => {
            if (
              node?.type === "image" &&
              typeof node.attrs?.fileId === "string"
            )
              foundImages.add(node.attrs.fileId);
            if (Array.isArray(node?.content)) node.content.forEach(collect);
          };
          collect(content);
          if (
            content?.type !== "doc" ||
            (read.title !== undefined && read.title !== item.title) ||
            item.images.some((i) => !foundImages.has(i.uri!.split("/").at(-1)!))
          )
            throw new Error(
              "The card was created, but its title or images could not be verified. Check Heptabase.",
            );
          item.status = "created";
          item.message = "Imported note and source.";
          delete item.creating;
          // Successful snapshots no longer need source text/image bytes on disk.
          item.images.forEach((i) => {
            delete i.data;
            delete i.snapshotFile;
          });
        } catch (error) {
          item.status =
            item.creating &&
            !(error instanceof HeptabaseCliError && error.definite)
              ? "uncertain"
              : "failed";
          item.message =
            error instanceof Error
              ? error.message
              : "Unable to import this note.";
          if (item.status === "uncertain") {
            this.batch!.unknownTitles = [
              ...new Set([
                ...(this.batch!.unknownTitles ?? []),
                titleKey(item.title),
              ]),
            ];
          }
          if (item.status === "uncertain")
            item.message +=
              " Check Heptabase; the card will not be created again automatically.";
        }
        this.persist();
      }
    } catch (error) {
      for (const item of this.batch!.items)
        if (item.status === "pending") {
          item.status = "failed";
          item.message =
            error instanceof Error
              ? error.message
              : "Unable to list Heptabase cards.";
        }
    } finally {
      if (temp) rmSync(temp, { recursive: true, force: true });
      this.batch!.running = false;
      this.busy = false;
      this.persist();
    }
  }
}
