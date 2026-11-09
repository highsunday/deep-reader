// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ReadingSegmentShortcutBar, ChatMessageList } from '../src/renderer/App';
import { learningQuestionArtifacts } from '../src/renderer/learning-question-artifact';
import { LearningQuestionCard } from '../src/renderer/LearningQuestionCard';
import { composeCodexInput } from '../src/main/chat-controller';
import { readingCoachTurnInstructions } from '../src/shared/reading-coach';
import type { ChatMessage } from '../src/shared/contracts';
afterEach(cleanup);
export const quiz = {version:2 as const,kind:'quiz' as const,quizId:'quiz-v2',title:'理解小考',themes:[{id:'t',title:'核心概念',summary:'獨立作答'}],questions:[{id:'q1',number:1,themeId:'t',level:'basic' as const,prompt:'說明概念差異。'},{id:'q2',number:2,themeId:'t',level:'application' as const,prompt:'用新情境說明。'}]};
const props = {disabled:false,onGenerateGuide:vi.fn(),onExplainReadingSegment:vi.fn(),onStartReadingCoach:vi.fn(),onStartLearningQuestionQuiz:vi.fn(),onStartSelfRetelling:vi.fn(),onCreateReadingNote:vi.fn()};
test('F71 TC1: separate clear entrances without Explain',()=>{
 render(<ReadingSegmentShortcutBar {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Guided Learning'}));expect(props.onStartReadingCoach).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'Take a Quiz'}));expect(props.onStartLearningQuestionQuiz).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:'Retell'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Explain'})).toBeNull();
});
test('F71 TC3: version 2 supports short quizzes without compulsory core questions',()=>{
 expect(learningQuestionArtifacts([{role:'assistant',text:'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```'}]).quiz).toEqual(quiz);
 expect(learningQuestionArtifacts([{role:'assistant',text:'```learning-question-quiz\n'+JSON.stringify({...quiz,version:1})+'\n```'}]).quiz).toBeUndefined();
});
test('F71 TC4: a skipped answer can be submitted, no answers shown first',async()=>{
 const submit=vi.fn((_text: string)=>true);
 render(<LearningQuestionCard open quiz={quiz} onOpen={()=>{}} onClose={()=>{}} onSubmit={submit}/>);
 fireEvent.change(screen.getByLabelText('第 1 題答案'),{target:{value:'我的理解'}});
 fireEvent.click(screen.getByRole('button',{name:'跳過第 2 題'}));
 fireEvent.click(screen.getByRole('button',{name:'送出並請 AI 批改'}));
 await vi.waitFor(()=>expect(submit).toHaveBeenCalledOnce());
 expect(submit.mock.calls[0]?.[0]).toContain('尚未驗證');
 expect(screen.queryByText('AI 修改示範')).toBeNull();
});
test('F71 TC2/3: coach integrates prepared rubrics; quiz is separate independent assessment',()=>{
 const source={bookTitle:'書',chapterTitle:'章',readingSegment:'原文'};
 const coach=readingCoachTurnInstructions({id:'u',turnId:'t',role:'user',text:'開始',status:'completed',readingSource:source} as ChatMessage);
 expect(coach).toContain('題目專屬');expect(coach).toContain('未曝光');
 const request=composeCodexInput({text:'小考',intent:'learningQuestionQuiz',context:source});
 expect(request).toContain('version 2');expect(request).not.toContain('3–5 core');
});

test('F71 TC4/5: hint evidence is visible and guidance happens only on click; failed handoff retries',async()=>{
 const {quizSession}=await import('../src/shared/quiz-workflow');
 const source={bookTitle:'原書',chapterTitle:'原章',readingSegment:'原區段'};
 const messages:ChatMessage[]=[{id:'u',turnId:'t',role:'user',status:'completed',intent:'learningQuestionQuiz',text:'小考',readingSource:source},{id:'a',turnId:'t',role:'assistant',status:'completed',text:'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```'},{id:'h',turnId:'h',role:'user',status:'completed',text:'$hint-learning-question-quiz\nQuiz ID: quiz-v2\nQuestion ID: q1',readingSource:source}];
 expect(quizSession(messages)?.hinted).toEqual(['q1']);
 const grade={version:2 as const,kind:'grade' as const,quizId:quiz.quizId,results:quiz.questions.map(q=>({id:q.id,assessment:'independent' as const,total:100,scores:{focus:{score:40,max:40 as const,reason:'充分'},correctness:{score:30,max:30 as const,reason:'正確'},ownWords:{score:15,max:15 as const,reason:'自行表達'},exampleOrExtension:{score:15,max:15 as const,reason:'有例子'}},feedback:'理解差別',improvement:'換新題驗證',revisedAnswer:'示範答案'})),summary:{average:100,strengths:['理解差別'],nextSteps:['新題'],encouragement:'繼續'}};
 const guide=vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
 render(<LearningQuestionCard open quiz={quiz} grade={grade} hinted={['q1']} onGuide={guide} onOpen={()=>{}} onClose={()=>{}} onSubmit={()=>true}/>);
 expect(screen.getByText('有提示 · 仍需獨立驗證')).toBeTruthy();expect(guide).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'針對錯題引導學習'}));
 await vi.waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'針對錯題引導學習'}));
 await vi.waitFor(()=>expect(guide).toHaveBeenCalledTimes(2));
 expect(guide.mock.calls[1][0]).toContain('Quiz ID: quiz-v2');
});
test('F71 TC6: active independent quiz suppresses leaked composer answer suggestions',async()=>{
 const {readingSuggestions}=await import('../src/shared/reading-input-suggestion');
 const source={bookTitle:'書',chapterTitle:'章',readingSegment:'區段'};
 const messages:ChatMessage[]=[{id:'u',turnId:'t',role:'user',status:'completed',intent:'learningQuestionQuiz',text:'小考',readingSource:source},{id:'a',turnId:'t',role:'assistant',status:'completed',text:'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```\n```reading-input-suggestion\n{"repeat":null,"followUp":"洩漏答案"}\n```'}];
 expect(readingSuggestions(messages,source)).toEqual({repeat:'',followUp:''});
});

