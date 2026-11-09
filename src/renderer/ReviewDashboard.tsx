import type { ReviewSummary } from "../shared/spaced-review";
import "./review-dashboard.css";

export function ReviewDailyProgress({ daily, onSettings }: { daily: ReviewSummary["daily"]; onSettings?(): void }) {
  return <section className="review-daily" aria-label="Today's progress">
    <div className="review-daily-heading"><h2>Today's progress</h2><small>Count / daily limit</small></div>
    <dl>{[
      { label: "New cards", count: daily.startedNew, limit: daily.dailyNewLimit, detail: "New cards started today / daily limit" },
      { label: "Due reviews", count: daily.completedDue, limit: daily.dailyDueLimit, detail: "Due reviews completed today / daily limit" }
    ].map(item => <div key={item.label} className="review-daily-item" title={item.detail}>
      <dt>{item.label}</dt><dd><strong>{item.count}</strong><span>/{item.limit}</span></dd>
    </div>)}</dl>
    {onSettings ? <button className="review-limit-button" type="button" onClick={onSettings} aria-label="Adjust daily limits" title="Adjust daily limits">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
    </button> : null}
  </section>;
}

export function ReviewOutcomes({ progress, activity }: Pick<ReviewSummary, "progress" | "activity">) {
  const maximum = Math.max(1, ...progress.daily.map(day => day.solid ?? 0));
  // Separate paths at unknown days; gaps must never be drawn as a zero result.
  let path = "", connected = false;
  const points = progress.daily.flatMap((day, index) => {
    if (day.solid === null) { connected = false; return []; }
    const x = 12 + index / Math.max(1, progress.daily.length - 1) * 616;
    const y = 154 - day.solid / maximum * 132;
    path += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `; connected = true;
    return [{ ...day, x, y }];
  });
  const delta = progress.delta30Days;
  const maxActivity = Math.max(1, ...activity.daily.map(day => day.newCompleted + day.dueCompleted));
  return <>
    <section className="review-growth" aria-label="Learning progress">
      <header><div><h2>Learning progress</h2></div><span className="review-period">90 days</span></header>
      <div className="review-growth-numbers">
        <div className="review-solid"><span>Solid recall</span><strong>{progress.solid}<small> cards</small></strong>
          <p>{delta === null ? "Insufficient data from 30 days ago" : delta === 0 ? "No change in the last 30 days" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} in the last 30 days`}</p></div>
        <dl><div><dt>Building</dt><dd>{progress.building}<small> cards</small></dd></div>
          <div><dt>30-day recall success rate</dt><dd>{progress.recallRate === null ? "—" : `${progress.recallRate}%`}</dd>
            <p>{progress.recallRate === null ? "No follow-up reviews yet" : `Based on ${progress.recallReviews} follow-up ratings`}</p></div></dl>
      </div>
      <div className="review-insights">
      <div className="review-trend"><div><strong>Solid recall over time</strong><small>Cards can move down when they need reinforcement.</small></div>
        <svg viewBox="0 0 640 174" role="img" aria-label={`90-day solid recall trend, currently ${progress.solid} cards`} preserveAspectRatio="none">
          <title>90-day solid recall trend; gaps indicate insufficient historical data</title>
          <line x1="12" x2="628" y1="22" y2="22" /><line x1="12" x2="628" y1="88" y2="88" /><line x1="12" x2="628" y1="154" y2="154" />
          <path d={path} />{points.length ? <circle cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="4" /> : null}
        </svg><div className="review-trend-axis"><span>{progress.daily[0]?.date}</span><span>{progress.daily.at(-1)?.date}</span></div>
      </div>
      <p className="review-method">Estimated from ratings over time and your review schedule, not a guarantee of recall. {progress.historyIncomplete ? "Some older records could not be verified; the chart leaves those periods blank." : "Each active recall attempt helps you check your understanding."}</p>
    <section className="review-activity" aria-label="30-day review activity">
      <header><div><h2>30-day review activity</h2></div>
        <strong>{activity.completedReviews} completed reviews <span>·</span> {activity.activeDays} active days</strong></header>
      <ol aria-label="Completed review rounds by day">{activity.daily.map(day => {
        const count = day.newCompleted + day.dueCompleted;
        const label = `${day.date}: ${day.newCompleted} new-card rounds and ${day.dueCompleted} due-review rounds completed`;
        return <li key={day.date} data-level={count === 0 ? 0 : Math.max(1, Math.ceil(count / maxActivity * 4))} title={label} aria-label={label} tabIndex={0}>
          <span aria-hidden="true">{Number(day.date.slice(-2))}</span><span className="review-day-tooltip">{label}</span></li>;
      })}</ol>
      <footer><span>{activity.daily[0]?.date} — {activity.daily.at(-1)?.date}</span><span>Less <i data-level="0" /><i data-level="2" /><i data-level="4" /> More</span></footer>
    </section>
      </div>
    </section>
  </>;
}
