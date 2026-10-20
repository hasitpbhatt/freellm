const MAX_DIMENSION = 1024
const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** Downscales an image file to a bounded JPEG data URL for vision requests. */
export async function fileToImageDataUrl(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or GIF image.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is too large. Try one under 15 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not read that image.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    bitmap.close()
  }
}
