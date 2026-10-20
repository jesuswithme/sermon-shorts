/* 설교 쇼츠 메이커 - 화면 로직 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const toast = (msg, ms = 2200) => {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
};

/* ------------------------------------------------------------ 디자인 / 템플릿 */
const FONTS = {
  "pretendard-black": ["P-Black", "Pretendard-Black"],
  "pretendard-extrabold": ["P-ExtraBold", "Pretendard-ExtraBold"],
  "pretendard-bold": ["P-Bold", "Pretendard-Bold"],
  "pretendard-medium": ["P-Medium", "Pretendard-Medium"],
  blackhansans: ["BHS", "Black Han Sans"],
};
const SUB_FONT = { basic: "P-Bold", semi: "P-Bold", crisp: "P-ExtraBold", bold: "P-Black", round: "P-ExtraBold", soft: "P-Medium" };
const BG = { black: "#000000", white: "#FFFFFF", beige: "#EFE8DC", navy: "#0F1B33", blur: "#000000" };
const ACCENTS = ["#7ED957", "#FFE14D", "#FF8A3D", "#5EC8FF", "#FF6FAE", "#2F8F3A", "#2563EB", "#FFFFFF"];

const BASE = {
  template: "square", bg: "black", fit: "16x9", arr: "stack", zoom: 1, focusX: 0.5,
  title: { show: true, font: "pretendard-black", size: 86, accent: "#7ED957" },
  sub: { lines: 2, style: "basic", motion: "pop", size: 62, offset: 0, highlight: "#FFE14D" },
  church: { show: true },
  outro: { on: false },
};
const TEMPLATES = [
  { id: "focus", name: "말씀 집중형", d: { bg: "black", fit: "16x9", sub: { size: 56 } } },
  { id: "bigsub", name: "큰 자막형", d: { bg: "black", fit: "16x9", sub: { size: 76, style: "bold" } } },
  { id: "square", name: "1:1 여백형", d: { bg: "black", fit: "1x1", sub: { size: 66 } } },
  { id: "focuslight", name: "집중형 밝게", d: { bg: "beige", fit: "16x9", title: { accent: "#2F8F3A" }, sub: { size: 58 } } },
  { id: "squarelight", name: "1:1 밝게", d: { bg: "beige", fit: "1x1", title: { accent: "#2F8F3A" } } },
  { id: "cover", name: "표지 추가형", d: { bg: "black", fit: "16x9", arr: "cover", title: { size: 96 }, outro: { on: true } } },
  { id: "vertical", name: "세로 영상형", d: { bg: "black", fit: "full", arr: "overlay", title: { accent: "#FFE14D" }, sub: { style: "crisp", size: 64 } } },
  { id: "bottom", name: "하단 정보형", d: { bg: "black", fit: "4x5", arr: "bottom", title: { size: 70, accent: "#FFE14D" }, sub: { size: 60 } } },
];
const TRACK = ["bg", "fit", "zoom", "focusX", "title.show", "title.font", "title.size", "title.accent", "sub.lines", "sub.style", "sub.motion", "sub.size", "sub.offset", "sub.highlight", "church.show", "outro.on"];
const LABEL = { bg: "배경", fit: "영상 모양", zoom: "확대", focusX: "좌우 위치", "title.show": "제목 표시", "title.font": "제목 글꼴", "title.size": "제목 크기", "title.accent": "강조색", "sub.lines": "자막 줄 수", "sub.style": "자막 모양", "sub.motion": "자막 움직임", "sub.size": "자막 크기", "sub.offset": "자막 위치", "sub.highlight": "자막 강조색", "church.show": "교회 표시", "outro.on": "마무리 화면" };

function deepMerge(a, b) {
  const o = clone(a);
  for (const k in b || {}) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) o[k] = deepMerge(o[k] || {}, b[k]);
    else o[k] = b[k];
  }
  return o;
}
const getK = (o, k) => k.split(".").reduce((a, x) => (a == null ? a : a[x]), o);
const setK = (o, k, v) => {
  const ks = k.split(".");
  let c = o;
  ks.slice(0, -1).forEach((x) => (c = c[x] = c[x] || {}));
  c[ks[ks.length - 1]] = v;
};
function tplDesign(id) {
  const t = TEMPLATES.find((x) => x.id === id) || S.myTpls.find((x) => x.id === id);
  if (!t) return clone(BASE);
  return deepMerge(BASE, { ...t.d, template: id });
}

/* ------------------------------------------------------------ 상태 */
const S = {
  step: 1, pid: null, p: null, segs: [], edits: {}, shorts: [], cur: 0,
  design: tplDesign("square"),
  extra: { churchName: "", logo: null, outroText: "구독과 좋아요 부탁드립니다", bgm: "", bgmVol: 0.12, silence: true, gap: 0.4 },
  myTpls: [], tplTab: "rec", logoImg: null,
};
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.pid) return;
    api("/api/state/" + S.pid, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shorts: S.shorts, design: S.design, edits: S.edits }) }).catch(() => {});
    localStorage.setItem("ssm_extra", JSON.stringify(S.extra));
    localStorage.setItem("ssm_design", JSON.stringify(S.design));
  }, 600);
}
try {
  Object.assign(S.extra, JSON.parse(localStorage.getItem("ssm_extra") || "{}"));
  const d = JSON.parse(localStorage.getItem("ssm_design") || "null");
  if (d) S.design = deepMerge(BASE, d);
} catch (e) {}

/* ------------------------------------------------------------ 단계 이동 */
function go(step) {
  if (step > 1 && !S.p) return;
  S.step = step;
  $$(".page").forEach((p) => p.classList.add("hidden"));
  $("#step" + step).classList.remove("hidden");
  $$(".step").forEach((b) => {
    const n = +b.dataset.step;
    b.classList.toggle("active", n === step);
    b.classList.toggle("done", n < step);
    b.disabled = n > 1 && !(S.p && S.p.status === "ready");
  });
  if (step === 2) renderStep2();
  if (step === 3) renderStep3();
  if (step !== 3) stopQuick();
}
$$(".step").forEach((b) => (b.onclick = () => go(+b.dataset.step)));

