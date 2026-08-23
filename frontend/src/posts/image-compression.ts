const MAX_INPUT_BYTES = 5_000_000
const TARGET_OUTPUT_BYTES = 1_000_000
const MAX_DIMENSION = 1600
const INITIAL_QUALITY = 0.8
const MIN_QUALITY = 0.3
const QUALITY_STEP = 0.1
const RESIZE_ATTEMPTS = 4

export class ImageCompressionError extends Error {}

/**
 * 投稿用の画像を、表示に十分な大きさを残しながら1MB以下のWebPへ変換する。
 * D1にはData URLとして保存するため、圧縮後のバイナリ容量を制限する。
 */
export async function compressPostImage(file: File): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageCompressionError('画像は5MB以下にしてください')
  }

  const source = (await isHeicCandidate(file)) ? await convertHeicToJpeg(file) : file
  const image = await loadImage(source)
  let { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, MAX_DIMENSION)

  for (let resizeAttempt = 0; resizeAttempt < RESIZE_ATTEMPTS; resizeAttempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new ImageCompressionError('画像を処理できませんでした')

    context.drawImage(image, 0, 0, width, height)
    for (let quality = INITIAL_QUALITY; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob.size <= TARGET_OUTPUT_BYTES) return readAsDataUrl(blob)
    }

    width = Math.max(1, Math.round(width * 0.8))
    height = Math.max(1, Math.round(height * 0.8))
  }

  throw new ImageCompressionError('画像を1MB以下に圧縮できませんでした。別の画像を選んでください')
}

function fitWithin(width: number, height: number, maxDimension: number) {
  const longestSide = Math.max(width, height)
  if (longestSide <= maxDimension) return { width, height }

  const scale = maxDimension / longestSide
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

async function convertHeicToJpeg(file: File): Promise<Blob> {
  try {
    // HEICデコーダー（約3MB）はHEIC選択時だけ取得し、通常の投稿表示を重くしない。
    const { heicTo, isHeic } = await import('heic-to')
    if (!(await isHeic(file))) return file
    return await heicTo({
      blob: file,
      type: 'image/jpeg',
      quality: 0.9,
    })
  } catch (error) {
    if (error instanceof ImageCompressionError) throw error
    throw new ImageCompressionError('HEIC画像を変換できませんでした')
  }
}

function isHeicCandidate(file: File): boolean {
  return (
    file.type.toLowerCase() === 'image/heic' ||
    file.type.toLowerCase() === 'image/heif' ||
    /\.hei[cf]$/i.test(file.name)
  )
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new ImageCompressionError('画像を読み込めませんでした'))
    }
    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new ImageCompressionError('画像を処理できませんでした'))
      },
      'image/webp',
      quality,
    )
  })
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageCompressionError('画像を処理できませんでした'))
    reader.readAsDataURL(blob)
  })
}
