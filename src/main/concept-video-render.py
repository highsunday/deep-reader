"""Local, bounded animation templates. Inputs are data; no generated code executes."""
import json, math, os, pathlib, subprocess, sys, re
from PIL import Image, ImageDraw, ImageFont

job = json.loads(pathlib.Path(sys.argv[1]).read_text())
out = pathlib.Path(sys.argv[1]).parent
ffmpeg, ffprobe = sys.argv[2:4]
W, H, FPS = 960, 540, 20
BG, PANEL, INK, MUTED, BLUE, GOLD = '#f7f5ef', '#ffffff', '#243d4a', '#6b7c83', '#2d6989', '#bd7834'
font_path = next((p for p in ['/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'] if os.path.exists(p)), None)
if not font_path: raise RuntimeError('A local Chinese font is required.')
fonts = {size: ImageFont.truetype(font_path, size) for size in [16,18,20,22,26,32]}
plan, source = job['plan'], job['source']

def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

def probe(path):
    return json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)]))

def lines(text, width, size):
    d = ImageDraw.Draw(Image.new('RGB', (1,1))); result, line = [], ''
    for ch in text:
        if ch == '\n' or (line and d.textlength(line+ch, font=fonts[size]) > width):
            result.append(line); line = ''
            if ch == '\n': continue
        line += ch
    if line: result.append(line)
    return result or ['']

def text(d, pos, value, size=22, color=INK):
    d.text(pos, value, font=fonts[size], fill=color)

def stamp(seconds):
    ms = round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def centered(d, y, value, size=26, color=INK, width=860):
    wrapped = lines(value, width, size)
    for n, line in enumerate(wrapped):
        text(d, ((W-d.textlength(line, font=fonts[size]))/2, y+n*(size+8)), line, size, color)


