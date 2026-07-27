#!/usr/bin/env node
// Bundle size budget check for the production build (see docs/05-ui.md).
// Pure Node, no dependencies: reads .output/chrome-mv3, walks the static
// import graph of every HTML entrypoint and sums gzip size of reachable JS.
// A chunk shared by several entrypoints is counted once per entrypoint, so
// the popup total stays honest even when the search page reuses the same code.
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import process from 'node:process';

const OUT_DIR = resolve(process.argv[2] ?? '.output/chrome-mv3');
const ENTRY_HTML = ['popup.html', 'search.html', 'options.html'];
const BACKGROUND = 'background.js';
const KB = 1024;
// docs/05-ui.md: JS popup суммарно ≤ 80 КБ gzip.
const POPUP_JS_BUDGET = 80 * KB;

const gzipCache = new Map();

function sizes(file) {
    let entry = gzipCache.get(file);
    if (!entry) {
        const raw = readFileSync(file);
        entry = { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length };
        gzipCache.set(file, entry);
    }
    return entry;
}

function fmt(bytes) {
    return `${(bytes / KB).toFixed(1)} KB`;
}

function rel(file) {
    return relative(OUT_DIR, file).split(/[\\/]/).join(posix.sep);
}

// Resolves an href/src from an HTML file or a JS chunk to a path inside OUT_DIR.
function resolveRef(spec, fromFile) {
    if (/^[a-z]+:/i.test(spec)) return null; // http:, data:, chrome-extension:
    const [path] = spec.split(/[?#]/);
    const file = path.startsWith('/') ? join(OUT_DIR, path) : resolve(dirname(fromFile), path);
    return file.startsWith(OUT_DIR) && existsSync(file) ? file : null;
}

// Static imports only, as emitted by rollup: `import ... from"x"`, `export ... from"x"`,
// bare `import"x"`. Dynamic `import("x")` never matches (a paren follows `import`).
// Regex on minified code is a heuristic; resolveRef drops anything that is not a real
// emitted file, which filters accidental matches inside string literals.
const IMPORT_RE = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;

function collectJs(entryFile) {
    const seen = new Set();
    const queue = [entryFile];
    while (queue.length > 0) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        const code = readFileSync(file, 'utf8');
        for (const match of code.matchAll(IMPORT_RE)) {
            const target = resolveRef(match[1] ?? match[2], file);
            if (target && target.endsWith('.js') && !seen.has(target)) queue.push(target);
        }
    }
    return [...seen];
}

function collectCss(htmlFile, html) {
    const files = [];
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = match[0];
        if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
        const file = href ? resolveRef(href[1], htmlFile) : null;
        if (file) files.push(file);
    }
    return files;
}

function group(title, files) {
    const total = { raw: 0, gzip: 0 };
    const rows = files
        .map((file) => ({ name: rel(file), ...sizes(file) }))
        .sort((a, b) => b.gzip - a.gzip);
    for (const row of rows) {
        total.raw += row.raw;
        total.gzip += row.gzip;
        console.log(
            `    ${row.name.padEnd(38)}${fmt(row.raw).padStart(10)}${fmt(row.gzip).padStart(12)}`,
        );
    }
    console.log(
        `  ${`= ${title}`.padEnd(40)}${fmt(total.raw).padStart(10)}${fmt(total.gzip).padStart(12)}`,
    );
    return total;
}

if (!existsSync(OUT_DIR)) {
    console.error(`Build output not found: ${OUT_DIR}\nRun \`pnpm build\` first.`);
    process.exit(1);
}

console.log(`Bundle size — ${rel(OUT_DIR) || OUT_DIR} (gzip -9, 1 KB = 1024 B)`);
console.log(`${''.padEnd(42)}${'raw'.padStart(10)}${'gzip'.padStart(12)}`);

const totals = new Map();
for (const name of ENTRY_HTML) {
    const htmlFile = join(OUT_DIR, name);
    if (!existsSync(htmlFile)) continue; // entrypoint may not exist yet (e.g. options)
    const html = readFileSync(htmlFile, 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)]
        .filter((match) => /type\s*=\s*["']?module/i.test(match[0]))
        .map((match) => /src\s*=\s*["']([^"']+)["']/i.exec(match[0]))
        .map((src) => (src ? resolveRef(src[1], htmlFile) : null))
        .filter((file) => file !== null);

    console.log(`\n  ${name}`);
    const js = group('JS', scripts.flatMap(collectJs));
    const css = group('CSS', collectCss(htmlFile, html));
    totals.set(name, { js, css });
}

const backgroundFile = join(OUT_DIR, BACKGROUND);
if (existsSync(backgroundFile)) {
    console.log(`\n  ${BACKGROUND}`);
    group('JS', collectJs(backgroundFile));
} else {
    console.log(`\n  ${BACKGROUND}: not found`);
}

const popup = totals.get('popup.html');
if (!popup) {
    console.error('\nFAIL: popup.html is missing from the build, budget cannot be checked.');
    process.exit(1);
}

const over = popup.js.gzip > POPUP_JS_BUDGET;
const diff = fmt(Math.abs(POPUP_JS_BUDGET - popup.js.gzip));
console.log(
    `\n${over ? 'FAIL' : 'OK'}: popup JS ${fmt(popup.js.gzip)} gzip ` +
        `${over ? 'over' : 'within'} budget ${fmt(POPUP_JS_BUDGET)} (${over ? 'excess' : 'headroom'} ${diff})`,
);
process.exit(over ? 1 : 0);
