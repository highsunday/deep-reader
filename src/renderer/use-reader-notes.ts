import { useCallback, useEffect, useRef, useState } from "react";
import type { ReaderDesktopApi, ReadingNote } from "../shared/contracts";

export function useReaderNotes(
  api: ReaderDesktopApi["readingNotes"] | undefined,
  bookTitle: string | undefined,
  contextKey: string
) {
  const [state, setState] = useState<{
    bookTitle?: string; notes: ReadingNote[]; loading: boolean; error: string;
  }>({ notes: [], loading: false, error: "" });
  const request = useRef(0);
  const savedDuringRequest = useRef(new Map<string, ReadingNote>());
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const version = ++request.current;
    savedDuringRequest.current = new Map();
    if (!bookTitle || !api) {
      setState({ notes: [], loading: false, error: "" });
      return;
    }
    setState((current) => ({
      bookTitle,
      notes: current.bookTitle === bookTitle ? current.notes : [],
      loading: true, error: ""
    }));
    void api.list({ status: "active", sort: "recent" }).then((notes) => {
      if (request.current !== version) return;
      const merged = new Map(notes.map((note) => [note.id, note]));
      for (const note of savedDuringRequest.current.values()) {
        if (!merged.has(note.id) || merged.get(note.id)!.revision <= note.revision) merged.set(note.id, note);
      }
      setState({ bookTitle, notes: [...merged.values()].filter((note) =>
        note.trashedAt === undefined
      ).sort((a, b) => b.createdAt - a.createdAt), loading: false, error: "" });
    }).catch((cause) => {
      if (request.current !== version) return;
      setState((current) => ({ ...current, loading: false,
        error: cause instanceof Error ? cause.message : "Unable to load notes." }));
    });
    return () => { request.current++; };
  }, [api, bookTitle, contextKey, revision]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const saved = useCallback((note: ReadingNote) => {
    // Keep saves made after a request started when merging its older snapshot.
    const previousSave = savedDuringRequest.current.get(note.id);
    if (previousSave && previousSave.revision > note.revision) return;
    savedDuringRequest.current.set(note.id, note);
    setState((current) => {
      const notes = current.bookTitle === bookTitle ? current.notes : [];
      if (notes.some((item) => item.id === note.id && item.revision > note.revision)) return current;
      const remaining = notes.filter((item) => item.id !== note.id);
      if (note.trashedAt === undefined) remaining.push(note);
      return { bookTitle, notes: remaining.sort((a, b) => b.createdAt - a.createdAt),
        loading: false, error: "" };
    });
  }, [bookTitle]);

  useEffect(() => api?.memoryImage?.onStateChanged((snapshot) => {
    if (snapshot.note) saved(snapshot.note);
  }), [api, bookTitle, saved]);

  // Keep chapter counts and local scopes isolated from the cross-book collection.
  return {
    notes: state.bookTitle === bookTitle ? state.notes.filter((note) => note.bookTitle === bookTitle) : [],
    allNotes: state.bookTitle === bookTitle ? state.notes : [],
    loading: Boolean(bookTitle) && (state.bookTitle !== bookTitle || state.loading),
    error: state.bookTitle === bookTitle ? state.error : "",
    refresh, saved
  };
}
