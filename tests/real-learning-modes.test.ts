import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatController } from '../src/main/chat-controller';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
import { learningQuestionArtifacts, formatLearningQuestionSubmission } from '../src/shared/learning-question-artifact';
import type { SendChatMessageInput } from '../src/shared/contracts';

test.skipIf(process.env.REAL_LEARNING_MODES !== '1')('F71 real AI: coach -> independent quiz -> hint/skip -> grading -> targeted guidance', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'f71-real-'));const client=new SpawnedCodexAppServerClient();
 const controller=new ChatController({createClient:()=>client,workingDirectory:dir});
 const source={bookTitle:'自造測試教材',chapterTitle:'恢復與增強',readingSegment:'恢復原狀，是受到衝擊後回到原先水準。增強則是在適量刺激與休息後建立超過原先需求、之後仍能使用的額外能力。這份額外能力可應對更大需求。並非所有壓力都能增強能力；過大刺激或缺乏休息可能造成傷害。只是熬夜把事情做完，不能證明留下額外能力。'};
 let model:string|undefined;const turns:unknown[]=[];
 async function send(input:SendChatMessageInput){
  await controller.sendMessage({...input,model});
  await expect.poll(()=>controller.getSnapshot().activeTurnId,{timeout:150000,interval:500}).toBeNull();
  const m=controller.getSnapshot().messages.findLast(m=>m.role==='assistant');expect(m?.status).toBe('completed');
  turns.push({input,answer:m!.text});mkdirSync('reports/f71-learning-modes',{recursive:true});writeFileSync('reports/f71-learning-modes/real-model.json',JSON.stringify({model,turns},null,2));return m!.text;
 }
 try{
  const state=await controller.connect();expect(state.connection).toBe('ready');model=state.models?.find(m=>m.isDefault)?.id??state.models?.[0]?.id;
  const first=await send({text:'開始引導學習',intent:'readingCoach',context:source});expect(first).not.toContain('```learning-question-quiz');
  const q=await send({text:'現在改做小考，使用未講解的新題。',intent:'learningQuestionQuiz',context:source});
  const quiz=learningQuestionArtifacts([{role:'assistant',text:q}]).quiz;expect(quiz?.version).toBe(2);expect(quiz!.questions.length).toBeLessThanOrEqual(3);expect(q).toContain('引導後');
  const question=quiz!.questions[0];
  const hint=await send({text:`$hint-learning-question-quiz\nQuiz ID: ${quiz!.quizId}\nQuestion ID: ${question.id}\n請給這一題一個小提示。`});expect(hint).not.toContain('```learning-question-grade');
  const answers=Object.fromEntries(quiz!.questions.map((q,i)=>[q.id,i===0?'恢復就是變強，所以壓力越大越好。':'跳過（尚未驗證）']));
  await send({text:formatLearningQuestionSubmission(quiz!,answers,[question.id])});
  const grade=learningQuestionArtifacts(controller.getSnapshot().messages).grade;expect(grade?.version).toBe(2);expect(grade!.results[0].assessment).not.toBe('independent');
  for(const r of grade!.results.filter(r=>r.id!==question.id))expect(r.assessment).toBe('unverified');
  const guide=await send({text:`$guide-learning-question-quiz\nQuiz ID: ${quiz!.quizId}\n針對錯題引導學習。`});expect(guide).not.toContain('```learning-question-quiz');expect(guide).toMatch(/恢復|壓力|刺激/);
 }finally{const id=controller.getSnapshot().threadId;if(id)await client.request('thread/archive',{threadId:id}).catch(()=>{});controller.close();rmSync(dir,{recursive:true,force:true});}
},900000);
