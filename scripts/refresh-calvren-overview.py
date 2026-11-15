#!/usr/bin/env python3
"""Rebuild the Calvren homepage explainer from the original, updating its real price scene."""
import json, pathlib, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

source=pathlib.Path(sys.argv[1]).resolve()
output=pathlib.Path(sys.argv[2]).resolve()
poster=pathlib.Path(sys.argv[3]).resolve()

def run(cmd):
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def metadata(path):
    data=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration:stream=width,height,codec_type","-of","json",str(path)]))
    v=next(x for x in data["streams"] if x["codec_type"]=="video")
    return float(data["format"]["duration"]),int(v["width"]),int(v["height"])
def font(size,bold=True):
    paths=(["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"] if bold else ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf","/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"])
    for p in paths:
        if pathlib.Path(p).exists():return ImageFont.truetype(p,size)
    return ImageFont.load_default()

with tempfile.TemporaryDirectory() as temp:
    temp=pathlib.Path(temp)
    dur,w,h=metadata(source)
    scx=w/910;scy=h/512
    def xy(x,y):return round(x*scx),round(y*scy)
    def rect(x0,y0,x1,y1):return (*xy(x0,y0),*xy(x1,y1))
    def extract(t,path):
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(t),"-i",str(source),"-frames:v","1",str(path)])
    price_path=temp/"price.png";closing_path=temp/"closing.png"
    extract(dur*.34,price_path)  # The original website film shows its pricing by ~5 seconds
    extract(dur*.72,closing_path) # Final cinematic Calvren logo and CTA
    price=Image.open(price_path).convert("RGB")
    close=Image.open(closing_path).convert("RGB")
    dark=(21,59,45);muted=(89,111,99)
    d=ImageDraw.Draw(price)
    cards=[
      (24,293,"STARTER","249",["Lead replies and","booking routing"],False),
      (308,608,"GROWTH","499",["Follow-ups, reviews","and monthly reports"],True),
      (622,892,"PRO","775",["Integrations and","advanced workflows"],False)
    ]
    for x0,x1,name,cost,benefits,featured in cards:
        fill=(230,242,214) if featured else (255,255,255)
        border=(53,102,72) if featured else (213,223,214)
        d.rounded_rectangle(rect(x0,251,x1,447),radius=round(14*scy),fill=fill,outline=border,width=max(1,round((2 if featured else 1)*scx)))
        if featured:
            d.rounded_rectangle(rect(x0+13,265,x0+117,295),radius=round(13*scy),fill=(213,236,162))
        d.text(xy(x0+16,269),name,font=font(round(16*scy)),fill=dark)
        d.text(xy(x0+16,306),"CA$",font=font(round(18*scy),False),fill=muted)
        d.text(xy(x0+64,300),cost,font=font(round(36*scy)),fill=dark)
        d.text(xy(x0+19,358),benefits[0],font=font(round(16*scy),False),fill=dark)
        d.text(xy(x0+19,382),benefits[1],font=font(round(16*scy),False),fill=dark)
        d.line([xy(x0+18,414),xy(x1-18,414)],fill=(213,225,212),width=1)
        d.text(xy(x0+18,421),"Onboarding required",font=font(round(12*scy),False),fill=muted)
    price.save(price_path)
    # Save an inspection image of the prices. This will not be used as the video poster.
    price.save(output.parent/"calvren-video-pricing-preview.jpg",quality=90,optimize=True)

    d=ImageDraw.Draw(close)
    # The live 910x512 clip has a bigger and higher CTA than the earlier walkthrough.
    # Cover the entire old .pages.dev button before displaying the new domain.
    d.rounded_rectangle(rect(261,333,650,418),radius=round(41*scy),fill=(211,237,164))
    label="Explore calvren.ca";f=font(round(27*scy))
    b=d.textbbox((0,0),label,font=f)
    d.text((round((w-(b[2]-b[0]))/2),round(357*scy)),label,font=f,fill=dark)
    close.save(closing_path)
    close.save(poster,quality=91,optimize=True)

    # Keep the opening animation, and replace the outdated price and website scenes.
    start_dur=min(dur*.22,3.3)
    seg=temp/"opening.mp4"
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(source),"-t",str(start_dur),"-an","-vf",f"scale={w}:{h},fps=24,format=yuv420p","-c:v","libx264","-preset","veryfast","-crf","22",str(seg)])
    parts=[seg]
    for i,(frame,seconds) in enumerate([(price_path,5.2),(closing_path,4.5)],1):
        out=temp/f"scene{i}.mp4"
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-loop","1","-framerate","24","-i",str(frame),"-t",str(seconds),"-vf","format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","22",str(out)])
        parts.append(out)
    concat=temp/"concat.txt"
    concat.write_text("".join("file '"+str(p)+"'\n" for p in parts))
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",str(concat),"-c","copy","-movflags","+faststart",str(output)])
    print("Calvren overview rebuilt from source",round(dur,2),"->",round(metadata(output)[0],2),"seconds")
