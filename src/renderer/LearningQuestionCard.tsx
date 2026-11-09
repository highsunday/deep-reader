import type { ReadingSourceSnapshot } from '../shared/contracts';
import { useEffect, useState } from "react";
import { formatLearningQuestionSubmission } from "./learning-question-artifact";
import type {
  LearningQuestionAnswers,
  LearningQuestionGrade,
  LearningQuestionQuiz,
  LearningQuestionResult
} from "./learning-question-artifact";

interface LearningQuestionCardProps {
  open: boolean;
  quiz: LearningQuestionQuiz;
  grade?: LearningQuestionGrade;
  initialAnswers?: LearningQuestionAnswers;
  onOpen(): void;
  onClose(): void;
  source?: ReadingSourceSnapshot;
  disabled?: boolean;
  hinted?: string[];
  afterCoaching?: boolean;
  onHint?(text: string): Promise<boolean> | boolean;
  onGuide?(text: string): Promise<boolean> | boolean;
  onSubmit(text: string): Promise<boolean> | boolean;
}

const LEVEL_LABELS = {
  basic: "基本理解",
  relationship: "關聯探索",
  application: "實際應用",
  synthesis: "統整思考",
  core: "核心問題"
} as const;

function Rubric({ result, modern = false, assisted = false }: { result: LearningQuestionResult; modern?: boolean; assisted?: boolean }) {
  const rows = [
    ["重點掌握", result.scores.focus],
    ["概念正確", result.scores.correctness],
    ["自己的話", result.scores.ownWords],
    ["舉例或延伸", result.scores.exampleOrExtension]
  ] as const;
  return (
    <aside className="learning-question-feedback">
      {modern ? <p><strong>{result.assessment === "unverified" ? "尚未驗證" : assisted ? "有提示 · 仍需獨立驗證" : result.assessment === "independent" ? "已獨立掌握" : "需要補強"}</strong></p> : <>
      <div className="learning-question-score">
        <span>本題得分</span><strong>{result.total} / 100</strong>
      </div>
      <div className="learning-question-rubric">
        {rows.map(([label, score]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{score.score} / {score.max}</strong>
            <p>{score.reason}</p>
          </div>
        ))}
      </div>
      </>}
      <p><strong>做得好</strong>{result.feedback}</p>
      <p><strong>具體改善</strong>{result.improvement}</p>
      <div className="learning-question-revision">
        <strong>AI 修改示範</strong>
        <p>{result.revisedAnswer}</p>
      </div>
    </aside>
  );
}

