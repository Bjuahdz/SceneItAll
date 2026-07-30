import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Platform } from "react-native";
import {
  Canvas,
  Picture,
  Skia,
  matchFont,
  PaintStyle,
  BlurStyle,
  TileMode,
  type SkCanvas,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, useFrameCallback, runOnJS } from "react-native-reanimated";

import { clamp01, rgba, seed, tintHex, ACCENT_HEX, type CloudData } from "./skyModel";

// ─────────────────────────────────────────────────────────────────────────────
// ENGINE A · THE CLOUDBANK — the Home screen (home_reference.js §8–§10,
// prototype initWheel + cfg29). Ported, not re-derived.
//
// The user's insight THEMES ring a central black-hole VOID orrery. Drag to
// SCRUB the ring: whichever theme passes under the 12-o'clock notch becomes
// selected, its member films condensing into a bright knot while the rest stay
// dim vapour, and its name + verbatim insight print above. Press the void
// (r < 66) and a 950ms warp opens the Explore sky (Engine B).
//
// Same UI-thread architecture as SkyCanvas: state built inside the frame
// worklet, fixed 60fps accumulator, SkPicture per frame, runOnJS only for
// selection + the warp completion.
// ─────────────────────────────────────────────────────────────────────────────

const STEP_MS = 1000 / 60;
const MAX_STEPS = 3;
const RING_RX = 144;
const RING_RY = 134;
const NOTCH_R = 170;
const CY_F = 0.455;
const VOID_R = 60;
const VOID_HIT = 66;
const WARP_MS = 950;

const fontFamily = Platform.select({ ios: "Helvetica Neue", default: "sans-serif" });
const voidFont = matchFont({ fontFamily, fontSize: 9.5, fontWeight: "800" });

export interface CloudbankController {
  selectTheme: (i: number) => void;
  pressVoid: () => void;
}

interface CloudbankProps {
  data: CloudData;
  width: number;
  height: number;
  selected: number;
  active?: boolean;
  onSelect?: (index: number) => void;
  onExplore?: () => void;
  onVoidPressed?: () => void;
  controllerRef?: React.MutableRefObject<CloudbankController | null>;
}

// ── §8 model ────────────────────────────────────────────────────────────────

