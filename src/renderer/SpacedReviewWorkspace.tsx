import { VoiceChatIcon } from "./ReadingVoiceControls";
import { ReviewVoiceDiscussion } from "./ReviewVoiceDiscussion";
import type { SavedVoiceReview } from "../shared/review-voice";
import { useEffect, useRef, useState } from "react";
import type { ReaderDesktopApi } from "../shared/contracts";
import { readingNoteImage } from "../shared/reading-note-images";
import { REVIEW_RATINGS, type RateReviewInput, type ReviewCard, type ReviewRating, type ReviewSummary } from "../shared/spaced-review";
import { ReadingNoteReadOnlyContent } from "./ReadingNoteReadOnlyContent";
import { ReadingNoteReviewSchedule } from "./ReadingNoteReviewSchedule";
import { ReviewDailyProgress, ReviewOutcomes } from "./ReviewDashboard";
import "./spaced-review.css";

const labels: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const meanings: Record<ReviewRating, string> = { again: "Could not recall it, or misunderstood the core idea", hard: "Mostly correct, but difficult or missing important details", good: "Recalled the core idea correctly", easy: "Explained it fully and easily" };
function ratingInterval(value: number) {
  const minutes = Math.max(1, Math.ceil((value - Date.now()) / 60_000));
  if (minutes < 60) return `In ${minutes} min`;
  if (minutes < 1440) return `In ${Math.round(minutes / 60)} hr`;
  const days = Math.round(minutes / 1440);
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}
export function reviewTime(value: number) {
  const minutes = Math.max(1, Math.ceil((value - Date.now()) / 60_000));
  if (minutes < 60) return `In about ${minutes} min`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}
