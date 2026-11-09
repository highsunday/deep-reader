import { expect, test, vi } from 'vitest';
import type { Session, WebContents } from 'electron';
import { configureReaderPermissions } from '../src/main/reader-permissions';

function setup() {
  const reader = {} as WebContents, other = {} as WebContents;
  let request!: Parameters<Session['setPermissionRequestHandler']>[0];
  let check!: Parameters<Session['setPermissionCheckHandler']>[0];
  configureReaderPermissions({setPermissionRequestHandler: handler => {request=handler;},setPermissionCheckHandler:handler=>{check=handler;}} as Session,reader);
  return {reader,other,
    request(contents:WebContents,permission:string,details:Record<string,unknown>={isMainFrame:true}) {
      const callback=vi.fn();request!(contents,permission as never,callback,details as never);return callback.mock.calls[0][0];
    },
    check(contents:WebContents|null,permission:string,details:Record<string,unknown>={isMainFrame:true}) {return check!(contents,permission as never,'http://127.0.0.1:45173',details as never);}
  };
}
test('TC1: the reader main document can pass both fullscreen permission gates',()=>{
  const s=setup();expect(s.request(s.reader,'fullscreen')).toBe(true);expect(s.check(s.reader,'fullscreen')).toBe(true);
});
test('TC2: another window, subframe or absent frame cannot gain fullscreen',()=>{
  const s=setup();for(const contents of [s.other,s.reader]){
    const details={isMainFrame:contents!==s.reader};expect(s.request(contents,'fullscreen',details)).toBe(false);expect(s.check(contents,'fullscreen',details)).toBe(false);
  }
  expect(s.check(null,'fullscreen')).toBe(false);expect(s.check(s.reader,'fullscreen',{})).toBe(false);
  expect(s.request(s.reader,'automatic-fullscreen')).toBe(false);expect(s.check(s.reader,'automatic-fullscreen')).toBe(false);
});
test('TC3: existing microphone and clipboard behavior is retained without granting camera or other permissions',()=>{
  const s=setup();expect(s.request(s.reader,'media',{isMainFrame:true,mediaTypes:['audio']})).toBe(true);
  expect(s.request(s.reader,'media',{isMainFrame:true,mediaTypes:['audio','video']})).toBe(false);
  expect(s.request(s.reader,'media',{isMainFrame:true,mediaTypes:['video']})).toBe(false);
  expect(s.check(s.reader,'media')).toBe(true);
  expect(s.request(s.reader,'clipboard-sanitized-write')).toBe(true);expect(s.check(s.reader,'clipboard-sanitized-write')).toBe(true);
  expect(s.request(s.other,'media',{isMainFrame:true,mediaTypes:['audio']})).toBe(false);
  expect(s.request(s.reader,'display-capture')).toBe(false);expect(s.check(s.reader,'geolocation')).toBe(false);
});
