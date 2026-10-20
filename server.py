# -*- coding: utf-8 -*-
"""설교 쇼츠 메이커 - 로컬 서버

실행: start.cmd  (또는 .venv\\Scripts\\python.exe server.py)
브라우저: http://127.0.0.1:8765
"""
import json, os, re, sys, uuid, time, shutil, threading, subprocess, mimetypes, traceback, base64, glob
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "output")
FONTS = os.path.join(ROOT, "fonts")
BGM = os.path.join(ROOT, "bgm")
TPL = os.path.join(ROOT, "data", "my_templates.json")
PORT = int(os.environ.get("SSM_PORT", "8765"))

for d in (DATA, OUT, FONTS, BGM):
    os.makedirs(d, exist_ok=True)


def find_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    pats = [os.path.join(ROOT, "tools", "**", "ffmpeg.exe"), r"C:\ffmpeg\**\ffmpeg.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages", "*FFmpeg*", "**", "ffmpeg.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "ffmpeg.exe")]
    for pat in pats:
        for c in glob.glob(pat, recursive=True):
            return c
    return "ffmpeg"


FFMPEG = find_ffmpeg()
FFPROBE = os.path.join(os.path.dirname(FFMPEG), "ffprobe.exe") if os.path.isabs(FFMPEG) else "ffprobe"
NOWIN = 0x08000000 if os.name == "nt" else 0

JOBS = {}
JOBS_LOCK = threading.Lock()


def new_job(kind):
    jid = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        JOBS[jid] = {"id": jid, "kind": kind, "status": "running", "progress": 0, "message": "준비 중", "result": None, "error": None}
    return jid


def job_update(jid, **kw):
    with JOBS_LOCK:
        JOBS[jid].update(kw)


def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout)[-1500:])
    return p.stdout


def probe_duration(path):
    try:
        out = run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path])
        return float(out.strip())
    except Exception:
        return 0.0


def hms_to_sec(s):
    s = (s or "").strip()
    if not s:
        return None
    parts = [float(x) for x in s.split(":")]
    v = 0.0
    for x in parts:
        v = v * 60 + x
    return v


def pdir(pid):
    return os.path.join(DATA, pid)


def load_project(pid):
    with open(os.path.join(pdir(pid), "project.json"), encoding="utf-8") as f:
        return json.load(f)


