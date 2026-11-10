import type { PaperWidthMm } from './thermal-paper'

export type ThermalDeviceProfile = {
  id: string
  label: string
  tokens: string[]
  serviceUuids: string[]
  bleRequired?: boolean
  defaultPaperMm?: PaperWidthMm
  maxGear?: number
}

export const THERMAL_PROFILES: ThermalDeviceProfile[] = [
  {
    id: 'hprt-b',
    label: '汉印 B 系列',
    tokens: ['B11', 'B12', 'B16', 'B18', 'B21', 'HPRT'],
    serviceUuids: ['FF00', 'FFE0', '18F0'],
    bleRequired: true,
    defaultPaperMm: 58,
    maxGear: 6,
  },
  {
    id: 'gprinter',
    label: '佳博 GP',
    tokens: ['GP-', 'GP_', 'GPRINTER'],
    serviceUuids: ['FFE0', 'FF00'],
    defaultPaperMm: 80,
  },
  {
    id: 'xprinter',
    label: '芯烨 XP',
    tokens: ['XP-', 'XP_', 'XPRINTER'],
    serviceUuids: ['FF00', '18F0'],
    defaultPaperMm: 80,
  },
  {
    id: 'sunmi',
    label: '商米',
    tokens: ['SUNMI'],
    serviceUuids: ['18F0'],
    defaultPaperMm: 80,
    maxGear: 8,
  },
  {
    id: 'goojprt',
    label: 'Goojprt',
    tokens: ['GOOJPRT', 'MPT-', 'PT-'],
    serviceUuids: ['FFE0', 'FFF0'],
    bleRequired: true,
    defaultPaperMm: 58,
  },
  {
    id: 'generic-pos',
    label: '通用 ESC/POS',
    tokens: ['PRINTER', 'PRINT', 'POS', 'RECEIPT', '打印', '热敏', '票据', 'P58', 'P80', 'RPP', 'HM-A', 'MUNBYN'],
    serviceUuids: ['FF00', 'FFE0', '18F0', 'FFF0', 'AE30', 'EEE0'],
  },
]

export const BLE_PRINTER_SERVICE_UUIDS = [
  'EEE0', 'FF00', 'FF10', 'FFE0', '18F0', 'FFF0', 'AE30',
]

export function matchThermalProfile(name?: string): ThermalDeviceProfile | null {
  const up = String(name || '').toUpperCase()
  if (!up) return null
  for (const p of THERMAL_PROFILES) {
    if (p.tokens.some((t) => up.includes(t.toUpperCase()))) return p
  }
  return null
}
