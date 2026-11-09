import type { MemoryImageSide, ReadingNoteMemoryImageSnapshot } from "../shared/contracts";

const allSides: MemoryImageSide[] = ["understand", "recall"];

export function activeMemoryImageSides(snapshot: ReadingNoteMemoryImageSnapshot): MemoryImageSide[] {
  if (snapshot.batch) {
    if (snapshot.batch.phase !== "running") return [];
    const completed = new Set(snapshot.batch.completed);
    if (snapshot.phase === "ready" && snapshot.side) completed.add(snapshot.side);
    else if (snapshot.phase !== "generating") return [];
    return snapshot.batch.sides.filter(side => !completed.has(side));
  }
  if (snapshot.phase !== "generating") return [];
  return snapshot.side ? [snapshot.side] : allSides;
}

export function activeMemoryImageKeys(snapshot: ReadingNoteMemoryImageSnapshot): string[] {
  if (snapshot.phase === "generating" && !snapshot.batch && !snapshot.side) {
    return [`${snapshot.noteId}\u0000unknown`];
  }
  return activeMemoryImageSides(snapshot).map(side => `${snapshot.noteId}\u0000${side}`);
}

export function memoryImageKeyBelongsToNote(key: string, noteId: string): boolean {
  return key.startsWith(`${noteId}\u0000`);
}
