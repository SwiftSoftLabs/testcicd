/**
 * Read-only audit: non-semantic JSX tags with onClick missing cursor affordance.
 * Exit 1 when gaps found (for optional CI). Does not modify files.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "src");
const NON_SEMANTIC = new Set([
  "div",
  "span",
  "li",
  "td",
  "tr",
  "article",
  "section",
  "header",
  "footer",
  "nav",
  "aside",
  "img",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
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
    if (!nameMatch) {
      i++;
      continue;
    }
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
        tags.push({ name, chunk: src.slice(start, end), start });
        i = end;
        break;
      }
      i++;
    }
  }
  return tags;
}

function hasCursorAffordance(chunk) {
  if (/className=\{sel\}/.test(chunk)) return true;
  if (/role=["']button["']/.test(chunk)) return true;
  if (
    /cursor-(?:pointer|grab|grabbing|default|not-allowed|text|zoom|col-resize|row-resize|ew-resize|ns-resize|move)/.test(
      chunk
    )
  ) {
    return true;
  }
  if (/dismiss-backdrop/.test(chunk)) return true;
  if (/style=\{\{[^}]*cursor\s*:/.test(chunk)) return true;
  if (/style=\{\{[\s\S]*?cursor\s*:/.test(chunk)) return true;
  return false;
}

const gaps = [];

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  for (const t of extractOpenTags(src)) {
    if (!NON_SEMANTIC.has(t.name)) continue;
    if (!/onClick=/.test(t.chunk)) continue;
    if (hasCursorAffordance(t.chunk)) continue;
    const line = src.slice(0, t.start).split("\n").length;
    gaps.push({
      file,
      line,
      tag: t.name,
      snippet: t.chunk.slice(0, 120).replace(/\s+/g, " "),
    });
  }
}

if (gaps.length) {
  console.error(`Found ${gaps.length} non-semantic onClick without cursor affordance:\n`);
  for (const g of gaps) {
    console.error(`  ${g.file}:${g.line} <${g.tag}> ${g.snippet}`);
  }
  process.exit(1);
}

console.log("OK: no non-semantic onClick cursor gaps");
