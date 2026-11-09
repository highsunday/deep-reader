import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  ReadingNoteDetail,
  ReadingNoteLibraryEmpty,
  ReadingNoteLibraryHeader,
  ReadingNoteList,
  readingNoteFilterOptions
} from "../src/renderer/ReadingNoteLibrary";
import type { ReadingNote } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

const notes: ReadingNote[] = [{
  id: "note-new",
  sourceDraftId: "draft-new",
  title: "Why does feedback delay cause oscillation?",
  content: markdownToReadingNoteDocument("A delay can make correction arrive **after** the state has crossed the target.\n\n<script>alert('no')</script>\n\n$e=mc^2$"),
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback loops",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  revision: 1
}, {
  id: "note-old",
  sourceDraftId: "draft-old",
  title: "How does a balancing loop work?",
  content: markdownToReadingNoteDocument("It counters change."),
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback loops",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  revision: 1
}];

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("the Library header mirrors the original app without a chapter filter", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteLibraryHeader
      view="active"
      counts={{ active: 2, trashed: 1 }}
      query={{ status: "active", search: "feedback", sort: "alphabetical" }}
      filterOptions={readingNoteFilterOptions(notes)}
      onView={() => undefined}
      onQuery={() => undefined}
      onClear={() => undefined}
      onEmptyTrash={() => undefined}
    />
  );
  assert.match(markup, /Reading Notes/);
  assert.match(markup, /Trash/);
  assert.match(markup, /Search titles/);
  assert.match(markup, />Book</);
  assert.doesNotMatch(markup, /來源章節|全部章節/);
  assert.match(markup, /Recently added/);
  assert.match(markup, /Title: A–Z/);
  assert.match(markup, /Clear filters/);
  assert.match(markup, /reading-note-search-field/);
  assert.match(markup, /reading-note-trash-entry-icon/);
  assert.match(styles, /\.reading-note-trash-entry \{[^}]*min-height: 34px;[^}]*padding: 6px 9px;[^}]*font-size: 13px;[^}]*font-weight: 650;/s);
  assert.match(styles, /\.reading-note-trash-entry strong \{[^}]*min-width: 18px;[^}]*height: 18px;[^}]*font-size: 9\.5px;/s);
});

test("active summaries are title-led and show only book source plus creation time", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteList
      view="active"
      notes={notes}
      mutating={false}
      onOpen={() => undefined}
      onRestore={() => undefined}
    />
  );
  assert.ok(markup.indexOf(notes[0].title) < markup.indexOf(notes[1].title));
  assert.match(markup, /Thinking in Systems/);
  assert.doesNotMatch(markup, /Feedback loops/);
  assert.match(markup, /2027|2026/);
  assert.match(markup, /reading-note-card-source/);
  assert.match(markup, /reading-note-card-title/);
  assert.doesNotMatch(markup, /reading-note-card-chapter/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
  assert.match(markup, /Open note/);
  assert.match(markup, /reading-note-card-open/);
  assert.match(markup, />Front</);
  assert.match(markup, />Back</);
  assert.match(styles, /\.reading-note-card-container > \.reading-note-library-card \{[^}]*padding-top: 50px;/s);
  assert.match(styles, /\.reading-note-card-face-status \{[^}]*top: 11px;[^}]*left: 18px;/s);
  assert.match(markup, /reading-note-card-zoom/);
  assert.match(styles, /\.reading-note-card-flip, \.reading-note-card-zoom \{[^}]*top: 11px;[^}]*width: 26px;[^}]*height: 22px;/s);
  assert.match(styles, /\.reading-note-card-flip \{ right: 18px; \}/);
  assert.match(styles, /\.reading-note-card-zoom \{ right: 49px; \}/);
});

test("the legacy detail fallback is title-led, safe, and supports soft deletion", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteDetail
      note={notes[0]}
      deleteConfirming
      mutating={false}
      onClose={() => undefined}
      onRequestDelete={() => undefined}
      onCancelDelete={() => undefined}
      onConfirmDelete={() => undefined}
    />
  );
  assert.match(markup, new RegExp(`<h2 id="reading-note-detail-title">${notes[0].title.replace(/[?]/g, "\\?")}<\\/h2>`));
  assert.equal(markup.split(notes[0].title).length - 1, 1);
  assert.doesNotMatch(markup, /Recall Prompt/);
  assert.match(markup, /Note Content/);
  assert.match(markup, /Source/);
  assert.match(markup, /reading-note-detail-paper/);
  assert.match(markup, /reading-note-detail-content/);
  assert.match(markup, /danger-outline-action/);
  assert.match(markup, />Delete<\/button>/);
  assert.match(markup, /reading-note-detail-source-copy/);
  assert.match(markup, /reading-note-detail-source-chevron/);
  assert.equal((markup.match(/aria-expanded="false"/g) ?? []).length, 2);
  assert.match(markup, /\*\*after\*\*/);
  assert.match(markup, /\$e=mc\^2\$/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /Move to Trash/);
  assert.doesNotMatch(markup, />Edit</);
  assert.doesNotMatch(markup, /Edit with AI/);
  assert.doesNotMatch(markup, /Review schedule|Back to source/);
});

