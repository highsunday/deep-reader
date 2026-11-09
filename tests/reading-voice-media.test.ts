import { afterEach, expect, test, vi } from "vitest";
import { ReadingVoicePeer } from "../src/renderer/reading-voice-peer";
const context = { bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "A scoped passage." };
const peers: ReadingVoicePeer[] = [];
afterEach(() => peers.splice(0).forEach(p => void p.stop()));

function setup() {
  const track = { enabled: true, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const channel = { close: vi.fn(), onmessage: null, onerror: null };
  const pc = { connectionState: "new", iceConnectionState: "new", onconnectionstatechange: null as null | (() => void), ontrack: null,
    addTrack: vi.fn(), createDataChannel: vi.fn(() => channel), createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" })),
    setLocalDescription: vi.fn(async () => {}), setRemoteDescription: vi.fn(async () => {}), close: vi.fn() };
  const audio = { autoplay: false, srcObject: null, play: vi.fn(async () => {}), pause: vi.fn(), remove: vi.fn() };
  const api = { start: vi.fn(async (input) => ({ sessionId: input.sessionId, sdp: "v=0\r\nm=audio 10\r\n" })), stop: vi.fn(async () => {}) };
  const getUserMedia = vi.fn(async () => stream);
  const peer = new ReadingVoicePeer(api, { getUserMedia, createPeer: () => pc as unknown as RTCPeerConnection,
    createAudio: () => audio as unknown as HTMLAudioElement, createId: () => "test-voice" });
  peers.push(peer);
  return { peer, track, stream, pc, channel, audio, api, getUserMedia };
}

test("F40 media keeps microphone live while muted and closes every resource on end", async () => {
  const { peer, track, stream, pc, audio, api, getUserMedia } = setup();
  await peer.start(context);
  expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  expect(pc.addTrack).toHaveBeenCalledWith(track, stream);
  expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ context }));
  expect(peer.state.phase).toBe("connecting");
  pc.connectionState = "connected"; pc.onconnectionstatechange?.();
  expect(peer.state.phase).toBe("active");
  peer.toggleMuted(); expect(track.enabled).toBe(false); expect(track.stop).not.toHaveBeenCalled();
  peer.toggleMuted(); expect(track.enabled).toBe(true);
  await peer.stop();
  expect(track.stop).toHaveBeenCalledTimes(1); expect(pc.close).toHaveBeenCalledTimes(1);
  expect(audio.pause).toHaveBeenCalled(); expect(api.stop).toHaveBeenCalledWith("test-voice");
  expect(peer.state.phase).toBe("idle");
});

test("F40 late microphone permission after cancellation never starts a server session", async () => {
  const { peer, api, getUserMedia, stream, track } = setup();
  let grant!: (value: MediaStream) => void;
  getUserMedia.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const starting = peer.start(context);
  expect(peer.state.phase).toBe("permission");
  await peer.stop(); grant(stream); await starting;
  expect(track.stop).toHaveBeenCalledOnce(); expect(api.start).not.toHaveBeenCalled();
  expect(peer.state.phase).toBe("idle");
});

test("F40 late SDP after ending does not revive a peer", async () => {
  const { peer, api, pc, track } = setup();
  let respond!: (answer: { sessionId: string; sdp: string }) => void;
  api.start.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  const starting = peer.start(context);
  await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce());
  await peer.stop(); respond({ sessionId: "test-voice", sdp: "late" }); await starting;
  expect(pc.setRemoteDescription).not.toHaveBeenCalled(); expect(track.stop).toHaveBeenCalledOnce();
  expect(peer.state.phase).toBe("idle");
});

test("F40 rejected microphone permission shows a recoverable error without calling server", async () => {
  const { peer, getUserMedia, api } = setup();
  getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  await peer.start(context);
  expect(peer.state.phase).toBe("error"); expect(peer.state.error).toMatch(/麥克風/);
  expect(api.start).not.toHaveBeenCalled();
});

test("F40 failed media connection stops server and microphone", async () => {
  const { peer, pc, track, api } = setup();
  await peer.start(context);
  pc.connectionState = "failed"; pc.onconnectionstatechange?.();
  await vi.waitFor(() => expect(peer.state.phase).toBe("error"));
  expect(track.stop).toHaveBeenCalledOnce(); expect(api.stop).toHaveBeenCalledWith("test-voice");
});
