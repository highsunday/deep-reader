// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import * as controls from "../src/renderer/ReadingVoiceControls";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const error = "Error invoking remote method 'reading-voice:start': Error: 語音連線逾時，請檢查網路後重試。";
function Harness() {
  const [message, setMessage] = useState<string | undefined>(error);
  return message ? <controls.ReadingVoiceNotice error={message} onDismiss={() => setMessage(undefined)} /> : null;
}

test("B47 voice notice is readable and can be dismissed without remaining on rerender", () => {
  expect(controls.ReadingVoiceNotice).toBeTypeOf("function");
  const view = render(<Harness />);
  expect(screen.getByRole("status").textContent).toContain("語音連線逾時");
  expect(screen.getByRole("status").textContent).not.toContain("Error invoking");
  fireEvent.click(screen.getByRole("button", { name: "關閉語音提示" }));
  view.rerender(<Harness />);
  expect(screen.queryByRole("status")).toBeNull();
});

test("B47 auto-dismiss pauses while reading with pointer or keyboard", () => {
  expect(controls.ReadingVoiceNotice).toBeTypeOf("function");
  vi.useFakeTimers();
  render(<Harness />);
  const notice = screen.getByRole("status");
  fireEvent.mouseEnter(notice);
  act(() => vi.advanceTimersByTime(9000));
  expect(screen.getByRole("status")).toBeTruthy();
  fireEvent.mouseLeave(notice);
  fireEvent.focus(screen.getByRole("button", { name: "關閉語音提示" }));
  act(() => vi.advanceTimersByTime(9000));
  expect(screen.getByRole("status")).toBeTruthy();
  fireEvent.blur(screen.getByRole("button", { name: "關閉語音提示" }));
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.queryByRole("status")).toBeNull();
});

test("B47 keyboard Escape dismisses the notice", () => {
  expect(controls.ReadingVoiceNotice).toBeTypeOf("function");
  render(<Harness />);
  fireEvent.keyDown(screen.getByRole("button", { name: "關閉語音提示" }), { key: "Escape" });
  expect(screen.queryByRole("status")).toBeNull();
});
