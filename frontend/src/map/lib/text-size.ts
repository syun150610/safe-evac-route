export type MapTextSize = 'small' | 'medium' | 'large'

const STORAGE_KEY = 'safe-map-text-size'

export function parseMapTextSize(value: string | null): MapTextSize {
  return value === 'medium' || value === 'large' ? value : 'small'
}

export function readMapTextSize(): MapTextSize {
  try {
    return parseMapTextSize(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'small'
  }
}

export function saveMapTextSize(value: MapTextSize): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // 保存できない環境でも、開いている画面の変更はそのまま使える
  }
}
