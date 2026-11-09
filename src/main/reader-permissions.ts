import type { Session, WebContents } from 'electron';

/** Permissions belong to the reader's main document, not other windows sharing its session. */
export function configureReaderPermissions(session: Session, reader: WebContents): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const ownWindow = contents === reader && details.isMainFrame;
    const audioOnly = permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.includes('audio') && !details.mediaTypes?.includes('video');
    callback(Boolean(ownWindow && (audioOnly || permission === 'clipboard-sanitized-write' || permission === 'fullscreen')));
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents === reader && (permission === 'media' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen' && details.isMainFrame === true));
}
