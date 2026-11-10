/** 运单号快递粗判（对齐 App CourierDetector） */
export type CourierKind = 'zto' | 'sf' | 'other'

export function detectCourier(raw: string): CourierKind {
  const compact = (raw || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!compact) return 'other'
  if (/^SF[A-Z0-9]{8,}$/.test(compact)) return 'sf'
  const digits = compact.replace(/[^0-9]/g, '')
  if (!digits) return 'other'
  if (/^7\d{11}$/.test(digits) || /^7\d{13}$/.test(digits)) return 'zto'
  if (/^0\d{11}$/.test(digits) || /^0\d{14}$/.test(digits)) return 'sf'
  return 'other'
}

export function courierLabel(kind: CourierKind): string {
  if (kind === 'zto') return '中通'
  if (kind === 'sf') return '顺丰'
  return '其他'
}

export function courierColor(kind: CourierKind): string {
  if (kind === 'zto') return '#1565C0'
  if (kind === 'sf') return '#2E7D32'
  return '#757575'
}
