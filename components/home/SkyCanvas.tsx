import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Platform } from "react-native";
import {
  Canvas,
  Picture,
  Skia,
  matchFont,
  PaintStyle,
  StrokeCap,
  BlurStyle,
  TileMode,
  type SkCanvas,
  type SkFont,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, useFrameCallback, runOnJS } from "react-native-reanimated";

import { clamp01, rgba, seed, tintHex, LIM, AMBER, type KindId, type SkyData } from "./skyModel";

// ─────────────────────────────────────────────────────────────────────────────
// The living sky — Skia port of home_reference.js §3 (buildSkyModel) and
// §4 (createExploreSky). Every constant is the reference's; port, don't
// re-derive.
//
// Two instances run over one shared SkyData: the ambient Home backdrop
// (`interactive={false}`) and the Explore sheet (`interactive`).
//
// Architecture (proven in this codebase): ALL engine state lives on the UI
// runtime — it is built inside the frame worklet from the plain, serializable
// `data` prop, so Reanimated never freezes the mutable member fields the physics
// writes. One useFrameCallback steps physics and records an SkPicture; <Picture>
// renders it. Gestures are worklets; runOnJS is used only for the three
// callbacks (lock / release / near-genre) and their haptics.
//
// The reference's easings are per-frame at 60fps, so the physics runs on a fixed
// 16.667ms accumulator — identical motion on 60Hz and 120Hz ProMotion displays.
//
// Colour note: Skia.Color("rgba(…)") carries the alpha, and setColor writes the
// FULL RGBA — so a computed alpha must never be followed by setAlphaf(1), which
// would silently flatten the whole scene to opaque. setAlphaf is used only where
// the paint carries a shader (which has no colour to encode alpha into).
// ─────────────────────────────────────────────────────────────────────────────

const STEP_MS = 1000 / 60; // reference tuning cadence
const MAX_STEPS = 3; //      never spiral after a stall
const ZOOM_MIN = 0.42;
const ZOOM_MAX = 1.9;

const fontFamily = Platform.select({ ios: "Helvetica Neue", default: "sans-serif" });
const plateFont = matchFont({ fontFamily, fontSize: 10, fontWeight: "700" });
const plateSubFont = matchFont({ fontFamily, fontSize: 8, fontWeight: "600" });

export interface SkyController {
  lockById: (id: number) => void;
  flyToGenre: (index: number) => void;
  release: () => void;
}

interface SkyCanvasProps {
  data: SkyData;
  width: number;
  height: number;
  interactive?: boolean;
  active?: boolean; //            gate the loop (focus / sheet-open)
  onLock?: (movieId: number) => void;
  onRelease?: () => void;
  onNearGenre?: (index: number) => void;
  controllerRef?: React.MutableRefObject<SkyController | null>;
}

// ── model construction (reference §3, run inside the worklet) ────────────────

