/**
 * 主包只留加载入口。维语包、GBK 和表格读写在分包里，用到再取。
 */
type Gbk = {
  encode: (text: string) => number[]
  decode: (bytes: ArrayLike<number>) => string
}

const lazy = require('./lazy-call.js') as {
  loadGbk: () => Promise<Gbk>
  loadSheet: () => Promise<SheetKit>
}

let gbkPromise: Promise<Gbk> | null = null

export function ensureGbk(): Promise<Gbk> {
  if (!gbkPromise) {
    gbkPromise = lazy.loadGbk().then((mod) => {
      const gbk = ((mod as { default?: Gbk }).default || mod) as Gbk
      if (!gbk || typeof gbk.encode !== 'function' || typeof gbk.decode !== 'function') {
        throw new Error('gbk')
      }
      return gbk
    })
    gbkPromise.catch(() => {
      gbkPromise = null
    })
  }
  return gbkPromise
}

let sheetPromise: Promise<SheetKit> | null = null

export type SheetKit = {
  autoMapping: (row: string[]) => Array<string>
  buildImportPlan: (opts: object) => { error?: string; plan?: unknown }
  columnViews: (rows: string[][], header: number, mapping: Array<string>) => Array<{ index: number; header: string; samples: string[]; field: string }>
  fieldChoices: (staff: boolean) => Array<{ id: string; label: string }>
  looksLikeHeader: (row: string[]) => boolean
  commitImport: (plan: unknown, staff: boolean) => Promise<{ stopped?: string; written: number; cloudMiss: string[]; synced?: boolean; categoryNote?: string; skipped: Array<{ code: string; reason: string }> }>
  exportFiles: (products: unknown[]) => string[][][]
  importBusy: () => boolean
  setImportBusy: (busy: boolean) => void
  staffUser: () => boolean
  readUserSheet: (path: string, size: number, name: string) => Promise<{ ok: true; table: { sheetName: string; rows: string[][] } } | { ok: false; error: string }>
  removeExportFiles: (paths: string[]) => void
  writeExportFile: (rows: string[][], kind: 'csv' | 'xlsx', index: number, prefix?: string) => string
}

export function loadSheetKit(): Promise<SheetKit> {
  if (!sheetPromise) {
    sheetPromise = lazy.loadSheet().then((mod) => {
      const kit = ((mod as { default?: SheetKit }).default || mod) as SheetKit
      if (!kit || typeof kit.writeExportFile !== 'function') throw new Error('sheet')
      return kit
    })
    sheetPromise.catch(() => {
      sheetPromise = null
    })
  }
  return sheetPromise
}