function buildState(data: CloudData, W: number, H: number, key: string): any {
  "worklet";
  const cx = W * 0.5;
  const cy = H * CY_F;
  const n = data.themes.length || 1;

  const far = [];
  for (let i = 0; i < 90; i++) {
    far.push({
      x: seed(i * 7 + 1) * W,
      y: seed(i * 13 + 5) * H,
      r: 0.3 + seed(i * 3 + 2) * 0.9,
      a: 0.06 + seed(i * 11 + 4) * 0.14,
    });
  }
  const twk = [];
  for (let i = 0; i < 14; i++) {
    twk.push({ x: seed(i * 17 + 3) * W, y: seed(i * 23 + 9) * H, ph: seed(i * 5 + 1) * 9 });
  }

  const clusters = data.themes.map((t, ti) => ({
    hue: t.hue,
    ti,
    baseA: -Math.PI / 2 + (ti * 2 * Math.PI) / n,
    selE: ti === 0 ? 1 : 0,
    ax: cx,
    ay: cy,
    lobes: [0, 1, 2].map((j) => ({
      dx: (seed(ti * 13 + j * 7 + 1) - 0.5) * 46,
      dy: (seed(ti * 17 + j * 11 + 2) - 0.5) * 38,
      r: 26 + seed(ti * 7 + j * 5 + 3) * 18,
    })),
  }));

  const stars = data.movies
    .filter((m) => data.claim[m.id] != null && clusters[data.claim[m.id]])
    .map((m) => ({
      ti: data.claim[m.id],
      jx: (seed(m.id * 31 + 1) - 0.5) * 54,
      jy: (seed(m.id * 37 + 2) - 0.5) * 46,
      px: cx,
      py: cy + 60,
      ph: seed(m.id * 61) * 9,
      size: 2.1 + Math.sqrt(m.takeCount) * 1.5,
    }));

  // ---- paints / paths ----
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
  const sprite = Skia.Paint();
  sprite.setAntiAlias(true);
  const text = Skia.Paint();
  text.setAntiAlias(true);
  const textOutline = Skia.Paint();
  textOutline.setAntiAlias(true);
  textOutline.setStyle(PaintStyle.Stroke);
  textOutline.setStrokeWidth(3.5);
  textOutline.setColor(Skia.Color("rgba(5,3,14,0.92)"));
  // respectCTM=false: these are drawn under canvas.scale, so a CTM-respecting
  // blur would multiply sigma by the star radius.
  const glowSel = Skia.Paint();
  glowSel.setAntiAlias(true);
  glowSel.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 9, false));
  const glowDim = Skia.Paint();
  glowDim.setAntiAlias(true);
  glowDim.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, false));
  const beadGlow = Skia.Paint();
  beadGlow.setAntiAlias(true);
  beadGlow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 3.5, false));

  const dash57 = Skia.PathEffect.MakeDash([5, 7], 0);
  const dash38 = Skia.PathEffect.MakeDash([3, 8], 0);

  const bgShader = Skia.Shader.MakeRadialGradient(
    { x: cx, y: H * 0.3 },
    H * 0.78,
    [Skia.Color("#0b0721"), Skia.Color("#070517"), Skia.Color("#02010c")],
    [0, 0.55, 1],
    TileMode.Clamp
  );
  // Unit lobe sprite per hue (radius 100, scaled per draw).
  const lobeByHue: Record<string, any> = {};
  for (const t of data.themes) {
    if (!lobeByHue[t.hue]) {
      lobeByHue[t.hue] = Skia.Shader.MakeRadialGradient(
        { x: 0, y: 0 },
        100,
        [Skia.Color(rgba(t.hue, 1)), Skia.Color(rgba(t.hue, 0))],
        [0, 1],
        TileMode.Clamp
      );
    }
  }

  return {
    key, W, H, cx, cy, clusters, stars, far, twk,
    unitStar, fill, stroke, sprite, text, textOutline,
    glowSel, glowDim, beadGlow, dash57, dash38, bgShader, lobeByHue,
    rot: 0,
    rotT: null as number | null,
    angVel: 0,
    freeSpin: 0,
    dragging: false,
    warpT: -1e9,
    warpFired: false,
    rippleT: -1e9,
    sel: 0,
    acc: 0,
    lastT: 0,
    cmdSeq: 0,
    lastAng: 0,
    moved: 0,
    downX: 0,
    downY: 0,
    glyphW: {} as Record<string, number>,
  };
}

function selectTheme(s: any, i: number, onSelect?: (i: number) => void) {
  "worklet";
  const c = s.clusters[i];
  if (!c) return;
  s.sel = i;
  let target = -Math.PI / 2 - c.baseA;
  target += Math.round((s.rot - target) / (2 * Math.PI)) * (2 * Math.PI);
  s.rotT = target;
  s.rippleT = s.lastT;
  if (onSelect) runOnJS(onSelect)(i);
}

// ── physics ─────────────────────────────────────────────────────────────────

