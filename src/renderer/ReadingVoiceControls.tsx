import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReadingVoiceApi, ReadingVoiceState } from "../shared/reading-voice";
import { readableVoiceError } from "../shared/reading-voice";
import { ReadingVoicePeer, type VoicePeerState } from "./reading-voice-peer";

export function useReadingVoice(api: ReadingVoiceApi | undefined, server: ReadingVoiceState | undefined, scopeKey: string) {
  const peer = useMemo(() => api ? new ReadingVoicePeer(api) : undefined, [api]);
  const [state, setState] = useState<VoicePeerState>({ phase: "idle", sessionId: null, muted: false });
  useEffect(() => {
    setState(peer?.state ?? { phase: "idle", sessionId: null, muted: false });
    if (!peer) return;
    const unsubscribe = peer.subscribe(setState);
    const close = () => { void peer.stop(); };
    window.addEventListener("pagehide", close);
    return () => { unsubscribe(); window.removeEventListener("pagehide", close); void peer.stop(); };
  }, [peer]);
  useEffect(() => { peer?.dismissError(); void peer?.stop(); }, [peer, scopeKey]);
  useEffect(() => {
    if (server?.phase === "error" && server.sessionId && server.sessionId === peer?.state.sessionId) {
      void peer.fail(server.error ?? "語音服務已中斷。", server.sessionId);
    }
  }, [peer, server?.phase, server?.sessionId, server?.error]);
  const dismissError = useCallback(() => peer?.dismissError(), [peer]);
  return { peer, state, dismissError, busy: !["idle", "error"].includes(state.phase) };
}

/** Anchored above the composer, outside its layout; one notice per failure. */
export function ReadingVoiceNotice({ error, onDismiss }: { error: string; onDismiss(): void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!error || hovered || focused) return;
    const timer = setTimeout(onDismiss, 8_000);
    return () => clearTimeout(timer);
  }, [error, hovered, focused, onDismiss]);
  return <div className="reading-voice-notice" role="status" aria-live="polite" aria-atomic="true"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(); } }}>
    <span className="reading-voice-notice-icon" aria-hidden="true">!</span>
    <div className="reading-voice-notice-copy"><strong>語音暫時無法使用</strong><p>{readableVoiceError(error)}</p></div>
    <button type="button" className="reading-voice-notice-close" aria-label="關閉語音提示" onClick={onDismiss}>×</button>
  </div>;
}

export function VoiceChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 18.2 3.5 21v-6A8.5 8.5 0 1 1 6 18.2Z" />
    <path d="M7.5 10v3m3-6v9m3-7v5m3-4v3" />
  </svg>;
}

export function ReadingVoiceButton({ disabledReason, onStart }: { disabledReason?: string; onStart(): void }) {
  return <button className="reading-voice-start" type="button" aria-label="開始語音聊天"
    title={disabledReason ?? "與 AI 即時討論目前閱讀區段"} disabled={!!disabledReason} onClick={onStart}>
    <VoiceChatIcon />
  </button>;
}

export function ReadingVoicePanel({ state, source, onMute, onStop }: {
  state: VoicePeerState; source?: string; onMute(): void; onStop(): void;
}) {
  const active = state.phase === "active";
  const status = state.phase === "permission" ? "請允許使用麥克風"
    : state.phase === "connecting" ? "正在連接 AI…"
    : state.phase === "stopping" ? "正在結束語音…"
    : state.muted ? "麥克風已靜音" : "可以開始說話";
  return <section className={`reading-voice-panel${active && !state.muted ? " is-listening" : ""}`} aria-label="語音聊天">
    <div className="reading-voice-heading"><span>AI 語音聊天</span><span className="reading-voice-source" title={source}>{source}</span></div>
    <div className="reading-voice-orb" aria-hidden="true"><VoiceChatIcon /></div>
    <strong className="reading-voice-status" role="status">{status}</strong>
    <p className="reading-voice-hint">討論目前閱讀區段，也可以隨時插話。</p>
    <div className="reading-voice-actions">
      <button type="button" className={`reading-voice-mute${state.muted ? " is-muted" : ""}`} disabled={!active}
        aria-label={state.muted ? "解除麥克風靜音" : "麥克風靜音"} aria-pressed={state.muted} onClick={onMute}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6" />
          {state.muted ? <path d="m3 3 18 18" /> : null}
        </svg><span>{state.muted ? "解除靜音" : "靜音"}</span>
      </button>
      <button type="button" className="reading-voice-end" disabled={state.phase === "stopping"} aria-label="結束語音聊天" onClick={onStop}>
        <span aria-hidden="true">■</span> 結束
      </button>
    </div>
  </section>;
}
