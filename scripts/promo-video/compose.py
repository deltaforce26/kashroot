#!/usr/bin/env python3
"""Composes the Kashroot Sukkot promo from the captured frame sequences.

Inputs (all under ./frames): intro30/, app30/ (+ app/meta.json marks), outro30/,
frame.png, cap{1,2,3}.png.
Output: kashroot-sukkot-2026.mp4 (1080x1920, 30fps, H.264 yuv420p, faststart, silent).
"""

import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FF = glob.glob(os.path.join(HERE, "py/imageio_ffmpeg/binaries/ffmpeg-*"))[0]
FR = os.path.join(HERE, "frames")
FPS = 30
GROUND = "0xf0eee9"
XF_A = 0.5  # intro -> app crossfade
XF_B = 0.4  # app -> outro crossfade

LAYOUTS = {
    "vertical": dict(
        size="1080x1920",
        screen=(660, 1428),
        at=(210, 300),
        frame="frame.png",
        capsfx="",
        capat=(0, 12),
        intro="intro30",
        outro="outro30",
        out="kashroot-sukkot-2026.mp4",
        seg="seg",
    ),
    "square": dict(
        size="1080x1080",
        screen=(400, 866),
        at=(70, 107),
        frame="frame-sq.png",
        capsfx="-sq",
        capat=(520, 330),
        intro="intro-sq30",
        outro="outro-sq30",
        out="kashroot-sukkot-2026-square.mp4",
        seg="seg-sq",
    ),
}
L = LAYOUTS["square" if "--square" in sys.argv else "vertical"]


def run(args):
    print(" ".join(a if " " not in a else repr(a) for a in args)[:400], "...", flush=True)
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *args], check=True, cwd=HERE)


def nframes(d):
    return len(glob.glob(os.path.join(FR, d, "o*.jpg")))


def encode_seq(seq, out, extra=()):
    run(
        [
            "-framerate",
            str(FPS),
            "-i",
            f"frames/{seq}/o%05d.jpg",
            *extra,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            out,
        ]
    )


def main():
    meta = json.load(open(os.path.join(FR, "app", "meta.json")))
    marks = {m["name"]: m["t"] for m in meta["marks"]}
    app_dur = nframes("app30") / FPS
    intro_dur = nframes(L["intro"]) / FPS
    outro_dur = nframes(L["outro"]) / FPS

    # Caption windows (seconds, relative to the app segment).
    caps = [
        ("cap1", marks["preset"] + 1.9, marks["home"] - 0.35),
        ("cap2", marks["home"] + 0.7, marks["detail"] - 0.25),
        ("cap3", marks["detail"] + 0.7, app_dur),
    ]
    fade = 0.4
    inputs = ["-framerate", str(FPS), "-i", "frames/app30/o%05d.jpg", "-i", f"frames/{L['frame']}"]
    for cid, _, _ in caps:  # noqa: B007 — keep the tuple shape readable
        inputs += [
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-t",
            f"{app_dur:.3f}",
            "-i",
            f"frames/{cid}{L['capsfx']}.png",
        ]
    fc = [
        f"color=c={GROUND}:s={L['size']}:r={FPS}:d={app_dur:.3f}[bg]",
        f"[0:v]scale={L['screen'][0]}:{L['screen'][1]}:flags=lanczos,format=rgba[scr]",
        f"[bg][scr]overlay={L['at'][0]}:{L['at'][1]}:shortest=1[a0]",
        "[a0][1:v]overlay=0:0[a1]",
    ]
    prev = "a1"
    for i, (_cid, s, e) in enumerate(caps):
        idx = 2 + i
        fc.append(
            f"[{idx}:v]format=rgba,fade=t=in:st={s:.3f}:d={fade}:alpha=1,"
            f"fade=t=out:st={e - fade:.3f}:d={fade}:alpha=1[c{i}]"
        )
        fc.append(f"[{prev}][c{i}]overlay={L['capat'][0]}:{L['capat'][1]}:shortest=1[a{i + 2}]")
        prev = f"a{i + 2}"
    fc.append(f"[{prev}]format=yuv420p[out]")
    run(
        [
            *inputs,
            "-filter_complex",
            ";".join(fc),
            "-map",
            "[out]",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            f"{L['seg']}-app.mp4",
        ]
    )
    encode_seq(L["intro"], f"{L['seg']}-intro.mp4")
    encode_seq(L["outro"], f"{L['seg']}-outro.mp4")

    off1 = intro_dur - XF_A
    off2 = off1 + app_dur - XF_B
    run(
        [
            "-i",
            f"{L['seg']}-intro.mp4",
            "-i",
            f"{L['seg']}-app.mp4",
            "-i",
            f"{L['seg']}-outro.mp4",
            "-filter_complex",
            f"[0:v][1:v]xfade=transition=fade:duration={XF_A}:offset={off1:.3f}[ab];"
            f"[ab][2:v]xfade=transition=fade:duration={XF_B}:offset={off2:.3f},format=yuv420p[v]",
            "-map",
            "[v]",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-movflags",
            "+faststart",
            "-an",
            L["out"],
        ]
    )
    total = intro_dur + app_dur + outro_dur - XF_A - XF_B
    shots = {
        "intro": (0, intro_dur),
        "app: launch+preset": (off1 + marks["preset"], off1 + marks["certifiers"]),
        "app: certifiers+requirements": (off1 + marks["certifiers"], off1 + marks["home"]),
        "app: home list": (off1 + marks["home"], off1 + marks["detail"]),
        "app: MATCH detail": (off1 + marks["detail"], off1 + app_dur),
        "outro": (off2, total),
    }
    json.dump(
        {"total": total, "shots": shots, "captions": caps, "off_app": off1, "off_outro": off2},
        open(
            os.path.join(
                HERE, "timeline-square.json" if "--square" in sys.argv else "timeline.json"
            ),
            "w",
        ),
        indent=1,
        ensure_ascii=False,
    )
    for k, (s, e) in shots.items():
        print(f"{s:6.2f}–{e:6.2f}  {k}")
    print("total", round(total, 2))


if __name__ == "__main__":
    main()
