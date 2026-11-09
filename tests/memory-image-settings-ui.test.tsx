// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { MemoryImageTemplateSettings, ReaderDesktopApi, SetMemoryImageTemplateDefaultInput } from "../src/shared/contracts";
import { AccountSettings } from "../src/renderer/App";
import { MemoryImageSettings } from "../src/renderer/MemoryImageSettings";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const purpose = {
  id: "purpose-surreal-association", kind: "purpose" as const, name: "超現實聯想",
  prompt: "Turn the concept into an exaggerated metaphor.", builtIn: true
};
const style = {
  id: "style-minimal-vector", kind: "style" as const, name: "極簡向量",
  prompt: "Use crisp vector shapes.", builtIn: true
};

function settings(custom = false): MemoryImageTemplateSettings {
  return {
    purposes: [purpose, ...(custom ? [{
      id: "custom-1", kind: "purpose" as const, name: "Concept ladder",
      prompt: "Arrange ideas as steps.", builtIn: false
    }] : [])],
    styles: [style],
    defaultPurposeId: custom ? "custom-1" : purpose.id,
    defaultStyleId: style.id
  };
}

function templatesApi() {
  return {
    get: vi.fn(async () => settings()),
    create: vi.fn(async () => settings(true)),
    update: vi.fn(async () => settings(true)),
    remove: vi.fn(async () => settings()),
    setDefault: vi.fn(async () => settings(true))
  } as unknown as NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>["templates"];
}

const connectedSnapshot = {
  connection: "ready" as const,
  connectionDetail: "Connected as reader@example.com",
  account: { type: "chatgpt", email: "reader@example.com" },
  allowance: { phase: "loading" as const, fiveHour: null, weekly: null, detail: "Loading account allowance." },
  threadId: null,
  activeTurnId: null,
  messages: [],
  conversations: [],
  activeConversationId: null,
  managementBusy: false
};

