// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ChatMessageList } from '../src/renderer/App';
import { readingSegmentShortcutText } from '../src/renderer/reading-segment-shortcuts';
import type { ChatIntent } from '../src/shared/contracts';
afterEach(cleanup);
test('F70 TC1: full coach instructions are accessible without burying the first question', () => {
  const prompt = readingSegmentShortcutText('readingCoach' as ChatIntent);
  const { container } = render(<ChatMessageList activeTurnId={null} messages={[
    { id: 'u', turnId: 't', role: 'user', text: prompt, intent: 'readingCoach' as ChatIntent, status: 'completed' },
    { id: 'a', turnId: 't', role: 'assistant', text: '恢復原狀與變得更強有什麼不同？', status: 'completed' }
  ]} />);
  const summary = screen.getByText('AI 深度閱讀與理解教練 · 查看完整指令');
  expect(summary.closest('details')?.open).toBe(false);
  fireEvent.click(summary);
  expect(container.querySelector('.reading-coach-instructions')?.textContent).toContain(prompt);
  expect(screen.getByText('恢復原狀與變得更強有什麼不同？')).toBeTruthy();
  expect(container.querySelector('.learning-question-card')).toBeNull();
});

// B71 replaces the previous F70 bottom-following contract.
function scrollFixture() {
  let contentHeight = 520;
  let latestOffset = 400;
  let viewportHeight = 600;
  let resize: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('messages') ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('messages') ? contentHeight + 36 + Number.parseFloat(this.querySelector<HTMLElement>('.message-current-turn')?.style.minHeight || '0') : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const scroller = document.querySelector<HTMLElement>('.messages');
    const top = 100 + (scroller ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0) - (scroller?.scrollTop ?? 0);
    if (this.classList.contains('messages')) return { top: 100, bottom: 100 + viewportHeight } as DOMRect;
    if (this.classList.contains('message-content')) return { top, bottom: top + contentHeight } as DOMRect;
    if (this.matches('.message.user')) return { top: top + latestOffset, bottom: top + latestOffset + 60 } as DOMRect;
    return { top: 0, bottom: 0 } as DOMRect;
  });
  const first = { id: 'u1', turnId: 't1', role: 'user' as const, text: '第一個問題', status: 'completed' as const };
  const reply = { id: 'a1', turnId: 't1', role: 'assistant' as const, text: '回覆開頭', status: 'streaming' as const };
  const view = render(<ChatMessageList activeTurnId="t1" messages={[first, reply]} />);
  const scroller = view.container.querySelector<HTMLElement>('.messages')!;
  scroller.style.padding = '18px 16px';
  return { ...view, scroller, first, reply,
    contentHeight(value: number) { contentHeight = value; },
    latestOffset(value: number) { latestOffset = value; },
    viewportHeight(value: number) { viewportHeight = value; },
    resize() { resize?.(); }
  };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('B71 TC1/2/5: align each new question at the top, including short turns', () => {
  const f = scrollFixture();
  expect(f.scroller.scrollTop).toBe(400); // Initial history uses the last question too.
  f.latestOffset(450); f.contentHeight(570);
  const next = { ...f.first, id: 'u2', text: '新的問題' };
  f.rerender(<ChatMessageList activeTurnId="t2" messages={[f.first, f.reply, next]} />);
  expect(f.scroller.scrollTop).toBe(450);
  expect(f.container.querySelector<HTMLElement>('.message-current-turn')?.style.minHeight).toBe('564px');
  f.scroller.scrollTop = 20; fireEvent.scroll(f.scroller);
  f.latestOffset(650); f.contentHeight(750);
  f.rerender(<ChatMessageList activeTurnId="t3" messages={[f.first, f.reply, next, { ...next, id: 'u3' }]} />);
  expect(f.scroller.scrollTop).toBe(650);
});

test.each(['streaming', 'completed', 'failed'] as const)('B71 TC3/4: %s updates preserve the reading position', status => {
  const f = scrollFixture();
  f.scroller.scrollTop = 350; fireEvent.scroll(f.scroller);
  f.contentHeight(1600);
  f.rerender(<ChatMessageList activeTurnId={status === 'streaming' ? 't1' : null} messages={[f.first, { ...f.reply, text: '更長的回覆'.repeat(100), status }]} />);
  expect(f.scroller.scrollTop).toBe(350);
  // Readers can also move farther down while streaming without re-enabling following.
  f.scroller.scrollTop = 1100; fireEvent.scroll(f.scroller);
  f.contentHeight(1900);
  f.rerender(<ChatMessageList activeTurnId={null} messages={[f.first, { ...f.reply, text: '後續回覆'.repeat(120), status }]} />);
  expect(f.scroller.scrollTop).toBe(1100);
  expect(f.container.querySelector<HTMLElement>('.message-current-turn')?.style.minHeight).toBe('564px');
});

test('B71 TC6/7: resize only adjusts the minimum turn height; switching or clearing resets the anchor', () => {
  const f = scrollFixture();
  f.scroller.scrollTop = 90;
  f.contentHeight(650); f.viewportHeight(800); f.resize();
  expect(f.scroller.scrollTop).toBe(90);
  expect(f.container.querySelector<HTMLElement>('.message-current-turn')?.style.minHeight).toBe('764px');
  f.latestOffset(50); f.contentHeight(1300);
  f.rerender(<ChatMessageList activeTurnId={null} messages={[{ ...f.first, id: 'other-conversation', text: '長問題'.repeat(200) }]} />);
  expect(f.scroller.scrollTop).toBe(50);
  expect(f.container.querySelector<HTMLElement>('.message-current-turn')?.style.minHeight).toBe('764px');
  f.rerender(<ChatMessageList activeTurnId={null} messages={[]} />);
  expect(screen.getByText('Ask to understand')).toBeTruthy();
  expect(f.container.querySelector('.message-current-turn')).toBeNull();
  f.latestOffset(0); f.contentHeight(70);
  f.rerender(<ChatMessageList activeTurnId={null} messages={[f.first]} />);
  expect(f.scroller.scrollTop).toBe(0);
});

test('B71 TC7: sending another question preserves an expanded quote in history', () => {
  const f = scrollFixture();
  const quoted = { ...f.first, quote: { text: '讀者展開查看的原文引用' } };
  f.rerender(<ChatMessageList activeTurnId="t1" messages={[quoted, f.reply]} />);
  const details = f.container.querySelector<HTMLDetailsElement>('.message-quote')!;
  details.open = true;
  f.rerender(<ChatMessageList activeTurnId="t2" messages={[quoted, f.reply, { ...f.first, id: 'u2' }]} />);
  expect(f.container.querySelector<HTMLDetailsElement>('.message-quote')?.open).toBe(true);
});
