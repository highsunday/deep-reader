// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ConceptVideoEditor } from '../src/renderer/ConceptVideoWorkspace';
import type { ConceptVideo, ConceptVideoApi } from '../src/shared/concept-video';
afterEach(cleanup);
const source={bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]};
const draft:ConceptVideo={id:'v',revision:1,createdAt:1,updatedAt:1,status:'draft',versions:[],source,context:[],conflicts:[],discussion:[{id:'a',role:'assistant',text:'觀察曲線的變化。',createdAt:1}],plan:{title:'曲線',goal:'觀察曲線',scenes:[{id:'s',heading:'曲線',visual:'曲線',narration:'變化'}],pace:'normal',narration:false}};
function setup(video?:ConceptVideo) {
  const api={capability:vi.fn(async()=>({aiAllowed:true,generationAllowed:true,narrationAllowed:true,reason:'',engines:{canvas:{available:true,reason:''},remotion:{available:true,reason:''},manim:{available:false,reason:'Install Manim runtime.'}}})),save:vi.fn(async(input:any)=>({...draft,revision:2,plan:input.plan})),create:vi.fn(async(input:any)=>({...draft,plan:{...draft.plan,engine:input.engine}})),requestAi:vi.fn(async()=>draft),generate:vi.fn(async()=>draft),get:vi.fn(),append:vi.fn(),cancel:vi.fn(),media:vi.fn(),poster:vi.fn()} as unknown as ConceptVideoApi;
  render(<ConceptVideoEditor api={api} source={source} initialVideo={video} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}}/>);
  return api;
}
test('E3: default Canvas and four options; pre-creation choice reaches create',async()=>{
  const api=setup();
  const select=screen.getByRole('combobox',{name:'Animation engine'}) as HTMLSelectElement;
  expect(select.value).toBe('canvas');expect(select.options).toHaveLength(4);
  fireEvent.change(select,{target:{value:'remotion'}});
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'解釋曲線'}});
  fireEvent.click(await screen.findByRole('button',{name:'Send'}));
  await waitFor(()=>expect(api.create).toHaveBeenCalledWith({source,question:'解釋曲線',engine:'remotion'}));
});
test('E3: save engine switch and disable generation with selected environment reason',async()=>{
  const api=setup(draft);
  fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'manim'}});
  await waitFor(()=>expect(api.save).toHaveBeenCalledWith(expect.objectContaining({id:'v',baseRevision:1,plan:expect.objectContaining({engine:'manim'})})));
  await screen.findByText('Install Manim runtime.');
  expect((screen.getByRole('button',{name:'Generate video'}) as HTMLButtonElement).disabled).toBe(true);
  expect(api.generate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'canvas'}});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Generate video'}) as HTMLButtonElement).disabled).toBe(false));
});
test('E3: cannot switch while generating',()=>{
  setup({...draft,generation:{id:'g',status:'running',stage:'Rendering'}});
  expect((screen.getByRole('combobox',{name:'Animation engine'}) as HTMLSelectElement).disabled).toBe(true);
});
