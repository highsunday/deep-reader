import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateMemoryImageTemplateInput,
  MemoryImageTemplate,
  MemoryImageTemplateIdentityInput,
  SetMemoryImageTemplateDefaultInput,
  MemoryImageTemplateKind,
  MemoryImageTemplateSettings,
  UpdateMemoryImageTemplateInput
} from "../shared/contracts";

import { purposeMatchesSide } from "../shared/memory-image-defaults";

const MAX_TEMPLATE_NAME_LENGTH = 60;
const MAX_TEMPLATE_PROMPT_LENGTH = 4_000;

import { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } from "../shared/memory-image-templates";
export { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } from "../shared/memory-image-templates";

interface StoredTemplate extends Omit<MemoryImageTemplate, "builtIn"> {}

interface MemoryImageTemplateState {
  version: 1;
  customPurposes: StoredTemplate[];
  customStyles: StoredTemplate[];
  defaultPurposeId: string;
  defaultStyleId: string;
  defaultsBySide?: MemoryImageTemplateSettings["defaultsBySide"];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: "name" | "prompt"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`A memory-image template ${label} is required.`);
  }
  const trimmed = value.trim();
  const limit = label === "name" ? MAX_TEMPLATE_NAME_LENGTH : MAX_TEMPLATE_PROMPT_LENGTH;
  if (trimmed.length > limit) throw new Error(`The memory-image template ${label} is too long.`);
  return trimmed;
}

function kind(value: unknown): MemoryImageTemplateKind {
  if (value !== "purpose" && value !== "style") throw new Error("Invalid memory-image template kind.");
  return value;
}

function templateSide(value: unknown): "understand" | "recall" {
  if (value === undefined) return "recall";
  if (value !== "understand" && value !== "recall") throw new Error("Invalid memory-image template side.");
  return value;
}

function parseStoredTemplate(value: unknown, expectedKind: MemoryImageTemplateKind): StoredTemplate {
  if (!object(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new Error("Invalid memory-image template settings.");
  }
  const parsedKind = kind(value.kind);
  if (parsedKind !== expectedKind) throw new Error("Invalid memory-image template settings.");
  return {
    id: value.id.trim(),
    kind: parsedKind,
    ...(parsedKind === "purpose" && value.side !== undefined ? { side: templateSide(value.side) } : {}),
    name: text(value.name, "name"),
    prompt: text(value.prompt, "prompt")
  };
}

function initialState(): MemoryImageTemplateState {
  return {
    version: 1,
    customPurposes: [],
    customStyles: [],
    defaultPurposeId: BUILT_IN_MEMORY_IMAGE_PURPOSES[0]!.id,
    defaultStyleId: BUILT_IN_MEMORY_IMAGE_STYLES[0]!.id
  };
}

function parseState(value: unknown): MemoryImageTemplateState {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.customPurposes) ||
    !Array.isArray(value.customStyles) || typeof value.defaultPurposeId !== "string" ||
    typeof value.defaultStyleId !== "string") {
    throw new Error("Invalid memory-image template settings.");
  }
  const customPurposes = value.customPurposes.map((item) => parseStoredTemplate(item, "purpose"));
  for (const item of customPurposes) {
    if (item.side) continue;
    const defaults = object(value.defaultsBySide) ? value.defaultsBySide : {};
    const front = object(defaults.understand) && defaults.understand.purposeId === item.id;
    const back = object(defaults.recall) && defaults.recall.purposeId === item.id;
    item.side = front && !back ? "understand" : "recall";
  }
  const customStyles = value.customStyles.map((item) => parseStoredTemplate(item, "style"));
  const ids = [
    ...BUILT_IN_MEMORY_IMAGE_PURPOSES,
    ...BUILT_IN_MEMORY_IMAGE_STYLES,
    ...customPurposes,
    ...customStyles
  ].map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Invalid memory-image template settings.");
  const purposeIds = new Set([...BUILT_IN_MEMORY_IMAGE_PURPOSES, ...customPurposes].map(({ id }) => id));
  const styleIds = new Set([...BUILT_IN_MEMORY_IMAGE_STYLES, ...customStyles].map(({ id }) => id));
  const defaultsBySide: NonNullable<MemoryImageTemplateSettings["defaultsBySide"]> = {};
  if (object(value.defaultsBySide)) {
    for (const side of ["understand", "recall"] as const) {
      const saved = value.defaultsBySide[side];
      if (!object(saved)) continue;
      const purpose = [...BUILT_IN_MEMORY_IMAGE_PURPOSES, ...customPurposes].find(item => item.id === saved.purposeId);
      defaultsBySide[side] = {
        ...(purpose && purposeMatchesSide(purpose, side)
          ? { purposeId: purpose.id } : {}),
        ...(typeof saved.styleId === "string" && styleIds.has(saved.styleId) ? { styleId: saved.styleId } : {})
      };
    }
  }
  return {
    version: 1,
    defaultsBySide,
    customPurposes,
    customStyles,
    defaultPurposeId: purposeIds.has(value.defaultPurposeId)
      ? value.defaultPurposeId
      : BUILT_IN_MEMORY_IMAGE_PURPOSES[0]!.id,
    defaultStyleId: styleIds.has(value.defaultStyleId)
      ? value.defaultStyleId
      : BUILT_IN_MEMORY_IMAGE_STYLES[0]!.id
  };
}

export class LocalMemoryImageTemplateStore {
  readonly #directory: string;
  readonly #path: string;
  readonly #createId: () => string;
  #state: MemoryImageTemplateState;