function buildState(data: SkyData, W: number, H: number, key: string): any {
  "worklet";
  const gl = data.genres;
  const n = gl.length || 1;

  // Genre nebulas ride two alternating rings so neighbours don't overlap.
  const anchors = gl.map((g, gi) => {
    const a = -Math.PI / 2 + (gi * 2 * Math.PI) / n; // first genre at 12 o'clock
    const r = gi % 2 ? 178 : 266;
    return {
      key: g.key,
      label: g.label,
      nFilms: g.n,
      avg: g.avg,
      gi,
      hue: g.hue,
      ax: Math.cos(a) * r,
      ay: Math.sin(a) * r * 0.9, // slight vertical squash
      scatter: 48 + Math.sqrt(g.n) * 34,
      lobes: [0, 1, 2].map((j) => ({
        dx: (seed(gi * 19 + j * 7 + 2) - 0.5) * 70,
        dy: (seed(gi * 23 + j * 11 + 4) - 0.5) * 58,
        r: 40 + seed(gi * 29 + j * 13 + 1) * 34,
      })),
    };
  });
  const byGenre: Record<string, any> = {};
  for (const a of anchors) byGenre[a.key] = a;

  // Each film is a star seeded to a fixed spot in its genre: clustered (cx0/cy0)
  // when zoomed out, separated (sx0/sy0) when zoomed in; sepE eases between.
  const members = data.movies.map((m) => {
    // Every film resolves to a nebula; a film with no anchor at all is dropped
    // below rather than dereferencing an empty anchors[0].
    const an = byGenre[m.genreKey] || anchors[0];
    if (!an) return null;
    const jx = (seed(m.id * 31 + 8) - 0.5) * 2;
    const jy = (seed(m.id * 37 + 9) - 0.5) * 1.7;
    return {
      id: m.id,
      takeCount: m.takeCount,
      rated: !!m.rated,
      an,
      cx0: an.ax + jx * an.scatter * 0.3,
      cy0: an.ay + jy * an.scatter * 0.3,
      sx0: an.ax + jx * an.scatter,
      sy0: an.ay + jy * an.scatter,
      sepTh: 1.0 + seed(m.id * 41 + 3) * 0.32,
      sepE: 0,
      pox: 0,
      poy: 0,
      ph: seed(m.id * 61) * 9,
      _sx: -9999,
      _sy: -9999,
    };
  }).filter((mb) => mb !== null) as any[];
  const byId: Record<number, any> = {};
  for (const mb of members) byId[mb.id] = mb;

  // ---- paints & paths (built once) ----
  const p = 0.32;
  const unitStar = Skia.Path.Make();
  unitStar.moveTo(0, -1);
  unitStar.quadTo(p * 0.5, -p * 0.5, 1, 0);
  unitStar.quadTo(p * 0.5, p * 0.5, 0, 1);
  unitStar.quadTo(-p * 0.5, p * 0.5, -1, 0);
  unitStar.quadTo(-p * 0.5, -p * 0.5, 0, -1);
  unitStar.close();

  const fill = Skia.Paint();
  fill.setAntiAlias(true);
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeCap(StrokeCap.Round);
  const sprite = Skia.Paint();
  sprite.setAntiAlias(true);
  const text = Skia.Paint();
  text.setAntiAlias(true);

  // Star glow ≈ the reference's shadowBlur (8 idle, 16 locked → sigma 4 / 8).
  // respectCTM MUST be false: the sparkle is drawn under canvas.scale(sr, sr),
  // and a CTM-respecting blur would multiply sigma by the star's radius.
  const glow = Skia.Paint();
  glow.setAntiAlias(true);
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, false));
  const glowLock = Skia.Paint();
  glowLock.setAntiAlias(true);
  glowLock.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 8, false));

  const dashPerson = Skia.PathEffect.MakeDash([5, 7], 0);
  const dashSimilar = Skia.PathEffect.MakeDash([2, 7], 0);

  // Deep-space backdrop + the 70 static far stars (fixed to the viewport).
  const bgShader = Skia.Shader.MakeRadialGradient(
    { x: W / 2, y: H * 0.35 },
    H * 0.8,
    [Skia.Color("#0a0620"), Skia.Color("#060414"), Skia.Color("#02010c")],
    [0, 0.6, 1],
    TileMode.Clamp
  );
  const far = [];
  for (let i = 0; i < 70; i++) {
    far.push({
      x: seed(i * 5 + 1) * W,
      y: seed(i * 7 + 3) * H,
      r: 0.3 + seed(i * 3 + 4) * 0.9,
      a: 0.05 + seed(i * 9 + 2) * 0.12,
    });
  }

  // Per-hue nebula lobe sprites (unit radius 100, scaled per draw).
  const lobeShaderByHue: Record<string, any> = {};
  for (const g of gl) {
    if (!lobeShaderByHue[g.hue]) {
      lobeShaderByHue[g.hue] = Skia.Shader.MakeRadialGradient(
        { x: 0, y: 0 },
        100,
        [Skia.Color(rgba(g.hue, 1)), Skia.Color(rgba(g.hue, 0))],
        [0, 1],
        TileMode.Clamp
      );
    }
  }

  return {
    key, W, H, anchors, members, byId, edges: data.edges,
    unitStar, fill, stroke, sprite, glow, glowLock, text,
    dashPerson, dashSimilar, bgShader, far, lobeShaderByHue,
    // ---- animation state ----
    cam: { x: 0, y: 0 },
    pcam: { x: 0, y: 0 },
    zoom: 0.5,
    zoomT: 0.58,
    flyTarget: null as { x: number; y: number } | null,
    lock: null as any,
    lockAt: 0,
    dwell: 0,
    threads: [] as any[],
    thAlpha: 0,
    camSpeed: 0,
    nearest: null as any,
    nd: 1e9,
    fc: 0,
    acc: 0,
    lastT: 0,
    cmdSeq: 0,
    // gesture scratch
    lastX: 0,
    lastY: 0,
    moved: 0,
    pinchZ0: 0.58,
    pinchAt: -1e9, // last frame time a pinch was active (tap suppression)
    // glyph advances are constant per (size, char) — measured once, not per frame
    glyphW: {} as Record<string, number>,
  };
}