def actor_art(icon, phase):
    art = Image.new('RGBA', (300,260)); a = ImageDraw.Draw(art)
    navy, blue, yellow, skin, green = '#254d61', '#73a6b7', '#e9b454', '#e7b48e', '#75a38b'
    def person(x,y,s=1,walk=False):
        def box(v): return tuple((x+v[k]*s if k%2==0 else y+v[k]*s) for k in range(len(v)))
        a.ellipse(box((-16,-65,16,-32)),fill=skin)
        a.pieslice(box((-18,-68,18,-31)),180,355,fill=navy)
        a.rounded_rectangle(box((-22,-28,22,28)),radius=max(1,int(10*s)),fill=blue)
        swing=8*math.sin(phase*math.tau) if walk else 0
        a.line(box((-12,23,-15+swing,64)),fill=navy,width=max(1,int(10*s)))
        a.line(box((12,23,15-swing,64)),fill=navy,width=max(1,int(10*s)))
        a.line(box((-21,-15,-34-swing,17)),fill=skin,width=max(1,int(8*s)))
        a.line(box((21,-15,34+swing,17)),fill=skin,width=max(1,int(8*s)))
    if icon=='office':
        a.rounded_rectangle((66,20,222,237),radius=8,fill=navy)
        a.polygon([(56,25),(146,0),(233,25)],fill=blue)
        for xx in [84,124,164,204]:
            for yy in [45,82,119,156]: a.rectangle((xx,yy,xx+12,yy+19),fill='#f2dca8')
        a.rectangle((125,194,164,237),fill='#bad1d7'); a.line((145,194,145,237),fill=navy,width=3)
        person(239,191,.68)
        a.rounded_rectangle((211,203,230,221),radius=3,fill=yellow)
    elif icon=='taxi':
        a.polygon([(68,135),(94,92),(199,92),(231,138)],fill=yellow)
        a.polygon([(83,134),(105,103),(143,103),(143,134)],fill='#d8edf0')
        a.polygon([(155,103),(190,103),(215,134),(155,134)],fill='#d8edf0')
        a.rounded_rectangle((43,135,264,195),radius=16,fill=yellow)
        a.rounded_rectangle((121,75,174,92),radius=5,fill='#fff2cb')
        a.text((130,77),'TAXI',font=fonts[16],fill=navy)
        a.rectangle((148,141,152,179),fill='#c99439')
        for xx in [90,222]:
            a.ellipse((xx-25,174,xx+25,224),fill=navy);a.ellipse((xx-13,186,xx+13,212),fill='#dbe6df')
            angle=phase*math.tau*3
            a.line((xx,199,xx+10*math.cos(angle),199+10*math.sin(angle)),fill=navy,width=3)
        a.rectangle((250,147,261,159),fill='#fff7d7'); a.rectangle((46,150,57,162),fill='#c87558')
        person(26,179,.52)
    elif icon=='person':
        person(150,144,1.4,True)
    elif icon=='tree':
        a.polygon([(138,237),(158,237),(163,104),(151,52),(140,110)],fill='#987352')
        for xx,yy,r in [(106,85,47),(184,82,48),(148,50,46),(146,108,48)]:
            a.ellipse((xx-r,yy-r,xx+r,yy+r),fill=green if xx<160 else '#568673')
        a.line((149,166,109,119),fill='#987352',width=8)
        a.ellipse((87,231,205,246),fill='#a7c7a0')
    elif icon=='boat':
        a.polygon([(39,161),(260,161),(223,209),(75,209)],fill=navy)
        a.line((150,30,150,161),fill='#987352',width=6)
        a.polygon([(144,36),(144,151),(63,151)],fill='#fbf3d7')
        a.polygon([(157,58),(157,151),(231,151)],fill=yellow)
        for yy in [214,235]:
            pts=[(x,yy+5*math.sin(x/22+phase*math.tau)) for x in range(15,290)]
            a.line(pts,fill=blue,width=5)
    elif icon=='coins':
        for j,(xx,levels) in enumerate([(63,3),(143,6),(221,4)]):
            for k in range(levels):
                yy=219-k*20
                a.rectangle((xx-29,yy-9,xx+29,yy+3),fill='#c98d3f')
                a.ellipse((xx-29,yy-17,xx+29,yy),fill=yellow,outline='#fff0bd',width=2)
    elif icon=='network':
        center=(150,127); nodes=[(150+101*math.cos(k*math.tau/5),127+101*math.sin(k*math.tau/5)) for k in range(5)]
        for k,(xx,yy) in enumerate(nodes):
            a.line((*center,xx,yy),fill='#9bc0c6',width=5)
            progress=(phase*2-k*.13)%1
            px=150+(xx-150)*progress;py=127+(yy-127)*progress
            a.ellipse((px-6,py-6,px+6,py+6),fill=yellow)
            a.ellipse((xx-19,yy-19,xx+19,yy+19),fill=blue)
        a.ellipse((119,96,181,158),fill=navy)
        a.ellipse((138,115,162,139),fill=yellow)
    elif icon=='brain':
        for xx,yy in [(104,66),(154,52),(202,76),(93,114),(139,104),(190,123),(116,162),(165,173),(202,160)]:
            a.ellipse((xx-37,yy-33,xx+37,yy+33),fill='#d4a598',outline='#ae7f77',width=3)
        a.line((153,49,148,193),fill='#ae7f77',width=4)
        for xx,yy in [(110,83),(181,102),(135,156)]:
            a.ellipse((xx-6,yy-6,xx+6,yy+6),fill='#fff1c2')
    elif icon=='book':
        a.polygon([(34,53),(145,67),(145,225),(34,208)],fill=navy)
        a.polygon([(145,67),(268,48),(268,206),(145,225)],fill=blue)
        a.polygon([(43,62),(140,77),(140,211),(43,199)],fill='#fff9e5')
        a.polygon([(151,78),(257,59),(257,196),(151,212)],fill='#ede3c7')
        for yy in range(96,180,20):
            a.line((57,yy,121,yy+8),fill='#b6c1b5',width=3)
            a.line((174,yy,236,yy-9),fill='#b6c1b5',width=3)
    elif icon=='shield':
        a.polygon([(150,23),(250,66),(228,165),(150,233),(72,165),(50,66)],fill=blue)
        a.polygon([(150,44),(226,78),(208,154),(150,208),(94,154),(74,78)],fill=navy)
        a.line((108,119,139,150,193,88),fill='#f7dfa1',width=13)
    return art


