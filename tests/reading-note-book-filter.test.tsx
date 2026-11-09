// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ReadingNoteBookFilter } from "../src/renderer/ReadingNoteBookFilter";

afterEach(cleanup);
const books = ["Thinking in Systems", "正念的奇蹟", ...Array.from({ length: 80 }, (_, i) => `Book ${i}`)];
function Fixture() {
  const [value, setValue] = useState<string>();
  return <><ReadingNoteBookFilter books={books} value={value} onChange={setValue} /><button onClick={() => setValue(undefined)}>Clear filters</button></>;
}

test("searches many books and selects a match with the keyboard", () => {
  render(<Fixture />);
  const input = screen.getByRole("combobox", { name: "Book" });
  fireEvent.focus(input);
  expect(screen.getAllByRole("option")).toHaveLength(83);
  fireEvent.change(input, { target: { value: "SYSTEMS" } });
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect((input as HTMLInputElement).value).toBe("Thinking in Systems");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect((input as HTMLInputElement).value).toBe("");
});

test("supports Chinese search, mouse selection and All books", () => {
  render(<Fixture />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "正念" } });
  fireEvent.click(screen.getByRole("option", { name: "正念的奇蹟" }));
  expect((input as HTMLInputElement).value).toBe("正念的奇蹟");
  fireEvent.click(input);
  fireEvent.click(screen.getByRole("option", { name: "All books" }));
  expect((input as HTMLInputElement).value).toBe("");
});

test("dismisses without changing the selection and handles no matches", () => {
  render(<Fixture />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: "missing title" } });
  expect(screen.getByRole("status").textContent).toBe("No matching books");
  fireEvent.keyDown(input, { key: "Escape" });
  expect((input as HTMLInputElement).value).toBe("Thinking in Systems");
  fireEvent.click(input);
  fireEvent.blur(input, { relatedTarget: screen.getByRole("button") });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect((input as HTMLInputElement).value).toBe("Thinking in Systems");
});

test("Enter on an empty search result preserves the current filter", () => {
  render(<Fixture />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.click(screen.getByRole("option", { name: "Thinking in Systems" }));
  fireEvent.click(input);
  expect(screen.getByText("Filtering by")).toBeTruthy();
  fireEvent.change(input, { target: { value: "no such book" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(input, { key: "Escape" });
  expect((input as HTMLInputElement).value).toBe("Thinking in Systems");
});
