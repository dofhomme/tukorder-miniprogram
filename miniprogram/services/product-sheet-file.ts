/**
 * 在手机上读、写表格。不把文件上传到服务器。
 */
import { looksLikeHeader } from './product-import'
import { ensureGbk } from './pack-lazy'
import {
  buildXlsx,
  csvText,
  entryText,
  extOf,
  fileTooBig,
  firstSheetTarget,
  inspectZip,
  parseCsv,
  sharedStrings,
  utf8,
  utf8Bytes,
  worksheetRows,
  type ZipEntry,
} from './product-sheet-codec'

export type SheetTable = { sheetName: string; rows: string[][] }

function readBuffer(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (res) => resolve(res.data as ArrayBuffer),
      fail: (err) => reject(err),
    })
  })
}

function zipText(path: string, entry: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager() as WechatMiniprogram.FileSystemManager & {
      readZipEntry: (opts: {
        filePath: string
        entries: Array<{ path: string; encoding: 'utf-8' }>
        success: (res: { entries?: Record<string, { data?: string; errMsg?: string }> }) => void
        fail: () => void
      }) => void
    }
    fs.readZipEntry({
      filePath: path,
      entries: [{ path: entry, encoding: 'utf-8' }],
      success: (res) => {
        const item = res.entries ? res.entries[entry] : undefined
        const data = item && item.data ? String(item.data) : ''
        if (!data) {
          reject(new Error('读取表格失败'))
          return
        }
        resolve(data)
      },
      fail: () => reject(new Error('读取表格失败')),
    })
  })
}

async function textOf(path: string, entry: ZipEntry): Promise<string> {
  const stored = entryText(entry)
  if (stored != null) return stored
  return zipText(path, entry.name)
}

function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const want = name.replace(/^\/+/, '')
  return entries.find((e) => e.name.replace(/^\/+/, '') === want)
}

async function decodeCsv(bytes: Uint8Array): Promise<{ text: string } | { error: string }> {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { error: '请把 CSV 另存为 UTF-8 或 GBK' }
  }
  const asUtf = utf8(bytes)
  if (asUtf.indexOf('\ufffd') < 0) return { text: asUtf }
  let asGbk = ''
  try {
    const GBK = await ensureGbk()
    asGbk = GBK.decode(bytes)
  } catch (_) {
    asGbk = ''
  }
  if (asGbk && asGbk.indexOf('\u0000') < 0) return { text: asGbk }
  return { error: '文件编码无法识别，请另存为 UTF-8 或 GBK' }
}

export async function readUserSheet(path: string, size: number, name: string): Promise<{ ok: true; table: SheetTable } | { ok: false; error: string }> {
  if (fileTooBig(size)) return { ok: false, error: '文件超过 10MB' }
  const ext = extOf(name)
  if (ext !== 'xlsx' && ext !== 'csv') return { ok: false, error: '只支持 .xlsx 和 .csv' }
  let buf: ArrayBuffer
  try {
    buf = await readBuffer(path)
  } catch (_) {
    return { ok: false, error: '文件读不出来' }
  }
  if (buf.byteLength > 10 * 1024 * 1024) return { ok: false, error: '文件超过 10MB' }
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    return { ok: false, error: '不支持旧版 .xls，请另存为 .xlsx' }
  }
  const head = utf8(bytes.subarray(0, 80)).trim().toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return { ok: false, error: '这不是表格文件' }
  }
  if (ext === 'csv') {
    if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return { ok: false, error: '这个文件不是 CSV' }
    const decoded = await decodeCsv(bytes)
    if ('error' in decoded) return { ok: false, error: decoded.error }
    const rows = parseCsv(decoded.text)
    if (!rows.length) return { ok: false, error: '文件是空的' }
    if (rows.length === 1) return { ok: false, error: '只有表头，没有数据' }
    return { ok: true, table: { sheetName: 'CSV', rows } }
  }
  if (!(bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return { ok: false, error: '不是有效的 Excel 文件' }
  }
  const zip = inspectZip(bytes)
  if (!zip.ok) return { ok: false, error: zip.error }
  const types = findEntry(zip.entries, '[Content_Types].xml')
  if (types) {
    try {
      const xml = (await textOf(path, types)).toLowerCase()
      if (xml.indexOf('vbaproject') >= 0 || xml.indexOf('macroenabled') >= 0) {
        return { ok: false, error: '不能导入带宏的表格' }
      }
    } catch (_) {
      return { ok: false, error: '这个表格打不开' }
    }
  }
  const book = findEntry(zip.entries, 'xl/workbook.xml')
  const rels = findEntry(zip.entries, 'xl/_rels/workbook.xml.rels')
  if (!book || !rels) return { ok: false, error: '找不到第一张表' }
  let sheet: { name: string; path: string }
  try {
    const target = firstSheetTarget(await textOf(path, book), await textOf(path, rels))
    if ('error' in target) return { ok: false, error: target.error }
    sheet = target
  } catch (_) {
    return { ok: false, error: '这个表格打不开' }
  }
  const sheetEntry = findEntry(zip.entries, sheet.path)
  if (!sheetEntry) return { ok: false, error: '找不到第一张表' }
  let strings: string[] = []
  const shared = findEntry(zip.entries, 'xl/sharedStrings.xml')
  try {
    if (shared) strings = sharedStrings(await textOf(path, shared))
    const parsed = worksheetRows(await textOf(path, sheetEntry), strings)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    const rows = parsed.rows.filter((row, index) => index === 0 || row.some((cell) => String(cell || '').trim()))
    if (!rows.length) return { ok: false, error: '文件是空的' }
    if (rows.length === 1 && looksLikeHeader(rows[0])) return { ok: false, error: '只有表头，没有数据' }
    return { ok: true, table: { sheetName: sheet.name || 'Sheet1', rows } }
  } catch (_) {
    return { ok: false, error: '这个表格打不开' }
  }
}

function userFile(name: string): string {
  return `${wx.env.USER_DATA_PATH}/${name}`
}

export function writeExportFile(rows: string[][], kind: 'csv' | 'xlsx', index: number, prefix = 'products'): string {
  const stamp = Date.now()
  const tag = String(prefix || 'products').replace(/[^a-z0-9_-]/gi, '') || 'products'
  const name = kind === 'csv' ? `tuk-${tag}-${stamp}-${index}.csv` : `tuk-${tag}-${stamp}-${index}.xlsx`
  const path = userFile(name)
  const fs = wx.getFileSystemManager()
  if (kind === 'csv') {
    fs.writeFileSync(path, csvText(rows), 'utf8')
  } else {
    const bytes = buildXlsx(rows)
    const copy = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(copy).set(bytes)
    fs.writeFileSync(path, wx.arrayBufferToBase64(copy), 'base64')
  }
  return path
}

export function removeExportFiles(paths: string[]) {
  const fs = wx.getFileSystemManager()
  for (const path of paths) {
    try {
      fs.unlinkSync(path)
    } catch (_) {
      /* 已经不在了 */
    }
  }
}

export function xlsxBytes(rows: string[][]): Uint8Array {
  return buildXlsx(rows)
}

export function csvBytes(rows: string[][]): Uint8Array {
  return utf8Bytes(csvText(rows))
}
