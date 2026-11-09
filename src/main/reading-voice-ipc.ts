import { parseStartReadingVoice, parseVoiceSessionId } from "../shared/reading-voice";
import type { ChatController } from "./chat-controller";

export function registerReadingVoiceIpc(
  ipc: { handle(channel: string, handler: (event: unknown, value: unknown) => unknown): unknown },
  chat: Pick<ChatController, "startVoice" | "stopVoice">,
  trusted: (event: unknown) => boolean
) {
  ipc.handle("reading-voice:start", (event, value) => {
    if (!trusted(event)) throw new Error("Untrusted voice caller.");
    return chat.startVoice(parseStartReadingVoice(value));
  });
  ipc.handle("reading-voice:stop", (event, value) => {
    if (!trusted(event)) throw new Error("Untrusted voice caller.");
    return chat.stopVoice(parseVoiceSessionId(value));
  });
}
