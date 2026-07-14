/**
 * One-off maintainer script: ensure every JSX opening tag with onClick has cursor-pointer
 * (unless it already sets cursor-grab/default/not-allowed or dismiss-backdrop).
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "src");
const SKIP_TAGS = new Set([
  "Fragment",
  "Suspense",
  "Provider",
  "ErrorBoundary",
]);

function walk(d, a = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, a);
    else if (f.endsWith(".tsx")) a.push(p);
  }
  return a;
}

function extractOpenTags(src) {
  const tags = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] !== "<" || src[i + 1] === "/" || src[i + 1] === "!") {
      i++;
      continue;
    }
    const start = i;
    i++;
    const nameMatch = /^([A-Za-z][\w.]*)/.exec(src.slice(i));
    if (!nameMatch) continue;
    const name = nameMatch[1];
    i += nameMatch[0].length;
    let depth = 0;
    let inStr = null;
    let escaped = false;
    while (i < src.length) {
      const ch = src[i];
      if (inStr) {
        if (!escaped && ch === inStr) inStr = null;
        escaped = !escaped && ch === "\\";
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        i++;
        continue;
      }
      if (ch === "{") {
        depth++;
        i++;
        continue;
      }
      if (ch === "}") {
        depth--;
        i++;
        continue;
      }
      if (depth === 0 && (ch === ">" || (ch === "/" && src[i + 1] === ">"))) {
        const end = ch === "/" ? i + 2 : i + 1;
        tags.push({ name, chunk: src.slice(start, end), start, end });
        i = end;
        break;
      }
      i++;
    }
  }
  return tags;
}

function shouldSkip(chunk) {
  if (/dismiss-backdrop/.test(chunk)) return true;
  if (
    /cursor-(?:pointer|grab|grabbing|zoom|not-allowed|default|text|col-resize|row-resize|ew-resize|ns-resize|move)/.test(
      chunk
    )
  ) {
    return true;
  }
  if (/style=\{\{[^}]*cursor\s*:/.test(chunk)) return true;
  if (/readOnly\s*&&/.test(chunk) && /cursor-default/.test(chunk)) return true;
  return false;
}

function patchChunk(chunk) {
  if (shouldSkip(chunk)) return chunk;

  if (/className="/.test(chunk)) {
    return chunk.replace(/className="/, 'className="cursor-pointer ');
  }
  if (/className='/.test(chunk)) {
    return chunk.replace(/className='/, "className='cursor-pointer ");
  }
  if (/className=\{`/.test(chunk)) {
    return chunk.replace(/className=\{`/, "className={`cursor-pointer ");
  }
  if (/className=\{cn\(/.test(chunk)) {
    return chunk.replace(/className=\{cn\(/, 'className={cn("cursor-pointer", ');
  }
  return chunk.replace(/\/?>$/, (m) => ` className="cursor-pointer"${m}`);
}

let filesChanged = 0;
let tagsPatched = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  const tags = extractOpenTags(src);
  const patches = [];
  for (const t of tags) {
    if (SKIP_TAGS.has(t.name)) continue;
    if (!/onClick=/.test(t.chunk)) continue;
    if (!/^(button|a|Link|div|li|span|label|td|tr|article|section|header|footer|nav|aside|img)$/i.test(t.name)) {
      /* custom components: patch usage site via className on parent if needed */
    }
    if (shouldSkip(t.chunk)) continue;
    const next = patchChunk(t.chunk);
    if (next !== t.chunk) {
      patches.push({ start: t.start, end: t.end, next });
      tagsPatched++;
    }
  }
  if (!patches.length) continue;
  patches.sort((a, b) => b.start - a.start);
  let out = src;
  for (const p of patches) {
    out = out.slice(0, p.start) + p.next + out.slice(p.end);
  }
  fs.writeFileSync(file, out);
  filesChanged++;
}

console.log(JSON.stringify({ filesChanged, tagsPatched }, null, 2));
