import { useEffect, useMemo, useRef, useState } from "react";
import { REVIEW_RATINGS, type ReviewCard, type ReviewRating } from "../shared/spaced-review";
import { UNDERSTANDING_LEVELS, understandingLabels, type ReviewVoiceApi, type ReviewVoiceContext, type SavedVoiceReview, type UnderstandingLevel, type VoiceReviewAssessment } from "../shared/review-voice";
import { ReadingVoicePeer, type VoicePeerState } from "./reading-voice-peer";
import { VoiceChatIcon } from "./ReadingVoiceControls";
import { readableVoiceError } from "../shared/reading-voice";

const ratingLabels: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const ratingHints: Record<ReviewRating, string> = { again: "Forgot or misunderstood", hard: "Difficult or missing key details", good: "Recalled the core idea", easy: "Complete and effortless" };
const understandingOptions: Record<UnderstandingLevel, string> = {
  unassessed: "Not assessed yet", unclear: "Still unclear", partial: "Partly understood", understood: "Core idea understood"
};
export function ReviewVoiceDiscussion({ api, card, saving, onSave, onManual, onReveal }: {
  api: ReviewVoiceApi; card: ReviewCard; saving: boolean;
  onSave(rating: ReviewRating, result: SavedVoiceReview): Promise<void>;
  onManual(): void; onReveal(): void;
}) {
  const [discussionId] = useState(() => crypto.randomUUID());
  const context = useMemo<ReviewVoiceContext>(() => ({ discussionId, noteId: card.note.id, noteRevision: card.note.revision, scheduleVersion: card.scheduleVersion }), [discussionId, card.note.id, card.note.revision, card.scheduleVersion]);
  const peer = useMemo(() => new ReadingVoicePeer<ReviewVoiceContext>(api), [api]);
  const [voice, setVoice] = useState<VoicePeerState>(peer.state);
  const hasAnswer = useRef(false);
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<VoiceReviewAssessment>();
  const [empty, setEmpty] = useState(false);
  const [manualRating, setManualRating] = useState(false);
  const [rating, setRating] = useState<ReviewRating | "">("");
  const ratingEdited = useRef(false);
  const [understanding, setUnderstanding] = useState<UnderstandingLevel>("unassessed");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const action = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = peer.subscribe(setVoice);
    const unsubscribeServer = api.onChanged(state => {
      if (state.discussionId !== discussionId) return;
      hasAnswer.current = state.hasAnswer;
      if (state.voice.phase === "error" && state.voice.sessionId === peer.state.sessionId) void peer.fail(state.voice.error ?? "Voice disconnected.", state.voice.sessionId ?? undefined);
    });
    const close = () => { void peer.stop(); void api.discard(discussionId).catch(() => {}); };
    // This component only mounts after the reader clicks Talk to AI. Deferring one
    // tick lets StrictMode cancel its trial mount before requesting a microphone.
    const begin = setTimeout(() => { void start(); }, 0);
    window.addEventListener("pagehide", close);
    return () => { clearTimeout(begin); alive.current = false; unsubscribe(); unsubscribeServer(); window.removeEventListener("pagehide", close); close(); };
  }, [api, peer, discussionId, context]);
  const talking = !["idle", "error"].includes(voice.phase);
  const locked = saving || assessing || voice.phase === "stopping";
  const insufficient = empty || !!assessment && assessment.suggestedRecall === null && assessment.suggestedUnderstanding === "unassessed";
  const showRatings = !!assessment && (!insufficient || manualRating);
  async function start() {
    if (action.current || saving || assessing || !["idle", "error"].includes(peer.state.phase)) return;
    action.current = true; setError(""); setAssessment(undefined); setEmpty(false); setManualRating(false);
    try { await peer.start(context); }
    finally { action.current = false; }
  }
  async function finish() {
    if (action.current || locked) return;
    action.current = true; setError(""); setAssessing(true);
    try {
      await peer.stop();
      if (!alive.current) return;
      if (!hasAnswer.current) { setEmpty(true); return; }
      const result = await api.assess(discussionId);
      if (!alive.current) return;
      setAssessment(result);
      if (!ratingEdited.current) setRating(result.suggestedRecall ?? "");
      setUnderstanding(result.suggestedUnderstanding);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? readableVoiceError(cause.message) : "Unable to assess this discussion."); }
    finally { action.current = false; if (alive.current) setAssessing(false); }
  }
  async function manual() {
    if (saving) return;
    await peer.stop(); await api.discard(discussionId).catch(() => {});
    if (alive.current) onManual();
  }
  const status = voice.phase === "error" ? "Couldn’t connect" : voice.phase === "idle" ? (error ? "Discussion paused" : "Starting…") : voice.phase === "permission" ? "Allow microphone access" : voice.phase === "connecting" ? "Connecting…"
    : voice.phase === "stopping" ? "Ending discussion…" : voice.muted ? "Microphone muted" : "You're ready to talk";
  return <section className="review-voice-discussion" aria-label="Voice review discussion">
    <header className="review-voice-header"><span><VoiceChatIcon />{assessment || empty ? "Your review" : "Voice review"}</span>
      <button className="review-quiet review-voice-close" type="button" aria-label="Close voice review" title="Return to self-rating" disabled={saving} onClick={() => void manual()}>×</button>
    </header>
    <div className={`review-voice-body${!assessment && !empty ? " is-conversation" : ""}`}>
      {error || voice.error ? <p role="alert" className="review-error">{error || readableVoiceError(voice.error!)}</p> : null}
      {assessing ? <div className="review-voice-centered" role="status"><div className="review-voice-orb is-working"><VoiceChatIcon /></div><h2>Putting it together…</h2><p>Your initial recall and understanding are assessed separately.</p></div>
      : insufficient && !manualRating ? <div className="review-voice-empty"><span className="review-voice-eyebrow">A little more to go</span><h2>Tell AI what you remember</h2><p>Explain the idea in your own words so AI can help you check it.</p></div>
      : showRatings ? <div className="review-voice-assessment">
        <h2>How did it go?</h2><p className="review-voice-intro">AI has suggested ratings. Adjust anything that feels off.</p>
        <div className="review-voice-field"><h3 id={`${discussionId}-recall`}>Before discussion</h3>
          <div className="review-voice-rating-options" role="group" aria-label="Initial recall">
            {REVIEW_RATINGS.map(value => <button key={value} type="button" data-rating={value} aria-pressed={rating === value} title={ratingHints[value]} disabled={saving}
              onClick={() => { ratingEdited.current = true; setRating(value); }}>{ratingLabels[value]}</button>)}
          </div><small>{rating ? "This sets your next review." : "Choose how well you recalled it before any hints."}</small>
        </div>
        <div className="review-voice-field"><label htmlFor={`${discussionId}-understanding`}>After discussion</label>
          <select id={`${discussionId}-understanding`} aria-label="Understanding after discussion" value={understanding} disabled={saving} onChange={e => setUnderstanding(e.target.value as UnderstandingLevel)}>
            {UNDERSTANDING_LEVELS.map(level => <option key={level} value={level}>{understandingOptions[level]}</option>)}
          </select><small>Your understanding now, separate from recall.</small>
        </div>
        <details className="review-voice-details"><summary>Assessment details</summary>
          <h3>Initial recall · AI: {assessment!.suggestedRecall ? ratingLabels[assessment!.suggestedRecall] : "Not assessed"}</h3><p>{assessment!.recallReason}</p>
          <h3>Understanding · AI: {understandingLabels[assessment!.suggestedUnderstanding]}</h3><p>{assessment!.understandingReason}</p>
          <h3>Summary</h3><p>{assessment!.summary}</p>
        </details>
      </div> : <div className="review-voice-centered">
        <div className={`review-voice-orb${voice.phase === "active" && !voice.muted ? " is-listening" : ""}`} aria-hidden="true"><VoiceChatIcon /></div>
        <h2 role="status">{status}</h2><p>Look at the card and share what comes to mind.</p>
        <small>Say “start” if you'd like AI to ask first.</small>
      </div>}
    </div>
    <footer className="review-voice-footer">
      {assessing ? <p className="review-voice-footnote">You can close this review at any time.</p>
      : insufficient && !manualRating ? <><button className="review-primary" type="button" disabled={saving} onClick={() => void start()}>Continue talking</button>
        <button className="review-quiet" type="button" disabled={saving} onClick={() => assessment ? setManualRating(true) : void manual()}>{assessment ? "Rate myself" : "Review without AI"}</button></>
      : showRatings ? <><div className="review-voice-actions"><button type="button" disabled={saving} onClick={() => void start()}>Keep talking</button>
        <button type="button" className="review-primary" disabled={saving || !rating} onClick={() => { if (rating && assessment) void onSave(rating, { ...assessment, understanding }); }}>{saving ? "Saving…" : "Save & next"}</button></div>
        <button className="review-quiet" type="button" disabled={saving} onClick={onReveal}>View note</button></>
      : <div className="review-voice-actions">
        {voice.phase === "active" ? <><button type="button" aria-pressed={voice.muted} onClick={() => peer.toggleMuted()}>{voice.muted ? "Unmute" : "Mute"}</button>
          <button className="review-primary" type="button" onClick={() => void finish()}>Finish discussion</button></>
        : talking ? <button className="review-quiet" type="button" onClick={() => void manual()}>Cancel</button>
        : <><button className="review-primary" type="button" disabled={locked} onClick={() => void start()}>Try again</button>
          {hasAnswer.current ? <button type="button" disabled={locked} onClick={() => void finish()}>Get assessment</button> : null}</>}
      </div>}
      <small className="review-voice-privacy">Only ratings &amp; a short summary are saved.</small>
    </footer>
  </section>;
}
