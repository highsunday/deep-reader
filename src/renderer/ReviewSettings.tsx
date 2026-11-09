import { useEffect, useRef, useState } from "react";
import type { SpacedReviewApi } from "../shared/spaced-review";
import "./review-dashboard.css";

export function ReviewSettings({ api }: { api: SpacedReviewApi }) {
  const [values, setValues] = useState<{ dailyNewLimit: string; dailyDueLimit: string }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    setError("");
    void api.settings().then(value => { if (active) setValues({ dailyNewLimit: String(value.dailyNewLimit), dailyDueLimit: String(value.dailyDueLimit) }); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load study limits."); });
    return () => { active = false; };
  }, [api, retry]);
  async function save() {
    if (!values || locked.current) return;
    setError(""); setMessage("");
    const parsed = { dailyNewLimit: Number(values.dailyNewLimit), dailyDueLimit: Number(values.dailyDueLimit) };
    if (Object.values(values).some(value => !value.trim()) || Object.values(parsed).some(value => !Number.isInteger(value) || value < 0 || value > 999)) {
      setError("Daily limits must be whole numbers from 0 to 999."); return;
    }
    locked.current = true; setBusy(true);
    try { await api.saveSettings(parsed); setMessage("Daily study limits saved."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save study limits."); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="review-settings">
    <h3>Build understanding, a little every day</h3>
    <p>Set separate daily limits for new cards and due reviews to find your own pace.</p>
    {error ? <p role="alert">{error}</p> : null}
    {!values ? error ? <button type="button" onClick={() => setRetry(value => value + 1)}>Retry loading settings</button> : <p role="status">Loading settings…</p> :
      <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="review-setting-row"><div><label htmlFor="review-new-limit">Daily new-card limit</label>
          <p id="review-new-description">Counts when you first save a rating. Set to 0 to pause new cards; cards already in learning continue.</p></div>
          <input id="review-new-limit" type="number" min="0" max="999" step="1" required disabled={busy}
            aria-describedby="review-new-description" value={values.dailyNewLimit}
            onChange={event => { setValues({ ...values, dailyNewLimit: event.target.value }); setMessage(""); }} /></div>
        <div className="review-setting-row"><div><label htmlFor="review-due-limit">Daily due-review limit</label>
          <p id="review-due-description">Counted separately from new cards. A review is complete when scheduled for a later day. Set to 0 to pause due reviews.</p></div>
          <input id="review-due-limit" type="number" min="0" max="999" step="1" required disabled={busy}
            aria-describedby="review-due-description" value={values.dailyDueLimit}
            onChange={event => { setValues({ ...values, dailyDueLimit: event.target.value }); setMessage(""); }} /></div>
        <p className="review-settings-hint">Limits apply across your library and reset at local midnight. Changing limits keeps your saved progress.</p>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save study limits"}</button>
        {message ? <p role="status">{message}</p> : null}
      </form>}
  </div>;
}
