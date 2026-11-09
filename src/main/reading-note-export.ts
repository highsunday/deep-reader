import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import type { ReadingNote } from "../shared/contracts";
import { readingNoteDocumentAttachmentIds, readingNoteDocumentToMarkdown } from "../shared/reading-note-document";
import { readingNoteImage } from "../shared/reading-note-images";

interface ExportAsset { path: string; bytes: Buffer }
export interface BuiltReadingNoteExport {
  extension: "md" | "zip";
  filename: string;
  markdown: string;
  assets: ExportAsset[];
}

function safeFilename(title: string): string {
  return title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").replace(/^\.+|[. ]+$/g, "").trim().slice(0, 100) || "Reading note";
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function imageData(dataUrl: string): { extension: string; bytes: Buffer } {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Unable to export an invalid reading-note image.");
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length) throw new Error("Unable to export an empty reading-note image.");
  return { extension: match[1] === "jpeg" ? "jpg" : match[1]!, bytes };
}

export async function buildReadingNoteExport(
  note: ReadingNote,
  readDataUrl: (attachmentId: string) => string,
  assetDirectory = "assets"
): Promise<BuiltReadingNoteExport> {
  const title = singleLine(note.title) || "Untitled reading note";
  const filename = safeFilename(title);
  const assets: ExportAsset[] = [];
  const paths = new Map<string, string>();
  const include = (id: string): string => {
    const existing = paths.get(id);
    if (existing) return existing;
    const { extension, bytes } = imageData(readDataUrl(id));
    const path = `${assetDirectory}/image-${assets.length + 1}.${extension}`;
    assets.push({ path, bytes });
    paths.set(id, path);
    return path;
  };

  const understandingId = readingNoteImage(note, "understand")?.attachmentId;
  const understanding = understandingId ? `![理解圖](${include(understandingId)})` : "";
  let body = readingNoteDocumentToMarkdown(note.content).trim();
  for (const id of readingNoteDocumentAttachmentIds(note.content)) {
    body = body.replaceAll(`reading-note-asset:${id}`, include(id));
  }
  const source = [singleLine(note.bookTitle), singleLine(note.chapterTitle)].filter(Boolean).join(" · ");
  const markdown = [
    understanding,
    body,
    ...(source ? ["---", `Source: ${source}`] : [])
  ].filter(Boolean).join("\n\n") + "\n";
  return { extension: assets.length ? "zip" : "md", filename, markdown, assets };
}

export interface ReadingNoteExportDependencies {
  get(noteId: string): ReadingNote | undefined;
  readDataUrl(attachmentId: string): string;
  showSaveDialog(options: {
    title: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

export async function saveReadingNoteExport(
  noteId: string,
  dependencies: ReadingNoteExportDependencies
): Promise<{ status: "cancelled" } | { status: "exported"; path: string }> {
  const note = dependencies.get(noteId);
  if (!note || note.trashedAt !== undefined) throw new Error("This reading note is unavailable for export.");
  const built = await buildReadingNoteExport(note, dependencies.readDataUrl);
  const selection = await dependencies.showSaveDialog({
    title: built.extension === "zip" ? "Export for Heptabase (import with Obsidian)" : "Export reading note for Heptabase",
    defaultPath: `${built.filename}.${built.extension}`,
    filters: [{ name: built.extension === "zip" ? "Obsidian ZIP (Markdown with images)" : "Markdown", extensions: [built.extension] }]
  });
  if (selection.canceled || !selection.filePath) return { status: "cancelled" };

  const contents = built.extension === "md" ? Buffer.from(built.markdown, "utf8") : await (async () => {
    const zip = new JSZip();
    zip.file(`${built.filename}.md`, built.markdown);
    for (const asset of built.assets) zip.file(asset.path, asset.bytes);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  })();
  const temporaryPath = join(dirname(selection.filePath), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, selection.filePath);
  } catch (cause) {
    try { unlinkSync(temporaryPath); } catch { /* No temporary file remains after a failed write. */ }
    throw cause;
  }
  return { status: "exported", path: selection.filePath };
}


/** Export the selected saved notes as one Obsidian-compatible vault archive. */
export async function saveReadingNotesExport(
  noteIds: string[],
  dependencies: ReadingNoteExportDependencies
): Promise<{ status: "cancelled" } | { status: "exported"; path: string }> {
  if (!Array.isArray(noteIds) || !noteIds.length || noteIds.some(id => typeof id !== "string" || !id.trim())) {
    throw new Error("Select at least one reading note to export.");
  }
  const notes = [...new Set(noteIds)].map(id => {
    const note = dependencies.get(id);
    if (!note || note.trashedAt !== undefined) throw new Error("A selected reading note is unavailable for export. Refresh your selection and try again.");
    return structuredClone(note);
  });
  // Invoke every builder before yielding so note contents and image bytes form one snapshot.
  const built = await Promise.all(notes.map((note, index) =>
    buildReadingNoteExport(note, dependencies.readDataUrl, `assets/note-${index + 1}`)));
  const zip = new JSZip();
  const filenames = new Set<string>();
  for (const item of built) {
    let filename = item.filename;
    let suffix = 2;
    while (filenames.has(filename.normalize("NFC").toLowerCase())) filename = `${item.filename} (${suffix++})`;
    filenames.add(filename.normalize("NFC").toLowerCase());
    zip.file(`${filename}.md`, item.markdown);
    for (const asset of item.assets) zip.file(asset.path, asset.bytes);
  }
  const selection = await dependencies.showSaveDialog({
    title: "Export for Heptabase (import with Obsidian)",
    defaultPath: `Reading notes (${notes.length}).zip`,
    filters: [{ name: "Obsidian ZIP (Markdown with images)", extensions: ["zip"] }]
  });
  if (selection.canceled || !selection.filePath) return { status: "cancelled" };
  const contents = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const temporaryPath = join(dirname(selection.filePath), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, selection.filePath);
  } catch (cause) {
    try { unlinkSync(temporaryPath); } catch { /* Temporary file was not created or already removed. */ }
    throw cause;
  }
  return { status: "exported", path: selection.filePath };
}
