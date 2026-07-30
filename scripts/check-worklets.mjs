#!/usr/bin/env node
// Catches the two Reanimated mistakes TypeScript cannot see. Both throw inside an
// animated-style updater, and a throw there is far worse than a normal crash:
// Reanimated's initialUpdaterRun() leaves IN_STYLE_UPDATER stuck true, so every
// withTiming/withSpring afterwards returns a bare number and the app dies
// app-wide with "Cannot create property 'reduceMotion' on number '1'" — an error
// that names none of the guilty code.
//
//   1. Calling an ordinary JS function from a worklet. Animated styles run on the
//      UI thread, which has no access to normal module functions.
//   2. Reading a shared value declared BELOW the hook. A worklet captures its
//      closure the moment the hook runs, so a later `useSharedValue` is captured
//      as `undefined` and `.value` throws on the very first render.
//
//   node scripts/check-worklets.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components", "contexts", "hooks"];
const HOOKS = [
  "useAnimatedStyle",
  "useDerivedValue",
  "useAnimatedProps",
  "useAnimatedReaction",
  "useAnimatedScrollHandler",
];

// `const foo = useSharedValue(...)` / `useDerivedValue(...)` — the declarations a
// worklet is only allowed to read from ABOVE.
const SHARED_DECL =
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:useSharedValue|useDerivedValue)\s*\(/g;

// Safe on the UI thread: Reanimated's own helpers and pure built-ins.
const ALLOWED = new Set([
  "interpolate",
  "interpolateColor",
  "clamp",
  "runOnJS",
  "runOnUI",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "parseFloat",
  "parseInt",
  "isNaN",
  "isFinite",
]);
// Control flow reads as a call to a regex; it isn't one.
const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "typeof",
  "await",
]);

const isAllowed = (name) =>
  ALLOWED.has(name) ||
  KEYWORDS.has(name) ||
  name.startsWith("with") ||
  name.startsWith("Math.");

// Comments and string/template literals contain things that look like calls —
// rgba(...), url(...) — but never execute as any.
function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`[^`]*`/g, "``")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.[jt]sx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Source between the hook's opening paren and its balanced close.
function bodyAt(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return "";
}

const problems = [];
for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue; // optional directory
  }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Where each shared value is created, by first occurrence. Anything a worklet
    // reads must appear here at a SMALLER offset than the hook itself.
    const declaredAt = new Map();
    for (const m of src.matchAll(SHARED_DECL)) {
      if (!declaredAt.has(m[1])) declaredAt.set(m[1], m.index);
    }
    for (const hook of HOOKS) {
      let from = 0;
      for (;;) {
        const at = src.indexOf(hook + "(", from);
        if (at === -1) break;
        const open = at + hook.length;
        const raw = bodyAt(src, open);
        from = open + Math.max(raw.length, 1);
        const body = stripNoise(raw);

        // (2) shared values captured before they exist
        const flagged = new Set();
        for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\.value\b/g)) {
          const name = m[1];
          const declIdx = declaredAt.get(name);
          if (declIdx === undefined || declIdx < at || flagged.has(name)) continue;
          // Same component only. A `}` in column 0 between the two means they are
          // in different top-level functions, so this name is a prop the component
          // was handed (SlatesGlyph({ focus }), useTabStyle(tx, …)) and merely
          // shares a spelling with a shared value declared further down the file.
          if (/\n\}/.test(src.slice(at, declIdx))) continue;
          flagged.add(name);
          const line = src.slice(0, at).split("\n").length;
          const declLine = src.slice(0, declIdx).split("\n").length;
          problems.push(
            `${relative(process.cwd(), file)}:${line}  ${hook} reads ${name}.value, ` +
              `but ${name} is declared below it on line ${declLine}`
          );
        }

        // (1) ordinary JS functions called from the UI thread
        for (const m of body.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
          const name = m[1];
          if (isAllowed(name) || HOOKS.includes(name)) continue;
          // Methods on a value (arr.map, obj.fn) are fine; bare calls are not.
          if (name.includes(".")) continue;
          const line = src.slice(0, open + m.index).split("\n").length;
          problems.push(`${relative(process.cwd(), file)}:${line}  ${hook} calls ${name}()`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error("\n✖ Reanimated worklet problems:\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\n  These crash at runtime and tsc cannot see them.\n" +
      "  · calls  — precompute the value into a constant outside the hook.\n" +
      "  · .value — move the useSharedValue above the hook that reads it.\n"
  );
  process.exit(1);
}
console.log("✓ worklets clean");