// Live world position: clustered→separated blend + thread pull + idle breathing
// (breathing only shows once separated).
function wpos(mb: any, t: number): { x: number; y: number } {
  "worklet";
  return {
    x: mb.cx0 + (mb.sx0 - mb.cx0) * mb.sepE + mb.pox + Math.sin(t / 3100 + mb.ph) * 5 * mb.sepE,
    y: mb.cy0 + (mb.sy0 - mb.cy0) * mb.sepE + mb.poy + Math.cos(t / 2700 + mb.ph) * 5 * mb.sepE,
  };
}

function engage(s: any, mb: any, t: number, onLock?: (id: number) => void) {
  "worklet";
  s.lock = mb;
  s.lockAt = t;
  s.dwell = 0;
  s.thAlpha = 1;
  // Top 4 strongest edges become threads; type carries the visual kind.
  const edges = s.edges
    .filter((e: any) => e.a === mb.id || e.b === mb.id)
    .sort((a: any, b: any) => b.strength - a.strength)
    .slice(0, 4);
  s.threads = edges
    .map((e: any) => ({
      tm: s.byId[e.a === mb.id ? e.b : e.a],
      reason: e.label,
      type: e.type as KindId,
      k: 0,
      _ax: 0,
      _ay: 0,
    }))
    .filter((th: any) => th.tm);
  // Nudge zoom in a touch, never past 1.3 (keeps the thread ring in frame).
  s.zoomT = Math.max(s.zoomT, Math.min(1.3, s.zoom + 0.18));
  if (onLock) runOnJS(onLock)(mb.id);
}

function releaseLock(s: any, onRelease?: () => void) {
  "worklet";
  if (!s.lock) return;
  s.lock = null;
  s.dwell = 0;
  if (onRelease) runOnJS(onRelease)();
}

// ── physics ──────────────────────────────────────────────────────────────────

