// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ConceptVideoEditor } from '../src/renderer/ConceptVideoWorkspace';
import { VIDEO_ENGINES, type ConceptVideo, type ConceptVideoApi } from '../src/shared/concept-video';
afterEach(cleanup);
const draft:ConceptVideo={id:'origin',revision:2,createdAt:1,updatedAt:1,status:'draft',versions:[],source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},context:[],conflicts:[],discussion:[{id:'a',role:'assistant',text:'觀察曲線的變化。',createdAt:1}],plan:{title:'曲線',goal:'觀察曲線',engine:'remotion',scenes:[{id:'s',heading:'曲線',visual:'曲線',narration:'變化'}],pace:'normal',narration:false}};
function setup(missing=false,initial=draft){
 const running={...draft,revision:3,comparison:{videoIds:['canvas','remotion','manim']},generation:{id:'g',status:'running',stage:'1/3 · Generating Canvas comparison video…'}} as ConceptVideo;
 const api={capability:vi.fn(async()=>({aiAllowed:true,generationAllowed:true,reason:'',engines:Object.fromEntries(VIDEO_ENGINES.map(e=>[e,{available:!missing||e!=='manim',reason:e==='manim'&&missing?'Install Manim runtime.':''}]))})),compare:vi.fn(async()=>running),get:vi.fn(async(id:string)=>id==='origin'?running:{...draft,id,plan:{...draft.plan,engine:id},generation:{id:'g',status:'running',stage:'Waiting for engine comparison'}}),media:vi.fn(),cancel:vi.fn(),save:vi.fn()} as unknown as ConceptVideoApi;
 render(<ConceptVideoEditor api={api} initialVideo={initial} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}}/>);
 return api;
}
test('TC5: comparison button generates from saved revision and keeps selected engine',async()=>{
 const api=setup();fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'all'}});const button=await screen.findByRole('button',{name:'Generate video'});
 await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));fireEvent.click(button);
 await waitFor(()=>expect(api.compare).toHaveBeenCalledWith({id:'origin',baseRevision:2}));
 expect((screen.getByRole('combobox',{name:'Animation engine'}) as HTMLSelectElement).value).toBe('all');
 await screen.findByRole('region',{name:'Engine comparison results'});expect(api.save).not.toHaveBeenCalled();
 expect((button as HTMLButtonElement).disabled).toBe(true);
});
test('TC5: missing engine and unsent changes disable comparison',async()=>{
 setup(true);fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'all'}});const button=await screen.findByRole('button',{name:'Generate video'});
 await screen.findByText('Manim: Install Manim runtime.');expect((button as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'remotion'}});
 expect((button as HTMLButtonElement).disabled).toBe(false);
 expect(screen.queryByText('Manim: Install Manim runtime.')).toBeNull();
 cleanup();setup();fireEvent.change(screen.getByRole('combobox',{name:'Animation engine'}),{target:{value:'all'}});await waitFor(()=>expect((screen.getByRole('button',{name:'Generate video'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'還沒送出的構想'}});expect((screen.getByRole('button',{name:'Generate video'}) as HTMLButtonElement).disabled).toBe(true);
});
test('TC2: reopening comparison retrieves all three saved players and handles missing result',async()=>{
 const initial={...draft,comparison:{videoIds:['canvas','remotion','manim']},generation:{id:'g',status:'completed',stage:'All three comparison videos generated'}} as ConceptVideo;
 const api={capability:async()=>({aiAllowed:true,generationAllowed:true,reason:''}),get:vi.fn(async(id:string)=>{if(id==='remotion')throw Error('Video not found.');return {...draft,id,status:'completed',plan:{...draft.plan,engine:id},versions:[{id:'version-'+id,createdAt:1,plan:{...draft.plan,engine:id},durationSeconds:3,bytes:2,scenes:[]}],currentVersionId:'version-'+id,generation:{id:'g',status:'completed',stage:'Video generated'}};}),media:vi.fn(async()=>new Uint8Array([1,2]))} as unknown as ConceptVideoApi;
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 render(<ConceptVideoEditor api={api} initialVideo={initial} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}}/>);
 const panel=await screen.findByRole('region',{name:'Engine comparison results'});
 await waitFor(()=>expect(within(panel).getAllByLabelText('Video preview: 曲線')).toHaveLength(2));
 expect(within(panel).getByText('Video not found.')).toBeTruthy();expect(api.get).toHaveBeenCalledTimes(3);
 cleanup();create.mockRestore();revoke.mockRestore();
});
test('selector discovery: fresh video offers all engines and explains required discussion',async()=>{
 const api={capability:async()=>({aiAllowed:true,generationAllowed:true,reason:''})} as unknown as ConceptVideoApi;
 render(<ConceptVideoEditor api={api} source={draft.source} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}}/>);
 const select=screen.getByRole('combobox',{name:'Animation engine'});
 expect(within(select).getByRole('option',{name:'general all (test)'})).toBeTruthy();
 fireEvent.change(select,{target:{value:'all'}});
 expect(screen.queryByRole('button',{name:'Generate video'})).toBeNull();
 expect(screen.getByText('Discuss your idea with AI first. This test becomes available after AI describes the video.')).toBeTruthy();
});
test('B58 T3: failed comparison exposes engine-only retry with saved child revision',async()=>{
 const original={...draft,comparison:{videoIds:['canvas','remotion','manim']},generation:{id:'g',status:'failed',stage:'Comparison finished with errors'}} as ConceptVideo;
 const changed=vi.fn();
 const api={capability:async()=>({aiAllowed:true,generationAllowed:true,reason:''}),get:vi.fn(async(id:string)=>({...draft,id,revision:8,plan:{...draft.plan,engine:id},generation:{id:'g',status:id==='canvas'?'failed':'completed',stage:'Generation failed',error:id==='canvas'?'seventy is not defined':undefined}})),generate:vi.fn(async()=>({...draft,id:'canvas',revision:9,generation:{id:'retry',status:'running',stage:'AI is repairing'}})),media:vi.fn()} as unknown as ConceptVideoApi;
 render(<ConceptVideoEditor api={api} initialVideo={original} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}} onChanged={changed}/>);
 const button=await screen.findByRole('button',{name:'Retry Canvas'});fireEvent.click(button);
 await waitFor(()=>expect(api.generate).toHaveBeenCalledWith({id:'canvas',baseRevision:8}));expect(api.generate).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledWith(expect.objectContaining({id:'canvas'}));
});
test('B58 T3: independent comparison retry can be cancelled from original editor',async()=>{
 const original={...draft,comparison:{videoIds:['canvas','remotion','manim']},generation:{id:'g',status:'failed',stage:'Initial comparison failed'}} as ConceptVideo;
 let active=true;
 const child=(id:string)=>({...draft,id,revision:9,generation:{id:'retry',status:id==='canvas'&&active?'running':'completed',stage:'Rendering'}} as ConceptVideo);
 const api={capability:async()=>({aiAllowed:true,generationAllowed:true,reason:''}),get:vi.fn(async(id:string)=>child(id)),cancel:vi.fn(async(id:string)=>{active=false;return {...child(id),generation:{id:'retry',status:'cancelled',stage:'Cancelled'}};})} as unknown as ConceptVideoApi;
 render(<ConceptVideoEditor api={api} initialVideo={original} sourceAvailable onBack={()=>{}} onOpenLibrary={()=>{}} onSource={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Cancel Canvas retry'}));await waitFor(()=>expect(api.cancel).toHaveBeenCalledWith('canvas'));
});