  constructor(directory: string, options: { createId?(): string } = {}) {
    this.#directory = directory;
    this.#path = join(directory, "memory-image-templates.json");
    this.#createId = options.createId ?? randomUUID;
    this.#state = this.#load();
  }

  get(): MemoryImageTemplateSettings {
    return structuredClone({
      purposes: [
        ...BUILT_IN_MEMORY_IMAGE_PURPOSES,
        ...this.#state.customPurposes.map((item) => ({ ...item, builtIn: false }))
      ],
      styles: [
        ...BUILT_IN_MEMORY_IMAGE_STYLES,
        ...this.#state.customStyles.map((item) => ({ ...item, builtIn: false }))
      ],
      defaultPurposeId: this.#state.defaultPurposeId,
      defaultStyleId: this.#state.defaultStyleId,
      defaultsBySide: this.#state.defaultsBySide ?? {}
    });
  }

  create(input: CreateMemoryImageTemplateInput): MemoryImageTemplate {
    const templateKind = kind(input.kind);
    const id = this.#createId();
    if (!id.trim() || this.#all().some((item) => item.id === id)) {
      throw new Error("Unable to allocate a memory-image template identifier.");
    }
    const created: StoredTemplate = {
      id: id.trim(),
      kind: templateKind,
      ...(templateKind === "purpose" ? { side: templateSide(input.side) } : {}),
      name: text(input.name, "name"),
      prompt: text(input.prompt, "prompt")
    };
    this.#mutate((state) => templateKind === "purpose"
      ? { ...state, customPurposes: [...state.customPurposes, created] }
      : { ...state, customStyles: [...state.customStyles, created] });
    return structuredClone({ ...created, builtIn: false });
  }

  update(input: UpdateMemoryImageTemplateInput): MemoryImageTemplate {
    const templateKind = kind(input.kind);
    const current = this.#find({ kind: templateKind, id: input.id });
    if (current.builtIn) throw new Error("Built-in memory-image templates cannot be changed.");
    const changed: StoredTemplate = {
      id: current.id,
      kind: templateKind,
      ...(templateKind === "purpose" ? { side: templateSide(input.side ?? current.side) } : {}),
      name: text(input.name, "name"),
      prompt: text(input.prompt, "prompt")
    };
    this.#mutate((state) => templateKind === "purpose"
      ? { ...state, customPurposes: state.customPurposes.map((item) => item.id === changed.id ? changed : item) }
      : { ...state, customStyles: state.customStyles.map((item) => item.id === changed.id ? changed : item) });
    return structuredClone({ ...changed, builtIn: false });
  }

  remove(input: MemoryImageTemplateIdentityInput): MemoryImageTemplateSettings {
    const templateKind = kind(input.kind);
    const current = this.#find({ kind: templateKind, id: input.id });
    if (current.builtIn) throw new Error("Built-in memory-image templates cannot be removed.");
    this.#mutate((state) => templateKind === "purpose"
      ? {
          ...state,
          customPurposes: state.customPurposes.filter(({ id }) => id !== current.id),
          defaultPurposeId: state.defaultPurposeId === current.id
            ? BUILT_IN_MEMORY_IMAGE_PURPOSES[0]!.id
            : state.defaultPurposeId
        }
      : {
          ...state,
          customStyles: state.customStyles.filter(({ id }) => id !== current.id),
          defaultStyleId: state.defaultStyleId === current.id
            ? BUILT_IN_MEMORY_IMAGE_STYLES[0]!.id
            : state.defaultStyleId
        });
    return this.get();
  }

  setDefault(input: SetMemoryImageTemplateDefaultInput): MemoryImageTemplateSettings {
    const templateKind = kind(input.kind);
    const current = this.#find({ kind: templateKind, id: input.id });
    if (input.side !== undefined) {
      const side = input.side;
      if (side !== "understand" && side !== "recall") throw new Error("Invalid memory-image side.");
      if (templateKind === "purpose" && !purposeMatchesSide(current, side)) {
        throw new Error("This purpose belongs to the other side.");
      }
      this.#mutate(state => ({ ...state, defaultsBySide: {
        ...state.defaultsBySide,
        [side]: { ...state.defaultsBySide?.[side], [templateKind === "purpose" ? "purposeId" : "styleId"]: current.id }
      } }));
      return this.get();
    }
    this.#mutate((state) => templateKind === "purpose"
      ? { ...state, defaultPurposeId: current.id }
      : { ...state, defaultStyleId: current.id });
    return this.get();
  }

  #all(): MemoryImageTemplate[] {
    const settings = this.get();
    return [...settings.purposes, ...settings.styles];
  }

  #find(input: MemoryImageTemplateIdentityInput): MemoryImageTemplate {
    if (typeof input.id !== "string" || !input.id.trim()) {
      throw new Error("A memory-image template identifier is required.");
    }
    const template = this.#all().find((item) => item.kind === input.kind && item.id === input.id.trim());
    if (!template) throw new Error("Memory-image template not found.");
    return template;
  }

  #load(): MemoryImageTemplateState {
    try { return parseState(JSON.parse(readFileSync(this.#path, "utf8"))); }
    catch (error) {
      if (object(error) && error.code === "ENOENT") return initialState();
      return initialState();
    }
  }

  #mutate(update: (state: MemoryImageTemplateState) => MemoryImageTemplateState): void {
    const previous = this.#state;
    this.#state = parseState(update(previous));
    try { this.#save(); } catch (error) { this.#state = previous; throw error; }
  }

  #save(): void {
    mkdirSync(this.#directory, { recursive: true });
    const temporary = `${this.#path}.next`;
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#path);
  }
}
