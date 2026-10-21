/**
 * Resizes the generated base icon into PWA icons.
 *
 *   node scripts/generate-icons.js [source.png]
 *
 * Produces public/icons/icon-192.png, icon-512.png and icon-maskable-512.png.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const DEFAULT_SOURCE = path.join(__dirname, '..', 'vibe_images');

async function main() {
  const argSource = process.argv[2];
  let source = argSource;
  if (!source) {
    const candidates = fs
      .readdirSync(DEFAULT_SOURCE)
      .filter((f) => /^app-icon-base.*\.png$/i.test(f))
      .sort();
    if (!candidates.length) {
      console.error('No source icon found in vibe_images/. Pass a path: node scripts/generate-icons.js icon.png');
      process.exit(1);
    }
    source = path.join(DEFAULT_SOURCE, candidates[candidates.length - 1]);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = await Jimp.read(source);

  async function writeSquare(size, name, mode) {
    const img = base.clone();
    if (mode === 'maskable') {
      // Maskable icons need the artwork inside the central 80% safe zone.
      const inner = img.clone().contain(size, size);
      const canvas = new Jimp(size, size, '#1a3a5c');
      const padded = Math.round(size * 0.1);
      inner.resize(size - padded * 2, size - padded * 2);
      canvas.composite(inner, padded, padded);
      await canvas.quality(90).writeAsync(path.join(OUT_DIR, name));
    } else {
      img.contain(size, size);
      await img.quality(90).writeAsync(path.join(OUT_DIR, name));
    }
    console.log(`wrote public/icons/${name}`);
  }

  await writeSquare(192, 'icon-192.png');
  await writeSquare(512, 'icon-512.png');
  await writeSquare(512, 'icon-maskable-512.png', 'maskable');
}

main().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
