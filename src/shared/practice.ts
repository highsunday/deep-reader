export interface PracticePin { noteId: string; pinnedAt: number }
export interface PracticeState { version: 1; revision: number; pins: PracticePin[] }
export interface SetPracticePinned { noteId: string; pinned: boolean }
export interface PracticeApi {
  list(): Promise<PracticeState>;
  setPinned(input: SetPracticePinned): Promise<PracticeState>;
}
export function practiceNoteId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 256) throw new Error('Invalid note ID.');
  return value;
}
export function parsePracticeState(value: unknown): PracticeState {
  if (!value || typeof value !== 'object') throw new Error('Invalid practice data.');
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || (state.revision as number) < 0 || !Array.isArray(state.pins)) throw new Error('Invalid practice data.');
  const pins: PracticePin[] = state.pins.map(pin => {
    if (!pin || typeof pin !== 'object' || !Number.isSafeInteger(pin.pinnedAt) || pin.pinnedAt < 0) throw new Error('Invalid practice pin.');
    return { noteId: practiceNoteId(pin.noteId), pinnedAt: pin.pinnedAt };
  });
  if (new Set(pins.map(p => p.noteId)).size !== pins.length) throw new Error('Duplicate practice pins.');
  return { version: 1, revision: state.revision as number, pins };
}