test("detail dialog keeps comfortable vertical clearance from the app chrome", () => {
  assert.match(styles, /\.reading-note-detail-backdrop \{[^}]*padding: 48px 28px;/s);
  assert.match(styles, /\.reading-note-detail \{[^}]*max-height: min\(780px, calc\(100vh - 96px\)\);/s);
  assert.match(styles, /@container \(max-width: 700px\)[\s\S]*?\.reading-note-detail-backdrop \{ padding: 16px; \}[\s\S]*?\.reading-note-detail \{ max-height: calc\(100vh - 32px\);/s);
});

test("detail dialog stays above the app header", () => {
  assert.match(styles, /\.app-header \{[^}]*z-index: 30;/s);
  assert.match(styles, /\.reading-note-detail-backdrop \{[^}]*z-index: 40;/s);
});

test("Trash summaries restore per item and empty Trash warns that deletion cannot be recovered", () => {
  const trashed = [{ ...notes[0], trashedAt: 1_800_000_000_100 }];
  const list = renderToStaticMarkup(
    <ReadingNoteList
      view="trashed"
      notes={trashed}
      mutating={false}
      onOpen={() => undefined}
      onRestore={() => undefined}
    />
  );
  const header = renderToStaticMarkup(
    <ReadingNoteLibraryHeader
      view="trashed"
      counts={{ active: 1, trashed: 1 }}
      query={{ status: "trashed", sort: "recent" }}
      filterOptions={{ books: [] }}
      emptyTrashConfirming
      onView={() => undefined}
      onQuery={() => undefined}
      onClear={() => undefined}
      onEmptyTrash={() => undefined}
      onCancelEmptyTrash={() => undefined}
      onConfirmEmptyTrash={() => undefined}
    />
  );
  assert.match(list, /Restore/);
  assert.match(list, /aria-label="Restore Why does feedback delay cause oscillation\?"/);
  assert.match(list, /aria-label="Open Why does feedback delay cause oscillation\?"/);
  assert.doesNotMatch(list, /visually-hidden/);
  assert.match(list, /reading-note-trash-meta/);
  assert.match(list, /reading-note-trash-note-icon/);
  assert.match(list, /reading-note-trash-deleted/);
  assert.match(list, /Deleted/);
  const restoringList = renderToStaticMarkup(
    <ReadingNoteList
      view="trashed"
      notes={trashed}
      mutating
      restoringNoteId={trashed[0].id}
      onOpen={() => undefined}
      onRestore={() => undefined}
    />
  );
  assert.match(restoringList, /aria-busy="true"/);
  assert.match(restoringList, /Restoring…/);
  assert.match(restoringList, /disabled=""/);
  assert.match(header, /Permanently empty Trash/);
  assert.match(header, /cannot be undone/);
  assert.match(header, /Cancel/);
  assert.match(header, /reading-note-empty-trash-icon/);
});

test("Trash actions keep permanent deletion cautious and Restore visually quiet", () => {
  assert.match(styles, /\.reading-note-trash-toolbar \.danger-outline-action \{[^}]*min-height: 34px;[^}]*padding: 6px 9px;[^}]*border: 1px solid transparent;[^}]*border-radius: 8px;[^}]*color: #875344;[^}]*background: transparent;[^}]*font-weight: 600;/s);
  assert.match(styles, /\.reading-note-trash-toolbar \.danger-outline-action:hover:not\(:disabled\) \{[^}]*color: #713e31;[^}]*background: #f5ebe7;/s);
  assert.match(styles, /\.reading-note-trash-restore \{[^}]*min-width: 104px;[^}]*min-height: 44px;[^}]*align-self: stretch;[^}]*margin: -8px -8px -8px 0;[^}]*border-left: 1px solid transparent;[^}]*border-radius: 0 15px 15px 0;[^}]*color: #42687a;[^}]*background: transparent;[^}]*font-weight: 600;/s);
  assert.match(styles, /\.reading-note-trash-restore:hover:not\(:disabled\) \{[^}]*border-left-color: #d8e2e4;[^}]*color: #274f63;[^}]*background: #edf2f2;/s);
  assert.match(styles, /@container \(max-width: 480px\)[^}]*\.reading-note-trash-item \{ grid-template-columns: minmax\(0, 1fr\); \}/s);
  assert.match(styles, /@container \(max-width: 480px\)[\s\S]*?\.reading-note-trash-restore \{[^}]*min-height: 44px;[^}]*justify-self: stretch;[^}]*border-top: 1px solid #e4e7e3;/s);
});

test("empty states distinguish first-note guidance, filtered results, and empty Trash", () => {
  assert.match(renderToStaticMarkup(
    <ReadingNoteLibraryEmpty view="active" filtersActive={false} />
  ), /Reading Notes Library is empty|Back to books/);
  assert.match(renderToStaticMarkup(
    <ReadingNoteLibraryEmpty view="active" filtersActive onClear={() => undefined} />
  ), /No notes match|Clear filters/);
  assert.match(renderToStaticMarkup(
    <ReadingNoteLibraryEmpty view="trashed" filtersActive={false} />
  ), /Trash is empty/);
});
