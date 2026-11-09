import type { HeptabaseImportController } from "./heptabase-import";
export function registerHeptabaseImportIpc(
  ipc: {
    handle(channel: string, handler: (event: any, ...args: any[]) => any): void;
  },
  controller: HeptabaseImportController,
  assertTrusted: (event: any) => void,
): void {
  ipc.handle("reading-notes:heptabase-start", (event, ids: unknown) => {
    assertTrusted(event);
    return controller.start(ids);
  });
  ipc.handle("reading-notes:heptabase-get", (event) => {
    assertTrusted(event);
    return controller.get();
  });
  ipc.handle("reading-notes:heptabase-retry", (event) => {
    assertTrusted(event);
    return controller.retry();
  });
}
