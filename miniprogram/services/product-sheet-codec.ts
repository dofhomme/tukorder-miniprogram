/** 表格读写。不访问网络，不执行公式。 */

const MAX_FILE = 10 * 1024 * 1024
const MAX_UNZIP = 40 * 1024 * 1024
const MAX_ENTRIES = 200

export function fileTooBig(size: number): boolean {
  return !Number.isFinite(size) || size > MAX_FILE
}

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim())
  return m ? m[1].toLowerCase() : ''
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

export type ZipEntry = {
  name: string
  method: number
  flag: number
  compressed: number
  uncompressed: number
  offset: number
  data?: Uint8Array
}

export function inspectZip(bytes: Uint8Array): { ok: true; entries: ZipEntry[] } | { ok: false; error: string } {
  if (bytes.length < 22 || u32(bytes, 0) !== 0x04034b50) return { ok: false, error: '不是有效的 Excel 文件' }
  let eocd = -1
  const start = Math.max(0, bytes.length - 66 * 1024)
  for (let i = bytes.length - 22; i >= start; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return { ok: false, error: '这个表格打不开' }
  const total = u16(bytes, eocd + 10)
  const cdOff = u32(bytes, eocd + 16)
  if (total <= 0 || total > MAX_ENTRIES) return { ok: false, error: '这个表格结构不支持' }
  const entries: ZipEntry[] = []
  let pos = cdOff
  let unzip = 0
  for (let n = 0; n < total; n++) {
    if (pos + 46 > bytes.length || u32(bytes, pos) !== 0x02014b50) return { ok: false, error: '这个表格打不开' }
    const flag = u16(bytes, pos + 8)
    const method = u16(bytes, pos + 10)
    const compressed = u32(bytes, pos + 20)
    const uncompressed = u32(bytes, pos + 24)
    const nameLen = u16(bytes, pos + 28)
    const extraLen = u16(bytes, pos + 30)
    const commentLen = u16(bytes, pos + 32)
    const localOff = u32(bytes, pos + 42)
    const name = utf8(bytes.subarray(pos + 46, pos + 46 + nameLen))
    if (flag & 1) return { ok: false, error: '不支持加密的表格' }
    if (method !== 0 && method !== 8) return { ok: false, error: '这个表格的压缩方式不支持' }
    const lower = name.toLowerCase()
    if (/vbaproject|externallink|embeddings|activex|macrosheet/.test(lower)) {
      return { ok: false, error: '不能导入带宏或外部链接的表格' }
    }
    unzip += uncompressed
    if (unzip > MAX_UNZIP) return { ok: false, error: '表格解压后超过 40MB' }
    let data: Uint8Array | undefined
    if (method === 0 && localOff + 30 < bytes.length) {
      const ln = u16(bytes, localOff + 26)
      const le = u16(bytes, localOff + 28)
      const begin = localOff + 30 + ln + le
      data = bytes.subarray(begin, begin + uncompressed)
    }
    entries.push({ name, method, flag, compressed, uncompressed, offset: localOff, data })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return { ok: true, entries }
}

export function utf8(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i]
    if (c < 0x80) {
      out += String.fromCharCode(c)
      i++
      continue
    }
    if (c < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
      continue
    }
    if (c < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
      continue
    }
    if (i + 3 < bytes.length) {
      const cp = ((c & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      const u = cp - 0x10000
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff))
      i += 4
      continue
    }
    out += '\ufffd'
    i++
  }
  return out
}

export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const n = text.charCodeAt(i + 1)
      if (n >= 0xdc00 && n <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (n - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return Uint8Array.from(out)
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

function textsOf(xml: string): string[] {
  const out: string[] = []
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(unescapeXml(m[1]))
  return out
}

export function sharedStrings(xml: string): string[] {
  const out: string[] = []
  const parts = xml.split(/<si\b/)
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].split(/<\/si>/)[0] || ''
    out.push(textsOf(chunk).join(''))
  }
  return out
}

function colRow(ref: string): { c: number; r: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase())
  if (!m) return null
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { c: c - 1, r: Number(m[2]) - 1 }
}

