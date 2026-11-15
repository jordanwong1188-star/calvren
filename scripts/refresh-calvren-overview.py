#!/usr/bin/env python3
"""Update Calvren's on-site overview video with approved CAD prices and domain."""
import json, pathlib, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
source=pathlib.Path(sys.argv[1]).resolve()
output=pathlib.Path(sys.argv[2]).resolve()
poster=pathlib.Path(sys.argv[3]).resolve()
def run(cmd):
    subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def probe(path):
    data=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration:stream=width,height,codec_type","-of","json",str(path)]))
    v=next(s for s in data["streams"] if s["codec_type"]=="video")
    return float(data["format"]["duration"]),int(v["width"]),int(v["height"])
def font(size):
    for name in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"]:
        if pathlib.Path(name).exists():return ImageFont.truetype(name,size)
    return ImageFont.load_default()
with tempfile.TemporaryDirectory() as t:
    tmp=pathlib.Path(t)
    duration,width,height=probe(source)
    a=tmp/"pricing.png";b=tmp/"outro.png"
    for seconds,dest in [(duration*.80,a),(duration*.96,b)]:
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(seconds),"-i",str(source),"-frames:v","1",str(dest)])
    price=Image.open(a).convert("RGB");outro=Image.open(b).convert("RGB")
    sx=width/1280;sy=height/720
    def xy(x,y):return round(x*sx),round(y*sy)
    def rect(x0,y0,x1,y1):return (*xy(x0,y0),*xy(x1,y1))
    d=ImageDraw.Draw(price)
    for x,amount in [(145,"249"),(547,"499"),(947,"775")]:
        bg=price.getpixel(xy(x+165,406))
        d.rectangle(rect(x,364,x+160,439),fill=bg)
        d.text(xy(x,368),amount,font=font(round(56*sy)),fill=(19,57,45))
    price.save(a)
    d=ImageDraw.Draw(outro)
    d.rounded_rectangle(rect(437,511,845,582),radius=round(28*sy),fill=(215,240,165))
    text="Explore calvren.ca";f=font(round(26*sy));extent=d.textbbox((0,0),text,font=f)
    d.text((round((width-(extent[2]-extent[0]))/2),round(527*sy)),text,font=f,fill=(19,57,45))
    outro.save(b)
    outro.save(poster,quality=91,optimize=True)
    initial=tmp/"initial.mp4"
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(source),"-t",str(max(1,duration*.715)),"-an","-vf",f"scale={width}:{height},fps=24,format=yuv420p","-c:v","libx264","-preset","veryfast","-crf","22",str(initial)])
    parts=[initial]
    for i,(picture,seconds) in enumerate([(a,3.8),(b,2.9)],1):
        video=tmp/f"part{i}.mp4"
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-loop","1","-framerate","24","-i",str(picture),"-t",str(seconds),"-vf","format=yuv420p","-an","-c:v","libx264","-preset","veryfast","-crf","22",str(video)])
        parts.append(video)
    concat=tmp/"concat.txt"
    concat.write_text("".join("file '"+str(p)+"'\n" for p in parts))
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",str(concat),"-c","copy","-movflags","+faststart",str(output)])
    assert output.stat().st_size>10000
    print("Updated Calvren overview:",round(duration,2),"->",round(probe(output)[0],2),"seconds")
