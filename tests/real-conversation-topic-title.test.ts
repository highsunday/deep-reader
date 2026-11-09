import { test, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateConversationTopicTitle } from '../src/main/conversation-topic-title';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';

test.skipIf(process.env.REAL_TOPIC_TITLES !== '1')('F69 authenticated AI distinguishes identical instructions by actual discussion', async () => {
  const topics = [
    {chapterTitle:'Absurd Creation', readingSegment:'All try their hands at miming, at repeating, and at re-creating the reality that is theirs. Creation is the great mime.', answer:'卡繆把創作比作模仿：創作者以作品重新呈現自己所經驗的現實。'},
    {chapterTitle:'Feedback Loops', readingSegment:'A balancing feedback loop opposes change and stabilizes a system. A reinforcing feedback loop amplifies change.', answer:'負回饋會抵銷變化，像恆溫器；正回饋則放大變化，像利息累積。'}
  ];
  const results = [];
  for (const [i, topic] of topics.entries()) {
    const title = await generateConversationTopicTitle({source:{bookTitle:i===0?'The Myth of Sisyphus':'Thinking in Systems',chapterTitle:topic.chapterTitle}, messages:[
      {role:'user',text:'請改寫成白話容易理解的語氣與修辭',readingSegment:topic.readingSegment},
      {role:'assistant',text:topic.answer}
    ]},{createClient:()=>new SpawnedCodexAppServerClient(),workingDirectory:process.cwd()},new AbortController().signal);
    expect(title.length).toBeGreaterThan(3); expect([...title].length).toBeLessThanOrEqual(40);
    results.push({chapter:topic.chapterTitle,title});
  }
  expect(results[0].title).not.toBe(results[1].title);
  expect(results[0].title).toMatch(/創作|現實|模仿/);
  expect(results[1].title).toMatch(/回饋|放大|穩定/);
  const dir=join(process.cwd(),'reports/f69-topic-titles'); mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'real-ai-titles.json'),JSON.stringify({date:'2026-10-20',results},null,2));
},180_000);
