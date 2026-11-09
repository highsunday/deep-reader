// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  HeptabaseImportAction,
  HeptabaseImportProvider,
  HeptabaseImportPanel,
} from "../src/renderer/HeptabaseImport";
import type {
  HeptabaseImportApi,
  HeptabaseImportBatch,
} from "../src/shared/heptabase-import";
beforeEach(() => {
 const values = new Map<string,string>();
 Object.defineProperty(window, 'localStorage', { configurable:true, value: { getItem:(key:string)=>values.get(key)??null, setItem:(key:string,value:string)=>values.set(key,value), removeItem:(key:string)=>values.delete(key), clear:()=>values.clear() } });
});
afterEach(cleanup);
test("F79 shared single/batch controls lock together and expose partial results, retry and reopen", async () => {
  let current: HeptabaseImportBatch | undefined;
  const api: HeptabaseImportApi = {
    get: vi.fn(async () => current),
    start: vi.fn(async () => {
      current = {
        id: "b",
        running: true,
        items: [{ noteId: "n", title: "A note", status: "importing" }],
      };
      return current;
    }),
    retry: vi.fn(async () => {
      current = {
        ...current!,
        items: [{ noteId: "n", title: "A note", status: "created" }],
      };
      return current;
    }),
  };
  render(
    <HeptabaseImportProvider api={api}>
      <HeptabaseImportAction api={api} noteIds={["n"]} />
      <HeptabaseImportAction api={api} noteIds={["x"]} />
      <HeptabaseImportPanel />
    </HeptabaseImportProvider>,
  );
  await waitFor(() =>
    expect(
      (
        screen.getAllByRole("button", {
          name: "Import to Heptabase",
        })[0] as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Import to Heptabase" })[0]!,
  );
  await screen.findByText(/Importing 0 \/ 1/);
  expect(
    screen
      .getAllByRole("button", { name: "Import to Heptabase" })
      .every((b) => (b as HTMLButtonElement).disabled),
  ).toBe(true);
  current = {
    id: "b",
    running: false,
    items: [
      {
        noteId: "n",
        title: "A note",
        status: "failed",
        message: "Missing image",
      },
    ],
  };
  fireEvent.click(screen.getByRole("button", { name: "Expand Heptabase import activity" }));
  await screen.findByText("Missing image");
  fireEvent.click(screen.getByRole("button", { name: "Retry failed items" }));
  await screen.findByText(/^1 imported ·/);
  expect(api.retry).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss Heptabase import notifications" }),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "View Heptabase import results" })[0]!,
  );
  expect(screen.getByText(/^1 imported ·/)).toBeDefined();
});

test('F79 uses the card-pool activity summary, initially collapsed, with a labeled result disclosure',async()=>{
 const batch:HeptabaseImportBatch={id:'format',running:false,items:[{noteId:'n',title:'Imported title',status:'created'}]};
 const api:HeptabaseImportApi={get:vi.fn(async()=>batch),start:vi.fn(async()=>batch),retry:vi.fn(async()=>batch)};
 const {container}=render(<HeptabaseImportAction api={api} noteIds={['n']}/>);
 const toggle=await screen.findByRole('button',{name:'Expand Heptabase import activity'});
 expect(toggle.getAttribute('aria-expanded')).toBe('false');expect(screen.queryByRole('region',{name:'Heptabase import results'})).toBeNull();
 expect(document.querySelector('.card-pool-upload .memory-image-activity-row')).toBeTruthy();
 fireEvent.click(toggle);expect(screen.getByRole('region',{name:'Heptabase import results'})).toBeDefined();
 expect(screen.getByText('Imported title')).toBeDefined();
 fireEvent.keyDown(screen.getByRole('complementary',{name:'Heptabase import'}),{key:'Escape'});
 expect(screen.queryByRole('region',{name:'Heptabase import results'})).toBeNull();expect(document.activeElement).toBe(toggle);
});

test('F79 running notifications can be dismissed without stopping the import and stay dismissed after polling',async()=>{
 let batch:HeptabaseImportBatch={id:'running-dismiss',running:true,items:[{noteId:'n',title:'Still importing',status:'importing'}]};
 const api:HeptabaseImportApi={get:vi.fn(async()=>structuredClone(batch)),start:vi.fn(async()=>batch),retry:vi.fn(async()=>batch)};
 render(<HeptabaseImportAction api={api} noteIds={['n']}/>);
 const dismiss=await screen.findByRole('button',{name:'Dismiss Heptabase import notifications'});
 expect((dismiss as HTMLButtonElement).disabled).toBe(false);fireEvent.click(dismiss);
 expect(screen.queryByRole('button',{name:'Expand Heptabase import activity'})).toBeNull();
 await waitFor(()=>expect(api.get).toHaveBeenCalledTimes(2));
 expect(screen.queryByRole('button',{name:'Expand Heptabase import activity'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'View Heptabase import results'}));
 expect(screen.getByText('Still importing')).toBeDefined();expect(api.start).not.toHaveBeenCalled();expect(api.retry).not.toHaveBeenCalled();
 batch={...batch,running:false,items:[{noteId:'n',title:'Still importing',status:'created'}]};
 await screen.findByText(/^1 imported ·/);
});

test('F79 dismissal survives moving results from the note dialog back to the global stack',async()=>{
 const dialog=document.createElement('section');dialog.className='reading-note-editor-dialog';document.body.append(dialog);
 const batch:HeptabaseImportBatch={id:'portal-dismiss',running:true,items:[{noteId:'n',title:'In progress',status:'importing'}]};
 const api:HeptabaseImportApi={get:vi.fn(async()=>batch),start:vi.fn(async()=>batch),retry:vi.fn(async()=>batch)};
 render(<HeptabaseImportProvider api={api}><HeptabaseImportAction api={api} noteIds={['n']}/><HeptabaseImportPanel/></HeptabaseImportProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Dismiss Heptabase import notifications'}));
 expect(screen.getByRole('button',{name:'View Heptabase import results'})).toBeDefined();
 dialog.remove();
 await waitFor(()=>expect(document.body.querySelector('.heptabase-import-results')).toBeNull());
 expect(screen.queryByRole('button',{name:'Expand Heptabase import activity'})).toBeNull();
 expect(screen.getByRole('button',{name:'View Heptabase import results'})).toBeDefined();
});

test('F79 closing removes the whole floating notification and history reopens only from the import action',async()=>{
 const batch:HeptabaseImportBatch={id:'fully-dismissed',running:false,items:[{noteId:'n',title:'Saved title',status:'created'}]};
 const api:HeptabaseImportApi={get:vi.fn(async()=>batch),start:vi.fn(async()=>batch),retry:vi.fn(async()=>batch)};
 const view=render(<HeptabaseImportAction api={api} noteIds={['n']}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Dismiss Heptabase import notifications'}));
 expect(screen.queryByRole('button',{name:'Heptabase import results'})).toBeNull();
 expect(screen.queryByRole('complementary',{name:'Heptabase import'})).toBeNull();
 const history=screen.getByRole('button',{name:'View Heptabase import results'});
 fireEvent.click(history);expect(screen.getByText('Saved title')).toBeDefined();
 fireEvent.click(screen.getByRole('button',{name:'Dismiss Heptabase import notifications'}));view.unmount();
 render(<HeptabaseImportAction api={api} noteIds={['n']}/>);
 await screen.findByRole('button',{name:'View Heptabase import results'});
 expect(screen.queryByRole('complementary',{name:'Heptabase import'})).toBeNull();
});
