#!/usr/bin/env node
/**
 * Builds a single self-contained preview HTML (all sprites inlined as
 * base64 data URIs, no external file references) from the *current*
 * production build, and stamps it with the exact git commit it was
 * built from.
 *
 * Phase 16 shipped a runtime bug that a source-only unit test did not
 * catch: a single-HTML preview was built from a branch that had
 * forked from `main` *before* Phase 16's enemy-def.ts change landed,
 * so the artifact silently carried a stale bok attack value even
 * though the source on the intended branch was already correct (see
 * docs/history/phase-16-early-game-balance.md, section "single-HTML
 * artifact mismatch"). This script exists so that mistake can't repeat
 * silently:
 *
 * - it refuses to run against a dirty working tree (the artifact must
 *   correspond to an actual commit, not an uncommitted mix)
 * - it always runs `vite build` itself immediately before embedding,
 *   so the embedded bundle can never be a stale/previous dist/
 * - it stamps the exact commit hash into both the output filename and
 *   a `<meta name="build-commit">` tag inside the HTML, so any
 *   delivered preview can be checked against `git log` after the fact
 * - it re-reads the just-built bundle from disk right before embedding
 *   (never a cached copy from an earlier step in the same process)
 *
 * Usage: node scripts/build-single-html.mjs [output-dir]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : repoRoot;

function run(cmd) {
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

// 1. Refuse a dirty working tree — the artifact must trace back to a real commit.
const status = run('git status --porcelain');
if (status.length > 0) {
  console.error('Refusing to build: working tree is not clean.\n' + status);
  process.exit(1);
}
const commitHash = run('git rev-parse HEAD');
const shortHash = commitHash.slice(0, 12);
const branch = run('git rev-parse --abbrev-ref HEAD');

console.log(`Building single HTML from commit ${shortHash} (${branch})...`);

// 2. Always rebuild — never trust a pre-existing dist/.
fs.rmSync(path.join(repoRoot, 'dist'), { recursive: true, force: true });
run('npx vite build');

// 3. Re-read the just-built output from disk.
const distDir = path.join(repoRoot, 'dist');
const htmlPath = path.join(distDir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const scriptTagMatch = html.match(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/);
if (!scriptTagMatch) throw new Error('script tag not found in dist/index.html');
const jsRelPath = scriptTagMatch[1].replace(/^\//, '');
const jsPath = path.join(distDir, jsRelPath);
let js = fs.readFileSync(jsPath, 'utf8');

// 4. Inline every sprite PNG under dist/assets/sprites as a base64 data URI.
const spritesDir = path.join(distDir, 'assets/sprites');
const spriteFiles = fs.readdirSync(spritesDir).filter((f) => f.endsWith('.png'));
const spriteMap = {};
for (const file of spriteFiles) {
  const key = file.replace(/\.png$/, '');
  const b64 = fs.readFileSync(path.join(spritesDir, file)).toString('base64');
  spriteMap[key] = `data:image/png;base64,${b64}`;
}
for (const key of Object.keys(spriteMap)) {
  const literal = `assets/sprites/${key}.png`;
  js = js.split(`\`${literal}\``).join(`\`${spriteMap[key]}\``);
  js = js.split(`"${literal}"`).join(`"${spriteMap[key]}"`);
  js = js.split(`'${literal}'`).join(`'${spriteMap[key]}'`);
}
// Dynamically-built sprite paths (`assets/sprites/${key}.png` template
// literals in the bundle) go through a lookup table instead, since a
// literal string replace can't match a runtime-interpolated key.
js = js.replace('`assets/sprites/${B}.png`', 'window.__SPRITE_MAP__[B]');
js = `window.__SPRITE_MAP__=${JSON.stringify(spriteMap)};\n` + js;

const remainingRefs = js.match(/assets\/sprites\/[^`"')]+\.png/g);
if (remainingRefs) {
  throw new Error(`Unembedded external sprite references remain: ${remainingRefs.join(', ')}`);
}

// 5. Inline the patched JS into the HTML with a *function* replacer —
//    never a string replacer — because String.prototype.replace
//    interprets "$&", "$1", etc. as special patterns in a string
//    replacement, and minified JS of this size reliably contains such
//    sequences by coincidence (this previously corrupted a preview
//    build with a stray literal <script> tag from the surrounding HTML).
html = html.replace(scriptTagMatch[0], () => `<script type="module">\n${js}\n</script>`);

// 6. Stamp the exact commit so any delivered artifact is traceable.
const metaTag = `<meta name="build-commit" content="${commitHash}">\n<meta name="build-branch" content="${branch}">\n  `;
html = html.replace('</head>', `${metaTag}</head>`);

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `rogue-of-sun-preview-${shortHash}.html`);
fs.writeFileSync(outPath, html);

console.log(`Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`build-commit: ${commitHash}`);
console.log(`build-branch: ${branch}`);
