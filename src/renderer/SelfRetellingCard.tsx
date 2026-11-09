import { useEffect, useState } from "react";
import { formatSelfRetellingSubmission } from "./self-retelling-artifact";
import type {
  SelfRetellingGrade,
  SelfRetellingTask
} from "./self-retelling-artifact";

interface SelfRetellingCardProps {
  open: boolean;
  task: SelfRetellingTask;
  grades: SelfRetellingGrade[];
  initialAnswers?: [string, string];
  onOpen(): void;
  onClose(): void;
  onSubmit(text: string): Promise<boolean> | boolean;
}

function FeedbackGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="self-retelling-feedback-group">
      <h4>{title}</h4>
      <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
    </section>
  );
}
function GradeResult({
  grade,
  answer
}: {
  grade: SelfRetellingGrade;
  answer: string;
}) {
  const scoreRows = [
    ["內容正確度", grade.scores.accuracy],
    ["重點完整度", grade.scores.completeness],
    ["自我表達", grade.scores.ownWords]
  ] as const;
  return (
    <section className="self-retelling-grade">
      <header>
        <span>第 {grade.attempt} 次回饋</span>
        <strong>{grade.scores.total} / 15</strong>
      </header>
      {answer ? (
        <details className="self-retelling-original">
          <summary>查看我的第 {grade.attempt} 次復述</summary>
          <p>{answer}</p>
        </details>
      ) : null}
      <div className="self-retelling-feedback-grid">
        <FeedbackGroup title="掌握正確" items={grade.feedback.strengths} />
        <FeedbackGroup title="需要修正" items={grade.feedback.corrections} />
        <FeedbackGroup title="重要遺漏" items={grade.feedback.omissions} />
        <FeedbackGroup title="表達改善" items={grade.feedback.expression} />
      </div>
      <div className="self-retelling-scores">
        {scoreRows.map(([label, score]) => (
          <article key={label}>
            <span>{label}</span><strong>{score.score} / 5</strong><p>{score.reason}</p>
          </article>
        ))}
      </div>
      <div className="self-retelling-revision">
        <strong>AI 修改示範</strong>
        <p>{grade.revisedRetelling}</p>
      </div>
    </section>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function SelfRetellingCard({
  open,
  task,
  grades,
  initialAnswers = ["", ""],
  onOpen,
  onClose,
  onSubmit
}: SelfRetellingCardProps) {
  const [practiceId, setPracticeId] = useState(task.practiceId);
  const [answers, setAnswers] = useState<[string, string]>(initialAnswers);
  const [activeAttempt, setActiveAttempt] = useState<1 | 2>(initialAnswers[1] ? 2 : 1);
  const [submittedAttempt, setSubmittedAttempt] = useState<1 | 2 | undefined>(
    initialAnswers[1] ? 2 : initialAnswers[0] && !grades.length ? 1 : undefined
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (practiceId === task.practiceId) return;
    setPracticeId(task.practiceId);
    setAnswers(initialAnswers);
    setActiveAttempt(initialAnswers[1] ? 2 : 1);
    setSubmittedAttempt(initialAnswers[1] ? 2 : initialAnswers[0] ? 1 : undefined);
    setError("");
  }, [initialAnswers, practiceId, task.practiceId]);

  if (!open) {
    const latest = grades.at(-1);
    return (
      <button
        className={`self-retelling-card-action ${latest ? "graded" : "ready"}`}
        type="button"
        aria-label={`開啟自我復述：${task.title}`}
        onClick={onOpen}
      >
        <span className="self-retelling-action-icon" aria-hidden="true">↺</span>
        <span>
          <small>{latest ? "自我復述 · 已回饋" : "自我復述 · 可作答"}</small>
          <strong>{task.title}</strong>
          <em>{latest ? `${latest.scores.total} / 15 · 查看建議` : "開始復述"}</em>
        </span>
        <span aria-hidden="true">→</span>
      </button>
    );
  }

  const answer = answers[activeAttempt - 1];
  const currentGrade = grades.find(({ attempt }) => attempt === activeAttempt);
  const locked = Boolean(currentGrade || submitting || submittedAttempt === activeAttempt);
  const grading = Boolean(!currentGrade && submittedAttempt === activeAttempt);
  const showEditor = !currentGrade &&
    (activeAttempt === 1 ? grades.length === 0 : grades.length === 1);
  const comparison = grades[1]?.comparison;

  async function submit() {
    if (!answer.trim() || locked) return;
    setSubmitting(true);
    setError("");
    try {
      const sent = await onSubmit(formatSelfRetellingSubmission(task, activeAttempt, answer));
      if (sent) setSubmittedAttempt(activeAttempt);
      else setError("復述未送出，內容仍保留，請稍後再試。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "復述未送出，內容仍保留，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="self-retelling-card" aria-label={task.title}>
      <header className="self-retelling-card-heading">
        <div>
          <span>{grades.length ? "AI 復述回饋" : "自我復述"}</span>
          <h2>{task.title}</h2>
          <small>第 {grades.at(-1)?.attempt ?? activeAttempt} 次 · 最多 2 次</small>
          <p>{task.instruction}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="收合自我復述">收合⌃</button>
      </header>

      <div className="self-retelling-card-body">
        {grades.map((grade) => (
          <GradeResult
            key={grade.attempt}
            grade={grade}
            answer={initialAnswers[grade.attempt - 1] || answers[grade.attempt - 1]}
          />
        ))}

        {showEditor ? (
          <section className="self-retelling-editor">
            <label>
              <span className="self-retelling-answer-label">
                <strong>請用自己的話說出這段的重點</strong>
                <small>第 {activeAttempt} 次</small>
              </span>
              <textarea
                rows={9}
                aria-label={`第 ${activeAttempt} 次自我復述`}
                placeholder="不用逐句背誦，試著說清楚核心主張、原因與重要關係…"
                value={answer}
                disabled={locked}
                onChange={(event) => {
                  const value = event.target.value;
                  setAnswers((current) => activeAttempt === 1
                    ? [value, current[1]]
                    : [current[0], value]);
                }}
              />
            </label>
          </section>
        ) : null}

        {grades.length === 2 && comparison ? (
          <section className="self-retelling-comparison">
            <h3>兩次比較</h3>
            <p>{comparison.summary}</p>
            <div>
              <span>{signed(comparison.accuracyDelta)} 正確度</span>
              <span>{signed(comparison.completenessDelta)} 完整度</span>
              <span>{signed(comparison.ownWordsDelta)} 自我表達</span>
              <strong>{signed(comparison.totalDelta)} 總分</strong>
            </div>
          </section>
        ) : null}
      </div>

      <footer className="self-retelling-card-footer">
        <span>{grading || submitting
          ? "AI 正在檢查你的復述…"
          : grades.length === 2
            ? "兩次復述已完成"
            : grades.length === 1 && activeAttempt === 1
              ? "第一次回饋完成，可以再用自己的話說一次。"
              : answer.trim()
                ? "內容已準備好，可以送出回饋。"
                : "先回想，再用自己的話自由復述。"}</span>
        {error ? <small role="alert">{error}</small> : null}
        {grades.length === 1 && activeAttempt === 1 ? (
          <button type="button" onClick={() => {
            setActiveAttempt(2);
            setSubmittedAttempt(undefined);
            setError("");
          }}>再復述一次</button>
        ) : showEditor ? (
          <button type="button" disabled={!answer.trim() || locked} onClick={() => void submit()}>
            {submitting ? "送出中…" : "送出並請 AI 回饋"}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