function stepPhysics(s: any, t: number, onSelect?: (i: number) => void) {
  "worklet";
  // Ring: programmatic ease > free-spin decay.
  if (s.rotT != null && !s.dragging) {
    const d = s.rotT - s.rot;
    s.rot += d * 0.12;
    if (Math.abs(d) < 0.004) s.rotT = null;
  } else if (!s.dragging) {
    s.rot += s.freeSpin;
    s.freeSpin *= 0.96;
  }

  // Notch-follow: while scrubbing, whatever sits nearest 12 o'clock is selected.
  if (s.rotT == null && (s.dragging || Math.abs(s.freeSpin) > 0.0008)) {
    let best = s.sel;
    let bd = 99;
    for (const c of s.clusters) {
      let d = (((c.baseA + s.rot + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < bd) {
        bd = d;
        best = c.ti;
      }
    }
    if (best !== s.sel) {
      s.sel = best;
      s.rippleT = t;
      if (onSelect) runOnJS(onSelect)(best);
    }
  }

  // Clusters ride the ring; the selected one eases toward full presence.
  for (const c of s.clusters) {
    const aa = c.baseA + s.rot;
    c.ax = s.cx + Math.cos(aa) * RING_RX;
    c.ay = s.cy + Math.sin(aa) * RING_RY;
    c.selE += ((s.sel === c.ti ? 1 : 0) - c.selE) * 0.08;
  }

  // Members ease toward their cluster; the selected cluster pulls them TIGHT.
  for (const st of s.stars) {
    const c = s.clusters[st.ti];
    if (!c) continue;
    const tight = 1 - c.selE * 0.62;
    const tx = c.ax + st.jx * tight;
    const ty = c.ay + st.jy * tight;
    st.px += (tx + Math.sin(t / 2300 + st.ph) * 3 - st.px) * 0.11;
    st.py += (ty + Math.cos(t / 2600 + st.ph) * 3 - st.py) * 0.11;
  }
}

// ── render ──────────────────────────────────────────────────────────────────

function render(s: any, canvas: SkCanvas, t: number) {
  "worklet";
  const W = s.W;
  const H = s.H;
  const cx = s.cx;
  const cy = s.cy;

  // Backdrop.
  s.sprite.setShader(s.bgShader);
  s.sprite.setAlphaf(1);
  canvas.drawRect({ x: 0, y: 0, width: W, height: H }, s.sprite);
  s.sprite.setShader(null);

  // Selected hue drives the dust bands + the pale crown wash.
  let selHue: string | null = null;
  let selE = 0;
  for (const c of s.clusters) {
    if (c.selE > selE) {
      selE = c.selE;
      selHue = c.hue;
    }
  }

  const bands = [
    { rot: -0.62, base: "rgba(96,130,200,0.05)", a: 0.05, o: -40 },
    { rot: 0.5, base: "rgba(140,110,210,0.06)", a: 0.06, o: 60 },
  ];
  for (const b of bands) {
    const colour =
      selHue && selE > 0.02 ? rgba(selHue, b.a * (0.4 + 0.6 * selE)) : b.base;
    canvas.save();
    canvas.translate(cx, cy + b.o);
    canvas.rotate((b.rot * 180) / Math.PI, 0, 0);
    s.sprite.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: 0, y: -34 },
        { x: 0, y: 34 },
        [Skia.Color("rgba(0,0,0,0)"), Skia.Color(colour), Skia.Color("rgba(0,0,0,0)")],
        [0, 0.5, 1],
        TileMode.Clamp
      )
    );
    s.sprite.setAlphaf(1);
    canvas.drawRect({ x: -W, y: -34, width: W * 2, height: 68 }, s.sprite);
    canvas.restore();
  }
  s.sprite.setShader(null);

  for (const f of s.far) {
    s.fill.setColor(Skia.Color(`rgba(255,255,255,${f.a})`));
    canvas.drawCircle(f.x, f.y, f.r, s.fill);
  }
  for (const w of s.twk) {
    const a = Math.max(0, 0.1 + 0.16 * Math.sin(t / 900 + w.ph));
    s.fill.setColor(Skia.Color(`rgba(223,230,255,${a})`));
    canvas.drawCircle(w.x, w.y, 1.1, s.fill);
  }

  // Pale top-crown wash in the selected hue.
  if (selHue && selE > 0.02) {
    s.sprite.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: 0, y: 0 },
        { x: 0, y: H * 0.6 },
        [
          Skia.Color(rgba(selHue, 0.045 * selE)),
          Skia.Color(rgba(selHue, 0.018 * selE)),
          Skia.Color(rgba(selHue, 0)),
        ],
        [0, 0.55, 1],
        TileMode.Clamp
      )
    );
    s.sprite.setAlphaf(1);
    canvas.drawRect({ x: 0, y: 0, width: W, height: H * 0.6 }, s.sprite);
    s.sprite.setShader(null);
  }

  // Theme vapour: 3 soft lobes each, dimming as the cluster condenses.
  for (const c of s.clusters) {
    for (const lb of c.lobes) {
      const br = 1 + 0.06 * Math.sin(t / 2200 + lb.r);
      const al = 0.13 * (1 - c.selE * 0.8) * br;
      if (al <= 0.002) continue;
      const r = lb.r * 1.9;
      canvas.save();
      canvas.translate(c.ax + lb.dx, c.ay + lb.dy);
      canvas.scale(r / 100, r / 100);
      s.sprite.setShader(s.lobeByHue[c.hue]);
      s.sprite.setAlphaf(al);
      canvas.drawCircle(0, 0, 100, s.sprite);
      canvas.restore();
    }
  }
  s.sprite.setShader(null);

  // Gravity-well pulse under the selected knot, 700ms after (re)selection.
  const selC = s.clusters[s.sel];
  if (selC) {
    let mx = 0;
    let my = 0;
    let cnt = 0;
    for (const st of s.stars) {
      if (st.ti === s.sel) {
        mx += st.px;
        my += st.py;
        cnt++;
      }
    }
    const ka = t - s.rippleT;
    if (cnt > 1 && ka < 700) {
      mx /= cnt;
      my /= cnt;
      const kk = ka / 700;
      const r = 24 + kk * 60;
      s.sprite.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: mx, y: my },
          r,
          [
            Skia.Color(rgba(tintHex(selC.hue, 0.55), 0.28 * (1 - kk))),
            Skia.Color(rgba(selC.hue, 0)),
          ],
          [0, 1],
          TileMode.Clamp
        )
      );
      s.sprite.setAlphaf(1);
      canvas.drawCircle(mx, my, r, s.sprite);
      s.sprite.setShader(null);
    }
  }

  // Stars — selected cluster bright and big, the rest dim vapour sparkle.
  const rippleAge = t - s.rippleT;
  for (const st of s.stars) {
    const c = s.clusters[st.ti];
    if (!c) continue;
    const isSel = st.ti === s.sel;
    const dimA = isSel ? 1 : 0.25 + 0.1 * Math.sin(t / 600 + st.ph);
    const rip = isSel && rippleAge < 600 ? 1 + 0.3 * (1 - rippleAge / 600) : 1;
    const tw = 0.55 + 0.45 * Math.sin(t / 480 + st.ph);
    const sz = st.size * rip * (isSel ? 1 : 0.6) * 1.45 * (0.88 + 0.24 * tw);
    const alpha = Math.min(1, (0.58 + 0.42 * tw) * dimA + (isSel ? 0.2 : 0));
    const colour = Skia.Color(rgba(tintHex(c.hue, 0.55), alpha));
    canvas.save();
    canvas.translate(st.px, st.py);
    canvas.rotate(((st.ph + t / 5200) * 180) / Math.PI, 0, 0);
    canvas.scale(sz, sz);
    const gp = isSel ? s.glowSel : s.glowDim;
    gp.setColor(colour);
    canvas.drawPath(s.unitStar, gp);
    s.fill.setColor(colour);
    canvas.drawPath(s.unitStar, s.fill);
    canvas.restore();
  }

  // Notch — the selection marker at 12 o'clock.
  const notch = Skia.Path.Make();
  notch.moveTo(cx - 5, cy - NOTCH_R - 9);
  notch.lineTo(cx + 5, cy - NOTCH_R - 9);
  notch.lineTo(cx, cy - NOTCH_R);
  notch.close();
  s.fill.setColor(Skia.Color("rgba(255,255,255,0.7)"));
  canvas.drawPath(notch, s.fill);

  // ── THE BLACK-HOLE VOID: core + 4 precessing rings + 2 orbiting beads ──
  const warpK = Math.min(1, (t - s.warpT) / WARP_MS);
  const warpOn = warpK < 1;

  s.fill.setColor(Skia.Color("#05030e"));
  canvas.drawCircle(cx, cy, VOID_R, s.fill);
  s.stroke.setPathEffect(null);
  s.stroke.setStrokeWidth(1.2);
  s.stroke.setColor(
    Skia.Color(`rgba(255,255,255,${0.45 + (warpOn ? 0.4 * Math.sin(warpK * Math.PI) : 0)})`)
  );
  canvas.drawCircle(cx, cy, VOID_R, s.stroke);

  const rings = [
    { e: 1, rot: 0, spin: 0, dash: null, a: 0.18 },
    { e: 0.36, rot: 0.52, spin: 0.5, dash: null, a: 0.3 },
    { e: 0.36, rot: -0.62, spin: -0.36, dash: s.dash57, a: 0.26 },
    { e: 0.72, rot: 1.18, spin: 0.22, dash: s.dash38, a: 0.18 },
  ];
  s.stroke.setStrokeWidth(1);
  for (const r of rings) {
    const rot = r.rot + (t / 9000) * r.spin;
    canvas.save();
    canvas.translate(cx, cy);
    canvas.rotate((rot * 180) / Math.PI, 0, 0);
    canvas.scale(1, r.e);
    s.stroke.setColor(Skia.Color(`rgba(235,240,255,${r.a})`));
    s.stroke.setPathEffect(r.dash);
    canvas.drawCircle(0, 0, 88, s.stroke);
    s.stroke.setPathEffect(null);
    canvas.restore();
  }

  // Two beads riding rings 1 and 2.
  const beads = [
    { r: rings[1], per: 2600, mul: 0.12 },
    { r: rings[2], per: 4100, mul: 0.08 },
  ];
  for (const b of beads) {
    const rot = b.r.rot + (t / 9000) * b.r.spin;
    const a = (t / b.per) * 6.28 * b.mul;
    canvas.save();
    canvas.translate(cx, cy);
    canvas.rotate((rot * 180) / Math.PI, 0, 0);
    const bx = Math.cos(a) * 88;
    const by = Math.sin(a) * 88 * b.r.e;
    s.beadGlow.setColor(Skia.Color(ACCENT_HEX));
    canvas.drawCircle(bx, by, 3, s.beadGlow);
    s.fill.setColor(Skia.Color("#ffffff"));
    canvas.drawCircle(bx, by, 2.1, s.fill);
    canvas.restore();
  }

  // Warp shock rings while the void is opening.
  if (warpOn) {
    s.stroke.setStrokeWidth(1.4);
    for (let i = 0; i < 3; i++) {
      const rr = 66 + Math.pow(((t - s.warpT) / 430 + i / 3) % 1, 2) * 300;
      s.stroke.setColor(Skia.Color(`rgba(200,220,255,${Math.max(0, 0.3 * (1 - rr / 360))})`));
      canvas.drawCircle(cx, cy, rr, s.stroke);
    }
  }

  // The door label — a gently pulsing EXPLORE inside the void.
  const pu = 0.5 + 0.5 * Math.sin(t / 1100);
  const label = "EXPLORE";
  let total = 0;
  const widths = [];
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    let w = s.glyphW[ch];
    if (w === undefined) {
      w = ch === " " ? 9.5 * 0.28 : voidFont.measureText(ch).width;
      s.glyphW[ch] = w;
    }
    widths.push(w);
    total += w + 1.2;
  }
  total -= 1.2;
  let tx = cx - total / 2;
  s.text.setColor(Skia.Color(rgba(ACCENT_HEX, 0.5 + 0.35 * pu)));
  for (let i = 0; i < label.length; i++) {
    canvas.drawText(label[i], tx, cy + 3, s.textOutline, voidFont);
    canvas.drawText(label[i], tx, cy + 3, s.text, voidFont);
    tx += widths[i] + 1.2;
  }
}