export function LearningQuestionCard({
  open,
  quiz,
  grade,
  initialAnswers = {},
  onOpen,
  onClose,
  onSubmit,
  source, disabled = false, hinted = [], afterCoaching = false, onHint, onGuide
}: LearningQuestionCardProps) {
  const [answers, setAnswers] = useState<LearningQuestionAnswers>(initialAnswers);
  const [answerQuizId, setAnswerQuizId] = useState(quiz.quizId);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const modern = quiz.version === 2;
  const label = modern ? "小考" : "理解測驗";
  async function action(handler: ((text: string) => Promise<boolean> | boolean) | undefined, text: string) {
    if (!handler || disabled || pendingAction) return;
    setPendingAction(true); setError("");
    try { if (!await handler(text)) setError("未送出，請稍後再試。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "未送出，請重試。"); }
    finally { setPendingAction(false); }
  }

  useEffect(() => {
    if (answerQuizId === quiz.quizId) return;
    setAnswerQuizId(quiz.quizId);
    setAnswers(initialAnswers);
    setSubmitted(false);
    setError("");
  }, [answerQuizId, initialAnswers, quiz.quizId]);

  useEffect(() => {
    if (modern && submitted && !disabled && !grade) {
      setSubmitted(false);
      setError("尚未收到有效批改；若回答已停止，可重新送出。");
    }
  }, [modern, submitted, disabled, grade]);

  if (!open) {
    return (
      <button
        className={`learning-question-card-action ${grade ? "graded" : "ready"}`}
        type="button"
        aria-label={`開啟${label}：${quiz.title}`}
        onClick={onOpen}
      >
        <span className="learning-question-action-icon" aria-hidden="true">▧</span>
        <span>
          <small>{`${label} · ${grade ? "已批改" : "可作答"}`}</small>
          <strong>{quiz.title}</strong>
          <em>{quiz.questions.length} 題 · {grade ? modern ? "查看理解評估" : `${grade.summary.average} 分 · 查看批改` : "開始作答"}</em>
        </span>
        <span aria-hidden="true">→</span>
      </button>
    );
  }

  const unanswered = quiz.questions.filter(({ id }) => !answers[id]?.trim()).length;
  const answered = quiz.questions.length - unanswered;
  const progressValue = grade ? quiz.questions.length : answered;
  const locked = Boolean(grade || submitted || submitting || disabled || pendingAction);
  const groups = [
    ...quiz.themes.map((theme) => ({
      id: theme.id,
      title: theme.title,
      summary: theme.summary,
      questions: quiz.questions.filter(({ themeId }) => themeId === theme.id)
    })),
    {
      id: "core",
      title: "核心問題",
      summary: "從第一性原理統整並內化這段內容",
      questions: quiz.questions.filter(({ themeId }) => themeId === "core")
    }
  ].filter(({ questions }) => questions.length);

  async function submit() {
    if (unanswered || locked) return;
    setSubmitting(true);
    setError("");
    try {
      const sent = await onSubmit(formatLearningQuestionSubmission(quiz, answers, hinted));
      if (sent) setSubmitted(true);
      else setError("測驗未送出，答案仍保留，請稍後再試。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "測驗未送出，答案仍保留，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="learning-question-card" aria-label={quiz.title}>
      <header className="learning-question-card-heading">
        <div>
          <span>{grade ? "AI 逐題批改" : label}</span>
          <h2>{quiz.title}</h2>
          <small>{quiz.questions.length} 題 · {quiz.themes.length} 個主題</small>
        </div>
        <button type="button" onClick={onClose} aria-label="收合理解測驗">收合⌃</button>
      </header>

      {modern && source ? <details className="quiz-source"><summary>原小考來源 · {source.bookTitle} / {source.chapterTitle}</summary><p>{source.readingSegment}</p></details> : null}
      {modern ? <p className="quiz-assessment-notice">{afterCoaching ? "本次引導後的小考 · " : ""}先獨立作答，全部提交後再查看講解。可以跳過或回答不知道；索取提示的題目會標示為有提示。{afterCoaching ? " 本次結果不代表長期記憶。" : ""}</p> : null}
      <div className="learning-question-progress">
        <div>
          <span>試卷進度</span>
          <strong>{grade
            ? `已批改 ${quiz.questions.length} / ${quiz.questions.length}`
            : `已回答 ${answered} / ${quiz.questions.length}`}</strong>
        </div>
        <progress
          aria-label="理解試卷進度"
          max={quiz.questions.length}
          value={progressValue}
        />
      </div>

      {grade ? (
        <section className="learning-question-summary">
          {modern ? <h3>本次理解評估</h3> : <div><span>平均分數</span><strong>{grade.summary.average}</strong></div>}
          <p>{grade.summary.encouragement}</p>
          <div><strong>掌握良好</strong>{grade.summary.strengths.map((item) => <span key={item}>{item}</span>)}</div>
          <div><strong>下一步</strong>{grade.summary.nextSteps.map((item) => <span key={item}>{item}</span>)}</div>
        </section>
      ) : null}

      <div className="learning-question-card-body">
        {groups.map((group) => (
          <section className="learning-question-group" key={group.id}>
            <header><span>{group.id === "core" ? "統整" : "主題"}</span><h3>{group.title}</h3><p>{group.summary}</p></header>
            {group.questions.map((question) => {
              const result = grade?.results.find(({ id }) => id === question.id);
              return (
                <article className="learning-question-item" key={question.id}>
                  <div className="learning-question-prompt">
                    <span>{question.number}</span>
                    <div><small>{LEVEL_LABELS[question.level]}</small><p>{question.prompt}</p></div>
                  </div>
                  <label className="learning-question-answer">
                    <span className="learning-question-answer-label">
                      <strong>你的回答</strong>
                      <small>第 {question.number} 題</small>
                    </span>
                    <textarea
                      rows={5}
                      aria-label={`第 ${question.number} 題答案`}
                      placeholder="請用自己的話回答…"
                      value={answers[question.id] ?? ""}
                      disabled={locked}
                      onChange={(event) => setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value
                      }))}
                    />
                  </label>
                  {modern && hinted.includes(question.id) ? <p className="quiz-hint-status">有提示 · 不列為獨立掌握</p> : null}
                  {modern && !grade ? <div className="quiz-question-actions">
                    <button type="button" disabled={locked} onClick={() => setAnswers(current => ({...current, [question.id]: '跳過（尚未驗證）'}))}>跳過第 {question.number} 題</button>
                    {onHint ? <button type="button" disabled={locked} onClick={() => void action(onHint, `$hint-learning-question-quiz\nQuiz ID: ${quiz.quizId}\nQuestion ID: ${question.id}\n請只給這一題一個小提示。`)}>第 {question.number} 題提示</button> : null}
                  </div> : null}
                  {result ? <Rubric result={result} modern={modern} assisted={hinted.includes(question.id)} /> : null}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      <footer className="learning-question-card-footer">
        <span>{grade
          ? "批改完成 · 答案已鎖定"
          : submitted || submitting
            ? "AI 正在逐題批改…"
            : unanswered
              ? `還有 ${unanswered} 題未回答`
              : "已完成全部題目，可以送出批改。"}</span>
        {error ? <small role="alert">{error}</small> : null}
        {grade && modern && onGuide && grade.results.some(r => r.assessment !== 'independent' || hinted.includes(r.id)) ? (
          <button type="button" disabled={disabled || pendingAction} onClick={() => void action(onGuide, `$guide-learning-question-quiz\nQuiz ID: ${quiz.quizId}\n請針對這次小考需要補強或尚未驗證的部分引導學習，沿用我的回答，不重做完整前測。`)}>針對錯題引導學習</button>
        ) : null}
        {!grade ? (
          <button type="button" disabled={Boolean(unanswered) || locked} onClick={() => void submit()}>
            {submitting ? "送出中…" : "送出並請 AI 批改"}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
