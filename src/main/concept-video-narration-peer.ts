import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface NarrationPeer {
  offer(): Promise<string>;
  answer(sdp: string): Promise<void>;
  finish(): Promise<{ pcm: Buffer; sampleRate: number; channels: number }>;
  close(): void;
}

// Trusted, static document. Script/source material is never evaluated in this renderer.
const recorderPage = `<!doctype html><meta charset="utf-8"><script>
let peer, channel, context, oscillator, audio, recorder, chunks=[], bytes=0, opened;
window.offer = async () => {
  peer = new RTCPeerConnection();
  context = new AudioContext(); await context.resume();
  const destination = context.createMediaStreamDestination();
  oscillator = context.createOscillator();
  const silence = context.createGain(); silence.gain.value = 0;
  oscillator.connect(silence).connect(destination); oscillator.start();
  peer.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  channel = peer.createDataChannel('oai-events');
  opened = new Promise((resolve,reject) => { channel.onopen=resolve; channel.onerror=()=>reject(Error('Narration data channel failed.')); });
  // Install a rejection handler before SDP negotiation completes.
  opened.catch(()=>{});
  peer.ontrack = event => {
    const stream = new MediaStream([event.track]);
    audio = new Audio(); audio.muted = true; audio.srcObject = stream;
    audio.play().catch(()=>{});
    recorder = new MediaRecorder(stream, {mimeType:'audio/webm;codecs=opus'});
    recorder.ondataavailable = event => { bytes+=event.data.size; if(bytes>32000000){peer.close();return;} chunks.push(event.data); };
    recorder.start(250);
  };
  const offer = await peer.createOffer(); await peer.setLocalDescription(offer); return offer.sdp;
};
window.answer = async sdp => { await peer.setRemoteDescription({type:'answer',sdp}); await opened; };
window.finish = async () => {
  if(!recorder || recorder.state!=='recording') throw Error('Codex returned no narration audio.');
  await new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(Error('Narration recording failed.'));recorder.stop();});
  if(bytes>32000000) throw Error('Codex narration is too long.');
  const blob = new Blob(chunks,{type:'audio/webm'});
  if(!blob.size) throw Error('Codex returned no narration audio.');
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});
};
</script>`;

interface RecorderHost {
  webContents: { executeJavaScript(expression: string): Promise<any> };
  isDestroyed(): boolean;
  destroy(): void;
}

async function recorderHost(): Promise<RecorderHost> {
  const electron = await import('electron');
  if (typeof electron.BrowserWindow === 'function') {
    const window = new electron.BrowserWindow({ show: false, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    try { await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recorderPage)}`); }
    catch (error) { window.destroy(); throw error; }
    return window;
  }
  // CLI integration tests use the identical trusted recorder in a dedicated Electron host.
  const directory = mkdtempSync(join(tmpdir(), 'video-narration-peer-'));
  const entry = join(directory, 'peer.cjs');
  writeFileSync(entry, `const {app,BrowserWindow}=require('electron');let window;
    app.whenReady().then(async()=>{window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
    await window.loadURL(${JSON.stringify(`data:text/html;charset=utf-8,${encodeURIComponent(recorderPage)}`)});process.send({ready:true});});
    process.on('message',async m=>{try{process.send({id:m.id,result:await window.webContents.executeJavaScript(m.expression)});}catch(e){process.send({id:m.id,error:e.message});}});
    process.on('disconnect',()=>app.exit());`);
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron.default as unknown as string, [entry], {env:environment,stdio:['ignore','ignore','ignore','ipc']});
  let destroyed = false, sequence = 0;
  const pending = new Map<number,{resolve(value: any):void;reject(error:Error):void}>();
  const close = () => { destroyed=true;child.kill();rmSync(directory,{recursive:true,force:true});for(const p of pending.values())p.reject(new Error('Narration recorder closed.'));pending.clear(); };
  try {
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{close();reject(new Error('Narration recorder startup timed out.'));},30000);
      child.on('message',(message:any)=>{if(message.ready){clearTimeout(timer);resolve();}else{const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error)):p.resolve(message.result);}}});
      child.on('error',error=>{clearTimeout(timer);close();reject(error);});
      child.on('exit',()=>{clearTimeout(timer);close();reject(new Error('Narration recorder exited.'));});
    });
  } catch(error) {close();throw error;}
  return {webContents:{executeJavaScript:expression=>new Promise((resolve,reject)=>{if(destroyed)return reject(new Error('Narration recorder closed.'));const id=++sequence;pending.set(id,{resolve,reject});child.send({id,expression});})},isDestroyed:()=>destroyed,destroy:close};
}

/** Receive-only narration recording; the uplink is generated silence, never a microphone. */
export async function createNarrationPeer(): Promise<NarrationPeer> {
  const window = await recorderHost();
  let decoder: ReturnType<typeof spawn> | undefined;
  return {
    offer: () => window.webContents.executeJavaScript('window.offer()'),
    answer: sdp => window.webContents.executeJavaScript(`window.answer(${JSON.stringify(sdp)})`),
    async finish() {
      const encoded: unknown = await window.webContents.executeJavaScript('window.finish()');
      if (typeof encoded !== 'string' || encoded.length > 44_000_000) throw new Error('Codex returned invalid narration audio.');
      const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(existsSync) ?? 'ffmpeg';
      // Trim only the ends, preserving pauses within the spoken script.
      const pcm = await new Promise<Buffer>((resolve, reject) => {
        const child = decoder = spawn(ffmpeg, ['-v','error','-i','pipe:0','-af',
          'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB,areverse',
          '-ar','24000','-ac','1','-f','s16le','pipe:1']);
        const chunks: Buffer[] = []; let bytes = 0, errors = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Narration audio decoding timed out.')); }, 15000);
        child.stdout.on('data', (data: Buffer) => { bytes += data.length; if(bytes>32_000_000) child.kill(); else chunks.push(data); });
        child.stderr.on('data', data => { errors = (errors + data).slice(-1000); });
        child.stdin.on('error', () => {});
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); decoder=undefined; code===0 && bytes>0 && bytes<=32_000_000 ? resolve(Buffer.concat(chunks)) : reject(new Error(`Narration audio decoding failed. ${errors}`)); });
        child.stdin.end(Buffer.from(encoded, 'base64'));
      });
      return { pcm, sampleRate: 24000, channels: 1 };
    },
    close() { decoder?.kill(); if (!window.isDestroyed()) window.destroy(); }
  };
}