def save_project(p):
    path = os.path.join(pdir(p["id"]), "project.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False)
    os.replace(tmp, path)


# ---------------------------------------------------------------- 1. 영상 가져오기 + 받아쓰기

def ingest_worker(jid, pid, opts):
    try:
        p = load_project(pid)
        d = pdir(pid)
        src = os.path.join(d, "source.mp4")
        start, end = hms_to_sec(opts.get("start")), hms_to_sec(opts.get("end"))
        if opts.get("url"):
            job_update(jid, message="유튜브에서 영상 받는 중...", progress=3)
            download_youtube(jid, opts["url"], d, None, None, p)
            os.replace(src, os.path.join(d, "full.mp4"))
            opts["upload"] = "full.mp4"
        if True:
            raw = os.path.join(d, opts["upload"])
            if start is not None or end is not None:
                job_update(jid, message="설교 구간 자르는 중...", progress=5)
                cmd = [FFMPEG, "-y"]
                if start is not None:
                    cmd += ["-ss", str(start)]
                if end is not None:
                    cmd += ["-to", str(end)]
                cmd += ["-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", src]
                run(cmd)
                os.remove(raw)
            elif raw.lower().endswith(".mp4"):
                os.replace(raw, src)
            else:
                job_update(jid, message="영상 변환 중...", progress=5)
                run([FFMPEG, "-y", "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", src])
                os.remove(raw)
        p["duration"] = probe_duration(src)
        p["status"] = "transcribing"
        save_project(p)

        segs = None
        if opts.get("url") and opts.get("useYtSubs"):
            job_update(jid, message="유튜브 자막 확인 중...", progress=40)
            segs = youtube_subs(opts["url"], d, start_offset=hms_to_sec(opts.get("start")) or 0, limit_end=hms_to_sec(opts.get("end")))
        if not segs:
            segs = transcribe(jid, src, opts.get("model") or "large-v3-turbo")
        p["segments"] = segs
        p["status"] = "recommending"
        save_project(p)

        job_update(jid, message="쇼츠로 쓸 만한 구간 찾는 중...", progress=92)
        p["recommend"] = recommend(p, use_ai=opts.get("useAI", True))
        p["status"] = "ready"
        save_project(p)
        make_poster(src, os.path.join(d, "poster.jpg"), p["duration"])
        job_update(jid, status="done", progress=100, message="완료", result={"pid": pid})
    except Exception as e:
        traceback.print_exc()
        try:
            p = load_project(pid)
            p["status"] = "error"
            p["error"] = str(e)[-500:]
            save_project(p)
        except Exception:
            pass
        job_update(jid, status="error", error=str(e)[-800:], message="실패")


def download_youtube(jid, url, d, start, end, p):
    import yt_dlp

    def hook(s):
        if s.get("status") == "downloading":
            tot = s.get("total_bytes") or s.get("total_bytes_estimate") or 0
            if tot:
                job_update(jid, progress=3 + int(30 * s.get("downloaded_bytes", 0) / tot), message="영상 받는 중... %d%%" % int(100 * s.get("downloaded_bytes", 0) / tot))

    ydl_opts = {
        "format": "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][vcodec^=avc1]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(d, "source.%(ext)s"),
        "ffmpeg_location": os.path.dirname(FFMPEG) if os.path.isabs(FFMPEG) else None,
        "quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True,
        "progress_hooks": [hook],
    }
    if start is not None or end is not None:
        from yt_dlp.utils import download_range_func
        ydl_opts["download_ranges"] = download_range_func(None, [(start or 0, end if end is not None else float("inf"))])
        ydl_opts["force_keyframes_at_cuts"] = True
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
    p["title"] = info.get("title") or p.get("title")
    p["channel"] = info.get("channel") or info.get("uploader")
    save_project(p)
    got = glob.glob(os.path.join(d, "source.*"))
    got = [g for g in got if not g.endswith((".part", ".ytdl"))]
    if not got:
        raise RuntimeError("영상을 받지 못했습니다.")
    if not got[0].endswith(".mp4"):
        run([FFMPEG, "-y", "-i", got[0], "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", os.path.join(d, "source.mp4")])
        os.remove(got[0])


def youtube_subs(url, d, start_offset=0, limit_end=None):
    """유튜브 자동자막(json3)이 있으면 단어 타이밍까지 가져온다. 없으면 None."""
    try:
        import yt_dlp
        opts = {"skip_download": True, "writeautomaticsub": True, "writesubtitles": True, "subtitleslangs": ["ko"],
                "subtitlesformat": "json3", "outtmpl": os.path.join(d, "yt"), "quiet": True, "no_warnings": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
        files = glob.glob(os.path.join(d, "yt*.json3"))
        if not files:
            return None
        data = json.load(open(files[0], encoding="utf-8"))
        segs = []
        for ev in data.get("events", []):
            if "segs" not in ev:
                continue
            t0 = ev.get("tStartMs", 0) / 1000.0
            dur = ev.get("dDurationMs", 0) / 1000.0
            words = []
            for s in ev["segs"]:
                w = s.get("utf8", "")
                if not w.strip():
                    continue
                words.append([t0 + s.get("tOffsetMs", 0) / 1000.0, None, w if w.startswith(" ") else " " + w.strip()])
            if not words:
                continue
            for i, w in enumerate(words):
                w[1] = words[i + 1][0] if i + 1 < len(words) else t0 + dur
            if limit_end is not None and words[0][0] > limit_end:
                continue
            if words[-1][1] < start_offset:
                continue
            for w in words:
                w[0] = round(w[0] - start_offset, 2)
                w[1] = round(w[1] - start_offset, 2)
            segs.append({"start": words[0][0], "end": words[-1][1], "text": "".join(w[2] for w in words).strip(), "words": words})
        # 자동자막 이벤트는 겹치므로 정리
        for i in range(len(segs) - 1):
            segs[i]["end"] = min(segs[i]["end"], segs[i + 1]["start"])
            segs[i]["words"][-1][1] = min(segs[i]["words"][-1][1], segs[i + 1]["start"])
        for i, s in enumerate(segs):
            s["id"] = i
        return segs or None
    except Exception:
        traceback.print_exc()
        return None


_MODELS = {}


def transcribe(jid, src, model_name):
    import numpy as np
    from faster_whisper import WhisperModel
    job_update(jid, message="소리 추출 중...", progress=35)
    p = subprocess.run([FFMPEG, "-v", "error", "-i", src, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, creationflags=NOWIN)
    audio = np.frombuffer(p.stdout, dtype=np.float32)
    total = len(audio) / 16000.0
    job_update(jid, message="받아쓰기 모델 불러오는 중...", progress=37)
    if model_name not in _MODELS:
        _MODELS[model_name] = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=max(2, (os.cpu_count() or 4) - 1))
    model = _MODELS[model_name]
    segments, _ = model.transcribe(audio, language="ko", word_timestamps=True, vad_filter=True,
                                   vad_parameters={"min_silence_duration_ms": 500}, beam_size=5,
                                   initial_prompt="오늘 말씀은 하나님의 사랑과 은혜에 대한 설교입니다. 예수님, 성령님, 아멘.")
    out = []
    t0 = time.time()
    for s in segments:
        words = [[round(w.start, 2), round(w.end, 2), w.word] for w in (s.words or [])]
        out.append({"id": len(out), "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(), "words": words})
        frac = min(1.0, s.end / max(total, 1))
        el = time.time() - t0
        eta = int(el / frac - el) if frac > 0.02 else None
        msg = "받아쓰는 중... %d%%" % int(frac * 100) + (" (약 %d분 남음)" % max(1, eta // 60) if eta else "")
        job_update(jid, progress=38 + int(frac * 52), message=msg)
    return out


def make_poster(src, dst, dur):
    try:
        run([FFMPEG, "-y", "-ss", str(min(30, dur / 3)), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", dst])
    except Exception:
        pass


# ---------------------------------------------------------------- 2. 추천 구간

KEYWORDS = ["하나님", "예수", "사랑", "은혜", "믿음", "기도", "십자가", "복음", "성령", "구원", "소망", "축복", "용서",
            "감사", "평안", "생명", "말씀", "회개", "능력", "기적", "인생", "마음", "여러분", "반드시", "절대", "결코", "진짜", "정말"]


def seg_dur(segs, a, b):
    return segs[b]["end"] - segs[a]["start"]


def speech_dur(segs, a, b):
    return sum(sum(w[1] - w[0] for w in s["words"]) or (s["end"] - s["start"]) for s in segs[a:b + 1])


def make_title(text):
    t = re.sub(r"\s+", " ", text).strip()
    words = t.split(" ")
    l1 = " ".join(words[:3])[:12]
    l2 = " ".join(words[3:6])[:14]
    return l1, l2 or "오늘의 말씀"


def heuristic_recommend(segs, n=5):
    if not segs:
        return []
    scores = []
    for i, s in enumerate(segs):
        txt = s["text"]
        sc = sum(txt.count(k) for k in KEYWORDS) * 1.0
        if "?" in txt:
            sc += 0.7
        if "!" in txt:
            sc += 0.5
        sc += min(len(txt), 60) / 60.0 * 0.5
        scores.append(sc)
    # 연속 구간: 30~58초 창
    cands = []
    for a in range(len(segs)):
        b = a
        while b + 1 < len(segs) and seg_dur(segs, a, b + 1) <= 58:
            b += 1
        if seg_dur(segs, a, b) < 25:
            continue
        sc = sum(scores[a:b + 1]) / max(1, seg_dur(segs, a, b)) * 40
        cands.append((sc, a, b))
    cands.sort(reverse=True)
    chosen = []
    for sc, a, b in cands:
        if all(b < x[0] - 2 or a > x[1] + 2 for x in chosen):
            chosen.append((a, b))
        if len(chosen) >= n - 1:
            break
    chosen.sort()
    out = []
    for a, b in chosen:
        best = max(range(a, b + 1), key=lambda i: scores[i])
        l1, l2 = make_title(segs[best]["text"])
        out.append({"title1": l1, "title2": l2, "ranges": [[a, b]], "reason": "핵심 단어가 많이 나오는 구간", "kind": "구간"})
    # 하이라이트 모음: 점수 높은 문장 4개(서로 떨어진)
    order = sorted(range(len(segs)), key=lambda i: -scores[i])
    picks = []
    for i in order:
        d = segs[i]["end"] - segs[i]["start"]
        if d < 3 or d > 16:
            continue
        if all(abs(i - j) > 8 for j in picks):
            picks.append(i)
        if len(picks) >= 4:
            break
    picks.sort()
    if picks:
        out.append({"title1": "오늘 설교", "title2": "핵심만 모았습니다", "ranges": [[i, i] for i in picks], "reason": "핵심 문장 하이라이트 모음", "kind": "하이라이트"})
    return out


def find_claude():
    for name in ("claude.cmd", "claude.exe", "claude"):
        p = shutil.which(name)
        if p:
            return p
    c = os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd")
    return c if os.path.exists(c) else None


def ai_recommend(segs, n=5):
    exe = find_claude()
    if not exe:
        return None
    lines = ["[%d] (%d초) %s" % (s["id"], int(s["start"]), s["text"]) for s in segs]
    prompt = (
        "아래는 교회 설교 영상의 받아쓰기입니다. 각 줄은 [줄번호] (시작초) 문장 입니다.\n"
        "유튜브 쇼츠로 만들기 좋은 구간 %d개를 추천해 주세요.\n"
        "- %d개는 '연속 구간': 앞뒤 맥락 없이도 이해되는 하나의 완결된 메시지, 길이 30~55초.\n"
        "- 마지막 1개는 '하이라이트 모음': 설교 전체에서 가장 울림이 있는 문장 3~4개(서로 떨어진 구간), 합계 30~55초.\n"
        "- 도입 인사, 광고, 기도 순서 안내는 피하세요. 마음을 울리는 결론, 예화의 절정, 강한 선포를 우선하세요.\n"
        "- 제목은 두 줄입니다. title1: 짧은 후킹 문구(10자 이내), title2: 핵심 메시지(12자 이내). 설교 내용에 근거하세요.\n"
        "- ranges는 [시작줄번호, 끝줄번호] 목록이며 끝줄 포함입니다.\n"
        "JSON만 출력하세요. 형식: {\"shorts\":[{\"title1\":\"\",\"title2\":\"\",\"ranges\":[[0,5]],\"reason\":\"추천 이유 한 줄\",\"kind\":\"구간\"|\"하이라이트\"}]}\n\n"
        % (n, n - 1)
    ) + "\n".join(lines)
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONHOME", "VIRTUAL_ENV", "PIP_PREFIX")}
    p = subprocess.run([exe, "-p", "--output-format", "text"], input=prompt, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=300, env=env, creationflags=NOWIN)
    m = re.search(r"\{.*\}", p.stdout, re.S)
    if not m:
        return None
    data = json.loads(m.group(0))
    out = []
    N = len(segs)
    for s in data.get("shorts", []):
        rs = []
        for r in s.get("ranges", []):
            a, b = max(0, min(N - 1, int(r[0]))), max(0, min(N - 1, int(r[1])))
            if b < a:
                a, b = b, a
            rs.append([a, b])
        if rs:
            out.append({"title1": s.get("title1", "")[:16], "title2": s.get("title2", "")[:18], "ranges": rs,
                        "reason": s.get("reason", ""), "kind": s.get("kind", "구간"), "ai": True})
    return out or None


def recommend(p, use_ai=True):
    segs = p.get("segments") or []
    if use_ai:
        try:
            r = ai_recommend(segs)
            if r:
                return r
        except Exception:
            traceback.print_exc()
    return heuristic_recommend(segs)


# ---------------------------------------------------------------- 3. 렌더링

def ass_color(hexstr, alpha=0):
    h = (hexstr or "#FFFFFF").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return "&H%02X%s%s%s" % (alpha, b, g, r)


def ass_time(t):
    t = max(0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return "%d:%02d:%05.2f" % (h, m, s)


def esc(t):
    return (t or "").replace("\\", "＼").replace("{", "(").replace("}", ")").replace("\n", " ")


FONT_MAP = {
    "pretendard-black": "Pretendard-Black",
    "pretendard-extrabold": "Pretendard-ExtraBold",
    "pretendard-bold": "Pretendard-Bold",
    "pretendard-medium": "Pretendard-Medium",
    "blackhansans": "Black Han Sans",
}


def sub_style_def(st, size, color, hl):
    """자막 스타일 프리셋 -> ASS Style 필드"""
    font, bold, border, outline, shadow, back, outc = "Pretendard-Bold", 0, 1, 0, 0, "&H00000000", "&H00000000"
    blur = 0
    if st == "basic":
        font, outline, shadow, back = "Pretendard-Bold", 2.5, 0, "&H64000000"
    elif st == "semi":
        font, border, outline, shadow, back, outc = "Pretendard-Bold", 3, 14, 0, "&H50000000", "&H50000000"
    elif st == "crisp":
        font, outline, shadow = "Pretendard-ExtraBold", 6, 0
    elif st == "bold":
        font, outline, shadow = "Pretendard-Black", 4, 3
        back = "&H80000000"
    elif st == "round":
        font, outline, shadow = "Pretendard-ExtraBold", 7, 0
        blur = 2
    elif st == "soft":
        font, outline, shadow, back = "Pretendard-Medium", 0, 3, "&H78000000"
        blur = 1
    return font, border, outline, shadow, back, outc, blur


def build_ass(item, path):
    L = item["layout"]
    W, H = 1080, 1920
    dur = item["duration"]
    total = dur + (item.get("outro", {}).get("seconds", 0) if item.get("outro", {}).get("on") else 0)
    sub = L.get("sub", {})
    title = L.get("title", {})
    church = L.get("church", {})
    size = int(sub.get("size", 62))
    font, border, outline, shadow, back, outc, blur = sub_style_def(sub.get("style", "basic"), size, sub.get("color"), sub.get("highlight"))
    if sub.get("style") != "semi":
        outc = ass_color(sub.get("outlineColor", "#000000"))
    if L.get("needOutline") and outline < 3 and border == 1:
        outline = 3.5
    st_title = title.get("font", "Pretendard-Black")
    lines = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: %d" % W, "PlayResY: %d" % H, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Sub,%s,%d,%s,%s,%s,%s,0,0,0,0,100,100,0,0,%d,%s,%s,5,40,40,0,1" % (
            font, size, ass_color(sub.get("hlOn") and sub.get("highlight") or sub.get("color", "#FFFFFF")),
            ass_color(sub.get("color", "#FFFFFF")), outc, back, border, outline, shadow),
        "Style: Title,%s,%d,%s,%s,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,%s,%s,8,40,40,0,1" % (
            st_title, int(title.get("size", 86)), ass_color(title.get("color", "#FFFFFF")), ass_color(title.get("color", "#FFFFFF")),
            title.get("outline", 0), title.get("shadow", 0)),
        "Style: Church,Pretendard-Bold,%d,%s,%s,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,%s,0,5,40,40,0,1" % (
            int(church.get("size", 34)), ass_color(church.get("color", "#FFFFFF")), ass_color(church.get("color", "#FFFFFF")), church.get("outline", 0)),
        "Style: Outro,Pretendard-Black,72,%s,%s,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1" % (
            ass_color(church.get("color", "#FFFFFF")), ass_color(church.get("color", "#FFFFFF"))),
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ev = lines.append
    # 타이틀
    if title.get("show") and (item.get("title1") or item.get("title2")):
        x, y = title.get("x", W // 2), title.get("y", 200)
        an = title.get("an", 8)
        t1 = esc(item.get("title1"))
        t2 = esc(item.get("title2"))
        txt = "{\\an%d\\pos(%d,%d)\\fad(250,0)}" % (an, x, y)
        parts = []
        if t1:
            parts.append("{\\c%s}%s" % (ass_color(title.get("color", "#FFFFFF")), t1))
        if t2:
            parts.append("{\\c%s}%s" % (ass_color(title.get("accent", "#7ED957")), t2))
        txt += "\\N".join(parts)
        if title.get("box"):
            # 반투명 띠
            bx = title["box"]
            ev("Dialogue: 0,%s,%s,Title,,0,0,0,,{\\an7\\pos(0,0)\\p1\\c&H000000&\\alpha&H%02X&}m 0 %d l %d %d l %d %d l 0 %d{\\p0}" % (
                ass_time(0), ass_time(dur), bx.get("alpha", 80), bx["y"], W, bx["y"], W, bx["y"] + bx["h"], bx["y"] + bx["h"]))
        ev("Dialogue: 2,%s,%s,Title,,0,0,0,,%s" % (ass_time(0), ass_time(dur), txt))
    # 교회 표시
    if church.get("show") and church.get("name"):
        ev("Dialogue: 2,%s,%s,Church,,0,0,0,,{\\an5\\pos(%d,%d)}%s" % (
            ass_time(0), ass_time(dur), church.get("textX", W // 2), church.get("y", 110), esc(church["name"])))
    # 자막
    motion = sub.get("motion", "pop")
    sy = sub.get("y", 1500)
    if sub.get("lines", 2) > 0:
        for c in item.get("cues", []):
            s, e = c["start"], c["end"]
            pre = "{\\an5\\pos(540,%d)" % sy
            if blur:
                pre += "\\blur%d" % blur
            if motion == "pop":
                pre += "\\fscx88\\fscy88\\t(0,110,\\fscx100\\fscy100)"
            elif motion == "fade":
                pre += "\\fad(140,80)"
            elif motion == "up":
                pre = "{\\an5\\move(540,%d,540,%d,0,140)\\fad(100,0)" % (sy + 28, sy) + ("\\blur%d" % blur if blur else "")
            pre += "}"
            body = []
            for li, line in enumerate(c["lines"]):
                seg = []
                for w in line:
                    txt = esc(w["t"])
                    if motion == "karaoke":
                        k = max(1, int(round((w["e"] - w["s"]) * 100)))
                        seg.append("{\\kf%d}%s" % (k, txt))
                    else:
                        seg.append(txt)
                body.append("".join(seg).strip())
            if motion == "karaoke":
                # 첫 단어 시작 전 지연
                first = c["lines"][0][0]["s"] if c["lines"] and c["lines"][0] else s
                lead = max(0, int(round((first - s) * 100)))
                pre = pre[:-1] + "}" + ("{\\k%d}" % lead if lead else "")
            ev("Dialogue: 1,%s,%s,Sub,,0,0,0,,%s%s" % (ass_time(s), ass_time(e), pre, "\\N".join(body)))
    # 마무리 화면
    outro = item.get("outro", {})
    if outro.get("on"):
        ev("Dialogue: 3,%s,%s,Outro,,0,0,0,,{\\an5\\pos(540,900)\\fad(250,0)}%s" % (ass_time(dur), ass_time(total), esc(outro.get("text1") or church.get("name") or "")))
        if outro.get("text2"):
            ev("Dialogue: 3,%s,%s,Church,,0,0,0,,{\\an5\\pos(540,1010)\\fad(250,0)\\fs40}%s" % (ass_time(dur), ass_time(total), esc(outro["text2"])))
    with open(path, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(lines) + "\n")


def render_one(pid, item, idx, jid, base_prog, span):
    p = load_project(pid)
    src = os.path.join(pdir(pid), "source.mp4")
    L = item["layout"]
    work = os.path.join(pdir(pid), "work")
    os.makedirs(work, exist_ok=True)
    tag = uuid.uuid4().hex[:6]
    ass_rel = os.path.relpath(os.path.join(work, "s_%s.ass" % tag), ROOT).replace("\\", "/")
    build_ass(item, os.path.join(ROOT, ass_rel))

    cmd = [FFMPEG, "-y", "-hide_banner"]
    fc = []
    vparts, aparts = [], []
    ni = 0
    for r in item["ranges"]:
        rs, re_ = r["s"], r["e"]
        cuts = r["cuts"]
        cmd += ["-ss", "%.3f" % rs, "-to", "%.3f" % re_, "-i", src]
        n = len(cuts)
        fc.append("[%d:v]split=%d%s" % (ni, n, "".join("[v%d_%d]" % (ni, k) for k in range(n))))
        fc.append("[%d:a]asplit=%d%s" % (ni, n, "".join("[a%d_%d]" % (ni, k) for k in range(n))))
        for k, (cs, ce) in enumerate(cuts):
            a, b = max(0, cs - rs), max(0.05, ce - rs)
            d = b - a
            fc.append("[v%d_%d]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS[vt%d_%d]" % (ni, k, a, b, ni, k))
            fd = min(0.02, d / 4)
            fc.append("[a%d_%d]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS,afade=t=in:d=%.3f,afade=t=out:st=%.3f:d=%.3f[at%d_%d]" % (
                ni, k, a, b, fd, max(0, d - fd), fd, ni, k))
            vparts.append("[vt%d_%d]" % (ni, k))
            aparts.append("[at%d_%d]" % (ni, k))
        ni += 1
    fc.append("%sconcat=n=%d:v=1:a=1[vc0][ac0]" % ("".join(v + a for v, a in zip(vparts, aparts)), len(vparts)))
    fc.append("[vc0]fps=30,setsar=1,split=2[vm][vb]")
    W, H = 1080, 1920
    bg = L.get("bg", {})
    if bg.get("type") == "blur":
        fc.append("[vb]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,boxblur=40:3,eq=brightness=-0.18,setsar=1[bg]" % (W, H, W, H))
    else:
        cmd += ["-f", "lavfi", "-i", "color=c=0x%s:s=%dx%d:r=30" % ((bg.get("color") or "#000000").lstrip("#"), W, H)]
        fc.append("[vb]nullsink")
        fc.append("[%d:v]format=yuv420p[bg]" % ni)
        ni += 1
    v = L["video"]
    ar = v["w"] / v["h"]
    zoom = float(v.get("zoom", 1.0))
    crop = "crop='min(iw,ih*%.5f)/%.3f':'min(ih,iw/%.5f)/%.3f'" % (ar, zoom, ar, zoom)
    if v.get("focusX") is not None:
        crop += ":'(iw-ow)*%.3f':'(ih-oh)/2'" % float(v["focusX"])
    fc.append("[vm]%s,scale=%d:%d,setsar=1[fg]" % (crop, v["w"], v["h"]))
    fc.append("[bg][fg]overlay=%d:%d:shortest=1,setsar=1[comp0]" % (v["x"], v["y"]))
    last = "comp0"
    church = L.get("church", {})
    logo = church.get("logo")
    if church.get("show") and logo and os.path.exists(os.path.join(DATA, "logos", logo)):
        cmd += ["-loop", "1", "-i", os.path.join(DATA, "logos", logo)]
        lh = int(church.get("logoH", 56))
        fc.append("[%d:v]scale=-1:%d,format=rgba[lg]" % (ni, lh))
        fc.append("[%s][lg]overlay=%d:%d:shortest=1[comp1]" % (last, church.get("logoX", 400), church.get("y", 110) - lh // 2))
        last = "comp1"
        ni += 1
    dur = item["duration"]
    outro = item.get("outro", {})
    alast = "ac0"
    if outro.get("on"):
        od = float(outro.get("seconds", 2.0))
        cmd += ["-f", "lavfi", "-t", "%.2f" % od, "-i", "color=c=0x%s:s=%dx%d:r=30" % ((outro.get("color") or "#000000").lstrip("#"), W, H)]
        cmd += ["-f", "lavfi", "-t", "%.2f" % od, "-i", "anullsrc=r=48000:cl=stereo"]
        fc.append("[%d:v]format=yuv420p,setsar=1[ov]" % ni)
        fc.append("[ac0]aresample=48000,aformat=channel_layouts=stereo[acs]")
        fc.append("[%s][acs][ov][%d:a]concat=n=2:v=1:a=1[vcat][acat]" % (last, ni + 1))
        last, alast = "vcat", "acat"
        ni += 2
        dur += od
    fc.append("[%s]ass=%s:fontsdir=fonts,format=yuv420p[vout]" % (last, ass_rel))
    bgm = item.get("bgm") or {}
    bfile = bgm.get("file")
    if bfile and os.path.exists(os.path.join(BGM, bfile)):
        cmd += ["-stream_loop", "-1", "-i", os.path.join(BGM, bfile)]
        vol = float(bgm.get("volume", 0.12))
        fc.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,volume=%.3f,atrim=0:%.3f,afade=t=in:d=1,afade=t=out:st=%.3f:d=1.5[bga]" % (ni, vol, dur, max(0, dur - 1.5)))
        fc.append("[%s]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[voc]" % alast)
        fc.append("[voc][bga]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]")
        ni += 1
    else:
        fc.append("[%s]aresample=48000,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[aout]" % alast)

    safe = re.sub(r'[\\/:*?"<>|]', "", (item.get("title1", "") + " " + item.get("title2", "")).strip())[:40].strip() or "쇼츠"
    stamp = datetime.now().strftime("%m%d_%H%M%S")
    name = "%s_%02d_%s.mp4" % (stamp, idx + 1, safe.replace(" ", "_"))
    outp = os.path.join(OUT, name)
    fc_path = os.path.join(work, "fc_%s.txt" % tag)
    with open(fc_path, "w", encoding="utf-8") as f:
        f.write(";\n".join(fc))
    cmd += ["-filter_complex_script", fc_path, "-map", "[vout]", "-map", "[aout]", "-t", "%.3f" % dur,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outp]
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    errbuf = []
    th = threading.Thread(target=lambda: errbuf.extend(proc.stderr.readlines()), daemon=True)
    th.start()
    for line in proc.stdout:
        if line.startswith("out_time_us="):
            try:
                t = int(line.split("=")[1]) / 1e6
                job_update(jid, progress=int(base_prog + span * min(1, t / max(dur, 0.1))))
            except ValueError:
                pass
    proc.wait()
    th.join(timeout=2)
    if proc.returncode != 0:
        if os.path.exists(outp):
            os.remove(outp)
        raise RuntimeError("".join(errbuf)[-1500:])
    meta = {"file": name, "title1": item.get("title1"), "title2": item.get("title2"), "duration": round(dur, 1),
            "project": pid, "source": p.get("title"), "created": datetime.now().isoformat(timespec="seconds"),
            "description": item.get("description", "")}
    with open(outp[:-4] + ".json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return meta


def render_worker(jid, pid, items):
    done = []
    try:
        n = len(items)
        for i, it in enumerate(items):
            job_update(jid, message="%d/%d 만드는 중: %s %s" % (i + 1, n, it.get("title1", ""), it.get("title2", "")))
            done.append(render_one(pid, it, i, jid, 100 * i / n, 100 / n))
            job_update(jid, result={"files": done})
        job_update(jid, status="done", progress=100, message="%d개 완성!" % n, result={"files": done})
    except Exception as e:
        traceback.print_exc()
        job_update(jid, status="error", error=str(e)[-1500:], message="만들기 실패", result={"files": done})


# ---------------------------------------------------------------- 배경음악 (저작권 걱정 없는 합성 패드)

def ensure_bgm():
    """저작권 걱정 없는 잔잔한 패드 음악을 직접 합성해 둔다 (처음 1회)."""
    import numpy as np, wave
    presets = {
        "잔잔한_피아노패드.m4a": ([(261.63, 329.63, 392.0), (220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66)], 0.0),
        "따뜻한_찬양패드.m4a": ([(196.0, 246.94, 293.66), (164.81, 196.0, 246.94), (130.81, 164.81, 196.0), (146.83, 185.0, 220.0)], 0.0),
        "묵상_앰비언트.m4a": ([(146.83, 220.0, 293.66), (130.81, 196.0, 261.63), (116.54, 174.61, 233.08), (130.81, 196.0, 261.63)], 0.3),
    }
    sr, seg = 44100, 8.0
    for name, (chords, shimmer) in presets.items():
        path = os.path.join(BGM, name)
        if os.path.exists(path):
            continue
        try:
            total = 32 * 6
            t = np.arange(int(sr * total)) / sr
            out = np.zeros((len(t), 2), dtype=np.float64)
            n = int(sr * seg * 1.5)
            for k in range(int(total / seg)):
                ch = chords[k % len(chords)]
                st = int(k * seg * sr)
                tt = np.arange(min(n, len(t) - st)) / sr
                env = np.sin(np.pi * tt / (seg * 1.5)) ** 2
                sig_l = np.zeros_like(tt)
                sig_r = np.zeros_like(tt)
                for j, fr in enumerate(list(ch) + [ch[0] / 2]):
                    a = 0.6 if j == len(ch) else 1.0
                    sig_l += a * (np.sin(2 * np.pi * fr * tt) + 0.25 * np.sin(4 * np.pi * fr * tt + 0.3))
                    sig_r += a * (np.sin(2 * np.pi * fr * 1.003 * tt + 0.7) + 0.25 * np.sin(4 * np.pi * fr * tt))
                    if shimmer:
                        sig_l += shimmer * 0.3 * np.sin(2 * np.pi * fr * 4 * tt) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.2 * tt))
                out[st:st + len(tt), 0] += env * sig_l
                out[st:st + len(tt), 1] += env * sig_r
            out /= np.max(np.abs(out)) + 1e-9
            out *= 0.6
            fade = int(sr * 3)
            out[:fade] *= np.linspace(0, 1, fade)[:, None]
            out[-fade:] *= np.linspace(1, 0, fade)[:, None]
            wav = path[:-4] + ".wav"
            with wave.open(wav, "wb") as w:
                w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
                w.writeframes((out * 32767).astype("<i2").tobytes())
            tmpm = path[:-4] + ".tmp.m4a"
            run([FFMPEG, "-y", "-i", wav, "-af", "lowpass=f=2200,aecho=0.8:0.8:90|210:0.3|0.2", "-c:a", "aac", "-b:a", "128k", tmpm])
            os.replace(tmpm, path)
            os.remove(wav)
        except Exception:
            traceback.print_exc()

# ---------------------------------------------------------------- HTTP

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def jbody(self):
        b = self.body()
        return json.loads(b.decode("utf-8")) if b else {}

    def send_file(self, path, ctype=None):
        if not os.path.isfile(path):
            return self.send_json({"error": "not found"}, 404)
        size = os.path.getsize(path)
        ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                code = 206
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        if path.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def do_GET(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        if path in ("/", "/index.html"):
            return self.send_file(os.path.join(WEB, "index.html"), "text/html; charset=utf-8")
        if path.startswith("/web/"):
            return self.send_file(os.path.join(WEB, os.path.basename(path)))
        if path.startswith("/fonts/"):
            return self.send_file(os.path.join(FONTS, os.path.basename(path)))
        if path.startswith("/media/"):
            _, _, pid, fn = path.split("/", 3)
            return self.send_file(os.path.join(pdir(os.path.basename(pid)), os.path.basename(fn)))
        if path.startswith("/out/"):
            return self.send_file(os.path.join(OUT, os.path.basename(path)))
        if path.startswith("/logo/"):
            return self.send_file(os.path.join(DATA, "logos", os.path.basename(path)))
        if path.startswith("/bgm/"):
            return self.send_file(os.path.join(BGM, os.path.basename(path)))
        if path == "/api/projects":
            res = []
            for f in sorted(glob.glob(os.path.join(DATA, "*", "project.json")), key=os.path.getmtime, reverse=True):
                try:
                    p = json.load(open(f, encoding="utf-8"))
                    res.append({k: p.get(k) for k in ("id", "title", "status", "duration", "created", "channel")})
                except Exception:
                    pass
            return self.send_json(res)
        if path.startswith("/api/project/"):
            pid = os.path.basename(path)
            try:
                return self.send_json(load_project(pid))
            except FileNotFoundError:
                return self.send_json({"error": "없는 프로젝트"}, 404)
        if path.startswith("/api/job/"):
            with JOBS_LOCK:
                j = dict(JOBS.get(os.path.basename(path)) or {"error": "no job"})
            return self.send_json(j)
        if path == "/api/outputs":
            res = []
            for f in sorted(glob.glob(os.path.join(OUT, "*.mp4")), key=os.path.getmtime, reverse=True):
                m = f[:-4] + ".json"
                meta = json.load(open(m, encoding="utf-8")) if os.path.exists(m) else {"file": os.path.basename(f)}
                meta["cover"] = os.path.basename(f[:-4] + "_cover.png") if os.path.exists(f[:-4] + "_cover.png") else None
                res.append(meta)
            return self.send_json(res)
        if path == "/api/bgm":
            return self.send_json(sorted(os.path.basename(f) for f in glob.glob(os.path.join(BGM, "*")) if f.lower().endswith((".mp3", ".m4a", ".wav", ".aac", ".ogg"))))
        if path == "/api/templates":
            return self.send_json(json.load(open(TPL, encoding="utf-8")) if os.path.exists(TPL) else [])
        if path == "/api/info":
            return self.send_json({"claude": bool(find_claude()), "ffmpeg": FFMPEG})
        return self.send_json({"error": "not found"}, 404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/state/"):
            pid = os.path.basename(path)
            p = load_project(pid)
            st = self.jbody()
            for k in ("shorts", "design", "edits"):
                if k in st:
                    p[k] = st[k]
            save_project(p)
            return self.send_json({"ok": True})
        return self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        q = parse_qs(u.query)
        if path == "/api/ingest":
            pid = datetime.now().strftime("%y%m%d%H%M%S") + "_" + uuid.uuid4().hex[:4]
            os.makedirs(pdir(pid), exist_ok=True)
            ctype = self.headers.get("Content-Type", "")
            if ctype.startswith("application/json"):
                opts = self.jbody()
                title = opts.get("url")
            else:
                opts = json.loads(unquote(self.headers.get("X-Options", "{}")))
                fname = unquote(self.headers.get("X-Filename", "upload.mp4"))
                ext = os.path.splitext(fname)[1].lower() or ".mp4"
                up = "upload" + ext
                n = int(self.headers.get("Content-Length") or 0)
                with open(os.path.join(pdir(pid), up), "wb") as f:
                    left = n
                    while left > 0:
                        chunk = self.rfile.read(min(1 << 20, left))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                opts["upload"] = up
                title = os.path.splitext(fname)[0]
            jid = new_job("ingest")
            p = {"id": pid, "title": title, "status": "importing", "created": datetime.now().isoformat(timespec="seconds"), "segments": [], "job": jid}
            save_project(p)
            threading.Thread(target=ingest_worker, args=(jid, pid, opts), daemon=True).start()
            return self.send_json({"pid": pid, "job": jid})
        if path.startswith("/api/recommend/"):
            pid = os.path.basename(path)
            p = load_project(pid)
            if "segments_override" in q:
                pass
            body = self.jbody()
            if body.get("segments"):
                p["segments"] = body["segments"]
            p["recommend"] = recommend(p, use_ai=body.get("useAI", True))
            save_project(p)
            return self.send_json(p["recommend"])
        if path == "/api/render":
            b = self.jbody()
            jid = new_job("render")
            threading.Thread(target=render_worker, args=(jid, b["pid"], b["items"]), daemon=True).start()
            return self.send_json({"job": jid})
        if path == "/api/cover":
            b = self.jbody()
            data = base64.b64decode(b["png"].split(",", 1)[1])
            fn = b.get("file")
            if fn:
                name = os.path.basename(fn)[:-4] + "_cover.png"
            else:
                safe = re.sub(r'[\\/:*?"<>|\s]+', "_", b.get("name", "cover"))[:40]
                name = datetime.now().strftime("%m%d_%H%M%S") + "_" + safe + "_cover.png"
            with open(os.path.join(OUT, name), "wb") as f:
                f.write(data)
            return self.send_json({"file": name})
        if path == "/api/logo":
            os.makedirs(os.path.join(DATA, "logos"), exist_ok=True)
            fname = unquote(self.headers.get("X-Filename", "logo.png"))
            ext = os.path.splitext(fname)[1].lower() or ".png"
            name = "logo_" + uuid.uuid4().hex[:6] + ext
            with open(os.path.join(DATA, "logos", name), "wb") as f:
                f.write(self.body())
            return self.send_json({"logo": name})
        if path == "/api/bgm-upload":
            fname = os.path.basename(unquote(self.headers.get("X-Filename", "bgm.mp3")))
            with open(os.path.join(BGM, fname), "wb") as f:
                f.write(self.body())
            return self.send_json({"file": fname})
        if path == "/api/templates":
            b = self.jbody()
            with open(TPL, "w", encoding="utf-8") as f:
                json.dump(b, f, ensure_ascii=False, indent=1)
            return self.send_json({"ok": True})
        if path == "/api/open-folder":
            if os.name == "nt":
                os.startfile(OUT)
            return self.send_json({"ok": True})
        if path.startswith("/api/delete-output/"):
            fn = os.path.basename(path)
            for ext in (".mp4", ".json", "_cover.png"):
                f = os.path.join(OUT, fn[:-4] + ext)
                if os.path.exists(f):
                    os.remove(f)
            return self.send_json({"ok": True})
        return self.send_json({"error": "not found"}, 404)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    threading.Thread(target=ensure_bgm, daemon=True).start()
    srv = Server(("127.0.0.1", PORT), H)
    url = "http://127.0.0.1:%d" % PORT
    print("설교 쇼츠 메이커 실행 중:", url)
    if "--no-browser" not in sys.argv:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
    srv.serve_forever()


if __name__ == "__main__":
    main()
