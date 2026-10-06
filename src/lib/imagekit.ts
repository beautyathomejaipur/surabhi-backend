import ImageKit from 'imagekit';
import { randomUUID } from 'node:crypto';
import { compressImage, type CompressPreset } from './image-compress.js';

let client: ImageKit | null = null;

function getClient(): ImageKit {
  if (client) return client;

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;

  if (!publicKey || !privateKey || !urlEndpoint) {
    throw new Error(
      'ImageKit is not configured. Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT.',
    );
  }

  client = new ImageKit({ publicKey, privateKey, urlEndpoint });
  return client;
}


export type UploadedImage = { url: string; publicId: string };

/**
 * Compresses the image (see lib/image-compress.ts) before it ever leaves
 * this server, then uploads it to ImageKit under the given folder — each
 * upload type (categories, menu items, outlets) gets its own folder, kept
 * as a leading-slash path the way ImageKit expects.
 */
export async function uploadImage(
  buffer: Buffer,
  folder: string,
  preset: CompressPreset = 'standard',
): Promise<UploadedImage> {
  const imagekit = getClient();
  const optimized = await compressImage(buffer, preset);
  const normalizedFolder = folder.startsWith('/') ? folder : `/${folder}`;

  const result = await imagekit.upload({
    file: optimized,
    fileName: `${randomUUID()}.webp`,
    folder: normalizedFolder,
    useUniqueFileName: false,
  });

  return { url: result.url, publicId: result.fileId };
}

export async function deleteImage(fileId: string): Promise<void> {
  const imagekit = getClient();
  await imagekit.deleteFile(fileId).catch((err) => {
    // Best-effort cleanup — an orphaned ImageKit asset is a non-issue,
    // but a failed request must not block the API response.
    console.error('Failed to delete ImageKit asset', fileId, err);
  });
}