export function worksheetRows(xml: string, strings: string[]): { rows: string[][] } | { error: string } {
  const map = new Map<number, Map<number, string>>()
  const cells = xml.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^/]*\/>/g) || []
  if (cells.length > 5000 * 32) return { error: '表格太大' }
  let maxR = 0
  let maxC = 0
  for (const cell of cells) {
    const ref = /r="([A-Z]+\d+)"/i.exec(cell)
    if (!ref) continue
    const pos = colRow(ref[1])
    if (!pos || pos.c > 80) continue
    const type = /t="([^"]+)"/.exec(cell)
    const t = type ? type[1] : ''
    let value = ''
    if (t === 'inlineStr') {
      const inner = /<is\b[\s\S]*?<\/is>/.exec(cell)
      value = inner ? textsOf(inner[0]).join('') : ''
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(cell)
      if (!v) continue
      value = unescapeXml(v[1].trim())
      if (t === 's') {
        const idx = Number(value)
        value = Number.isInteger(idx) && strings[idx] != null ? strings[idx] : ''
      }
    }
    if (!map.has(pos.r)) map.set(pos.r, new Map())
    map.get(pos.r)!.set(pos.c, value)
    if (pos.r > maxR) maxR = pos.r
    if (pos.c > maxC) maxC = pos.c
  }
  if (maxR > 20000 || maxC > 64) return { error: '表格太大' }
  const rows: string[][] = []
  for (let r = 0; r <= maxR; r++) {
    const line = map.get(r)
    if (!line) {
      rows.push([])
      continue
    }
    const row: string[] = []
    line.forEach((v, c) => {
      row[c] = v
    })
    for (let c = 0; c < row.length; c++) if (row[c] == null) row[c] = ''
    rows.push(row)
  }
  while (rows.length && !rows[rows.length - 1].some((x) => String(x || '').trim())) rows.pop()
  return { rows }
}

function attr(tag: string, name: string): string {
  const m = new RegExp(name + '="([^"]*)"', 'i').exec(tag)
  return m ? unescapeXml(m[1]) : ''
}

export function firstSheetTarget(workbookXml: string, relsXml: string): { name: string; path: string } | { error: string } {
  const sheet = /<sheet\b[^>]*>/.exec(workbookXml)
  if (!sheet) return { error: '表格里没有工作表' }
  const name = attr(sheet[0], 'name') || 'Sheet1'
  const rid = attr(sheet[0], 'r:id') || attr(sheet[0], 'id')
  const rels = relsXml.match(/<Relationship\b[^>]*>/g) || []
  let target = ''
  for (const rel of rels) {
    if (attr(rel, 'Id') === rid) target = attr(rel, 'Target')
  }
  if (!target) return { error: '找不到第一张表' }
  if (/^https?:/i.test(target) || target.indexOf('..') >= 0) return { error: '不能导入带外部链接的表格' }
  const path = target.replace(/^\/+/, '')
  const full = path.indexOf('xl/') === 0 ? path : `xl/${path.replace(/^\//, '')}`
  return { name, path: full }
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') {
      quoted = true
      continue
    }
    if (c === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += c
  }
  if (cell.length || row.length) {
    row.push(cell)
    if (row.some((x) => x.trim())) rows.push(row)
  }
  return rows
}

export function csvText(rows: string[][]): string {
  const lines = rows.map((row) =>
    row
      .map((cell) => {
        const v = String(cell ?? '')
        if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
        return v
      })
      .join(','),
  )
  return `\uFEFF${lines.join('\r\n')}`
}

function xmlEscape(s: string): string {
  return String(s || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sharedTable(rows: string[][]): { list: string[]; at: Map<string, number> } {
  const at = new Map<string, number>()
  const list: string[] = []
  for (const row of rows) {
    for (const cell of row) {
      const value = String(cell ?? '')
      if (at.has(value)) continue
      at.set(value, list.length)
      list.push(value)
    }
  }
  return { list, at }
}

function colName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function worksheetXml(rows: string[][]): string {
  const { at } = sharedTable(rows)
  let cols = 1
  const body = rows
    .map((row, r) => {
      if (row.length > cols) cols = row.length
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`
          const id = at.get(String(value ?? '')) ?? 0
          return `<c r="${ref}" t="s"><v>${id}</v></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const end = rows.length ? `${colName(Math.max(0, cols - 1))}${rows.length}` : 'A1'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${end}"/>` +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

function sharedStringsXml(rows: string[][]): string {
  const { list } = sharedTable(rows)
  const count = rows.reduce((n, row) => n + row.length, 0)
  const body = list.map((value) => `<si><t xml:space="preserve">${xmlEscape(value)}</t></si>`).join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${list.length}">${body}</sst>`
  )
}

function crc32(data: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return ~c >>> 0
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = utf8Bytes(file.name)
    const sum = crc32(file.data)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint32(14, sum, true)
    view.setUint32(18, file.data.length, true)
    view.setUint32(22, file.data.length, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    parts.push(local, file.data)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, sum, true)
    cv.setUint32(20, file.data.length, true)
    cv.setUint32(24, file.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    central.push(cen)
    offset += local.length + file.data.length
  }
  const cdSize = central.reduce((n, x) => n + x.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const total = offset + cdSize + eocd.length
  const out = new Uint8Array(total)
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  for (const part of central) {
    out.set(part, p)
    p += part.length
  }
  out.set(eocd, p)
  return out
}

export function buildXlsx(rows: string[][]): Uint8Array {
  const sheet = utf8Bytes(worksheetXml(rows))
  const strings = utf8Bytes(sharedStringsXml(rows))
  const workbook = utf8Bytes(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="商品" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  const rels = utf8Bytes(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>',
  )
  const rootRels = utf8Bytes(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  const types = utf8Bytes(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
  )
  return zipStore([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: strings },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ])
}

export function entryText(entry: ZipEntry): string | null {
  if (!entry.data) return null
  return utf8(entry.data)
}