test('F71 TC4: malformed or stopped grading can be retried once the turn ends', async()=>{
 const submit=vi.fn((_text:string)=>true);const base={open:true,quiz,onOpen:()=>{},onClose:()=>{},onSubmit:submit,initialAnswers:{q1:'回答',q2:'不知道'}};
 const view=render(<LearningQuestionCard {...base}/>);
 fireEvent.click(screen.getByRole('button',{name:'送出並請 AI 批改'}));
 await vi.waitFor(()=>expect(submit).toHaveBeenCalledOnce());
 view.rerender(<LearningQuestionCard {...base} disabled/>);
 view.rerender(<LearningQuestionCard {...base} disabled={false}/>);
 await vi.waitFor(()=>expect((screen.getByRole('button',{name:'送出並請 AI 批改'}) as HTMLButtonElement).disabled).toBe(false));
});

test('F71 J2/J3: multiple quiz cards remain accessible and protocol messages stay human-readable',()=>{
 const source={bookTitle:'原始測試書',chapterTitle:'原始章節',readingSegment:'原文'};
 const messages:ChatMessage[]=[
  {id:'u1',turnId:'t1',role:'user',status:'completed',text:'小考',intent:'learningQuestionQuiz',readingSource:source},
  {id:'a1',turnId:'t1',role:'assistant',status:'completed',text:'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```'},
  {id:'h1',turnId:'t2',role:'user',status:'completed',text:'$hint-learning-question-quiz\nQuiz ID: quiz-v2\nQuestion ID: q1\n給提示',readingSource:source},
  {id:'u2',turnId:'t3',role:'user',status:'completed',text:'小考',intent:'learningQuestionQuiz',readingSource:source},
  {id:'a2',turnId:'t3',role:'assistant',status:'completed',text:'```learning-question-quiz\n'+JSON.stringify({...quiz,quizId:'second',title:'第二次小考'})+'\n```'}
 ];
 render(<ChatMessageList messages={messages} activeTurnId={null}/>);
 expect(screen.getByRole('button',{name:'開啟小考：理解小考'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'開啟小考：第二次小考'})).toBeTruthy();
 expect(screen.getByText('已要求第 1 題提示 · 理解小考')).toBeTruthy();
 expect(screen.queryByText(/\$hint-learning-question-quiz/)).toBeNull();
});

test('F71 U03: offline disables result guidance and question actions',()=>{
 const source={bookTitle:'書',chapterTitle:'章',readingSegment:'原文'};
 const result={id:'q',assessment:'needs-guidance',scores:{focus:{score:0,max:40,reason:'錯誤'},correctness:{score:0,max:30,reason:'錯誤'},ownWords:{score:0,max:15,reason:'未答'},exampleOrExtension:{score:0,max:15,reason:'未答'}},total:0,feedback:'待釐清',improvement:'先釐清',revisedAnswer:'解釋'};
 const grade={version:2,kind:'grade',quizId:quiz.quizId,results:quiz.questions.map(q=>({...result,id:q.id})),summary:{average:0,strengths:[],nextSteps:['釐清'],encouragement:'繼續'}};
 const messages:ChatMessage[]=[{id:'u',turnId:'t',role:'user',status:'completed',intent:'learningQuestionQuiz',text:'小考',readingSource:source},{id:'a',turnId:'t',role:'assistant',status:'completed',text:'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```'},{id:'g',turnId:'g',role:'assistant',status:'completed',text:'```learning-question-grade\n'+JSON.stringify(grade)+'\n```'}];
 render(<ChatMessageList messages={messages} activeTurnId={null} actionsDisabled/>);
 fireEvent.click(screen.getByRole('button',{name:'開啟小考：理解小考'}));
 expect((screen.getByRole('button',{name:'針對錯題引導學習'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText('原小考來源 · 書 / 章')).toBeTruthy();
});
