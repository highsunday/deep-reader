export type HeptabaseImportStatus =
  | "pending"
  | "importing"
  | "created"
  | "duplicate"
  | "failed"
  | "uncertain";
export interface HeptabaseImportItem {
  noteId: string;
  title: string;
  status: HeptabaseImportStatus;
  message?: string;
  cardId?: string;
}
export interface HeptabaseImportBatch {
  id: string;
  running: boolean;
  items: HeptabaseImportItem[];
}
export interface HeptabaseImportApi {
  start(noteIds: string[]): Promise<HeptabaseImportBatch>;
  get(): Promise<HeptabaseImportBatch | undefined>;
  retry(): Promise<HeptabaseImportBatch>;
}
