import multer from 'multer';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a phone photo, keeps requests fast

// Files are held in memory only long enough to hand the buffer to sharp/ImageKit.
// Nothing is ever written to local disk.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only JPEG, PNG or WebP images are allowed.'));
      return;
    }
    cb(null, true);
  },
});
