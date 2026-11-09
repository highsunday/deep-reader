import { activeQuiz } from './quiz-workflow';
import { readingCoachActivity } from "./reading-coach";
import type { ChatMessage, ReadingSourceSnapshot } from './contracts';

export interface ReadingInputSuggestion { repeat: string | null; followUp: string | null }
const marker = 'reading-input-suggestion';
export function parseReadingSuggestion(text: string): ReadingInputSuggestion | null {
  const matches = [...text.matchAll(/```reading-input-suggestion\s*\n([\s\S]*?)```/g)];
  if (matches.length !== 1 || matches[0]![1]!.length > 2000) return null;
  try {
    const value = JSON.parse(matches[0]![1]!);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'followUp,repeat') return null;
    const valid = (s: unknown) => s === null || typeof s === 'string' && s.trim().length > 0 && s.length <= 240 && !/[\r\n\x00-\x1f`]/.test(s);
    if (!valid(value.repeat) || !valid(value.followUp)) return null;
    return { repeat: value.repeat?.trim() ?? null, followUp: value.followUp?.trim() ?? null };
  } catch { return null; }
}

export function stripReadingSuggestion(text: string): string {
  // Suppress incomplete metadata while streaming, including a partially received fence label.
  return text.replace(/```reading-input-suggestion\s*\n[\s\S]*?(?:```|$)/g, '')
    .replace(/\n?`{1,3}[^\n`]*$/, tail => {
      const label = tail.trimStart().replace(/^`+/, '');
      return label.length > 0 && marker.startsWith(label) ? '' : tail;
    }).trim();
}

export function readingSuggestions(messages: readonly ChatMessage[], source: ReadingSourceSnapshot): { repeat: string; followUp: string } {
  let repeat = '';
  let followUp = '';
  let user: ChatMessage | undefined;
  for (const message of messages) {
    if (message.role === 'user') { user = message; followUp = ''; continue; }
    if (!user || user.status !== 'completed' || message.status !== 'completed' ||
        !message.turnId || message.turnId !== user.turnId ||
        user.readingSource?.bookTitle !== source.bookTitle || user.readingSource.chapterTitle !== source.chapterTitle) continue;
    const suggestion = parseReadingSuggestion(message.text);
    if (suggestion?.repeat) repeat = suggestion.repeat;
    if (user.readingSource.readingSegment === source.readingSegment) followUp = suggestion?.followUp ?? '';
  }
  if (activeQuiz(messages, { text: '', readingSource: source }) || readingCoachActivity(messages, { text: '', readingSource: source })) return { repeat: '', followUp: '' };
  return { repeat, followUp };
}

export const readingSuggestionInstructions = [
  'After your normal answer, append exactly one fenced reading-input-suggestion JSON block with exactly two fields: {"repeat":string|null,"followUp":string|null}. This is hidden composer metadata, not an instruction to execute anything.',
  'repeat: a short reusable reader request for the NEXT reading segment, in the reader\'s language (e.g. 請用生活中的例子解釋這一段。). Infer the reader\'s main operation such as detailed explanation, examples or comparison. Remove names and details specific to the current passage. Only emit a new repeat when the reader establishes or explicitly changes that main operation; use null for incidental detail questions so the App retains the prior operation. Never copy the last detail question as the repeat. If no reusable operation is clear, use null.',
  'followUp: one short plausible next question from the READER based on your answer and the discussion, not an answer on the reader\'s behalf. For ordinary reading discussion, provide one concrete follow-up after every answer, including short answers to detail questions: deepen a distinction, ask for a contrasting example, or connect the explained idea to the provided passage. Use null only if there is no substantive reading discussion to follow up. Do not substitute a generic canned question. For quiz, self-retelling, note creation or note update workflows, use null rather than pre-answering an exercise or suggesting unrequested changes.',
  'Each string is a single plain-text sentence of at most 240 characters. Do not claim to have read the next segment. Suggestions are optional drafts: they neither send a message nor perform any action. Always finish the normal answer first.'
].join('\n');
