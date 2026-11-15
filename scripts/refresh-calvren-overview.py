#!/usr/bin/env python3
"""Non-destructive Calvren video repair: retain ALL original 15-second video frames.

Only overlay the outdated prices and closing web address, with Inter typography.
Re-encode in one continuous pass to avoid invalid timestamps from concatenated clips.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

source=pathlib.Path(sys.argv[1]).resolve()
output=pathlib.Path(sys.argv[2]).resolve()
poster=pathlib.Path(sys.argv[3]).resolve()
media_dir=poster.parent
output.parent.mkdir(parents=True,exist_ok=True)

def run(args):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if p.returncode:
        raise RuntimeError("Command failed: "+" ".join(map(str,args))+"\n"+p.stderr[-2500:])
    return p.stdout

def metadata(path):
    data=json.loads(run(["ffprobe","-v","error","-show_entries","format=duration:stream=codec_type,width,height,nb_frames,r_frame_rate","-of","json",str(path)]))
    video=next(s for s in data["streams"] if s["codec_type"]=="video")
    return float(data["format"]["duration"]),int(video["width"]),int(video["height"]),video

def font(size,weight="regular"):
    import glob
    candidates={
        "regular": ["*Inter-Regular*","*InterVariable*","*LiberationSans-Regular*","*DejaVuSans.ttf"],
        "medium": ["*Inter-Medium*","*InterVariable*","*LiberationSans-Regular*","*DejaVuSans.ttf"],
        "semi": ["*Inter-SemiBold*","*Inter-Bold*","*InterVariable*","*LiberationSans-Bold*","*DejaVuSans-Bold.ttf"],
        "bold": ["*Inter-Bold*","*Inter-SemiBold*","*InterVariable*","*LiberationSans-Bold*","*DejaVuSans-Bold.ttf"]
    }
    paths=glob.glob("/usr/share/fonts/**/*",recursive=True)
    for pattern in candidates[weight]:
        import fnmatch
        matches=[p for p in paths if fnmatch.fnmatch(pathlib.Path(p).name,pattern) and pathlib.Path(p).is_file()]
        if matches:
            return ImageFont.truetype(sorted(matches)[0],size)
    return ImageFont.load_default()

duration,w,h,source_stream=metadata(source)
if not 14.5 <= duration <= 16.0:
    raise ValueError(f"Expected 15-second source, found {duration:.3f}s")
sx,sy=w/910,h/512
xy=lambda x,y:(round(x*sx),round(y*sy))
bbox=lambda x0,y0,x1,y1:(*xy(x0,y0),*xy(x1,y1))
def f(size,weight="regular"):
    return font(max(10,round(size*sy)),weight)

with tempfile.TemporaryDirectory() as work:
    work=pathlib.Path(work)
    price_overlay=Image.new("RGBA",(w,h),(0,0,0,0))
    d=ImageDraw.Draw(price_overlay)
    # Matches the coordinates of the actual original pricing slide.
    plans=[
      {"x0":24,"x1":294,"name":"STARTER","price":"249","details":["Reply to new leads","Route booking requests"],"featured":False},
      {"x0":309,"x1":608,"name":"GROWTH","price":"499","details":["Follow up with leads","Reviews and monthly reports"],"featured":True},
      {"x0":623,"x1":892,"name":"PRO","price":"775","details":["Connect business tools","Custom workflows and support"],"featured":False},
    ]
    ink=(27,58,47,255);subtle=(93,112,102,255)
    for p in plans:
        x0,x1=p["x0"],p["x1"]
        is_featured=p["featured"]
        bg=(234,246,226,255) if is_featured else (255,255,253,255)
        stroke=(59,108,78,255) if is_featured else (213,226,216,255)
        d.rounded_rectangle(bbox(x0,244,x1,453),radius=round(15*sy),fill=bg,outline=stroke,width=max(1,round((2 if is_featured else 1)*sx)))
        # A small accent, not an oversized promotional badge.
        if is_featured:
            d.rounded_rectangle(bbox(x0+18,260,x0+61,265),radius=round(3*sy),fill=(141,181,112,255))
        d.text(xy(x0+18,275),p["name"],font=f(17,"semi"),fill=ink)
        d.line([xy(x0+18,306),xy(x1-18,306)],fill=(224,232,221,255),width=max(1,round(sy)))
        d.text(xy(x0+18,312),"CA$",font=f(18,"medium"),fill=subtle)
        d.text(xy(x0+62,306),p["price"],font=f(42,"bold"),fill=ink)
        d.text(xy(x1-62,326),"/mo",font=f(14,"medium"),fill=subtle)
        d.text(xy(x0+18,381),p["details"][0],font=f(15,"medium"),fill=ink)
        d.text(xy(x0+18,407),p["details"][1],font=f(15,"medium"),fill=ink)
        d.text(xy(x0+18,439),"✓",font=f(13,"semi"),fill=(77,131,78,255))
        d.text(xy(x0+36,439),"Custom onboarding",font=f(11,"regular"),fill=subtle)
    price_path=work/"pricing-overlay.png"
    price_overlay.save(price_path)

    # Cover the old website address ONLY, preserving the moving original video.
    end_overlay=Image.new("RGBA",(w,h),(0,0,0,0))
    e=ImageDraw.Draw(end_overlay)
    e.rounded_rectangle(bbox(257,331,654,419),radius=round(42*sy),fill=(216,239,173,255))
    text="Explore calvren.ca"
    font_cta=f(27,"semi")
    text_bounds=e.textbbox((0,0),text,font=font_cta)
    tw=text_bounds[2]-text_bounds[0]
    th=text_bounds[3]-text_bounds[1]
    e.text(((w-tw)//2,round(374*sy-th/2)),text,font=font_cta,fill=ink)
    end_path=work/"ending-overlay.png"
    end_overlay.save(end_path)

    # A single continuous encode keeps the original ~450 frames and sound, if any.
    filtergraph="[0:v][1:v]overlay=0:0:enable='between(t,4.45,7.25)':format=auto[priced];[priced][2:v]overlay=0:0:enable='gte(t,7.25)':format=auto,format=yuv420p[v]"
    run([
      "ffmpeg","-hide_banner","-loglevel","error","-y",
      "-i",str(source),"-loop","1","-framerate","30","-i",str(price_path),
      "-loop","1","-framerate","30","-i",str(end_path),
      "-filter_complex",filtergraph,"-map","[v]","-map","0:a?",
      "-c:v","libx264","-preset","medium","-crf","18",
      "-pix_fmt","yuv420p","-c:a","aac","-b:a","160k",
      "-movflags","+faststart","-t",str(duration),str(output)
    ])
    out_dur,ow,oh,out_video=metadata(output)
    if abs(out_dur-duration)>0.30 or (ow,oh)!=(w,h):
        raise AssertionError(f"Duration/dimensions mismatch: source={duration}, output={out_dur}, dims={ow}x{oh}")
    # Thorough stream decode catches misleading durations with unplayable tails.
    run(["ffmpeg","-hide_banner","-loglevel","error","-xerror","-i",str(output),"-f","null","-"])
    for stamp,destination in [
      (5.5,media_dir/"calvren-video-pricing-preview.jpg"),
      (11.2,poster),
    ]:
        run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(stamp),"-i",str(output),"-frames:v","1","-q:v","3",str(destination)])
    # Validation contact sheet across entire video, including the previously truncated ending.
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(output),
         "-vf","fps=1/2,scale=455:256,tile=4x2","-frames:v","1",
         str(media_dir/"calvren-video-review.jpg")])
    print(f"OK: Original duration={duration:.3f}s; fixed duration={out_dur:.3f}s; frames={out_video.get('nb_frames')}; full decode succeeded.")
