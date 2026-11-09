import { parseVoiceSessionId } from "../shared/reading-voice";
import { parseStartReviewVoice } from "../shared/review-voice";
import type { ReviewVoiceController } from "./review-voice-controller";
export function registerReviewVoiceIpc(
  ipc: { handle(channel: string, handler: (event: unknown, value: unknown) => unknown): unknown },
  controller: ReviewVoiceController,
  trusted: (event: unknown) => boolean
) {
  const operations: Record<string, (value: unknown) => unknown> = {
    start: value => controller.start(parseStartReviewVoice(value)),
    stop: value => controller.stop(parseVoiceSessionId(value)),
    assess: value => controller.assess(parseVoiceSessionId(value)),
    discard: value => controller.discard(parseVoiceSessionId(value))
  };
  for (const [name, run] of Object.entries(operations)) ipc.handle(`review-voice:${name}`, (event, value) => {
    if (!trusted(event)) throw new Error("Untrusted review voice caller.");
    return run(value);
  });
}
