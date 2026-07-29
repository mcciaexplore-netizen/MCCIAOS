#!/usr/bin/env node
// Installs the MCCIA logo into the app and the PDF reports in one step.
//
//   npm run logo -- path/to/mccia-logo.png
//
// Reads the image, base64-encodes it, and rewrites LOGO_DATA_URI in
// src/lib/brand.ts. Both the sidebar and the generated PDF read from there, so
// this is the only place the file needs to go.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const BRAND_FILE = resolve(process.cwd(), 'src/lib/brand.ts');

// pdfkit can embed PNG and JPEG only — no SVG — and the same bytes serve the
// browser, so restrict to what both consumers can use.
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run logo -- path/to/logo.png');
  process.exit(1);
}

const path = resolve(process.cwd(), input);
const ext = extname(path).toLowerCase();
const mime = MIME[ext];

if (!mime) {
  console.error(
    `Unsupported file type "${ext || '(none)'}". Use .png or .jpg.\n` +
      'An SVG cannot be embedded in the PDF; export it to PNG first ' +
      '(a transparent PNG around 600px wide works well).',
  );
  process.exit(1);
}

let bytes;
try {
  bytes = readFileSync(path);
} catch {
  console.error(`Could not read ${path}`);
  process.exit(1);
}

const kb = statSync(path).size / 1024;
if (kb > 400) {
  console.error(
    `That file is ${kb.toFixed(0)}KB. It is inlined into the JS bundle and ` +
      'every PDF, so please resize it under 400KB.',
  );
  process.exit(1);
}

const dataUri = `data:${mime};base64,${bytes.toString('base64')}`;

const source = readFileSync(BRAND_FILE, 'utf-8');
// The declaration carries an explicit `: string`, so match it optionally
// rather than assuming the bare form.
const next = source.replace(
  /export const LOGO_DATA_URI(\s*:\s*string)? = '[^']*';/,
  `export const LOGO_DATA_URI: string = '${dataUri}';`,
);

if (next === source) {
  console.error('Could not find LOGO_DATA_URI in src/lib/brand.ts — was it edited?');
  process.exit(1);
}

writeFileSync(BRAND_FILE, next);
console.log(`Installed ${input} (${kb.toFixed(0)}KB) into src/lib/brand.ts`);
console.log('It now appears in the sidebar and on every generated PDF report.');