/* ------------------------------------------------------------ STEP 1 */
async function loadRecent() {
  const list = await api("/api/projects");
  $("#recent").innerHTML = list.length
    ? list.map((p) => `<div class="rc" data-id="${p.id}"><img src="/media/${p.id}/poster.jpg" onerror="this.style.visibility='hidden'"><div><b>${esc(p.title || "설교")}</b><small>${p.status === "ready" ? fmt(p.duration) + " · " + (p.created || "").slice(0, 10) : statusKo(p.status)}</small></div></div>`).join("")
    : `<p class="hint">아직 가져온 설교가 없어요.</p>`;
  $$(".rc").forEach((el) => (el.onclick = () => openProject(el.dataset.id)));
}
const statusKo = (s) => ({ importing: "가져오는 중", transcribing: "받아쓰는 중", recommending: "추천 중", error: "실패", ready: "완료" }[s] || s);
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function ingestOpts() {
  return { start: $("#optStart").value, end: $("#optEnd").value, model: $("#optModel").value, useYtSubs: $("#optYt").checked, useAI: $("#optAI").checked };
}
$("#btnIngest").onclick = async () => {
  const url = $("#url").value.trim();
  if (!url) return toast("유튜브 링크를 넣어 주세요");
  const r = await api("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, ...ingestOpts() }) });
  watchIngest(r.pid, r.job);
};
async function uploadFile(f) {
  const prog = $("#ingestProg");
  prog.classList.remove("hidden", "err");
  $(".msg", prog).textContent = "파일 올리는 중...";
  const r = await fetch("/api/ingest", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name), "X-Options": encodeURIComponent(JSON.stringify(ingestOpts())) }, body: f }).then((r) => r.json());
  watchIngest(r.pid, r.job);
}
$("#file").onchange = (e) => e.target.files[0] && uploadFile(e.target.files[0]);
const drop = $("#drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); };

function watchIngest(pid, job) {
  const prog = $("#ingestProg");
  prog.classList.remove("hidden", "err");
  $("#btnIngest").disabled = true;
  const tick = async () => {
    const j = await api("/api/job/" + job).catch(() => null);
    if (!j || j.error === "no job") { $("#btnIngest").disabled = false; return openProject(pid); }
    $(".bar i", prog).style.width = j.progress + "%";
    $(".msg", prog).textContent = j.message + (j.error ? "\n" + j.error : "");
    if (j.status === "running") return setTimeout(tick, 1000);
    $("#btnIngest").disabled = false;
    if (j.status === "error") { prog.classList.add("err"); return; }
    openProject(pid);
  };
  tick();
}
async function openProject(pid) {
  const p = await api("/api/project/" + pid);
  if (p.status !== "ready") {
    if (p.job && p.status !== "error") return watchIngest(pid, p.job);
    return toast(p.status === "error" ? "이 설교는 가져오기에 실패했어요: " + (p.error || "") : "아직 처리 중이에요", 4000);
  }
  S.pid = pid; S.p = p; S.segs = p.segments || []; S.edits = p.edits || {};
  if (p.design) S.design = deepMerge(BASE, p.design);
  S.shorts = p.shorts && p.shorts.length ? p.shorts : recToShorts(p.recommend || []);
  S.cur = 0;
  $("#player").src = `/media/${pid}/source.mp4`;
  $("#hv").src = `/media/${pid}/source.mp4`;
  $("#srcTitle").textContent = p.title || "설교";
  buildTranscript();
  go(2);
  saveState();
}
const recToShorts = (rec) => rec.map((r, i) => ({ id: Date.now() + i, title1: r.title1 || "", title2: r.title2 || "", ranges: r.ranges, on: true, kind: r.kind, reason: r.reason, ai: r.ai }));

/* ------------------------------------------------------------ 자막/구간 계산 */
const segText = (i) => (S.edits[i] != null ? S.edits[i] : S.segs[i].text);
function segWords(i) {
  const s = S.segs[i];
  if (S.edits[i] == null && s.words && s.words.length) return s.words.map(([a, b, t]) => ({ s: a, e: b, t, seg: i }));
  const toks = segText(i).trim().split(/\s+/).filter(Boolean);
  const tot = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
  let t0 = s.start;
  const span = s.end - s.start;
  return toks.map((t) => { const d = (span * (t.length + 1)) / tot; const w = { s: t0, e: t0 + d, t: " " + t, seg: i }; t0 += d; return w; });
}
const mctx = document.createElement("canvas").getContext("2d");
function textW(str, size, family) { mctx.font = `${size}px ${family}`; return mctx.measureText(str).width; }

function buildShort(sh, design = S.design) {
  const dur = S.p ? S.p.duration : 0;
  const gap = S.extra.gap;
  const ranges = [];
  let off = 0;
  const words = [];
  for (const [a, b] of sh.ranges) {
    const rs = Math.max(0, S.segs[a].start - 0.15), re = Math.min(dur || 1e9, S.segs[b].end + 0.3);
    let ws = [];
    for (let i = a; i <= b; i++) ws = ws.concat(segWords(i));
    let cuts = [];
    if (S.extra.silence && ws.length) {
      for (const w of ws) {
        const cs = Math.max(rs, w.s - 0.08), ce = Math.min(re, w.e + 0.14);
        const last = cuts[cuts.length - 1];
        if (last && cs - last[1] <= gap) last[1] = Math.max(last[1], ce);
        else if (last && cs <= last[1]) last[1] = Math.max(last[1], ce);
        else cuts.push([cs, ce]);
      }
      cuts = cuts.filter((c) => c[1] - c[0] > 0.12);
    } else cuts = [[rs, re]];
    const rOff = [];
    for (const c of cuts) { rOff.push(off); off += c[1] - c[0]; }
    for (const w of ws) {
      const m = (w.s + w.e) / 2;
      let k = cuts.findIndex((c) => m >= c[0] && m <= c[1]);
      if (k < 0) k = cuts.reduce((bi, c, i) => (Math.abs(c[0] - m) < Math.abs(cuts[bi][0] - m) ? i : bi), 0);
      const c = cuts[k];
      words.push({ t: w.t, seg: w.seg, src: w.s, s: rOff[k] + Math.max(0, Math.min(c[1], w.s) - c[0]), e: rOff[k] + Math.max(0, Math.min(c[1], w.e) - c[0]), rangeEnd: false });
    }
    if (words.length) words[words.length - 1].rangeEnd = true;
    ranges.push({ s: rs, e: re, cuts });
  }
  const duration = off;
  // 자막 묶기
  const sub = design.sub;
  const fam = SUB_FONT[sub.style] || "P-Bold";
  const maxW = sub.style === "semi" ? 860 : 900;
  const nLines = Math.max(1, sub.lines);
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const cand = cur.concat([w]);
    const txt = cand.map((x) => x.t).join("").trim();
    const tooLong = textW(txt, sub.size, fam) > maxW * nLines * 0.92;
    const tooSlow = cur.length && w.e - cur[0].s > 4.2;
    if (cur.length && (tooLong || tooSlow)) flush();
    cur.push(w);
    const end = /[.?!。…]$/.test(w.t.trim()) || w.rangeEnd || (i + 1 < words.length && words[i + 1].s - w.e > 0.7);
    if (end) flush();
  }
  flush();
  const out = cues.map((ws, i) => {
    let lines = [ws];
    if (nLines === 2) {
      const full = ws.map((x) => x.t).join("").trim();
      if (textW(full, sub.size, fam) > maxW * 0.62 && ws.length > 1) {
        let best = 1, bd = 1e9;
        for (let k = 1; k < ws.length; k++) {
          const a = textW(ws.slice(0, k).map((x) => x.t).join("").trim(), sub.size, fam), b = textW(ws.slice(k).map((x) => x.t).join("").trim(), sub.size, fam);
          const d = Math.abs(a - b) + (a > b ? 0 : 5);
          if (d < bd) { bd = d; best = k; }
        }
        lines = [ws.slice(0, best), ws.slice(best)];
      }
    }
    const start = ws[0].s;
    const nx = cues[i + 1];
    let end = ws[ws.length - 1].e + 0.25;
    if (nx && nx[0].s - end < 0.5) end = nx[0].s;
    end = Math.min(end, duration);
    return { start, end, src: ws[0].src, lines: lines.map((l) => l.map((x, j) => ({ t: j === 0 ? x.t.trimStart() : x.t, s: x.s, e: x.e }))) };
  });
  return { ranges, cues: out, duration, words };
}
function estDur(sh) { try { return buildShort(sh).duration; } catch (e) { return 0; } }