function UnderstandingImage({ api, id, disabled, onFlip }: {
  api: ReaderDesktopApi["readingNotes"]; id: string; disabled: boolean; onFlip(): void;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    void api.attachments.readDataUrl(id).then(value => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [api, id]);
  return url ? <button className="review-understanding-flip" type="button" aria-label="Click image to return to recall"
    title="Click image to return to recall" disabled={disabled} onClick={onFlip}>
    <img className="review-understanding-image" src={url} alt="Understanding image" onError={() => setUrl(undefined)} />
  </button> : null;
}
export function SpacedReviewWorkspace({ api, summary, summaryError, refresh, onNotes, onSettings }: {
  api: ReaderDesktopApi["readingNotes"];
  summary?: ReviewSummary;
  summaryError: string;
  refresh(): Promise<void>;
  onNotes(): void;
  onSettings?(): void;
}) {
  const review = api.review!;
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [front, setFront] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [failedRating, setFailedRating] = useState(false);
  const operation = useRef<RateReviewInput | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const focusButton = useRef<HTMLButtonElement>(null);
  const cardScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);
  useEffect(() => { if (card && imageReady) focusButton.current?.focus(); }, [card, imageReady]);
  useEffect(() => { if (cardScroll.current) cardScroll.current.scrollTop = 0; }, [front, card?.note.id]);
  async function next() {
    const current = ++generation.current;
    const value = await review.next();
    if (current !== generation.current) return;
    operation.current = null;
    setCard(value); setVoiceMode(false); setFront(false); setRevealed(false); setImageReady(!value?.recallUrl); setFailedRating(false);
    setCompleted(!value);
    await refresh();
  }
  async function start() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await next(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load the card."); }
    finally { locked.current = false; setBusy(false); }
  }
  async function rate(rating: ReviewRating, voiceReview?: SavedVoiceReview) {
    if (!card || (!revealed && !voiceReview && !operation.current?.voiceReview) || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const current = generation.current;
    operation.current ??= { noteId: card.note.id, noteRevision: card.note.revision,
      scheduleVersion: card.scheduleVersion, rating, operationId: crypto.randomUUID(), ...(voiceReview ? { voiceReview } : {}) };
    try {
      await review.rate(operation.current);
      if (current !== generation.current) return;
      operation.current = null; setFailedRating(false); setCard(null);
      setCount(value => value + 1);
      await next();
    } catch (cause) {
      if (current === generation.current || operation.current === null) {
        setFailedRating(Boolean(operation.current));
        setError(cause instanceof Error ? cause.message : "Rating was not saved. Please retry.");
      }
    } finally { locked.current = false; setBusy(false); }
  }
  function leave() {
    if (locked.current) return;
    generation.current++; operation.current = null; setCard(null); setCount(0);
    setVoiceMode(false); setCompleted(false); setError(""); setFailedRating(false); void refresh();
  }
  async function imageFailed() {
    if (!card) return;
    const failedCard = card;
    setCard({ ...card, recallUrl: undefined });
    setImageReady(true);
    if (failedCard.recallAttachmentId) {
      try { await review.imageFailed(failedCard.note.id, failedCard.recallAttachmentId); }
      catch { /* The local title fallback remains usable even if the report fails. */ }
    }
  }
  return <section className={`spaced-review-workspace${card ? " is-reviewing" : ""}`} aria-labelledby="spaced-review-title">
    <header className={`spaced-review-header${card ? "" : " library-page-heading"}`}>
      <div className="review-heading">{card ? <span className="review-heading-icon" aria-hidden="true">↻</span> : null}
        <div>{!card ? <span className="library-page-eyebrow">Remember your notes</span> : null}<h1 id="spaced-review-title">Review</h1>
          {!card ? <p>Recall first, then check. One idea at a time.</p> : null}</div>
      </div>
      {card ? <>
        {!voiceMode ? <div className="review-face-steps" aria-label={front ? "Showing the understanding side" : "Showing the recall side"}>
          <span className={!front ? "active" : ""}><span aria-hidden="true">01</span> Recall</span>
          <span className="review-step-divider" aria-hidden="true">/</span>
          <span className={front ? "active" : ""}><span aria-hidden="true">02</span> Check</span>
        </div> : null}
      <div className="review-session-meta">
        <p className="review-session-count" aria-live="polite"><span><strong>{count}</strong> ratings saved</span><span><strong>{summary?.available ?? "…"}</strong> cards remaining</span></p>
        {revealed && !voiceMode ? <button className="review-quiet review-flip" type="button" disabled={busy || (!front && !imageReady)}
          onClick={() => setFront(value => !value)}><span aria-hidden="true">↻</span> {front ? "Back to recall" : "Show answer"}</button> : null}
        <button className="review-quiet" type="button" disabled={busy} onClick={leave}>Leave review <span aria-hidden="true">↗</span></button>
      </div></> : null}
    </header>
    {summaryError || error ? <div className="review-error" role="alert">
      <p>{error || summaryError}</p>
      {failedRating && operation.current ? <button type="button" disabled={busy} onClick={() => void rate(operation.current!.rating)}>Retry saving rating</button> : null}
      <button type="button" disabled={busy} onClick={() => card ? void start() : void refresh().then(() => setError(""))}>{card ? "Reload card" : "Retry"}</button>
    </div> : null}
    {!summary && !summaryError ? <p role="status">Loading review queue…</p> : null}
    {!card && summary ? <div className="review-dashboard">
      <ReviewDailyProgress daily={summary.daily} onSettings={onSettings} />
      <div className={`review-home-card${summary.available ? " has-ready-cards" : ""}`}>

        <div className="review-ready-row">
          <span className="review-focus-symbol" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z"/></svg></span>
          <div className="review-ready-copy">
            {summary.available ? <span className="review-focus-status"><i aria-hidden="true" />Today's focus</span> : null}
            <h2>{summary.available ? <><strong>{summary.available}</strong> cards ready</>
              : summary.backlog > 0 ? "Daily limits reached or reviews paused" : completed ? "All currently available reviews are complete" : summary.enrolled ? "No cards are ready to review" : "Start collecting ideas worth remembering"}</h2>
            {summary.available ? <p>{[
              summary.learning ? `${summary.learning} learning` : "",
              summary.due ? `${summary.due} due` : "",
              summary.newCards ? `${summary.newCards} new` : ""
            ].filter(Boolean).join(" · ")}</p> : !summary.enrolled ? <p>Saved reading notes are automatically added to review.</p>
              : summary.backlog > 0 ? <p>Adjust your daily limits, or continue tomorrow.</p>
              : summary.nextDueAt !== null ? <p>Next review: <time dateTime={new Date(summary.nextDueAt).toISOString()}>{reviewTime(summary.nextDueAt)}</time></p> : null}
            {completed ? <p>{count} {count === 1 ? "rating" : "ratings"} saved this session</p> : null}
          </div>
          {summary.available ? <button className="review-primary" type="button" disabled={busy} onClick={() => { setCount(0); void start(); }}>{busy ? "Loading…" : "Start review"}</button>
            : <button type="button" disabled={busy} onClick={summary.backlog > 0 && onSettings ? onSettings : onNotes}>{summary.backlog > 0 && onSettings ? "Adjust daily limits" : "Open Reading Notes"}</button>}
        </div>
      </div>
      <ReviewOutcomes progress={summary.progress} activity={summary.activity} />
    </div> : null}
    {card ? <div className="review-session">
      <div ref={cardScroll} className="review-card-scroll" key={`${card.note.id}:${card.note.revision}:${card.scheduleVersion}`}>
        {!front ? <article className="review-recall-card" aria-label="Recall side">
          <button ref={focusButton} className="review-recall-image" type="button" disabled={!imageReady || busy || voiceMode}
            aria-label="Show answer" onClick={() => { setFront(true); setRevealed(true); }}>
            {card.recallUrl ? <img src={card.recallUrl} alt="Recall image" onLoad={() => setImageReady(true)} onError={() => void imageFailed()} />
              : <span className="review-recall-title">{card.note.title}</span>}
          </button>
        </article> : <article className="review-understand-card" aria-label="Understanding side">
          {readingNoteImage(card.note, "understand") ? <UnderstandingImage key={readingNoteImage(card.note, "understand")!.attachmentId}
            api={api} id={readingNoteImage(card.note, "understand")!.attachmentId} disabled={busy} onFlip={() => setFront(false)} /> : null}
          <h2>{card.note.title}</h2>
          <details className="review-source"><summary>Book and chapter source</summary><p>{card.note.bookTitle} · {card.note.chapterTitle}</p></details>
          <ReadingNoteReadOnlyContent api={api} note={card.note} />
          <ReadingNoteReviewSchedule key={card.note.id} api={review} noteId={card.note.id} />
        </article>}
      </div>
      {voiceMode && review.voice ? <ReviewVoiceDiscussion key={`voice:${card.note.id}:${card.note.revision}:${card.scheduleVersion}`}
        api={review.voice} card={card} saving={busy || failedRating} onSave={rate}
        onManual={() => setVoiceMode(false)} onReveal={() => { setFront(true); setRevealed(true); }} /> : null}
      {!voiceMode ? <footer className={`review-rating-bar${revealed ? " is-revealed" : ""}`} aria-busy={busy}>
        {revealed ? <><div className="review-rating-prompt"><p>How well did you recall it?</p><small>{busy ? <span role="status">Saving / loading…</span> : "Rate your recall before seeing the answer"}</small></div><div className="review-ratings" role="group" aria-label="Recall rating">
          {REVIEW_RATINGS.map(rating => <button key={rating} type="button" data-rating={rating} title={meanings[rating]}
            disabled={busy || failedRating} onClick={() => void rate(rating)}><strong>{labels[rating]}</strong><small>{ratingInterval(card.intervals[rating])}</small></button>)}
        </div></> : <><div className="review-rating-prompt"><p>Try explaining this idea in your own words</p><small>It is okay not to remember. Reveal the answer to check.</small></div>
          <div className="review-start-actions">{review.voice ? <button type="button" className="review-primary review-voice-entry" disabled={busy || !imageReady}
            onClick={() => setVoiceMode(true)}><VoiceChatIcon />Talk to AI</button> : null}
          <button className={`${review.voice ? "review-quiet" : "review-primary"} review-reveal`} type="button" disabled={busy || !imageReady}
            onClick={() => { setFront(true); setRevealed(true); }}>Show answer <span aria-hidden="true">→</span></button></div></>}
      </footer> : null}
    </div> : null}
  </section>;
}