function stepPhysics(s: any, t: number, interactive: boolean, onLock?: (id: number) => void) {
  "worklet";
  // Camera easing: fly-to > lock-follow > free. Zoom eases toward target.
  if (s.flyTarget) {
    s.cam.x += (s.flyTarget.x - s.cam.x) * 0.07;
    s.cam.y += (s.flyTarget.y - s.cam.y) * 0.07;
    if (Math.hypot(s.flyTarget.x - s.cam.x, s.flyTarget.y - s.cam.y) < 4) s.flyTarget = null;
  }
  if (s.lock) {
    const p = wpos(s.lock, t);
    s.cam.x += (p.x - s.cam.x) * 0.05;
    s.cam.y += (p.y - s.cam.y) * 0.05;
  }
  s.zoom += (s.zoomT - s.zoom) * 0.08;
  s.camSpeed = Math.hypot(s.cam.x - s.pcam.x, s.cam.y - s.pcam.y);
  s.pcam = { x: s.cam.x, y: s.cam.y };
  const cd = Math.hypot(s.cam.x, s.cam.y);
  if (cd > LIM) {
    const f = 1 - 0.1 * (1 - LIM / cd); // soft leash
    s.cam.x *= f;
    s.cam.y *= f;
  }

  // Star separation + thread-pull decay; track the nearest-to-centre star.
  let nearest = null;
  let nd = 1e9;
  for (const mb of s.members) {
    mb.sepE += ((s.zoom > mb.sepTh ? 1 : 0) - mb.sepE) * 0.03;
    if (!s.lock || (s.lock !== mb && !s.threads.some((th: any) => th.tm === mb))) {
      mb.pox *= 0.985;
      mb.poy *= 0.985;
    }
    const p = wpos(mb, t);
    const x = (p.x - s.cam.x) * s.zoom + s.W / 2;
    const y = (p.y - s.cam.y) * s.zoom + s.H * 0.45;
    mb._sx = x;
    mb._sy = y;
    if (x < -40 || x > s.W + 40 || y < -40 || y > s.H + 40) continue;
    const d = Math.hypot(x - s.W / 2, y - s.H * 0.45);
    if (d < nd) {
      nd = d;
      nearest = mb;
    }
  }
  s.nearest = nearest;
  s.nd = nd;

  // LINGER-LOCK: hold a star near centre (zoomed in, camera still) for 750ms.
  if (interactive && !s.lock && nearest && nd < 95 && s.zoom > 1.12 && s.camSpeed < 0.6 && !s.flyTarget) {
    s.dwell += STEP_MS;
    if (s.dwell > 750) engage(s, nearest, t, onLock);
  } else if (!s.lock) {
    s.dwell = Math.max(0, s.dwell - 33);
  }

  // Threads: growth advances whether or not the lock still holds (so a released
  // burst finishes drawing as it fades, exactly as the reference does); only the
  // ring pull requires a live lock.
  if (!s.lock) s.thAlpha *= 0.97;
  if (s.threads.length && s.thAlpha > 0.03) {
    const lp = s.lock ? wpos(s.lock, t) : null;
    s.threads.forEach((th: any, i: number) => {
      const start = s.lockAt + i * 650;
      let kk = clamp01((t - start) / 900);
      if (kk <= 0) return;
      kk = 1 - Math.pow(1 - kk, 3); // cubic-out
      th.k = kk;
      if (s.lock && lp) {
        const ang = -Math.PI / 2 + i * 2.2 + seed(th.tm.id * 7) * 0.9;
        const wantX = lp.x + Math.cos(ang) * (86 + 20 * i);
        const wantY = lp.y + Math.sin(ang) * (78 + 17 * i);
        const baseX = th.tm.cx0 + (th.tm.sx0 - th.tm.cx0) * th.tm.sepE;
        const baseY = th.tm.cy0 + (th.tm.sy0 - th.tm.cy0) * th.tm.sepE;
        th.tm.pox += (wantX - baseX - th.tm.pox) * 0.05 * kk;
        th.tm.poy += (wantY - baseY - th.tm.poy) * 0.05 * kk;
      }
    });
  }
}

// ── text ─────────────────────────────────────────────────────────────────────
// measureText returns the INK bounding box, so a space measures 0 and a
// letter-spaced string would collapse. Substitute a nominal advance for
// whitespace, and measure each glyph exactly once.

function drawTextCentered(
  s: any,
  canvas: SkCanvas,
  str: string,
  cx: number,
  y: number,
  font: SkFont,
  fontSize: number,
  colour: string,
  letterSpacing: number
) {
  "worklet";
  s.text.setColor(Skia.Color(colour));
  if (letterSpacing <= 0) {
    canvas.drawText(str, cx - font.measureText(str).width / 2, y, s.text, font);
    return;
  }
  const widths = [];
  let total = -letterSpacing;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const cacheKey = fontSize + ch;
    let w = s.glyphW[cacheKey];
    if (w === undefined) {
      w = ch === " " ? fontSize * 0.28 : font.measureText(ch).width;
      s.glyphW[cacheKey] = w;
    }
    widths.push(w);
    total += w + letterSpacing;
  }
  let x = cx - total / 2;
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== " ") canvas.drawText(str[i], x, y, s.text, font);
    x += widths[i] + letterSpacing;
  }
}

