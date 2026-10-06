import sharp from 'sharp';

// How hard sharp works to shrink the WebP output. Higher squeezes more size
// out but costs more CPU per upload; 4 is libwebp's own default and stays
// fast enough that an upload request never feels slow under real load.
const WEBP_EFFORT = 4;

export type CompressPreset = 'thumbnail' | 'standard';

// Two presets cover everything we upload today:
//  - thumbnail: category icons, always rendered small (a few hundred px at
//    most), so there is no reason to ship anything bigger.
//  - standard: outlet and menu item photos, which may eventually appear
//    larger on a menu/detail page, so they keep more headroom.
// Picking the right preset at the call site (rather than one size for
// everything) is most of the actual byte savings here — resizing a photo
// that is only ever shown at 72px down to 1200px was pure waste.
const PRESETS: Record<CompressPreset, { maxDimension: number; quality: number }> = {
  thumbnail: { maxDimension: 640, quality: 78 },
  standard: { maxDimension: 1000, quality: 82 },
};

/**
 * Re-encodes an uploaded image to WebP: EXIF-rotated then stripped, capped to
 * the preset's max dimension (never upscaled), and quality-compressed. Runs
 * fully in memory — nothing touches disk — so it is safe to call from a
 * request handler without extra I/O overhead.
 */
export async function compressImage(buffer: Buffer, preset: CompressPreset = 'standard'): Promise<Buffer> {
  const { maxDimension, quality } = PRESETS[preset];

  return sharp(buffer)
    .rotate() // respect EXIF orientation before it gets stripped below
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: WEBP_EFFORT })
    .toBuffer();
}