/* ------------------------------------------------------------ STEP 2: 대본 + 드래그 */
let selA = null, selB = null, dragging = false;
function buildTranscript() {
  const box = $("#transcript");
  box.innerHTML = S.segs.map((s, i) => `<div class="seg" data-i="${i}"><span class="t" data-t="${s.start}">${fmt(s.start)}</span><span class="x">${esc(segText(i))}</span></div>`).join("");
  updateMarks();
}
function updateMarks() {
  const curSet = new Set(), other = {};
  S.shorts.forEach((sh, si) => sh.ranges.forEach(([a, b]) => { for (let i = a; i <= b; i++) si === S.cur ? curSet.add(i) : (other[i] = other[i] || si + 1); }));
  const firstOf = {};
  S.shorts.forEach((sh, si) => sh.ranges.forEach(([a]) => { if (!(a in firstOf)) firstOf[a] = si; }));
  const [lo, hi] = selA == null ? [-1, -2] : [Math.min(selA, selB), Math.max(selA, selB)];
  $$("#transcript .seg").forEach((el) => {
    const i = +el.dataset.i;
    el.classList.toggle("in-cur", curSet.has(i));
    el.classList.toggle("in-other", !curSet.has(i) && i in other);
    el.classList.toggle("sel", i >= lo && i <= hi);
    let b = $(".bdg", el);
    if (i in firstOf) {
      if (!b) { b = document.createElement("span"); el.appendChild(b); }
      b.className = "bdg" + (firstOf[i] === S.cur ? "" : " o");
      b.textContent = "쇼츠 " + (firstOf[i] + 1);
    } else if (b) b.remove();
    let ed = $(".ed", el);
    if (S.edits[i] != null && !ed) { ed = document.createElement("span"); ed.className = "ed"; ed.textContent = "고침"; el.appendChild(ed); }
    if (S.edits[i] == null && ed) ed.remove();
  });
}
const tr = $("#transcript");
tr.addEventListener("mousedown", (e) => {
  const el = e.target.closest(".seg");
  if (!el || e.target.classList.contains("t") || e.target.isContentEditable || e.button !== 0) return;
  selA = selB = +el.dataset.i;
  dragging = true;
  updateMarks();
});
tr.addEventListener("mouseover", (e) => {
  if (!dragging) return;
  const el = e.target.closest(".seg");
  if (el) { selB = +el.dataset.i; updateMarks(); showSelBar(); }
});
document.addEventListener("mouseup", () => { if (dragging) { dragging = false; showSelBar(); } });
tr.addEventListener("click", (e) => {
  if (e.target.classList.contains("t")) { const p = $("#player"); p.currentTime = +e.target.dataset.t; p.play(); }
});
tr.addEventListener("dblclick", (e) => {
  const x = e.target.closest(".x");
  if (!x) return;
  const i = +x.parentElement.dataset.i;
  x.contentEditable = "true";
  x.focus();
  x.onblur = () => {
    x.contentEditable = "false";
    const v = x.textContent.trim();
    if (v && v !== S.segs[i].text) S.edits[i] = v; else delete S.edits[i];
    x.textContent = segText(i);
    updateMarks(); saveState(); renderShortList();
  };
  x.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); x.blur(); } if (ev.key === "Escape") { x.textContent = segText(i); x.blur(); } };
});
function selRange() { return [Math.min(selA, selB), Math.max(selA, selB)]; }
function showSelBar() {
  if (selA == null) return $("#selBar").classList.add("hidden");
  const [a, b] = selRange();
  const d = estDur({ ranges: [[a, b]] });
  $("#selInfo").textContent = `${fmt(S.segs[a].start)} ~ ${fmt(S.segs[b].end)} · ${b - a + 1}문장 · 약 ${Math.round(d)}초`;
  $("#selBar").classList.remove("hidden");
}
function clearSel() { selA = selB = null; $("#selBar").classList.add("hidden"); updateMarks(); }
$("#selCancel").onclick = clearSel;
$("#selPlay").onclick = () => { const [a, b] = selRange(); playRange(S.segs[a].start, S.segs[b].end); };
function addRange(sh, a, b) {
  // 겹치면 합치기
  const ov = sh.ranges.find(([x, y]) => !(b < x - 1 || a > y + 1));
  if (ov) { ov[0] = Math.min(ov[0], a); ov[1] = Math.max(ov[1], b); } else sh.ranges.push([a, b]);
}
$("#selAdd").onclick = () => {
  const [a, b] = selRange();
  if (!S.shorts.length) S.shorts.push(newShort());
  addRange(S.shorts[S.cur], a, b);
  clearSel(); renderShortList(); saveState();
};
$("#selNew").onclick = () => {
  const [a, b] = selRange();
  const sh = newShort();
  const words = segText(a).split(/\s+/);
  sh.title1 = words.slice(0, 3).join(" ").slice(0, 12);
  sh.title2 = words.slice(3, 6).join(" ").slice(0, 14);
  sh.ranges.push([a, b]);
  S.shorts.push(sh);
  S.cur = S.shorts.length - 1;
  clearSel(); renderShortList(); saveState();
};
const newShort = () => ({ id: Date.now(), title1: "", title2: "", ranges: [], on: true });
let rangeStop = null;
function playRange(s, e) {
  const p = $("#player");
  p.currentTime = s; p.play();
  clearInterval(rangeStop);
  rangeStop = setInterval(() => { if (p.currentTime >= e || p.paused) { p.pause(); clearInterval(rangeStop); } }, 100);
}
$("#player").addEventListener("timeupdate", () => {
  const t = $("#player").currentTime;
  const el = $("#transcript .seg.playing");
  const i = S.segs.findIndex((s) => t >= s.start && t < s.end);
  if (el && +el.dataset.i === i) return;
  if (el) el.classList.remove("playing");
  if (i >= 0) $(`#transcript .seg[data-i="${i}"]`)?.classList.add("playing");
});
$("#search").oninput = (e) => {
  const q = e.target.value.trim();
  let first = null;
  $$("#transcript .seg").forEach((el) => { const hit = q && segText(+el.dataset.i).includes(q); el.classList.toggle("hit", !!hit); if (hit && !first) first = el; });
  first && first.scrollIntoView({ block: "center" });
};