// ── render ───────────────────────────────────────────────────────────────────

function render(s: any, canvas: SkCanvas, t: number) {
  "worklet";
  const W = s.W;
  const H = s.H;
  const sx = (wx: number) => (wx - s.cam.x) * s.zoom + W / 2;
  const sy = (wy: number) => (wy - s.cam.y) * s.zoom + H * 0.45;
  const cd = Math.hypot(s.cam.x, s.cam.y);

  // Backdrop + far stars + boundary rings. (Draws even with zero films — an
  // empty journal still gets a sky, per the 0-film state.)
  s.sprite.setShader(s.bgShader);
  s.sprite.setAlphaf(1);
  canvas.drawRect({ x: 0, y: 0, width: W, height: H }, s.sprite);
  s.sprite.setShader(null);
  for (const st of s.far) {
    s.fill.setColor(Skia.Color(`rgba(255,255,255,${st.a})`));
    canvas.drawCircle(st.x, st.y, st.r, s.fill);
  }
  const edgeA = clamp01((cd - LIM * 0.55) / (LIM * 0.5));
  s.stroke.setStrokeWidth(1);
  s.stroke.setPathEffect(null);
  s.stroke.setColor(Skia.Color(`rgba(210,220,250,${0.05 + edgeA * 0.06})`));
  canvas.drawCircle(sx(0), sy(0), (LIM + 90) * s.zoom, s.stroke);
  s.stroke.setColor(Skia.Color(`rgba(210,220,250,${0.035 + edgeA * 0.06})`));
  canvas.drawCircle(sx(0), sy(0), (LIM + 128) * s.zoom, s.stroke);

  // Genre nebulas — gas lobes thin as stars separate; nameplates fade with zoom.
  const thin = clamp01((s.zoom - 1.0) / 0.6);
  for (const an of s.anchors) {
    for (const lb of an.lobes) {
      const br = 1 + 0.07 * Math.sin(t / 2400 + lb.r + an.gi);
      const x = sx(an.ax + lb.dx);
      const y = sy(an.ay + lb.dy);
      const r = (an.scatter * 0.9 + lb.r) * s.zoom * br * 1.5;
      if (x < -r || x > W + r || y < -r || y > H + r) continue;
      canvas.save();
      canvas.translate(x, y);
      canvas.scale(r / 100, r / 100);
      s.sprite.setShader(s.lobeShaderByHue[an.hue]);
      s.sprite.setAlphaf(0.14 * (1 - thin * 0.55));
      canvas.drawCircle(0, 0, 100, s.sprite);
      canvas.restore();
    }
    const la = 0.38 * (1 - thin);
    if (la > 0.02) {
      const x = sx(an.ax);
      const y = sy(an.ay - an.scatter - 26);
      if (x > -60 && x < W + 60 && y > 80 && y < H - 90) {
        drawTextCentered(s, canvas, an.label.toUpperCase(), x, y, plateFont, 10, `rgba(255,255,255,${la})`, 2.5);
        const sub = `${an.nFilms} film${an.nFilms === 1 ? "" : "s"}${
          an.avg ? " · avg ★ " + an.avg.toFixed(1) : ""
        }`;
        drawTextCentered(s, canvas, sub, x, y + 12, plateSubFont, 8, `rgba(255,255,255,${la * 0.6})`, 0);
      }
    }
  }
  s.sprite.setShader(null);

  // Threads — colour = the LOCKED nebula's hue; dash encodes kind; BREAKOUT amber.
  if (s.threads.length && s.thAlpha > 0.03) {
    const lp = s.lock ? wpos(s.lock, t) : null;
    s.threads.forEach((th: any, i: number) => {
      const kk = th.k || 0;
      if (kk <= 0) return;
      const A = s.lock && lp ? { x: sx(lp.x), y: sy(lp.y) } : { x: th._ax, y: th._ay };
      if (s.lock && lp) {
        th._ax = A.x;
        th._ay = A.y;
      }
      const B = { x: th.tm._sx, y: th.tm._sy };
      const mx = (A.x + B.x) / 2 + Math.sin(t / 1500 + i * 2) * 8;
      const my = (A.y + B.y) / 2 + Math.cos(t / 1300 + i * 2) * 8;
      const ex = A.x + (B.x - A.x) * kk;
      const ey = A.y + (B.y - A.y) * kk;
      const oc = th.type === "outlier";
      const lockHue = s.lock ? s.lock.an.hue : th.tm.an.hue;

      const path = Skia.Path.Make();
      path.moveTo(A.x, A.y);
      path.quadTo(mx, my, ex, ey);
      s.stroke.setColor(
        Skia.Color(oc ? rgba(AMBER, 0.52 * s.thAlpha) : rgba(tintHex(lockHue, 0.45), 0.5 * s.thAlpha))
      );
      s.stroke.setStrokeWidth(oc ? 1.6 : th.type === "insight" ? 1.4 : 1.1);
      s.stroke.setPathEffect(
        oc || th.type === "insight" ? null : th.type === "person" ? s.dashPerson : s.dashSimilar
      );
      canvas.drawPath(path, s.stroke);
      s.stroke.setPathEffect(null);

      if (kk < 1) {
        s.fill.setColor(
          Skia.Color(oc ? rgba(AMBER, 0.9 * s.thAlpha) : rgba(tintHex(lockHue, 0.7), 0.85 * s.thAlpha))
        );
        canvas.drawCircle(ex, ey, 2.4, s.fill);
      }
    });
  }

  // Stars: a base dot always; a 4-point sparkle once zoomed in (or locked / a
  // live thread endpoint). Locked gets 1.4× + a ring; rated films wear a halo.
  for (const mb of s.members) {
    const x = mb._sx;
    const y = mb._sy;
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    const tw = 0.5 + 0.5 * Math.sin(t / 520 + mb.ph);
    const isLock = s.lock === mb;
    const isRel = s.lock && s.threads.some((th: any) => th.tm === mb && (th.k || 0) > 0.4);
    const starK = Math.max(clamp01((s.zoom - 1.02) / 0.4), isLock || isRel ? 1 : 0);

    s.fill.setColor(Skia.Color(rgba(tintHex(mb.an.hue, 0.6), 0.35 + 0.45 * tw)));
    canvas.drawCircle(x, y, 1.35 * Math.sqrt(s.zoom), s.fill);

    if (starK > 0) {
      const sr = (2 + mb.takeCount * 0.8) * starK * Math.min(s.zoom, 1.5) * (isLock ? 1.4 : 1);
      const alpha = Math.min(1, (0.5 + 0.4 * tw) * starK + (isLock || isRel ? 0.25 : 0));
      const colour = Skia.Color(rgba(tintHex(mb.an.hue, 0.55), alpha));
      const glowPaint = isLock ? s.glowLock : s.glow;
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(((mb.ph + t / 5600) * 180) / Math.PI, 0, 0);
      canvas.scale(sr, sr);
      glowPaint.setColor(colour);
      canvas.drawPath(s.unitStar, glowPaint);
      s.fill.setColor(colour);
      canvas.drawPath(s.unitStar, s.fill);
      canvas.restore();

      if (mb.rated && starK > 0.5 && !isLock) {
        s.stroke.setColor(Skia.Color(`rgba(255,255,255,${0.16 * starK})`));
        s.stroke.setStrokeWidth(1);
        canvas.drawCircle(x, y, sr * 1.9 + 3, s.stroke);
      }
    }

    if (isLock) {
      const lk = clamp01((t - s.lockAt) / 400);
      s.stroke.setColor(Skia.Color(`rgba(255,255,255,${0.5 * lk})`));
      s.stroke.setStrokeWidth(1);
      canvas.drawCircle(x, y, 13, s.stroke);
    }
  }
}

