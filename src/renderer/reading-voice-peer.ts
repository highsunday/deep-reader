import type { ReadingVoiceAnswer, ReadingVoiceContext } from "../shared/reading-voice";
import { readableVoiceError } from "../shared/reading-voice";

export interface VoicePeerState {
  phase: "idle" | "permission" | "connecting" | "active" | "stopping" | "error";
  sessionId: string | null;
  muted: boolean;
  error?: string;
}
interface MediaRun {
  id: string;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  audio?: HTMLAudioElement;
  serverRequested: boolean;
  timer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}
interface Dependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeer(): RTCPeerConnection;
  createAudio(): HTMLAudioElement;
  createId(): string;
}

/** Native WebRTC media, deliberately independent of React and the Codex process. */
export class ReadingVoicePeer<Context = ReadingVoiceContext> {
  #state: VoicePeerState = { phase: "idle", sessionId: null, muted: false };
  #run?: MediaRun;
  #listeners = new Set<(state: VoicePeerState) => void>();
  #stopping?: Promise<void>;
  constructor(private api: { start(input: { sessionId: string; sdp: string; context: Context }): Promise<ReadingVoiceAnswer>; stop(sessionId: string): Promise<void> }, private deps: Dependencies = {
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    createPeer: () => new RTCPeerConnection(), createAudio: () => new Audio(), createId: () => crypto.randomUUID()
  }) {}
  get state() { return { ...this.#state }; }
  subscribe(listener: (state: VoicePeerState) => void) {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #set(state: VoicePeerState) { this.#state = state; this.#listeners.forEach(fn => fn(this.state)); }

  async start(context: Context): Promise<void> {
    if (this.#run || this.#stopping) return;
    const run: MediaRun = { id: this.deps.createId(), serverRequested: false };
    this.#run = run;
    this.#set({ phase: "permission", sessionId: run.id, muted: false });
    try {
      const stream = await this.deps.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this.#run !== run) { stream.getTracks().forEach(track => track.stop()); return; }
      run.stream = stream;
      const peer = run.peer = this.deps.createPeer();
      const audio = run.audio = this.deps.createAudio();
      audio.autoplay = true;
      run.channel = peer.createDataChannel("oai-events");
      run.channel.onerror = () => { void this.fail("語音資料連線失敗，請重新開始。", run.id); };
      peer.ontrack = event => {
        if (this.#run !== run) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => this.fail("無法播放 AI 聲音，請檢查音訊裝置後重試。", run.id));
      };
      peer.onconnectionstatechange = () => {
        if (this.#run !== run) return;
        if (peer.connectionState === "connected") {
          clearTimeout(run.timer); clearTimeout(run.disconnectTimer);
          this.#set({ ...this.#state, phase: "active" });
        } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          void this.fail("語音連線已中斷，請重新開始。", run.id);
        } else if (peer.connectionState === "disconnected") {
          clearTimeout(run.disconnectTimer);
          run.disconnectTimer = setTimeout(() => { void this.fail("語音連線已中斷，請重新開始。", run.id); }, 5_000);
        }
      };
      stream.getAudioTracks().forEach(track => {
        peer.addTrack(track, stream);
        track.onended = () => { if (this.#run === run) void this.fail("麥克風已中斷，請檢查裝置後重試。", run.id); };
      });
      this.#set({ ...this.#state, phase: "connecting" });
      run.timer = setTimeout(() => { void this.fail("語音連線逾時，請檢查網路後重試。", run.id); }, 50_000);
      const offer = await peer.createOffer();
      if (this.#run !== run) return;
      if (!offer.sdp) throw new Error("無法建立語音連線。");
      await peer.setLocalDescription(offer);
      if (this.#run !== run) return;
      run.serverRequested = true;
      const answer = await this.api.start({ sessionId: run.id, sdp: offer.sdp, context });
      if (this.#run !== run) return;
      if (answer.sessionId !== run.id) throw new Error("語音連線回覆已過期。");
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (error) {
      if (this.#run !== run) return;
      const name = error && typeof error === "object" && "name" in error ? error.name : "";
      const message = name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "未取得麥克風權限。請在系統設定允許此軟體使用麥克風，再重試。"
        : name === "NotFoundError" ? "找不到麥克風，請連接音訊輸入裝置。"
        : error instanceof Error ? readableVoiceError(error.message) : "無法開始語音聊天。";
      await this.fail(message, run.id);
    }
  }

  dismissError() {
    if (this.#state.phase === "error") this.#set({ phase: "idle", sessionId: null, muted: false });
  }
  toggleMuted() {
    if (!this.#run?.stream || this.#state.phase !== "active") return;
    const muted = !this.#state.muted;
    this.#run.stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    this.#set({ ...this.#state, muted });
  }
  async fail(error: string, sessionId?: string): Promise<void> {
    if (sessionId && this.#run?.id !== sessionId) return;
    await this.stop();
    if (!this.#run) this.#set({ phase: "error", sessionId: null, muted: false, error });
  }
  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const run = this.#run;
    if (!run) return Promise.resolve();
    this.#run = undefined; // invalidate pending media permission and SDP before any asynchronous cleanup
    this.#set({ phase: "stopping", sessionId: run.id, muted: false });
    clearTimeout(run.timer); clearTimeout(run.disconnectTimer);
    if (run.peer) { run.peer.ontrack = null; run.peer.onconnectionstatechange = null; }
    run.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (run.channel) { run.channel.onerror = null; run.channel.close(); }
    run.peer?.close();
    if (run.audio) { run.audio.pause(); run.audio.srcObject = null; run.audio.remove(); }
    this.#stopping = (async () => {
      try { if (run.serverRequested) await this.api.stop(run.id); }
      catch { this.#set({ phase: "error", sessionId: null, muted: false, error: "本機麥克風已關閉，但語音服務未能正常結束。請重新連接 Codex。" }); return; }
      this.#set({ phase: "idle", sessionId: null, muted: false });
    })().finally(() => { this.#stopping = undefined; });
    return this.#stopping;
  }
}
