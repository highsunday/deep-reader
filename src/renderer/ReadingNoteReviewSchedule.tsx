import { understandingLabels } from "../shared/review-voice";
import { useEffect, useState } from "react";
import type { NoteReviewDetails, ReviewRating, SpacedReviewApi } from "../shared/spaced-review";
import "./reading-note-review-schedule.css";

const ratingLabels: Record<ReviewRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
function ReviewDate({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat("en", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(value)}</time>;
}

export function ReadingNoteReviewSchedule({ api, noteId }: { api: SpacedReviewApi; noteId: string }) {
  const [details, setDetails] = useState<NoteReviewDetails>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    setDetails(undefined);
    setError("");
    const refresh = async () => {
      const current = ++sequence;
      try {
        const value = await api.details(noteId);
        if (active && current === sequence) { setDetails(value); setError(""); }
      } catch (cause) {
        if (active && current === sequence) {
          setDetails(undefined);
          setError(cause instanceof Error ? cause.message : "Unable to load review history.");
        }
      }
    };
    const changed = () => { void refresh(); };
    const unsubscribe = api.onChanged(changed);
    window.addEventListener("focus", changed);
    void refresh();
    return () => { active = false; unsubscribe(); window.removeEventListener("focus", changed); };
  }, [api, noteId, attempt]);

  const state = !details ? "loading" : !details.eligible ? "unavailable" : !details.enrolled ? "off"
    : details.paused ? "paused" : details.totalReviews ? "scheduled" : "new";
  const status = { loading: "Loading…", unavailable: "Unavailable", off: "Not enrolled", paused: "Paused", scheduled: "Scheduled", new: "Not reviewed yet" }[state];
  return <section className="note-review-schedule" aria-label="Review schedule">
    <div className="note-review-schedule-summary">
      <div className="note-review-schedule-heading"><h3>Review schedule</h3>
        <span className="note-review-schedule-state" data-state={error ? "error" : state}>{error ? "Unable to load" : status}</span>
      </div>
      {details ? <dl>
        <div><dt>Last reviewed</dt><dd>{details.lastReviewedAt !== null ? <ReviewDate value={details.lastReviewedAt} /> : "Not yet"}</dd></div>
        <div><dt>Last rating</dt><dd>{details.lastRating ? <span className="note-review-rating" data-rating={details.lastRating}>{ratingLabels[details.lastRating]}</span> : "—"}</dd></div>
        <div><dt>{details.paused || !details.eligible ? "Previously due" : "Next due"}</dt><dd>{details.dueAt !== null ? <ReviewDate value={details.dueAt} />
          : details.enrolled && details.eligible && !details.paused ? "Ready now" : "—"}</dd></div>
        <div><dt>Total reviews</dt><dd>{details.totalReviews}</dd></div>
      </dl> : null}
    </div>
    {error ? <div className="note-review-schedule-error" role="alert"><span>{error}</span>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div> : !details ? <p role="status">Loading review history…</p> : <>
      {details.reason ? <p className="note-review-schedule-hint">{details.reason}</p> : details.paused ? <p className="note-review-schedule-hint">Your existing schedule will continue when you resume reviews.</p> : null}
      <details className="note-review-history">
        <summary>View review history</summary>
        {details.history.length ? <div className="note-review-history-scroll" role="region" aria-label="Review history" tabIndex={0}>
          <table><caption>Review history, newest first</caption><thead><tr><th scope="col">Reviewed at</th><th scope="col">Rating</th><th scope="col">Next due after review</th></tr></thead>
            <tbody>{details.history.map(event => <tr key={event.operationId}>
              <td><ReviewDate value={event.reviewedAt} /></td><td><span className="note-review-rating" data-rating={event.rating}>{ratingLabels[event.rating]}</span></td>
              <td><ReviewDate value={event.dueAt} />{event.voiceReview ? <details className="review-history-voice"><summary>Voice review result</summary>
                <p>Initial recall: {ratingLabels[event.rating]} · AI: {event.voiceReview.suggestedRecall ? ratingLabels[event.voiceReview.suggestedRecall] : "Not enough evidence"}</p>
                <p>{event.voiceReview.recallReason}</p>
                <p>After discussion: {understandingLabels[event.voiceReview.understanding]} · AI: {understandingLabels[event.voiceReview.suggestedUnderstanding]}</p>
                <p>{event.voiceReview.understandingReason}</p><p>{event.voiceReview.summary}</p>
              </details> : null}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p>Your review history will appear here after your first rating.</p>}
      </details>
    </>}
  </section>;
}
