// Renders assets/logo.svg to a retina PNG that email clients can display.
// Run with: node scripts/build-logo-png.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await sharp(join(root, 'assets', 'logo.svg'), { density: 400 })
  .resize(200, 200)
  .png()
  .toFile(join(root, 'assets', 'logo.png'));

console.log('assets/logo.png written');
