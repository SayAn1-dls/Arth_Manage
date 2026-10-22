// Brand guardrails (docs/BRAND_IMPLEMENTATION.md §9). Fails the build on drift from the Arthakram kit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const allowedRawColour = new Set(['styles/tokens.css']); // the only file allowed to hold raw values
const skipDirs = new Set(['assets', 'generated']);
const exts = /\.(tsx?|css|html)$/;

const rules = [
  {
    name: 'raw colour value outside tokens.css',
    re: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/,
    onlyOutsideTokens: true,
  },
  {
    name: 'Quill Orange (#FC6E1A) is for logo artwork only',
    re: /fc6e1a|--ak-quill/i,
    onlyOutsideTokens: true,
  },
  { name: 'forbidden typeface (Poppins/Montserrat)', re: /poppins|montserrat/i },
  {
    name: 'white text on Ember fails contrast (use Ink)',
    re: /bg-ember[^"'`]*text-white|text-white[^"'`]*bg-ember/,
  },
  {
    name: 'Ember as ordinary text colour (use Ink/Graphite; Ember is fill-only)',
    re: /(?<![\w-])text-ember\b/,
  },
  {
    name: 'Tailwind default palette (use brand tokens)',
    re: /\b(?:bg|text|border|ring|from|to|via)-(?:blue|indigo|violet|purple|sky|cyan|teal|emerald|green|slate|gray|zinc|neutral|stone|red|rose|pink|fuchsia|yellow|amber|lime)-\d{2,3}\b/,
  },
];

const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!skipDirs.has(name)) walk(full);
      continue;
    }
    if (!exts.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const rel = relative(root, full);
    const isTokens = allowedRawColour.has(rel);
    readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const rule of rules) {
          if (rule.onlyOutsideTokens && isTokens) continue;
          if (rule.re.test(line))
            problems.push(`${rel}:${i + 1}  ${rule.name}\n    ${line.trim()}`);
        }
      });
  }
}
walk(root);

if (problems.length) {
  console.error(`Brand lint failed (${problems.length}):\n` + problems.join('\n'));
  process.exit(1);
}
console.log('Brand lint passed.');