def story_frame(scene, index, count, t, duration):
    im=Image.new('RGB',(W,H),'#f5f0e5');d=ImageDraw.Draw(im)
    # A shared illustrated world; no cards, editor controls or navigation inside the movie.
    d.ellipse((-130,160,430,610),fill='#e5ebe0');d.ellipse((570,130,1180,620),fill='#e3ebe7')
    d.ellipse((782,27,850,95),fill='#edcf89')
    for cx,cy in [(135+t*9,122),(690+t*7,141)]:
        d.ellipse((cx-35,cy-10,cx+35,cy+12),fill='#fffaf0');d.ellipse((cx-10,cy-23,cx+21,cy+11),fill='#fffaf0')
    text(d,(36,24),scene['heading'],20,MUTED)
    centered(d,57,scene['visual'],32,width=760)
    stage=scene['stage'];actors=stage['actors'];n=len(actors)
    centers=[W/2] if n==1 else [240,720] if n==2 else [170,480,790]
    scale=1.02 if n<3 else .78
    elapsed=t*duration
    for j,(actor,cx) in enumerate(zip(actors,centers)):
        # Sequence steps enter in narrative order. Comparisons share the same clock.
        delay=j*min(1.1,duration*.12) if stage['layout']=='sequence' else 0
        local=max(0,elapsed-delay);reveal=min(1,local/.6)
        if reveal<=0:continue
        motion=actor['motion'];art=actor_art(actor['icon'],local/4)
        xx=cx; yy=133; alpha=reveal;factor=scale
        if motion=='move': xx+=24*math.sin(local*.85)
        elif motion=='grow': factor*=.62+.38*min(1,local/max(1,duration*.6)); yy+=260*(scale-factor)
        elif motion=='fall':
            drop=max(0,min(1,(t-.25)/.45));yy+=drop*45;alpha*=1-.62*drop
        elif motion=='sway':art=art.rotate(5*math.sin(local*1.6),resample=Image.Resampling.BICUBIC)
        elif motion=='steady': yy+=2*math.sin(local*1.5)
        elif motion=='connect': factor*=.96+.04*math.sin(local*1.4)
        if actor['icon'] in ['office','taxi','person','tree','coins']:
            d.ellipse((cx-115*scale,372,cx+115*scale,389),fill='#cbd4c6')
        art=art.resize((round(300*factor),round(260*factor)),Image.Resampling.LANCZOS)
        art.putalpha(art.getchannel('A').point(lambda a:round(a*alpha)))
        # Keep a falling illustration inside the stage, away from labels and captions.
        art=art.crop((0,0,art.width,max(1,min(art.height,round(390-yy)))))
        im.paste(art,(round(xx-art.width/2),round(yy)),art)
        label=lines(actor['label'],260 if n<3 else 220,20)
        for k,line in enumerate(label):
            text(d,(cx-d.textlength(line,font=fonts[20])/2,391+k*25),line,20)
        if stage['layout']=='sequence' and j<n-1 and elapsed>delay+.5:
            start=cx+105*scale;stop=centers[j+1]-105*scale;y=260
            d.line((start,y,stop,y),fill='#c29855',width=4)
            d.polygon([(stop,y),(stop-11,y-7),(stop-11,y+7)],fill='#c29855')
    return im

records, durations = [], []
for i, scene in enumerate(plan['scenes']):
    narration = scene['narration'].strip() or scene['visual'].strip() or plan['goal']
    if len(narration) > 1500: raise RuntimeError('Shorten each narration to 1,500 characters before generating.')
    audio = out / f'{i}.wav'
    if plan['narration'] and narration:
        duration = float(probe(audio)['format']['duration']) + 1
    else:
        duration = max(6, len(narration)/ (3.5 if plan['pace']=='slow' else 5))
    visual_lines = lines(scene['visual'] or plan['goal'], 355, 22)
    duration = max(duration, math.ceil(len(visual_lines)/6)*4)
    duration = math.ceil(duration*FPS)/FPS
    durations.append(duration); records.append((scene, narration, audio, visual_lines))