// ── component ───────────────────────────────────────────────────────────────

export default function CloudbankCanvas({
  data,
  width,
  height,
  selected,
  active = true,
  onSelect,
  onExplore,
  onVoidPressed,
  controllerRef,
}: CloudbankProps) {
  const stateKey = useMemo(
    () =>
      `${width}x${height}|` +
      data.themes.map((t) => t.hue + ":" + t.memberIds.length).join(",") +
      "|" +
      data.movies.map((m) => m.id + ":" + m.takeCount).join(","),
    [data, width, height]
  );

  const state = useSharedValue<any>(null);
  const command = useSharedValue<{ seq: number; type: string; arg: number } | null>(null);
  const blank = useMemo(() => {
    const rec = Skia.PictureRecorder();
    rec.beginRecording(Skia.XYWHRect(0, 0, width, height));
    return rec.finishRecordingAsPicture();
  }, [width, height]);
  const picture = useSharedValue(blank);

  const frame = useFrameCallback((info) => {
    "worklet";
    const t = info.timestamp;
    let s = state.value;
    if (s === null || s.key !== stateKey) {
      const prev = s;
      s = buildState(data, width, height, stateKey);
      if (prev) s.cmdSeq = prev.cmdSeq;
      if (prev && prev.W === s.W && prev.H === s.H) {
        s.rot = prev.rot;
        s.sel = Math.min(prev.sel, Math.max(0, s.clusters.length - 1));
        s.freeSpin = prev.freeSpin;
        for (const c of s.clusters) {
          const old = prev.clusters[c.ti];
          if (old) c.selE = old.selE;
        }
      }
      state.value = s;
    }

    const cmd = command.value;
    if (cmd && cmd.seq !== s.cmdSeq) {
      s.cmdSeq = cmd.seq;
      if (cmd.type === "select") selectTheme(s, cmd.arg, onSelect);
      else if (cmd.type === "void" && !(t - s.warpT < WARP_MS)) {
        s.warpT = t;
        s.warpFired = false;
      }
    }

    const dt = s.lastT ? Math.min(200, t - s.lastT) : STEP_MS;
    s.lastT = t;
    s.acc += dt;
    let steps = 0;
    while (s.acc >= STEP_MS && steps < MAX_STEPS) {
      stepPhysics(s, t, onSelect);
      s.acc -= STEP_MS;
      steps++;
    }
    if (steps === 0) return;
    if (s.acc > STEP_MS * MAX_STEPS) s.acc = 0;

    // Warp finished → hand over to the Explore sky.
    if (s.warpT > 0 && !s.warpFired && t - s.warpT >= WARP_MS) {
      s.warpFired = true;
      s.warpT = -1e9;
      if (onExplore) runOnJS(onExplore)();
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

  // Keep the engine's selection in step when the parent drives it.
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
      selectTheme: (i: number) => send("select", i),
      pressVoid: () => send("void", 0),
    };
    return () => {
      if (controllerRef) controllerRef.current = null;
    };
  }, [controllerRef, send]);

  // ---- gestures: scrub the ring, tap the void or a cluster ----
  const pan = Gesture.Pan()
    .maxPointers(1)
    .onBegin((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.dragging = true;
      s.rotT = null;
      s.moved = 0;
      s.downX = ev.x;
      s.downY = ev.y;
      s.lastAng = Math.atan2(ev.y - s.cy, ev.x - s.cx);
    })
    .onUpdate((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.moved += Math.abs(ev.x - s.downX) + Math.abs(ev.y - s.downY);
      s.downX = ev.x;
      s.downY = ev.y;
      const a = Math.atan2(ev.y - s.cy, ev.x - s.cx);
      let d = a - s.lastAng;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      s.lastAng = a;
      s.rot += d;
      s.angVel = s.angVel * 0.5 + d * 0.5; // EMA for the fling
    })
    .onFinalize(() => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.dragging = false;
      s.freeSpin = Math.max(-0.09, Math.min(0.09, s.angVel));
      s.angVel = 0;
    });

  const tap = Gesture.Tap()
    .maxDistance(8)
    .onEnd((ev) => {
      "worklet";
      const s = state.value;
      if (!s) return;
      s.angVel = 0;
      s.freeSpin = 0;
      if (Math.hypot(ev.x - s.cx, ev.y - s.cy) < VOID_HIT) {
        if (t_warpBusy(s)) return;
        s.warpT = s.lastT;
        s.warpFired = false;
        if (onVoidPressed) runOnJS(onVoidPressed)();
        return;
      }
      let hit = null;
      let hd = 48;
      for (const c of s.clusters) {
        const d = Math.hypot(ev.x - c.ax, ev.y - c.ay);
        if (d < hd) {
          hd = d;
          hit = c;
        }
      }
      if (hit) selectTheme(s, hit.ti, onSelect);
    });

  const gesture = Gesture.Race(pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }} collapsable={false}>
        <Canvas style={{ width, height }}>
          <Picture picture={picture} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

function t_warpBusy(s: any): boolean {
  "worklet";
  return s.lastT - s.warpT < WARP_MS;
}
