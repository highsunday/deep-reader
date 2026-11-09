import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { parseVideoPlan } from '../src/shared/concept-video';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
export const story = [
 { heading: '兩種工作', visual: '同樣收入，不同來源', narration: '約翰在銀行上班，喬治開計程車。他們平均收入相近，收入來源卻不同。', stage: { layout: 'compare', actors: [{ icon: 'office', label: '約翰：一位雇主', motion: 'steady' }, { icon: 'taxi', label: '喬治：許多乘客', motion: 'move' }] } },
 { heading: '遇到衝擊', visual: '收入來源集中時，衝擊也集中', narration: '如果約翰突然失業，固定收入就中斷了。喬治少了一名乘客，仍可能接到其他客人。', stage: { layout: 'compare', actors: [{ icon: 'office', label: '失業，收入中斷', motion: 'fall' }, { icon: 'taxi', label: '少一位，還有其他客人', motion: 'move' }] } },
 { heading: '理解差異', visual: '波動不等於脆弱', narration: '看起來平穩，不代表能承受衝擊。關鍵是收入的來源，以及能不能調整。', stage: { layout: 'focus', actors: [{ icon: 'tree', label: '保留調整空間', motion: 'sway' }] } }
];
function setup() {
 const directory = mkdtempSync(join(tmpdir(), 'story-video-')); directories.push(directory);
 const store = new LocalConceptVideoStore(directory);
 const video = store.create({ source: { bookId:'b',chapterId:'c',bookTitle:'反脆弱',chapterTitle:'比較',range:{start:0,end:2},readingSegment:'約翰領固定薪水，喬治開計程車。',images:[] }, question:'比較兩人' });
 return { store, video, directory };
}
test('B54 V1: summary draft becomes several narrative scenes with voice, preserving discussion and old data', () => {
 const {store,video,directory} = setup();
 const result = store.completeStoryboard({ id:video.id,baseRevision:video.revision,scenes:story });
 expect(result.plan.animation).toBe('story'); expect(result.plan.narration).toBe(true);
 expect(result.plan.scenes).toHaveLength(3); expect(result.discussion).toEqual(video.discussion);
 expect(result.plan.scenes[0].narration).not.toBe(result.plan.goal);
 expect(new LocalConceptVideoStore(directory).get(video.id)).toEqual(result);
});
test('B54 V2/V3: unsafe story data and stale preparation never overwrite the saved draft', () => {
 const {store,video} = setup();
 expect(() => store.completeStoryboard({id:video.id,baseRevision:1,scenes:[{...story[0],stage:{layout:'focus',actors:[{icon:'execute',label:'oops',motion:'move'}]}},...story.slice(1)]})).toThrow();
 expect(store.get(video.id)).toEqual(video);
 store.append({id:video.id,baseRevision:1,question:'換一種說法'});
 expect(() => store.completeStoryboard({id:video.id,baseRevision:1,scenes:story})).toThrow(/changed/);
 expect(store.get(video.id).plan).toEqual(video.plan);
});
test('B54 V2: story template requires executable scenes, not an old text-only plan', () => {
 const {video} = setup();
 expect(() => parseVideoPlan({...video.plan,animation:'story'})).toThrow();
});
test('B54: narration must tell the story, not read the proposal or repeat a static GUI scene', () => {
 const {store,video}=setup();
 for(const scenes of [story.map(s=>({...s,narration:'這支影片將說明兩者差異。'})),story.map(s=>({...s,stage:story[0].stage}))]) {
  expect(()=>store.completeStoryboard({id:video.id,baseRevision:1,scenes})).toThrow(/repeats the summary/);
  expect(store.get(video.id)).toEqual(video);
 }
});