if sum(durations) > 300: raise RuntimeError('The video exceeds five minutes. Shorten the content or turn off narration.')
subtitles, offset, timeline = [], 0., []
for i, ((scene, narration, audio, visual_lines), duration) in enumerate(zip(records, durations)):
    path = out/f'{i}.mp4'
    args = [ffmpeg, '-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{W}x{H}', '-framerate', str(FPS), '-i', 'pipe:0']
    if plan['narration']:
        if audio.exists(): args += ['-i', str(audio), '-af', 'apad']
        else: args += ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono']
        args += ['-c:a','aac','-ar','44100','-ac','1']
    args += ['-t',str(duration),'-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(path)]
    proc = subprocess.Popen(args, stdin=subprocess.PIPE)
    chunks = lines(narration, 820, 22)
    if plan.get('animation')=='story':
        chunks=[line for phrase in re.findall(r'[^，。！？；：]+[，。！？；：]*',narration) for line in lines(phrase,830,22)] or chunks
    weights=[len(chunk) for chunk in chunks];total_weight=sum(weights);ends=[];cumulative=0
    for chunk,weight in zip(chunks,weights):
        start=cumulative/total_weight;cumulative+=weight;end=cumulative/total_weight;ends.append(end)
        subtitles.append((offset+duration*start,offset+duration*end,chunk))
    def caption_at(t):return chunks[next((k for k,end in enumerate(ends) if t<end),len(chunks)-1)]
    for f in range(round(duration*FPS)):
        t = f/FPS/duration
        im = Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
        text(d,(32,18), '深度閱讀  /  本機概念動畫',16,MUTED)
        title = lines(plan['title'],830,32)
        text(d,(32,48),title[0],32)
        text(d,(32,95), f'第 {i+1} / {len(records)} 段 · {scene["heading"] or "解說步驟"}',18,BLUE)
        d.rounded_rectangle((530,135,928,421),radius=16,fill=PANEL)
        page_count = max(1, math.ceil(len(visual_lines)/6)); page=min(page_count-1,int(t*page_count))
        text(d,(551,152),'畫面與理解重點',16,MUTED)
        for n,line in enumerate(visual_lines[page*6:page*6+6]): text(d,(551,185+n*32),line,22)
        if page_count>1: text(d,(551,390),f'{page+1} / {page_count}',16,MUTED)
        if plan.get('animation','flow')=='derivative':
            def xy(x,y): return (65+x*160, 385-y*43)
            for x in [0,1,2]:
                d.line([xy(x,0),xy(x,5)],fill='#dbe4e6'); text(d,(xy(x,0)[0]-5,393),str(x),16,MUTED)
            for y in [0,1,2,3,4,5]:
                d.line([xy(0,y),xy(2.5,y)],fill='#dbe4e6'); text(d,(40,xy(0,y)[1]-8),str(y),16,MUTED)
            points=[xy(x/100,(x/100)**2) for x in range(225)]
            d.line(points,fill=BLUE,width=3)
            h=1-(1-.005)*(t*t*(3-2*t)); slope=2+h
            d.line([xy(0,1-slope),xy(2.3,1+slope*1.3)],fill=GOLD,width=3)
            for x,color in [(1,BLUE),(1+h,GOLD)]:
                px,py=xy(x,x*x);d.ellipse((px-6,py-6,px+6,py+6),fill=color)
            text(d,(68,145),'y = x² · P = (1, 1)',20,BLUE)
            text(d,(68,176),f'h = {h:.3f}   割線斜率 = {slope:.3f}',18,GOLD)
            if t > .8:
                d.line([xy(0,-1),xy(2.3,3.6)],fill='#438574',width=2)
                text(d,(280,424),'綠線：切線斜率 = 2',16,'#438574')
            text(d,(68,424),'h → 0，斜率 → 2',18,BLUE)
        else:
            count=len(records); gap=min(53,250/max(1,count-1)); top=165
            for n,(step,_,_,_) in enumerate(records):
                cy=top+n*gap; color=BLUE if n<=i else '#bbcbd2'
                if n<count-1:
                    d.line((94,cy+16,94,cy+gap-16),fill='#bbcbd2',width=3)
                    if n==i and i<count-1:
                        py=cy+16+(gap-32)*t;d.ellipse((90,py-4,98,py+4),fill=GOLD)
                d.ellipse((78,cy-16,110,cy+16),fill=color)
                text(d,(88,cy-12),str(n+1),18,'white')
                label=lines(step['heading'] or f'步驟 {n+1}',345,20)[0]
                text(d,(127,cy-12),label,20,BLUE if n==i else MUTED)
            # Real motion indicates advancement through this step, with an explicit process meaning.
            d.line((127,top+i*gap+22,472,top+i*gap+22),fill='#dbe4e6',width=3)
            dot=127+345*t;d.ellipse((dot-5,top+i*gap+17,dot+5,top+i*gap+27),fill=GOLD)
        if plan.get('animation')=='story':
            im=story_frame(scene,i,len(records),t,duration);d=ImageDraw.Draw(im)
            # Captions sit above the native player's control overlay and use short readable phrases.
            chunk=caption_at(t);
            d.rectangle((0,449,W,488),fill='#f5f0e5')
            text(d,((W-d.textlength(chunk,font=fonts[22]))/2,456),chunk,22)
        else:
            d.rounded_rectangle((32,465,928,515),radius=10,fill='#e7edf0')
            chunk=caption_at(t);text(d,((W-d.textlength(chunk,font=fonts[22]))/2,476),chunk,22)
            d.rectangle((32,529,32+896*(offset+f/FPS)/sum(durations),533),fill=BLUE)
        proc.stdin.write(im.tobytes())
        if f==round(duration*FPS)//2: im.save(out/f'preview-{i+1}.png')
    proc.stdin.close()
    if proc.wait()!=0: raise RuntimeError('Video encoding failed.')
    timeline.append({'id':scene['id'],'start':offset,'end':offset+duration});offset+=duration
    print(f'段落 {i+1}/{len(records)} 已完成',flush=True)
(out/'concat.txt').write_text(''.join(f"file '{i}.mp4'\n" for i in range(len(records))))
final=out/'video.mp4'
run([ffmpeg,'-y','-v','error','-f','concat','-safe','0','-i',str(out/'concat.txt'),'-c','copy','-movflags','+faststart',str(final)])
meta=probe(final)
if not any(s['codec_type']=='video' and s['codec_name']=='h264' for s in meta['streams']): raise RuntimeError('Video validation failed.')
run([ffmpeg,'-v','error','-i',str(final),'-f','null','-'])
if final.stat().st_size>100_000_000: raise RuntimeError('The video exceeds 100 MB. Shorten the content.')
(out/'subtitles.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{c}' for i,(a,b,c) in enumerate(subtitles))+'\n')
(out/'result.json').write_text(json.dumps({'durationSeconds':offset,'bytes':final.stat().st_size,'scenes':timeline}))