test("Settings defaults to Account and switches between accessible panels", async () => {
  const api = templatesApi();
  render(
    <AccountSettings
      snapshot={connectedSnapshot}
      memoryImageTemplates={api}
      onReconnect={() => undefined}
      onClose={() => undefined}
    />
  );

  const tabs = screen.getByRole("tablist", { name: "Settings sections" });
  const accountTab = screen.getByRole("tab", { name: "Account" });
  const memoryTab = screen.getByRole("tab", { name: "Memory Images" });
  expect(tabs).toBeTruthy();
  expect(accountTab.getAttribute("aria-selected")).toBe("true");
  expect(accountTab.tabIndex).toBe(0);
  expect(memoryTab.getAttribute("aria-selected")).toBe("false");
  expect(memoryTab.tabIndex).toBe(-1);
  expect(screen.getByRole("tabpanel", { name: "Account" })).toBeTruthy();
  expect(screen.queryByRole("tabpanel", { name: "Memory Images" })).toBeNull();

  fireEvent.click(memoryTab);
  expect(memoryTab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel", { name: "Memory Images" })).toBeTruthy();
  expect(screen.queryByRole("tabpanel", { name: "Account" })).toBeNull();
  await openTemplateLibrary();
  expect(screen.getAllByText("超現實聯想").length).toBeGreaterThan(0);
});

test("Settings preserves an unsaved memory-image template draft across tabs", async () => {
  const api = templatesApi();
  render(
    <AccountSettings
      snapshot={connectedSnapshot}
      memoryImageTemplates={api}
      onReconnect={() => undefined}
      onClose={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("tab", { name: "Memory Images" }));
  await openTemplateLibrary();
  fireEvent.click(screen.getByRole("button", { name: "Add purpose" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Template name" }), {
    target: { value: "Visual bridge" }
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Template prompt" }), {
    target: { value: "Connect the ideas with one visual bridge." }
  });

  fireEvent.click(screen.getByRole("tab", { name: "Account" }));
  fireEvent.click(screen.getByRole("tab", { name: "Memory Images" }));
  expect((screen.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("Visual bridge");
  expect(api.get).toHaveBeenCalledTimes(1);
});

test("Settings tabs support arrow, Home, and End keyboard navigation", () => {
  render(
    <AccountSettings
      snapshot={connectedSnapshot}
      memoryImageTemplates={templatesApi()}
      onReconnect={() => undefined}
      onClose={() => undefined}
    />
  );

  const accountTab = screen.getByRole("tab", { name: "Account" });
  const memoryTab = screen.getByRole("tab", { name: "Memory Images" });
  accountTab.focus();
  fireEvent.keyDown(accountTab, { key: "ArrowRight" });
  expect(memoryTab.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(memoryTab);
  fireEvent.keyDown(memoryTab, { key: "Home" });
  expect(accountTab.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(accountTab);
  fireEvent.keyDown(accountTab, { key: "End" });
  expect(memoryTab.getAttribute("aria-selected")).toBe("true");
});

test("memory-image settings show built-ins and create a custom purpose", async () => {
  const api = templatesApi();
  render(<MemoryImageSettings api={api} />);

  await openTemplateLibrary();
  expect(screen.getAllByText("超現實聯想").length).toBeGreaterThan(0);
  expect(screen.getAllByText("極簡向量").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Built-in")).toHaveLength(2);
  const instructions = screen.getByText(purpose.prompt).closest("details")!;
  expect(instructions.open).toBe(false);
  fireEvent.click(instructions.querySelector("summary")!);
  expect(instructions.open).toBe(true);
  expect(screen.getAllByText(/Connect one core concept to a concrete scene you can recall later/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "Add purpose" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Template name" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Template name" }), {
    target: { value: "Concept ladder" }
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Template prompt" }), {
    target: { value: "Arrange ideas as steps." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));

  await waitFor(() => expect(api.create).toHaveBeenCalledWith({
    kind: "purpose", name: "Concept ladder", prompt: "Arrange ideas as steps.", side: "recall"
  }));
  expect((await screen.findAllByText("Concept ladder")).length).toBeGreaterThan(0);
});

test("template editor actions reveal the form by focusing its name field", async () => {
  const api = templatesApi();
  api.get = vi.fn(async () => settings(true));
  render(<MemoryImageSettings api={api} />);

  await openTemplateLibrary();
  fireEvent.click(screen.getByRole("button", { name: "Add style" }));
  const createDialog = screen.getByRole("dialog", { name: "Create style template" });
  expect(createDialog.closest(".dialog-backdrop")).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Template name" }));

  fireEvent.click(screen.getByRole("button", { name: "Cancel template editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy 超現實聯想" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Template name" }));
  expect((document.activeElement as HTMLInputElement).value).toBe("超現實聯想 copy");

  fireEvent.click(screen.getByRole("button", { name: "Cancel template editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Concept ladder" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Template name" }));
  expect((document.activeElement as HTMLInputElement).value).toBe("Concept ladder");
});

test("template editor and delete confirmation close from their backdrop without closing settings", async () => {
  const api = templatesApi();
  const onSettingsBackdropMouseDown = vi.fn();
  api.get = vi.fn(async () => settings(true));
  render(
    <div onMouseDown={onSettingsBackdropMouseDown}>
      <MemoryImageSettings api={api} />
    </div>
  );

  await openTemplateLibrary();
  fireEvent.click(screen.getByRole("button", { name: "Edit Concept ladder" }));
  const editorBackdrop = screen.getByRole("dialog", { name: "Edit purpose template" }).closest(".dialog-backdrop");
  expect(editorBackdrop).not.toBeNull();
  fireEvent.mouseDown(editorBackdrop!);
  expect(screen.queryByRole("dialog", { name: "Edit purpose template" })).toBeNull();
  expect(screen.getByText("Choose the default look for new card images.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Delete Concept ladder" }));
  const deleteDialog = screen.getByRole("alertdialog", { name: "Delete memory image template?" });
  expect(deleteDialog.closest(".dialog-backdrop")).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel template deletion" }));
  fireEvent.mouseDown(deleteDialog.closest(".dialog-backdrop")!);
  expect(screen.queryByRole("alertdialog", { name: "Delete memory image template?" })).toBeNull();
  expect(screen.getByText("Choose the default look for new card images.")).toBeTruthy();
  expect(onSettingsBackdropMouseDown).not.toHaveBeenCalled();
});

test("built-ins can be copied while custom templates can be edited, defaulted, and removed", async () => {
  const api = templatesApi();
  api.get = vi.fn(async () => settings(true));
  render(<MemoryImageSettings api={api} />);

  await openTemplateLibrary();
  fireEvent.click(screen.getByRole("button", { name: "Copy 超現實聯想" }));
  expect((screen.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("超現實聯想 copy");
  fireEvent.click(screen.getByRole("button", { name: "Cancel template editing" }));

  fireEvent.click(screen.getByRole("button", { name: "Edit Concept ladder" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Template prompt" }), {
    target: { value: "Show causes below effects." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith({
    kind: "purpose", id: "custom-1", name: "Concept ladder", prompt: "Show causes below effects.", side: "recall"
  }));

  fireEvent.click(screen.getByRole("button", { name: "Set Concept ladder as default" }));
  await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith({ kind: "purpose", id: "custom-1", side: "recall" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Concept ladder" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete template" }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ kind: "purpose", id: "custom-1" }));
});

async function openTemplateLibrary() {
  fireEvent.click(screen.getByRole("tab", { name: /Back · Recall/ }));
  await screen.findByText("Advanced");
  fireEvent.click(screen.getByText("Advanced"));
  await screen.findByRole("button", { name: "Add purpose" });
}

test("front and back settings keep independent defaults and filter purposes", async () => {
  const { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } = await import("../src/shared/memory-image-templates");
  let saved: MemoryImageTemplateSettings = { purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES, styles: BUILT_IN_MEMORY_IMAGE_STYLES,
    defaultPurposeId: "purpose-concept-structure", defaultStyleId: "style-minimal-vector" };
  const api = templatesApi();
  api.get = vi.fn(async () => saved);
  api.setDefault = vi.fn(async ({ kind, id, side }: SetMemoryImageTemplateDefaultInput) => {
    saved = { ...saved, defaultsBySide: { ...saved.defaultsBySide,
      [side!]: { ...saved.defaultsBySide?.[side!], [kind === "purpose" ? "purposeId" : "styleId"]: id } } };
    return saved;
  });
  render(<MemoryImageSettings api={api} />);
  const front = screen.getByRole("tab", { name: /Front · Understanding/ });
  const back = screen.getByRole("tab", { name: /Back · Recall/ });
  expect(front.getAttribute("aria-selected")).toBe("true");
  const type = await screen.findByRole("combobox", { name: "Image type" });
  const style = screen.getByRole("combobox", { name: "Style" });
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  expect(screen.getByText("Advanced").closest("details")!.open).toBe(false);
  expect([...type.querySelectorAll("option")].some(item => item.value === "purpose-surreal-association")).toBe(false);
  fireEvent.change(type, { target: { value: "purpose-concept-contrast" } });
  await screen.findByText("Front defaults saved.");
  fireEvent.change(style, { target: { value: "style-storybook-watercolor" } });
  await waitFor(() => expect(api.setDefault).toHaveBeenLastCalledWith({ kind: "style", id: "style-storybook-watercolor", side: "understand" }));
  await screen.findByText("Front defaults saved.");
  fireEvent.click(back);
  expect(screen.getByRole("tabpanel", { name: /Back · Recall/ })).toBeTruthy();
  expect([...type.querySelectorAll("option")].some(item => item.value === "purpose-concept-contrast")).toBe(false);
  fireEvent.change(style, { target: { value: "style-clay-miniature" } });
  await screen.findByText("Back defaults saved.");
  fireEvent.keyDown(back, { key: "Home" });
  expect(document.activeElement).toBe(front);
  expect((style as HTMLSelectElement).value).toBe("style-storybook-watercolor");
  expect((type as HTMLSelectElement).value).toBe("purpose-concept-contrast");
  fireEvent.keyDown(front, { key: "End" });
  expect(document.activeElement).toBe(back);
  expect((style as HTMLSelectElement).value).toBe("style-clay-miniature");
});

test("B39 settings create and move side-specific purposes while sharing styles", async () => {
  const { LocalMemoryImageTemplateStore } = await import("../src/main/memory-image-template-store");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "purpose-ui-"));
  try {
    const store = new LocalMemoryImageTemplateStore(directory);
    const api = templatesApi();
    api.get = vi.fn(async () => store.get());
    api.create = vi.fn(async input => { store.create(input); return store.get(); });
    api.update = vi.fn(async input => { store.update(input); return store.get(); });
    store.create({ kind: "style", name: "Shared ink", prompt: "Ink" });
    render(<MemoryImageSettings api={api} />);
    await openTemplateLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Copy 視覺聯想" }));
    expect((screen.getByRole("combobox", { name: "Template card side" }) as HTMLSelectElement).value).toBe("recall");
    fireEvent.change(screen.getByRole("textbox", { name: "Template name" }), { target: { value: "誇張圖像" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await screen.findByRole("button", { name: "Edit 誇張圖像" });
    fireEvent.click(screen.getByRole("tab", { name: /Front · Understanding/ }));
    expect(screen.queryByRole("option", { name: "誇張圖像" })).toBeNull();
    expect(screen.getByRole("option", { name: "Shared ink" })).toBeTruthy();
    fireEvent.click(screen.getByText("Advanced"));
    fireEvent.click(screen.getByRole("button", { name: "Add purpose" }));
    expect((screen.getByRole("combobox", { name: "Template card side" }) as HTMLSelectElement).value).toBe("understand");
    fireEvent.click(screen.getByRole("button", { name: "Cancel template editing" }));
    await openTemplateLibrary();
    expect(screen.getByRole("option", { name: "Shared ink" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit 誇張圖像" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Template card side" }), { target: { value: "understand" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "誇張圖像" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Front · Understanding/ }));
    expect(screen.getByRole("option", { name: "誇張圖像" })).toBeTruthy();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("B39 generation chooser separates custom purposes and shares custom styles", async () => {
  const { MemoryImageTemplateChooser } = await import("../src/renderer/MemoryImageTemplateChooser");
  const templates: MemoryImageTemplateSettings = {
    purposes: [
      { id: "front", kind: "purpose", name: "Front layout", prompt: "Explain", builtIn: false, side: "understand" },
      { id: "back", kind: "purpose", name: "誇張圖像", prompt: "Recall", builtIn: false, side: "recall" }
    ], styles: [{ ...style, id: "shared", name: "Shared ink", builtIn: false }],
    defaultPurposeId: "front", defaultStyleId: "shared"
  };
  const props = { templates, purposeValue: "front", styleValue: "shared", styleExplicit: true, disabled: false, onChange: vi.fn() };
  const view = render(<MemoryImageTemplateChooser {...props} fixedGoal="understand" />);
  fireEvent.click(screen.getByRole("button", { name: "Explore other purposes" }));
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  expect(screen.getByRole("button", { name: "Choose Front layout" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choose 誇張圖像" })).toBeNull();
  expect(screen.getByRole("button", { name: "Choose Shared ink" })).toBeTruthy();
  view.rerender(<MemoryImageTemplateChooser {...props} purposeValue="back" fixedGoal="remember" />);
  expect(screen.queryByRole("button", { name: "Choose Front layout" })).toBeNull();
  expect(screen.getByRole("button", { name: "Choose 誇張圖像" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose Shared ink" })).toBeTruthy();
});
