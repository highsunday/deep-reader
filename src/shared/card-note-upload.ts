export type CardNoteUploadStatus = "pending" | "uploading" | "created" | "duplicate_title" | "validation_error" | "refused" | "unreachable" | "uncertain";
export interface CardNoteUploadItem { noteId: string; title: string; submissionId: string; status: CardNoteUploadStatus; message?: string; url?: string; }
export interface CardNoteUploadBatch { id: string; baseUrl: string; running: boolean; items: CardNoteUploadItem[]; }
export interface CardNoteUploadApi {
  start(noteIds: string[]): Promise<CardNoteUploadBatch>;
  get(): Promise<CardNoteUploadBatch | undefined>;
  retry(): Promise<CardNoteUploadBatch>;
}
