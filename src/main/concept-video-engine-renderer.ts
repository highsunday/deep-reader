import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { videoEngine, type ConceptVideo, type VideoEngineCapability } from '../shared/concept-video';
import type { RenderedVideo } from './concept-video-generator';
import { synthesizeVideoNarration } from './concept-video-narration';
import remotionWorker from './concept-video-remotion-worker.cjs.txt?raw';
import manimWorker from './concept-video-manim-worker.py?raw';
const execute = promisify(execFile);
const require = createRequire(join(process.cwd(), 'package.json'));
export interface ManimRuntime { python: string; roots: string[] }
export async function findManimRuntime(): Promise<ManimRuntime | undefined> {
  const candidates = [...new Set([process.env.VIDEO_MANIM_PYTHON, join(process.cwd(), '.video-venv/bin/python3'), join(process.cwd(), '.venv/bin/python3'), 'python3'].filter((s): s is string => Boolean(s)))];
  for (const python of candidates) {
    try {
      const result = await execute(python, ['-I', '-c', 'import manim,typst,sys,json; assert manim.__version__ == "0.21.0", "Expected Manim Community 0.21.0"; print(json.dumps({"python":sys.executable,"roots":[sys.prefix,sys.base_prefix]+sys.path}))'], { timeout: 15_000 });
      const runtime = JSON.parse(result.stdout) as ManimRuntime;
      return { python: runtime.python, roots: [...new Set(runtime.roots.filter(p => p && existsSync(p)).map(p => realpathSync(p)))].filter(p => p !== '/' && p !== homedir() && p !== process.cwd()) };
    } catch { /* Try the next runtime; never substitute a different engine. */ }
  }
}
export async function remotionBrowser(): Promise<string> {
  const { ensureBrowser } = require('@remotion/renderer') as typeof import('@remotion/renderer');
  const browser = await ensureBrowser({ browserExecutable: process.env.VIDEO_REMOTION_BROWSER, logLevel: 'error', onBrowserDownload: () => { throw new Error('Remotion requires its local browser. Run npm run setup:video:remotion.'); } });
  if (!('path' in browser)) throw new Error('Remotion browser is unavailable. Run npm run setup:video:remotion.');
  return browser.path;
}
export async function engineCapabilities(): Promise<{ remotion: VideoEngineCapability; manim: VideoEngineCapability }> {
  const [browser, manim] = await Promise.allSettled([remotionBrowser(), findManimRuntime()]);
  return {
    remotion: browser.status === 'fulfilled' ? { available: true, reason: '' } : { available: false, reason: browser.reason instanceof Error ? browser.reason.message : 'Remotion is unavailable.' },
    manim: manim.status === 'fulfilled' && manim.value && process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')
      ? { available: true, reason: '' } : { available: false, reason: 'Manim requires Python with Manim Community 0.21.0 and the macOS sandbox. Run npm run setup:video:manim.' }
  };
}
// Generated Python never runs with the application's filesystem or network authority.
export function manimSandbox(directory: string, runtime: ManimRuntime): string {
  const quote = (p: string) => JSON.stringify(resolve(p));
  const roots = [...new Set(['/System', '/usr', '/Library', '/opt/homebrew', '/private/var/db', ...runtime.roots])];
  return `(version 1) (deny default)
(allow process-exec process-fork sysctl-read)
(allow signal process-info* (target same-sandbox))
(allow mach-lookup (global-name "com.apple.FontObjectsServer") (global-name "com.apple.fonts") (global-name "com.apple.logd") (global-name "com.apple.lsd.mapdb") (global-name "com.apple.system.logger") (global-name "com.apple.bsd.dirhelper"))
(allow file-read-metadata)
(allow file-read* (literal "/"))
(allow file-read-data ${roots.map(p => `(subpath ${quote(p)})`).join(' ')})
(allow file-read* file-write* (subpath ${quote(realpathSync(directory))}))
(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (literal "/dev/null"))`;
}
export function runVideoProcess(command: string, args: string[], signal: AbortSignal, options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Generation cancelled'));
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let errors = '', failure: Error | undefined, settled = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig); else child.kill(sig); } catch { /* Already stopped. */ } };
    const stop = (error: Error) => { failure ??= error; kill('SIGTERM'); killTimer ??= setTimeout(() => { kill('SIGKILL'); child.stderr.destroy(); child.unref(); finish(failure); }, 2000); };
    const abort = () => stop(new Error('Generation cancelled'));
    const timer = setTimeout(() => stop(new Error('Video rendering timed out. Shorten the video and try again.')), options.timeoutMs ?? 10 * 60_000);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort); };
    const finish = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? no(error) : yes(); };
    child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
    child.on('error', error => finish(error));
    child.on('close', (code, killedBy) => finish(failure ?? (code !== 0 ? new Error(errors.trim() || `Video renderer exited ${killedBy ?? code}.`) : undefined)));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
}
function stamp(seconds: number) {
  const n = Math.round(seconds * 1000);
  return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;
}
export async function renderEngineProgram(video: ConceptVideo, directory: string, signal: AbortSignal, ffmpeg: string, ffprobe: string): Promise<RenderedVideo> {
  const engine = videoEngine(video.plan);
  if (engine === 'canvas') throw new Error('Use the Canvas renderer.');
  const runtime = engine === 'manim' ? await findManimRuntime() : undefined;
  const browser = engine === 'remotion' ? await remotionBrowser() : undefined;
  if (engine === 'manim' && (!runtime || process.platform !== 'darwin')) throw new Error('Manim Community runtime is unavailable.');
  mkdirSync(directory, { recursive: true });
  await synthesizeVideoNarration(video.plan, directory, signal);
  const probe = async (path: string) => JSON.parse((await execute(ffprobe, ['-v','error','-show_format','-show_streams','-of','json',path], { timeout: 30_000, signal })).stdout);
  const subtitles: {start:number;end:number;text:string}[] = [], timeline: RenderedVideo['scenes'] = [];
  let total = 0;
  const scenes = [];
  for (const [i, scene] of video.plan.scenes.entries()) {
    let duration = video.plan.narration ? Number((await probe(join(directory, `${i}.wav`))).format.duration) + 0.6 : Math.max(6, scene.narration.length / 5);
    duration = Math.ceil(duration * 30) / 30;
    if (!Number.isFinite(duration) || duration <= 0 || total + duration > 300) throw new Error('The video exceeds five minutes. Shorten it.');
    const phrases = (scene.narration.match(/[^，。！？；：]+[，。！？；：]*/gu) ?? [scene.narration]).flatMap(p => p.match(/.{1,32}/gu) ?? []);
    const weight = phrases.reduce((sum,p) => sum + p.length, 0);
    let cumulative = 0;
    const captions = phrases.map(text => { const start = duration * cumulative / weight; cumulative += text.length; const end = duration * cumulative / weight; subtitles.push({start:total+start,end:total+end,text}); return {start,end,text}; });
    scenes.push({...scene,duration,captions});
    timeline.push({id:scene.id,start:total,end:total+duration}); total += duration;
    writeFileSync(join(directory, `scene-${i+1}.${engine === 'manim' ? 'py' : 'jsx'}`), scene.code!);
  }
  writeFileSync(join(directory, 'job.json'), JSON.stringify({plan:video.plan,source:video.source,scenes}));
  if (engine === 'remotion') {
    const worker = join(directory, 'remotion-worker.cjs'); writeFileSync(worker, remotionWorker);
    const root = dirname(dirname(require.resolve('remotion/package.json')));
    const node = process.execPath;
    await runVideoProcess(node, [worker, join(directory,'job.json'), root, browser!], signal, { env:{...process.env,ELECTRON_RUN_AS_NODE:'1'} });
  } else {
    const worker = join(directory,'manim-worker.py'), profile = join(directory,'sandbox.sb'), temp = join(directory,'tmp');
    mkdirSync(temp); writeFileSync(worker,manimWorker); writeFileSync(profile,manimSandbox(directory,runtime!));
    // A minimal environment avoids forwarding account or service credentials.
    await runVideoProcess('/usr/bin/sandbox-exec', ['-f',profile,runtime!.python,'-I',worker,join(directory,'job.json')], signal, {
      cwd:directory,env:{PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',HOME:directory,TMPDIR:temp,LANG:'en_US.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}
    });
  }
  for (const [i, scene] of scenes.entries()) {
    const args = ['-y','-v','error','-i',join(directory,`${i}-raw.mp4`)];
    if (video.plan.narration) args.push('-i',join(directory,`${i}.wav`),'-map','0:v:0','-map','1:a:0','-af','apad','-c:a','aac','-ar','44100','-ac','1');
    else args.push('-an');
    args.push('-t',String(scene.duration),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',join(directory,`${i}.mp4`));
    await runVideoProcess(ffmpeg,args,signal,{timeoutMs:120_000});
    await runVideoProcess(ffmpeg,['-y','-v','error','-ss',String(scene.duration/2),'-i',join(directory,`${i}.mp4`),'-frames:v','1',join(directory,`preview-${i+1}.png`)],signal,{timeoutMs:30_000});
  }
  writeFileSync(join(directory,'concat.txt'),scenes.map((_,i)=>`file '${i}.mp4'`).join('\n'));
  const final=join(directory,'video.mp4');
  await runVideoProcess(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',join(directory,'concat.txt'),'-c','copy','-movflags','+faststart',final],signal,{timeoutMs:120_000});
  const metadata=await probe(final), bytes=statSync(final).size;
  if (!metadata.streams.some((s: any) => s.codec_name === 'h264' && s.width === 1920 && s.height === 1080 && s.r_frame_rate === '30/1') || bytes < 1 || bytes > 100_000_000 || Math.abs(Number(metadata.format.duration)-total)>0.2) throw new Error('Video validation failed.');
  await runVideoProcess(ffmpeg,['-v','error','-i',final,'-f','null','-'],signal,{timeoutMs:120_000});
  writeFileSync(join(directory,'subtitles.srt'),subtitles.map((s,i)=>`${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}`).join('\n\n')+'\n');
  const result={durationSeconds:total,bytes,scenes:timeline};
  writeFileSync(join(directory,'result.json'),JSON.stringify(result));
  for (const file of ['remotion-worker.cjs','manim-worker.py','sandbox.sb','tmp','manim','bundle','entry.jsx','concat.txt',...scenes.flatMap((_,i)=>[`${i}-raw.mp4`,`${i}.mp4`,`${i}.wav`])]) rmSync(join(directory,file),{recursive:true,force:true});
  return result;
}