function renderShortList() {
  const L = $("#shortList");
  $("#shortCount").textContent = `${S.shorts.length}개`;
  L.innerHTML = S.shorts.map((sh, i) => {
    const d = estDur(sh);
    const dtag = sh.ranges.length ? `<span class="tag ${d > 60 ? "over" : d >= 15 ? "ok" : ""}">${Math.round(d)}초</span>` : `<span class="tag">비어 있음 · 대사를 드래그해 추가</span>`;
    return `<div class="sc ${i === S.cur ? "active" : ""}" data-i="${i}">
      <div class="sc-top"><span class="sc-n">${i + 1}</span><div style="flex:1"><input class="ti" data-k="title1" value="${esc(sh.title1)}" placeholder="제목 윗줄"><input class="ti ti2" data-k="title2" value="${esc(sh.title2)}" placeholder="제목 아랫줄(강조)"></div>
      <label class="inc"><input type="checkbox" ${sh.on ? "checked" : ""} data-on>만들기</label><button class="sc-x" title="삭제" data-del>✕</button></div>
      <div class="sc-meta">${dtag}${sh.kind === "하이라이트" || sh.ranges.length > 1 ? `<span class="tag">하이라이트 모음</span>` : ""}${sh.ai ? `<span class="tag ai">AI 추천</span>` : ""}
      ${sh.ranges.map(([a, b], k) => `<span class="chip"><span data-play="${k}">▶ ${fmt(S.segs[a].start)}~${fmt(S.segs[b].end)}</span><button data-rm="${k}" title="구간 빼기">✕</button></span>`).join("")}</div>
      ${sh.reason ? `<div class="reason">💡 ${esc(sh.reason)}</div>` : ""}</div>`;
  }).join("");
  $$(".sc", L).forEach((el) => {
    const i = +el.dataset.i, sh = S.shorts[i];
    el.onclick = (e) => {
      if (e.target.closest("[data-del]")) { if (confirm("이 쇼츠를 지울까요?")) { S.shorts.splice(i, 1); S.cur = Math.max(0, Math.min(S.cur, S.shorts.length - 1)); renderShortList(); saveState(); } return; }
      const rm = e.target.closest("[data-rm]");
      if (rm) { sh.ranges.splice(+rm.dataset.rm, 1); renderShortList(); saveState(); return; }
      const pl = e.target.closest("[data-play]");
      if (pl) { const [a, b] = sh.ranges[+pl.dataset.play]; playRange(S.segs[a].start, S.segs[b].end); }
      if (e.target.matches("input")) { if (S.cur !== i) { S.cur = i; $$(".sc", L).forEach((x) => x.classList.toggle("active", +x.dataset.i === i)); updateMarks(); } return; }
      if (S.cur !== i) { S.cur = i; renderShortList(); }
      if (sh.ranges[0] && !pl) $(`#transcript .seg[data-i="${sh.ranges[0][0]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    $$("input.ti", el).forEach((inp) => (inp.oninput = () => { sh[inp.dataset.k] = inp.value; saveState(); }));
    $("[data-on]", el).onchange = (e) => { sh.on = e.target.checked; saveState(); };
  });
  updateMarks();
}
function renderStep2() { renderShortList(); }
$("#btnAddShort").onclick = () => { S.shorts.push(newShort()); S.cur = S.shorts.length - 1; renderShortList(); saveState(); toast("이제 오른쪽 대사를 드래그해서 추가하세요"); };
$("#btnReRec").onclick = async () => {
  const b = $("#btnReRec");
  b.disabled = true; b.textContent = "추천 받는 중...";
  try {
    const rec = await api("/api/recommend/" + S.pid, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useAI: true }) });
    const keep = S.shorts.filter((s) => !s.ai && s.ranges.length);
    S.shorts = keep.concat(recToShorts(rec));
    S.cur = 0; renderShortList(); saveState(); toast("새 추천 구간을 받았어요");
  } catch (e) { toast("추천 실패: " + e.message); }
  b.disabled = false; b.textContent = "✨ 추천 다시";
};
$("#btnToStep3").onclick = () => {
  if (!S.shorts.some((s) => s.ranges.length)) return toast("먼저 쇼츠에 넣을 대사를 골라 주세요");
  go(3);
};

/* ------------------------------------------------------------ 레이아웃 계산 (미리보기와 실제 영상이 같이 씀) */
function resolveLayout(d, sh) {
  const W = 1080, H = 1920;
  const light = d.bg === "white" || d.bg === "beige";
  const txt = light ? "#1F2328" : "#FFFFFF";
  let arr = d.arr || "stack";
  if (d.fit === "full") arr = "overlay";
  else if (arr === "overlay") arr = "stack";
  if (arr === "bottom" && d.fit !== "4x5") arr = "stack";
  const vh = { "16x9": 608, "1x1": 1080, "4x5": 1350, full: 1920 }[d.fit] || 608;
  const t1 = sh?.title1?.trim(), t2 = sh?.title2?.trim();
  const tn = d.title.show ? (t1 ? 1 : 0) + (t2 ? 1 : 0) : 0;
  const tsz = d.title.size, tH = tn * tsz * 1.18;
  const ssz = d.sub.size, sH = Math.max(1, d.sub.lines) * ssz * 1.3;
  const tFont = FONTS[d.title.font] || FONTS["pretendard-black"];
  const L = {
    bg: { type: d.bg === "blur" ? "blur" : "color", color: BG[d.bg] || "#000000" },
    video: { x: 0, y: 0, w: W, h: vh, zoom: d.zoom || 1, focusX: d.focusX ?? 0.5 },
    title: { show: d.title.show && tn > 0, x: W / 2, y: 200, an: 8, size: tsz, color: txt, accent: d.title.accent, font: tFont[1], css: tFont[0], outline: 0, shadow: 0 },
    sub: { y: 1400, size: ssz, style: d.sub.style, motion: d.sub.motion, lines: d.sub.lines, color: txt, highlight: d.sub.highlight, hlOn: false, outlineColor: light ? "#FFFFFF" : "#000000", css: SUB_FONT[d.sub.style] || "P-Bold" },
    church: { show: d.church.show && !!S.extra.churchName, name: S.extra.churchName, y: 105, size: 34, color: txt, outline: 0, logo: S.extra.logo, logoH: 54 },
    needOutline: false,
  };
  if (d.sub.style === "semi") L.sub.color = "#FFFFFF";
  if (arr === "stack" || arr === "cover") {
    const vy = { "16x9": arr === "cover" ? 700 : 640, "1x1": 440, "4x5": 330 }[d.fit];
    L.video.y = vy;
    L.title.y = Math.max(165, vy - 55 - tH);
    if (d.fit === "4x5") { L.sub.y = vy + vh - 170; L.needOutline = true; L.sub.color = "#FFFFFF"; L.sub.outlineColor = "#000000"; }
    else L.sub.y = Math.min(H - 140, vy + vh + 70 + sH / 2);
    if (arr === "cover") { L.church.y = 1790; L.church.size = 38; L.church.logoH = 64; }
  } else if (arr === "overlay") {
    L.video = { x: 0, y: 0, w: W, h: H, zoom: d.zoom || 1, focusX: d.focusX ?? 0.5 };
    L.title.y = 190; L.title.color = "#FFFFFF"; L.title.outline = 5; L.title.shadow = 2;
    L.church.y = 110; L.church.color = "#FFFFFF"; L.church.outline = 2.5;
    L.sub.y = 1430; L.sub.color = "#FFFFFF"; L.sub.outlineColor = "#000000"; L.needOutline = true;
  } else if (arr === "bottom") {
    L.video.y = 0;
    L.church.y = 80; L.church.color = "#FFFFFF"; L.church.outline = 2.5;
    L.sub.y = vh + 60 + sH / 2;
    L.title.an = 7; L.title.x = 80; L.title.y = Math.min(H - tH - 70, vh + 60 + sH + 50); L.title.color = txt;
  }
  L.sub.y += +d.sub.offset || 0;
  if (d.sub.motion === "karaoke") L.sub.hlOn = true;
  // 교회 이름 + 로고 위치
  const tw = L.church.show ? textW(L.church.name, L.church.size, "P-Bold") : 0;
  const lw = L.church.logo && S.logoImg ? (L.church.logoH * S.logoImg.naturalWidth) / S.logoImg.naturalHeight : 0;
  const gapL = lw ? 12 : 0;
  const tot = lw + gapL + tw;
  L.church.logoX = Math.round(W / 2 - tot / 2);
  L.church.textX = Math.round(W / 2 - tot / 2 + lw + gapL + tw / 2);
  L.church.logoW = lw;
  L.outroColor = BG[d.bg] || "#000000";
  return L;
}

/* ------------------------------------------------------------ 캔버스 그리기 */
function drawFrame(ctx, L, sh, cue, t, vid, opt = {}) {
  const W = 1080, H = 1920;
  ctx.save();
  ctx.fillStyle = L.bg.color;
  ctx.fillRect(0, 0, W, H);
  const ready = vid && vid.readyState >= 2 && vid.videoWidth;
  if (L.bg.type === "blur" && ready) {
    const vw = vid.videoWidth, vh = vid.videoHeight, sc = Math.max(W / vw, H / vh);
    ctx.filter = "blur(36px) brightness(0.8)";
    ctx.drawImage(vid, (W - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
    ctx.filter = "none";
  }
  const v = L.video;
  if (ready) {
    const vw = vid.videoWidth, vh = vid.videoHeight, ar = v.w / v.h, z = v.zoom || 1;
    const sw = Math.min(vw, vh * ar) / z, shh = Math.min(vh, vw / ar) / z;
    const sx = (vw - sw) * (v.focusX ?? 0.5), sy = (vh - shh) / 2;
    ctx.drawImage(vid, sx, sy, sw, shh, v.x, v.y, v.w, v.h);
  } else {
    ctx.fillStyle = "#2b2f36"; ctx.fillRect(v.x, v.y, v.w, v.h);
  }
  // 제목
  if (L.title.show && !opt.noTitle) {
    const lines = [];
    if (sh.title1?.trim()) lines.push([sh.title1.trim(), L.title.color]);
    if (sh.title2?.trim()) lines.push([sh.title2.trim(), L.title.accent]);
    ctx.font = `${L.title.size}px ${L.title.css}`;
    ctx.textAlign = L.title.an === 7 ? "left" : "center";
    ctx.textBaseline = "top";
    lines.forEach(([s, c], i) => {
      const y = L.title.y + i * L.title.size * 1.18;
      if (L.title.outline) { ctx.lineJoin = "round"; ctx.strokeStyle = "#000"; ctx.lineWidth = L.title.outline * 2; ctx.strokeText(s, L.title.x, y); }
      ctx.fillStyle = c; ctx.fillText(s, L.title.x, y);
    });
  }
  // 교회
  const ch = L.church;
  if (ch.show) {
    if (ch.logoW && S.logoImg) ctx.drawImage(S.logoImg, ch.logoX, ch.y - ch.logoH / 2, ch.logoW, ch.logoH);
    ctx.font = `${ch.size}px P-Bold`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (ch.outline) { ctx.strokeStyle = "#000"; ctx.lineWidth = ch.outline * 2; ctx.strokeText(ch.name, ch.textX, ch.y); }
    ctx.fillStyle = ch.color; ctx.fillText(ch.name, ch.textX, ch.y);
  }
  // 자막
  if (cue && L.sub.lines > 0) drawCue(ctx, L, cue, t);
  ctx.restore();
}
function drawCue(ctx, L, cue, t) {
  const s = L.sub, size = s.size, lh = size * 1.25;
  const st = s.style;
  ctx.font = `${st === "bold" ? Math.round(size) : size}px ${s.css}`;
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.lineJoin = "round";
  const n = cue.lines.length;
  let outline = { basic: 2.5, crisp: 6, bold: 4, round: 7, soft: 0, semi: 0 }[st] ?? 2.5;
  if (L.needOutline && outline < 3 && st !== "semi") outline = 3.5;
  let scale = 1;
  if (s.motion === "pop" && t != null) scale = 0.88 + 0.12 * Math.min(1, Math.max(0, (t - cue.start) / 0.11));
  ctx.save();
  ctx.translate(540, s.y); ctx.scale(scale, scale);
  if (s.motion === "fade" && t != null) ctx.globalAlpha = Math.min(1, Math.max(0, (t - cue.start) / 0.14));
  cue.lines.forEach((line, li) => {
    const str = line.map((w) => w.t).join("");
    const w = ctx.measureText(str).width;
    const y = (li - (n - 1) / 2) * lh;
    let x = -w / 2;
    if (st === "semi") { ctx.fillStyle = "rgba(0,0,0,.69)"; ctx.fillRect(x - 14, y - size * 0.62 - 6, w + 28, size * 1.24 + 12); }
    if (st === "soft" || st === "bold") { ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowOffsetX = ctx.shadowOffsetY = 3; ctx.shadowBlur = st === "soft" ? 6 : 0; }
    if (outline) { ctx.strokeStyle = s.outlineColor; ctx.lineWidth = outline * 2; if (st === "round") ctx.filter = "blur(1px)"; ctx.strokeText(str, x, y); ctx.filter = "none"; }
    ctx.shadowColor = "transparent";
    for (const wd of line) {
      ctx.fillStyle = s.hlOn && t != null && wd.s <= t ? s.highlight : s.color;
      ctx.fillText(wd.t, x, y);
      x += ctx.measureText(wd.t).width;
    }
  });
  ctx.restore();
}

/* ------------------------------------------------------------ STEP 3 */
const hv = $("#hv");
let built = null, pvCue = null;
function curShort() { return S.shorts[S.cur]; }
function renderStep3() {
  const valid = S.shorts.map((s, i) => [s, i]).filter(([s]) => s.ranges.length);
  if (!curShort()?.ranges.length && valid.length) S.cur = valid[0][1];
  $("#pickShort").innerHTML = S.shorts.map((s, i) => s.ranges.length ? `<option value="${i}" ${i === S.cur ? "selected" : ""}>${i + 1}/${S.shorts.length}  ${esc(s.title1)} ${esc(s.title2)} ${s.on ? "" : "(만들기 제외)"} · ${Math.round(estDur(s))}초</option>` : "").join("");
  syncControls();
  buildTplGrid();
  refreshPreview();
  loadBgm();
}
$("#pickShort").onchange = (e) => { S.cur = +e.target.value; syncControls(); refreshPreview(); };
$("#t1").oninput = (e) => { curShort().title1 = e.target.value; saveState(); drawAll(); };
$("#t2").oninput = (e) => { curShort().title2 = e.target.value; saveState(); drawAll(); };
$("#churchName").oninput = (e) => { S.extra.churchName = e.target.value.trim(); saveState(); drawAll(); };
$("#outroText").oninput = (e) => { S.extra.outroText = e.target.value; saveState(); };

function syncControls() {
  const d = S.design, sh = curShort() || {};
  $("#t1").value = sh.title1 || ""; $("#t2").value = sh.title2 || "";
  if ($("#pickShort").value !== String(S.cur)) $("#pickShort").value = String(S.cur);
  $("#churchName").value = S.extra.churchName;
  $("#outroText").value = S.extra.outroText;
  $$(".chips[data-k]").forEach((c) => {
    const k = c.dataset.k;
    let v = k === "silence.on" ? S.extra.silence : getK(d, k);
    $$("button", c).forEach((b) => b.classList.toggle("on", String(v) === b.dataset.v));
  });
  $$("#quickLines button").forEach((b) => b.classList.toggle("on", +b.dataset.v === d.sub.lines));
  $$("input[type=range][data-k]").forEach((r) => {
    const k = r.dataset.k;
    r.value = k === "bgm.volume" ? S.extra.bgmVol : k === "silence.gap" ? S.extra.gap : getK(d, k);
  });
  $$(".colors[data-k]").forEach((c) => {
    const k = c.dataset.k;
    c.innerHTML = ACCENTS.map((col) => `<button style="background:${col}" data-v="${col}" class="${getK(d, k) === col ? "on" : ""}"></button>`).join("");
  });
  $("#zoomVal").textContent = (+d.zoom).toFixed(2) + "x";
  $("#focusVal").textContent = Math.round(d.focusX * 100) + "%";
  $("#tSizeVal").textContent = d.title.size;
  $("#sSizeVal").textContent = d.sub.size;
  $("#sOffVal").textContent = d.sub.offset;
  $("#bgmVolVal").textContent = Math.round(S.extra.bgmVol * 100) + "%";
  $("#gapVal").textContent = S.extra.gap.toFixed(2) + "초";
  $("#logoPrev").src = S.extra.logo ? "/logo/" + S.extra.logo : "";
  // 요약
  const bgN = { black: "검정", white: "흰색", beige: "베이지", navy: "남색", blur: "흐린 원본" }[d.bg];
  const fitN = { "16x9": "원본", "1x1": "1:1", "4x5": "4:5", full: "세로 꽉" }[d.fit];
  $("#sumTitle").textContent = `${sh.title1 || ""} ${sh.title2 || ""}`;
  $("#sumBg").textContent = `${fitN} · ${bgN}`;
  $("#sumTitleStyle").textContent = d.title.show ? `표시 · ${d.title.size}` : "없음";
  $("#sumSub").textContent = `${["없음", "한 줄", "두 줄"][d.sub.lines]} · ${$(`[data-k="sub.style"] [data-v="${d.sub.style}"]`).textContent} · ${$(`[data-k="sub.motion"] [data-v="${d.sub.motion}"]`).textContent}`;
  $("#sumChurch").textContent = d.church.show ? (S.extra.churchName || "이름을 넣어 주세요") + (d.outro.on ? " · 마무리 화면" : "") : "없음";
  $("#sumBgm").textContent = `${S.extra.bgm ? S.extra.bgm.replace(/\.[^.]+$/, "") : "음악 없음"} · 무음 삭제 ${S.extra.silence ? "켜짐" : "꺼짐"}`;
  // 바뀐 개수
  const base = tplDesign(d.template);
  const changed = TRACK.filter((k) => JSON.stringify(getK(base, k)) !== JSON.stringify(getK(d, k)));
  const tname = (TEMPLATES.find((t) => t.id === d.template) || S.myTpls.find((t) => t.id === d.template) || { name: "기본" }).name;
  $("#chgBadge").classList.toggle("hidden", !changed.length);
  $("#chgBadge").textContent = changed.length + "개 바꿈";
  $("#chgBanner").classList.toggle("hidden", !changed.length);
  $("#chgText").textContent = `「${tname}」에서 ${changed.length}개를 바꿨습니다 (${changed.map((k) => LABEL[k]).join(", ")})`;
  const sel = S.shorts.filter((s) => s.on && s.ranges.length).length;
  $("#renderN").textContent = sel;
  $$(".tpl").forEach((el) => el.classList.toggle("on", el.dataset.id === d.template));
  const ar = hv.videoWidth / hv.videoHeight;
  $("#tplNote").textContent = ar > 1.3 ? "넣으신 영상이 가로라, 「1:1」과 「세로 영상형」은 좌우가 꽤 잘립니다. 고급 설정의 '좌우 위치'로 설교자 쪽을 맞춰 주세요." : "";
  checkWarnings();
}
function setDesign(k, v) {
  if (k === "silence.on") S.extra.silence = v;
  else if (k === "silence.gap") S.extra.gap = v;
  else if (k === "bgm.volume") S.extra.bgmVol = v;
  else setK(S.design, k, v);
  if (k === "fit") S.design.arr = v === "full" ? "overlay" : S.design.arr === "overlay" ? "stack" : S.design.arr;
  saveState(); syncControls();
  if (k.startsWith("sub") || k.startsWith("silence")) refreshPreview(); else drawAll();
}
$$(".chips[data-k]").forEach((c) => c.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  let v = b.dataset.v;
  v = v === "true" ? true : v === "false" ? false : v;
  setDesign(c.dataset.k, v);
}));
$("#quickLines").onclick = (e) => { const b = e.target.closest("button"); if (b) setDesign("sub.lines", +b.dataset.v); };
$$("input[type=range][data-k]").forEach((r) => (r.oninput = () => setDesign(r.dataset.k, +r.value)));
$$(".colors[data-k]").forEach((c) => c.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setDesign(c.dataset.k, b.dataset.v); }));
$("#btnReset").onclick = () => { S.design = tplDesign(S.design.template); saveState(); syncControls(); refreshPreview(); };

// 템플릿 그리드
function buildTplGrid() {
  const list = S.tplTab === "rec" ? TEMPLATES : S.myTpls;
  $$(".seg-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tplTab));
  $("#tplGrid").innerHTML = list.length
    ? list.map((t) => `<div class="tpl ${t.id === S.design.template ? "on" : ""}" data-id="${t.id}"><canvas width="216" height="384"></canvas><span>${esc(t.name)}</span>${S.tplTab === "mine" ? `<button class="del" data-del="${t.id}">지우기</button>` : ""}</div>`).join("")
    : `<p class="hint" style="grid-column:1/-1">아직 저장한 서식이 없어요. 아래 '내 서식으로 저장'을 눌러 보세요.</p>`;
  $$(".tpl").forEach((el) => (el.onclick = (e) => {
    if (e.target.dataset.del) { S.myTpls = S.myTpls.filter((x) => x.id !== e.target.dataset.del); api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.myTpls) }); buildTplGrid(); return; }
    S.design = tplDesign(el.dataset.id); saveState(); syncControls(); refreshPreview();
  }));
  drawThumbs();
}
$$(".seg-toggle button").forEach((b) => (b.onclick = () => { S.tplTab = b.dataset.tab; buildTplGrid(); }));
$("#btnSaveTpl").onclick = async () => {
  const name = prompt("서식 이름을 정해 주세요", "우리교회 서식");
  if (!name) return;
  const d = clone(S.design);
  const id = "my_" + Date.now();
  delete d.template;
  S.myTpls.push({ id, name, d });
  S.design.template = id;
  await api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S.myTpls) });
  S.tplTab = "mine"; buildTplGrid(); syncControls(); toast("내 서식에 저장했어요");
};

// 미리보기
function refreshPreview() {
  const sh = curShort();
  if (!sh || !sh.ranges.length) return;
  built = buildShort(sh);
  const c = built.cues.find((x) => x.end - x.start > 1 && x.lines[0].length > 2) || built.cues[0];
  pvCue = c;
  const srcT = c ? c.src + 0.3 : S.segs[sh.ranges[0][0]].start + 1;
  if (Math.abs(hv.currentTime - srcT) > 0.05) { hv.currentTime = srcT; } else drawAll();
}
hv.addEventListener("seeked", () => { if (!quick) drawAll(); });
hv.addEventListener("loadeddata", () => { if (S.step === 3) { syncControls(); drawAll(); } });
function drawAll() {
  const sh = curShort();
  if (!sh) return;
  const L = resolveLayout(S.design, sh);
  const ctx = $("#pv").getContext("2d");
  drawFrame(ctx, L, sh, pvCue, pvCue ? (pvCue.start + pvCue.end) / 2 : null, hv);
  drawThumbs();
  checkWarnings();
}
function drawThumbs() {
  const sh = curShort();
  if (!sh) return;
  $$(".tpl").forEach((el) => {
    const id = el.dataset.id;
    const d = id === S.design.template ? S.design : tplDesign(id);
    const ctx = $("canvas", el).getContext("2d");
    ctx.setTransform(0.2, 0, 0, 0.2, 0, 0);
    const b = buildShort(sh, d);
    const cue = b.cues.find((x) => x.lines[0].length > 2) || b.cues[0];
    drawFrame(ctx, resolveLayout(d, sh), sh, cue, cue ? cue.end : null, hv);
  });
}

// 빠른 전체 미리보기
let quick = null;
$("#btnQuick").onclick = () => (quick ? stopQuick() : startQuick());
function startQuick() {
  const sh = curShort();
  if (!sh || !sh.ranges.length) return;
  const b = buildShort(sh);
  const cuts = [];
  let off = 0;
  b.ranges.forEach((r) => r.cuts.forEach((c) => { cuts.push({ s: c[0], e: c[1], off }); off += c[1] - c[0]; }));
  quick = { cuts, k: 0, b, L: resolveLayout(S.design, sh), sh };
  hv.muted = false;
  hv.currentTime = cuts[0].s;
  hv.play();
  $("#btnQuick").textContent = "■ 미리보기 멈추기";
  $("#pvTime").classList.remove("hidden");
  if (S.extra.bgm) { const a = $("#bgmAudio"); a.src = "/bgm/" + encodeURIComponent(S.extra.bgm); a.volume = Math.min(1, S.extra.bgmVol * 2.2); a.currentTime = 0; a.play(); }
  const ctx = $("#pv").getContext("2d");
  const loop = () => {
    if (!quick) return;
    const q = quick, c = q.cuts[q.k], t = hv.currentTime;
    if (t >= c.e - 0.02 && !hv.seeking) {
      q.k++;
      if (q.k >= q.cuts.length) return stopQuick();
      hv.currentTime = q.cuts[q.k].s;
    }
    const cc = q.cuts[q.k];
    const ot = cc.off + Math.max(0, hv.currentTime - cc.s);
    const cue = q.b.cues.find((x) => ot >= x.start && ot < x.end);
    drawFrame(ctx, q.L, q.sh, cue, ot, hv);
    $("#pvTime").textContent = `${fmt(ot)} / ${fmt(q.b.duration)}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function stopQuick() {
  if (!quick) return;
  quick = null;
  hv.pause(); hv.muted = true;
  $("#bgmAudio").pause();
  $("#btnQuick").textContent = "▶ 빠른 전체 미리보기";
  $("#pvTime").classList.add("hidden");
  refreshPreview();
}

// 화면 자막 다듬기
$("#btnSubs").onclick = () => {
  const sh = curShort();
  if (!sh) return;
  const ids = [];
  sh.ranges.forEach(([a, b]) => { for (let i = a; i <= b; i++) ids.push(i); });
  openModal("화면 자막 다듬기", `<p class="hint">받아쓰기가 틀린 글자를 고치세요. 고친 내용은 이 설교의 모든 쇼츠에 같이 적용됩니다.</p>` +
    ids.map((i) => `<div class="cue-ed"><small>${fmt(S.segs[i].start)}</small><textarea data-i="${i}" rows="1">${esc(segText(i))}</textarea></div>`).join("") +
    `<div style="text-align:right;margin-top:10px"><button class="btn primary" id="subsSave">저장</button></div>`);
  $("#subsSave").onclick = () => {
    $$("#modalBody textarea").forEach((ta) => { const i = +ta.dataset.i, v = ta.value.trim(); if (v && v !== S.segs[i].text) S.edits[i] = v; else delete S.edits[i]; });
    closeModal(); saveState(); buildTranscript(); refreshPreview(); toast("자막을 고쳤어요");
  };
};

// 커버 이미지
$("#btnCover").onclick = async () => {
  const sh = curShort();
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1920;
  const L = resolveLayout(S.design, sh);
  drawFrame(c.getContext("2d"), L, sh, null, null, hv);
  const png = c.toDataURL("image/png");
  const r = await api("/api/cover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ png, name: `${sh.title1}_${sh.title2}` }) });
  const a = document.createElement("a");
  a.href = png; a.download = r.file; a.click();
  toast("커버 이미지를 저장했어요 (output 폴더)");
};

// 확인 필요 항목
function checkWarnings() {
  const w = [];
  S.shorts.forEach((s, i) => {
    if (!s.on || !s.ranges.length) return;
    const d = estDur(s);
    const n = `쇼츠 ${i + 1}`;
    if (d > 60) w.push(`${n}: ${Math.round(d)}초예요. 유튜브 쇼츠는 60초 이하가 안전해요 (3분까지 허용되지만 추천 노출은 짧을수록 유리).`);
    if (d < 8) w.push(`${n}: ${Math.round(d)}초로 너무 짧아요.`);
    if (S.design.title.show && !s.title1.trim() && !s.title2.trim()) w.push(`${n}: 제목이 비어 있어요.`);
  });
  if (S.design.church.show && !S.extra.churchName) w.push("교회 표시가 켜져 있지만 교회 이름이 비어 있어요 (교회 표시 메뉴).");
  if (!S.shorts.some((s) => s.on && s.ranges.length)) w.push("만들 쇼츠가 선택되지 않았어요.");
  $("#warnBox").classList.toggle("hidden", !w.length);
  $("#warnCount").textContent = w.length;
  $("#warnList").innerHTML = w.map((x) => `<li>${esc(x)}</li>`).join("");
}
$("#warnToggle").onclick = () => $("#warnList").classList.toggle("hidden");

// 로고 / 배경음악
$("#logoFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = await fetch("/api/logo", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name) }, body: f }).then((r) => r.json());
  S.extra.logo = r.logo; loadLogo(); saveState(); syncControls();
};
$("#logoClear").onclick = () => { S.extra.logo = null; S.logoImg = null; saveState(); syncControls(); drawAll(); };
function loadLogo() {
  if (!S.extra.logo) return (S.logoImg = null);
  const im = new Image();
  im.onload = () => { S.logoImg = im; drawAll(); };
  im.src = "/logo/" + S.extra.logo;
}
async function loadBgm() {
  const list = await api("/api/bgm");
  $("#bgmSel").innerHTML = `<option value="">음악 없음</option>` + list.map((f) => `<option ${f === S.extra.bgm ? "selected" : ""}>${esc(f)}</option>`).join("");
}
$("#bgmSel").onchange = (e) => { S.extra.bgm = e.target.value; saveState(); syncControls(); };
$("#bgmPlay").onclick = () => {
  const a = $("#bgmAudio");
  if (!a.paused) return a.pause();
  if (!S.extra.bgm) return toast("음악을 먼저 고르세요");
  a.src = "/bgm/" + encodeURIComponent(S.extra.bgm); a.volume = 0.6; a.play();
};
$("#bgmFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = await fetch("/api/bgm-upload", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name) }, body: f }).then((r) => r.json());
  S.extra.bgm = r.file; await loadBgm(); saveState(); syncControls(); toast("배경음악을 추가했어요");
};

// 만들기
$("#btnRender").onclick = async () => {
  const items = [];
  for (const sh of S.shorts) {
    if (!sh.on || !sh.ranges.length) continue;
    const b = buildShort(sh);
    const L = resolveLayout(S.design, sh);
    items.push({
      title1: sh.title1, title2: sh.title2, ranges: b.ranges, duration: b.duration, layout: L,
      cues: b.cues.map((c) => ({ start: c.start, end: c.end, lines: c.lines })),
      outro: { on: S.design.outro.on, seconds: 2, text1: S.extra.churchName, text2: S.extra.outroText, color: L.outroColor },
      bgm: { file: S.extra.bgm, volume: S.extra.bgmVol },
      description: `${sh.title1} ${sh.title2}\n\n${S.p.title || ""}\n${S.extra.churchName ? S.extra.churchName + "\n" : ""}\n#설교 #말씀 #쇼츠 #교회${S.extra.churchName ? " #" + S.extra.churchName.replace(/\s/g, "") : ""}`,
    });
  }
  if (!items.length) return toast("만들 쇼츠를 골라 주세요");
  stopQuick();
  const btn = $("#btnRender");
  btn.disabled = true;
  const prog = $("#renderProg");
  prog.classList.remove("hidden", "err");
  $("#renderDone").innerHTML = "";
  const r = await api("/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: S.pid, items }) });
  const tick = async () => {
    const j = await api("/api/job/" + r.job);
    $(".bar i", prog).style.width = j.progress + "%";
    $(".msg", prog).textContent = j.message + (j.error ? "\n" + j.error : "");
    showDone(j.result?.files || []);
    if (j.status === "running") return setTimeout(tick, 1000);
    btn.disabled = false;
    if (j.status === "error") prog.classList.add("err");
    else toast(`${items.length}개 쇼츠를 만들었어요!`, 3500);
    refreshSaved();
  };
  tick();
};
function showDone(files) {
  $("#renderDone").innerHTML = files.length ? `<div class="done-list">${files.map((f) => `<div class="done-item"><video src="/out/${encodeURIComponent(f.file)}" muted preload="metadata"></video><b>${esc(f.title1)} ${esc(f.title2)}<br><small>${f.duration}초</small></b><a class="btn sm ghost" href="/out/${encodeURIComponent(f.file)}" download>받기</a></div>`).join("")}<button class="btn sm ghost" onclick="openFolder()">📂 폴더 열기</button></div>` : "";
}
window.openFolder = () => api("/api/open-folder", { method: "POST" });

/* ------------------------------------------------------------ 저장된 쇼츠 / 모달 */
function openModal(title, html) { $("#modalTitle").textContent = title; $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $$("#modalBody video").forEach((v) => v.pause()); }
$("#modalClose").onclick = closeModal;
$("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
async function refreshSaved() { const o = await api("/api/outputs"); $("#savedCount").textContent = o.length; return o; }
$("#btnSaved").onclick = async () => {
  const o = await refreshSaved();
  openModal(`저장된 쇼츠 ${o.length}개`, o.length ? `<div style="margin-bottom:12px"><button class="btn sm ghost" onclick="openFolder()">📂 폴더 열기</button></div><div class="outs">${o.map((f) => `<div class="out"><video src="/out/${encodeURIComponent(f.file)}" controls preload="metadata"></video><div><b>${esc(f.title1 || f.file)} ${esc(f.title2 || "")}</b><small class="hint">${f.duration || ""}초 · ${(f.created || "").replace("T", " ").slice(5, 16)}</small><div class="acts"><a class="btn sm ghost" href="/out/${encodeURIComponent(f.file)}" download>받기</a>${f.cover ? `<a class="btn sm ghost" href="/out/${encodeURIComponent(f.cover)}" download>커버</a>` : ""}${f.description ? `<button class="btn sm ghost" data-copy="${esc(f.description)}">설명글 복사</button>` : ""}<button class="btn sm ghost" data-delout="${esc(f.file)}">삭제</button></div></div></div>`).join("")}</div>` : `<p class="hint">아직 만든 쇼츠가 없어요.</p>`);
  $$("[data-copy]").forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast("설명글을 복사했어요"); }));
  $$("[data-delout]").forEach((b) => (b.onclick = async () => { if (!confirm("이 쇼츠 파일을 지울까요?")) return; await api("/api/delete-output/" + encodeURIComponent(b.dataset.delout), { method: "POST" }); $("#btnSaved").click(); }));
};
$("#btnNew").onclick = () => { stopQuick(); S.p = null; S.pid = null; $("#url").value = ""; $("#ingestProg").classList.add("hidden"); go(1); loadRecent(); };

/* ------------------------------------------------------------ 시작 */
(async () => {
  try { S.myTpls = await api("/api/templates"); } catch (e) {}
  loadLogo();
  refreshSaved();
  loadRecent();
  go(1);
  document.fonts.load("40px P-Black"); document.fonts.load("40px P-Bold"); document.fonts.load("40px P-ExtraBold"); document.fonts.load("40px P-Medium"); document.fonts.load("40px BHS");
  document.fonts.ready.then(() => S.step === 3 && drawAll());
})();
