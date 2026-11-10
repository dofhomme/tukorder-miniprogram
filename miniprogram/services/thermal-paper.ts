/** 热敏纸宽：203 DPI（8 点/mm）。110mm 按 104mm 可打宽 = 832 点 / Font A 64 列。 */

export type PaperWidthMm = 58 | 80 | 110

export const PAPER_WIDTHS: PaperWidthMm[] = [58, 80, 110]

export function isPaperWidthMm(mm: unknown): mm is PaperWidthMm {
  return mm === 58 || mm === 80 || mm === 110
}

export function normalizePaperWidthMm(mm?: number | null): PaperWidthMm {
  return isPaperWidthMm(mm) ? mm : 80
}

export function dotsPerLine(mm?: number | null): number {
  switch (normalizePaperWidthMm(mm)) {
    case 58:
      return 384
    case 110:
      return 832
    default:
      return 576
  }
}

export function lineWidthChars(mm?: number | null): number {
  switch (normalizePaperWidthMm(mm)) {
    case 58:
      return 32
    case 110:
      return 64
    default:
      return 48
  }
}

/** GBK 全角横线个数（每条约占 2 列） */
export function gbkDashCount(mm?: number | null): number {
  switch (normalizePaperWidthMm(mm)) {
    case 58:
      return 24
    case 110:
      return 42
    default:
      return 32
  }
}