// ── component ────────────────────────────────────────────────────────────────

export default function SkyCanvas({
  data,
  width,
  height,
  interactive = true,
  active = true,
  onLock,
  onRelease,
  onNearGenre,
  controllerRef,
}: SkyCanvasProps) {
  // `rated` and the genre average feed the canvas (halo ring + nameplate), so
  // they belong in the rebuild key — otherwise live enrichment never lands.
  const stateKey = useMemo(
    () =>
      `${width}x${height}|` +
      data.genres.map((g) => `${g.key}:${g.n}:${g.avg == null ? "-" : g.avg.toFixed(2)}`).join(",") +
      "|" +
      data.movies.map((m) => `${m.id}:${m.takeCount}:${m.rated ? 1 : 0}`).join(",") +
      `|${data.edges.length}`,
    [data, width, height]
  );

  const state = useSharedValue<any>(null);
  const command = useSharedValue<{ seq: number; type: string; arg: number } | null>(null);
  const blankPicture = useMemo(() => {
    const rec = Skia.PictureRecorder();
    rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    return rec.finishRecordingAsPicture();
  }, [width, height]);
  const picture = useSharedValue(blankPicture);

  const frame = useFrameCallback((info) => {
    "worklet";
    const t = info.timestamp;
    let s = state.value;
    if (s === null || s.key !== stateKey) {
      const prev = s;
      s = buildState(data, width, height, stateKey);
      // `command` outlives the rebuild and is never cleared, so a fresh cmdSeq of
      // 0 would re-consume the last command. Adopt the seq we already handled.
      if (prev) s.cmdSeq = prev.cmdSeq;
      // Enrichment landing mid-session changes take counts and rebuilds the model.
      // Carry the camera, zoom, separation and lock across so the sky never
      // lurches under the user just because a take finished distilling.
      if (prev && prev.W === s.W && prev.H === s.H) {
        s.cam = { x: prev.cam.x, y: prev.cam.y };
        s.pcam = { x: prev.cam.x, y: prev.cam.y };
        s.zoom = prev.zoom;
        s.zoomT = prev.zoomT;
        for (const mb of s.members) {
          const old = prev.byId[mb.id];
          if (old) {
            mb.sepE = old.sepE;
            mb.pox = old.pox; // keep the thread-pulled ring from snapping back
            mb.poy = old.poy;
          }
        }
        // Restore the lock EXPLICITLY — calling engage() here would reset lockAt
        // and thAlpha (replaying the whole thread burst) and ratchet zoomT by
        // +0.18 on every rebuild.
        if (prev.lock && s.byId[prev.lock.id]) {
          s.lock = s.byId[prev.lock.id];
          s.lockAt = prev.lockAt;
          s.thAlpha = prev.thAlpha;
          s.threads = prev.threads
            .map((th: any) =>
              s.byId[th.tm.id]
                ? { tm: s.byId[th.tm.id], reason: th.reason, type: th.type, k: th.k, _ax: th._ax, _ay: th._ay }
                : null
            )
            .filter((th: any) => th);
        }
      }
      state.value = s;
    }

    // Commands from JS (stage-pager re-lock, scrub fly-to, release).
    const cmd = command.value;
    if (cmd && cmd.seq !== s.cmdSeq) {
      s.cmdSeq = cmd.seq;
      if (cmd.type === "lock") {
        const mb = s.byId[cmd.arg];
        if (mb && s.lock !== mb) engage(s, mb, t, onLock);
      } else if (cmd.type === "fly") {
        const an = s.anchors[cmd.arg];
        if (an) {
          releaseLock(s, onRelease);
          s.flyTarget = { x: an.ax, y: an.ay };
          s.zoomT = Math.max(s.zoomT, 1.3);
          if (onNearGenre) runOnJS(onNearGenre)(cmd.arg);
        }
      } else if (cmd.type === "release") {
        releaseLock(s, onRelease);
      }
    }

    // Fixed-step physics so the reference's per-frame easings hold on any display.
    const dt = s.lastT ? Math.min(200, t - s.lastT) : STEP_MS;
    s.lastT = t;
    s.acc += dt;
    let steps = 0;
    while (s.acc >= STEP_MS && steps < MAX_STEPS) {
      stepPhysics(s, t, interactive, onLock);
      s.acc -= STEP_MS;
      steps++;
    }
    if (steps === 0) return; // nothing moved — keep the last picture
    if (s.acc > STEP_MS * MAX_STEPS) s.acc = 0;

    // Nearest-nebula sync (cheap + debounced, as in the reference).
    if (++s.fc % 30 === 0 && onNearGenre && s.anchors.length) {
      let bi = 0;
      let bd = 1e9;
      for (let i = 0; i < s.anchors.length; i++) {
        const an = s.anchors[i];
        const d = Math.hypot(an.ax - s.cam.x, an.ay - s.cam.y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      runOnJS(onNearGenre)(bi);
    }

    const rec = Skia.PictureRecorder();
    const canvas = rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    render(s, canvas, t);
    picture.value = rec.finishRecordingAsPicture();
  }, false);

  useEffect(() => {
    frame.setActive(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- controller (JS → UI commands) ----
  // Strictly monotonic seq: a clock-derived id could collide with another
  // command issued in the same millisecond and be silently dropped.
  const seqRef = useRef(0);
  const send = useCallback(
    (type: string, arg: number) => {
      command.value = { seq: ++seqRef.current, type, arg };
    },
    [command]
  );
  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = {
      lockById: (id: number) => send("lock", id),
      flyToGenre: (i: number) => send("fly", i),
      release: () => send("release", 0),
    };
    return () => {
      if (controllerRef) controllerRef.current = null;
    };
  }, [controllerRef, send]);

  // ---- gestures (only when interactive) ----
  // maxPointers(1): the moment a second finger lands, pan tears down so a pinch
  // can't drive the camera from the moving multi-touch centroid.
  const pan = Gesture.Pan()
    .enabled(interactive)
    .maxPointers(1)
    .onBegin((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.lastX = ev.x;
      s.lastY = ev.y;
      s.moved = 0;
      s.flyTarget = null;
    })
    .onUpdate((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      const dx = ev.x - s.lastX;
      const dy = ev.y - s.lastY;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.cam.x -= dx / s.zoom; // pan follows the finger 1:1
      s.cam.y -= dy / s.zoom;
      s.lastX = ev.x;
      s.lastY = ev.y;
      if (s.moved > 9 && s.lock) releaseLock(s, onRelease); // dragging breaks a lock
    });

  const tap = Gesture.Tap()
    .enabled(interactive)
    .maxDistance(8)
    .onEnd((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      // TapGesture has no maxPointers, so swallow taps that are really the tail
      // of a pinch — otherwise releasing two fingers can lock or release a star.
      if (s.lastT - s.pinchAt < 250) return;
      // Tap = lock the nearest star within 26 screen px, else release.
      let hit = null;
      let hd = 26;
      for (const mb of s.members) {
        const d = Math.hypot(ev.x - mb._sx, ev.y - mb._sy);
        if (d < hd) {
          hd = d;
          hit = mb;
        }
      }
      if (hit) engage(s, hit, s.lastT, onLock);
      else if (s.lock) releaseLock(s, onRelease);
    });

  // Pinch is the zoom input (the reference's wheel): zoom-to-separate and the
  // linger-lock threshold (zoom > 1.12) are unreachable without it.
  const pinch = Gesture.Pinch()
    .enabled(interactive)
    .onBegin(() => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.pinchZ0 = s.zoomT; // anchor to the target, not the eased value
      s.pinchAt = s.lastT;
    })
    .onUpdate((ev) => {
      "worklet";
      const s = state.value;
      if (!s || !ev.scale) return;
      s.flyTarget = null; // a deliberate zoom cancels an in-flight fly-to
      s.pinchAt = s.lastT;
      s.zoomT = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s.pinchZ0 * ev.scale));
    })
    .onFinalize(() => {
      "worklet";
      const s = state.value;
      if (s) s.pinchAt = s.lastT;
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Race(pan, tap));

  const canvasEl = (
    <Canvas style={{ width, height }}>
      <Picture picture={picture} />
    </Canvas>
  );

  if (!interactive) {
    return (
      <View style={{ width, height }} pointerEvents="none">
        {canvasEl}
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }} collapsable={false}>
        {canvasEl}
      </View>
    </GestureDetector>
  );
}
