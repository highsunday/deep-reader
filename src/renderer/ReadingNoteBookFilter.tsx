import { useEffect, useId, useRef, useState } from "react";

export function ReadingNoteBookFilter({ books, value, onChange }: {
  books: string[];
  value?: string;
  onChange(value: string | undefined): void;
}) {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const matching = books.filter((book) => book.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const options = ["", ...matching];
  const activeIndex = active < options.length ? active : -1;

  useEffect(() => {
    if (open) list.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function choose(book: string) {
    onChange(book || undefined);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="reading-note-book-filter" data-filtered={Boolean(value)} data-open={open} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label htmlFor={id}>Book</label>
      <div className="reading-note-book-input">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder={open ? "Search books…" : "All books"}
          title={value || "All books"}
          value={open ? search : value ?? ""}
          onFocus={() => { setSearch(""); setActive(Math.max(0, books.indexOf(value ?? "") + 1)); setOpen(true); }}
          onClick={() => { if (!open) { setSearch(""); setActive(Math.max(0, books.indexOf(value ?? "") + 1)); setOpen(true); } }}
          onChange={(event) => { setSearch(event.target.value); setActive(event.target.value.trim() ? 1 : 0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) { setSearch(""); setActive(0); setOpen(true); }
              else setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
            }
            if (event.key === "Enter" && open && activeIndex >= 0) { event.preventDefault(); choose(options[activeIndex]); }
          }}
        />
        <svg className="reading-note-book-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
      </div>
      {open && <div className="reading-note-book-menu">
        <div className="reading-note-book-menu-heading">
          <span>Choose a book</span><span>{matching.length} / {books.length}</span>
        </div>
        {value && <div className="reading-note-book-current" title={value}><span>Filtering by</span><strong>{value}</strong></div>}
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Books">
          {options.map((book, index) => <li
            key={book}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={(value ?? "") === book}
            className={index === activeIndex ? "highlighted" : undefined}
            title={book || "All books"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(book)}
          >
            <span className="reading-note-book-check" aria-hidden="true">{(value ?? "") === book ? "✓" : ""}</span>
            <span>{book || "All books"}</span>
          </li>)}
        </ul>
        {matching.length === 0 && <div className="reading-note-book-empty"><p role="status">{books.length ? "No matching books" : "No books available"}</p><span>{books.length ? "Try a shorter title or another keyword." : "Books appear here when you save reading notes."}</span></div>}
        <div className="reading-note-book-menu-footer"><span>↑ ↓ Navigate · Enter Select</span><span>Esc Close</span></div>
      </div>}
    </div>
  );
}
