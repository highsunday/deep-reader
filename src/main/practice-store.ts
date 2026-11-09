import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePracticeState, practiceNoteId, type PracticeState } from '../shared/practice';
interface Options {
  getNote(id: string): { id: string; trashedAt?: number } | undefined;
  now?(): number;
  write?(path: string, data: string): void;
}

// The retired practice workflow used the same filename and version, but stored
// practices/records instead of pins. Recognize that shape only, never guess at
// malformed current data. History remains in the byte-for-byte legacy backup.
function legacyPins(value: unknown): PracticeState | undefined {
  if (!value || typeof value !== 'object' || 'pins' in value) return undefined;
  const state = value as Record<string, unknown>;
  if (!('practices' in state)) return undefined;
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || (state.revision as number) < 0
    || !Array.isArray(state.practices) || !Array.isArray(state.records)) throw new Error('Invalid legacy practice data.');
  const pins = new Map<string, { noteId: string; pinnedAt: number }>();
  for (const practice of state.practices) {
    if (!practice || typeof practice !== 'object' || !Number.isSafeInteger(practice.createdAt) || practice.createdAt < 0
      || (practice.status !== 'active' && practice.status !== 'finished')) throw new Error('Invalid legacy practice.');
    const noteId = practiceNoteId(practice.noteId);
    if (practice.status === 'active' && !pins.has(noteId)) pins.set(noteId, { noteId, pinnedAt: practice.createdAt });
  }
  return parsePracticeState({ version: 1, revision: (state.revision as number) + 1, pins: [...pins.values()] });
}

export class LocalPracticeStore {
  private state?: PracticeState;
  private readonly path: string;
  constructor(private directory: string, private options: Options) { this.path = join(directory, 'practice.json'); }
  private load(): PracticeState {
    if (this.state) return this.state;
    let raw: string;
    try { raw = readFileSync(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.state = { version: 1, revision: 0, pins: [] };
      throw new Error('Unable to read practice notes. Your original data has been preserved.');
    }
    let state: PracticeState, migrated: PracticeState | undefined;
    try {
      const value: unknown = JSON.parse(raw);
      migrated = legacyPins(value);
      state = migrated ?? parsePracticeState(value);
    }
    catch { throw new Error('Unable to read practice data. The original file has been preserved and has not been overwritten.'); }
    if (migrated) {
      try {
        writeFileSync(join(this.directory, `practice.legacy-${randomUUID()}.json`), raw, { encoding: 'utf8', flag: 'wx' });
        this.persist(state);
      } catch { throw new Error('Unable to migrate previous practice data. Your original data has been preserved. Please try again.'); }
    }
    return this.state = state;
  }
  list(): PracticeState { return structuredClone(this.load()); }
  setPinned(value: unknown): PracticeState {
    if (!value || typeof value !== 'object') throw new Error('Invalid pin operation.');
    const input = value as Record<string, unknown>, noteId = practiceNoteId(input.noteId);
    if (typeof input.pinned !== 'boolean') throw new Error('Invalid pin state.');
    const current = this.load(), existing = current.pins.some(p => p.noteId === noteId);
    if (input.pinned === existing) return structuredClone(current);
    if (input.pinned) {
      const note = this.options.getNote(noteId);
      if (!note || note.trashedAt !== undefined) throw new Error('This note cannot be pinned right now. Please refresh the note list.');
    }
    const state = parsePracticeState({ version: 1, revision: current.revision + 1, pins: input.pinned
      ? [...current.pins, { noteId, pinnedAt: (this.options.now ?? Date.now)() }]
      : current.pins.filter(p => p.noteId !== noteId) });
    this.persist(state);
    this.state = state;
    return structuredClone(state);
  }
  private persist(state: PracticeState): void {
    mkdirSync(this.directory, { recursive: true });
    const data = JSON.stringify(state, null, 2);
    if (this.options.write) this.options.write(this.path, data);
    else {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, data, 'utf8'); renameSync(temporary, this.path); }
      finally { rmSync(temporary, { force: true }); }
    }
  }
}
