import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { ReaderDesktopApi, ReadingNote } from "../shared/contracts";
import { readingNoteDocumentToBlockNoteBlocks } from "./reading-note-editor-adapter";
import { readingNoteSchema } from "./reading-note-schema";
import { ReadingNoteVisualContext } from "./ReadingNoteInlineVisual";

/** Same rich document and managed attachments as the note editor, without editing controls. */
export function ReadingNoteReadOnlyContent({ api, note }: { api: ReaderDesktopApi["readingNotes"]; note: ReadingNote }) {
  const editor = useCreateBlockNote({
    schema: readingNoteSchema,
    initialContent: readingNoteDocumentToBlockNoteBlocks(note.content) as never,
    resolveFileUrl: async url => {
      if (!url.startsWith("reading-note-asset:")) throw new Error("Only managed note images are supported.");
      return api.attachments.readDataUrl(url.slice("reading-note-asset:".length));
    }
  }, [note.id, note.revision]);
  return <ReadingNoteVisualContext.Provider value={{ api, note, browsing: true }}>
    <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} sideMenu={false} slashMenu={false} />
  </ReadingNoteVisualContext.Provider>;
}
