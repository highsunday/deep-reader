import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewSummary, SpacedReviewApi } from "../shared/spaced-review";

export function useReviewSummary(api?: SpacedReviewApi) {
  const [summary, setSummary] = useState<ReviewSummary>();
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!api) return;
    const current = ++generation.current;
    try {
      const next = await api.summary();
      if (current === generation.current) { setSummary(next); setError(""); }
    } catch (cause) {
      if (current === generation.current) {
        setSummary(undefined);
        setError(cause instanceof Error ? cause.message : "Unable to load the review queue.");
      }
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const unsubscribe = api?.onChanged(onFocus);
    window.addEventListener("focus", onFocus);
    return () => { generation.current++; unsubscribe?.(); window.removeEventListener("focus", onFocus); };
  }, [api, refresh]);
  useEffect(() => {
    if (!summary) return;
    const at = Math.min(summary.refreshAt, summary.nextDueAt ?? Infinity);
    if (!Number.isFinite(at)) return;
    const timer = window.setTimeout(() => { void refresh(); },
      Math.min(2_147_483_647, Math.max(1000, at - Date.now() + 20)));
    return () => window.clearTimeout(timer);
  }, [summary, refresh]);
  return { summary, error, refresh };
}
