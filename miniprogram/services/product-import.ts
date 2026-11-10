/**
 * 商品导入导出的纯规则。不读文件、不写云端。
 * 货号按去空格后的原文比较，区分大小写。
 */
import type { Product } from './team'
import {
  displayStock,
  isSkuProduct,
  rebuildSkuMatrix,
  type ProductSkuCell,
} from './product-sku'

export type ImportField =
  | 'code'
  | 'name'
  | 'unit'
  | 'price'
  | 'stock'
  | 'category'
  | 'color'
  | 'size'
  | 'skuStock'
  | 'skuBarcode'

export type ImportMode = 'fill' | 'overwrite'

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  code: '货号',
  name: '品名',
  unit: '单位',
  price: '单价',
  stock: '库存',
  category: '分类',
  color: '颜色',
  size: '尺码',
  skuStock: 'SKU库存',
  skuBarcode: 'SKU条码',
}

const FIELD_ORDER: ImportField[] = [
  'code',
  'name',
  'unit',
  'price',
  'stock',
  'category',
  'color',
  'size',
  'skuStock',
  'skuBarcode',
]

const ALIAS: Record<string, ImportField> = {
  货号: 'code',
  款号: 'code',
  编码: 'code',
  商品编码: 'code',
  商品货号: 'code',
  code: 'code',
  品名: 'name',
  名称: 'name',
  商品名称: 'name',
  name: 'name',
  单位: 'unit',
  unit: 'unit',
  单价: 'price',
  批价: 'price',
  价格: 'price',
  售价: 'price',
  price: 'price',
  库存: 'stock',
  商品库存: 'stock',
  stock: 'stock',
  分类: 'category',
  类别: 'category',
  category: 'category',
  颜色: 'color',
  色: 'color',
  color: 'color',
  尺码: 'size',
  尺: 'size',
  size: 'size',
  sku库存: 'skuStock',
  规格库存: 'skuStock',
  skustock: 'skuStock',
  sku条码: 'skuBarcode',
  规格条码: 'skuBarcode',
  skubarcode: 'skuBarcode',
}

export const EXPORT_HEADERS = [
  '货号',
  '品名',
  '单位',
  '单价',
  '库存',
  '分类',
  '颜色',
  '尺码',
  'SKU库存',
  'SKU条码',
]

const TEXT_MAX = 64
const MAX_AXIS = 16
const MAX_DATA_ROWS = 5000

export type ColumnView = {
  index: number
  header: string
  samples: string[]
  field: ImportField | ''
}

export type SkipItem = { code: string; rows: number; reason: string }

export type ImportPlan = {
  addCount: number
  updateCount: number
  skips: SkipItem[]
  createCategories: string[]
  notes: string[]
  products: Product[]
}

type CellBag = Partial<Record<ImportField, string>>

function normHeader(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[*＊:：]/g, '')
}

export function guessField(header: string): ImportField | '' {
  return ALIAS[normHeader(header)] || ''
}

export function fieldChoices(staff: boolean): Array<{ id: ImportField | ''; label: string }> {
  const list: Array<{ id: ImportField | ''; label: string }> = [{ id: '', label: '不导入' }]
  for (const id of FIELD_ORDER) {
    if (staff && (id === 'price' || id === 'category')) continue
    list.push({ id, label: IMPORT_FIELD_LABEL[id] })
  }
  return list
}

export function looksLikeHeader(row: string[]): boolean {
  return (row || []).some((cell) => !!guessField(cell))
}

/** 同一字段被两列选中时，后面的选择生效。 */
export function normalizeMapping(mapping: Array<ImportField | ''>): Array<ImportField | ''> {
  const last = new Map<ImportField, number>()
  mapping.forEach((field, index) => {
    if (field) last.set(field, index)
  })
  return mapping.map((field, index) => (field && last.get(field) === index ? field : ''))
}

export function columnViews(
  rows: string[][],
  headerIndex: number,
  mapping: Array<ImportField | ''>,
): ColumnView[] {
  const header = rows[headerIndex] || []
  const width = Math.max(header.length, mapping.length)
  const views: ColumnView[] = []
  for (let i = 0; i < width; i++) {
    const name = String(header[i] || '').trim() || `第${i + 1}列`
    const samples: string[] = []
    for (let r = headerIndex + 1; r < rows.length && samples.length < 3; r++) {
      const v = String((rows[r] || [])[i] || '').trim()
      if (v) samples.push(v)
    }
    views.push({ index: i, header: name, samples, field: mapping[i] || '' })
  }
  return views
}

export function autoMapping(header: string[]): Array<ImportField | ''> {
  return normalizeMapping(header.map((cell) => guessField(cell)))
}

function trimCell(v: unknown): string {
  return String(v ?? '').trim()
}

function badScience(raw: string): boolean {
  return /e[+-]/i.test(raw)
}

function parsePrice(raw: string): number | null | 'bad' {
  const s = raw.trim()
  if (!s) return null
  if (badScience(s)) return 'bad'
  const t = s.replace(/[¥￥元,\s，]/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return 'bad'
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return 'bad'
  return n
}

function parseStock(raw: string): number | null | 'bad' {
  const s = raw.trim()
  if (!s) return null
  if (!/^\d+$/.test(s)) return 'bad'
  const n = Number(s)
  if (!Number.isInteger(n) || n < 0) return 'bad'
  return n
}

function tooLong(raw: string): boolean {
  return raw.trim().length > TEXT_MAX
}

function rowBag(row: string[], mapping: Array<ImportField | ''>): CellBag {
  const bag: CellBag = {}
  for (let i = 0; i < mapping.length; i++) {
    const field = mapping[i]
    if (!field) continue
    bag[field] = trimCell(row[i])
  }
  return bag
}

function bagEmpty(bag: CellBag): boolean {
  return Object.keys(bag).every((k) => !trimCell(bag[k as ImportField]))
}

function dataRows(rows: string[][], headerIndex: number, mapping: Array<ImportField | ''>): CellBag[] {
  const out: CellBag[] = []
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const bag = rowBag(rows[r] || [], mapping)
    if (bagEmpty(bag)) continue
    out.push(bag)
  }
  return out
}

function sameSku(a: Product, b: Product): boolean {
  if (!!isSkuProduct(a) !== !!isSkuProduct(b)) return false
  if (!isSkuProduct(a)) return true
  if ((a.colors || []).join('\0') !== (b.colors || []).join('\0')) return false
  if ((a.sizes || []).join('\0') !== (b.sizes || []).join('\0')) return false
  const left = rebuildSkuMatrix(a.colors || [], a.sizes || [], a.skus || [])
  const right = rebuildSkuMatrix(b.colors || [], b.sizes || [], b.skus || [])
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i].stock !== right[i].stock) return false
    if (trimCell(left[i].barcode) !== trimCell(right[i].barcode)) return false
  }
  return true
}

function changed(prev: Product, next: Product, staff: boolean): boolean {
  if (staff) {
    const stockDiff = (prev.stock == null ? null : Number(prev.stock)) !== (next.stock == null ? null : Number(next.stock))
    return stockDiff || !sameSku(prev, next)
  }
  if (trimCell(prev.name) !== trimCell(next.name)) return true
  if (trimCell(prev.unit) !== trimCell(next.unit)) return true
  if (Number(prev.price || 0) !== Number(next.price || 0)) return true
  if (trimCell(prev.category) !== trimCell(next.category)) return true
  const ps = prev.stock == null ? null : Number(prev.stock)
  const ns = next.stock == null ? null : Number(next.stock)
  if (ps !== ns) return true
  return !sameSku(prev, next)
}

function applyText(
  prev: string,
  incoming: string,
  mode: ImportMode,
  mapped: boolean,
): string {
  if (!mapped) return prev
  if (!incoming) return prev
  if (mode === 'overwrite') return incoming
  return prev ? prev : incoming
}

function applyStock(
  prev: number | null | undefined,
  incoming: number | null,
  mode: ImportMode,
  mapped: boolean,
): number | null {
  if (!mapped || incoming == null) return prev == null ? null : Number(prev)
  if (mode === 'fill' && prev != null) return Number(prev)
  return incoming
}

function cellOf(skus: ProductSkuCell[], color: string, size: string): ProductSkuCell | undefined {
  return skus.find((x) => x.color === color && x.size === size)
}

type SkuLine = { color: string; size: string; stock: number | null; barcode: string }

function mergeSku(
  prev: Product | undefined,
  lines: SkuLine[],
  pool: number | null,
  poolMapped: boolean,
  mode: ImportMode,
  mapStock: boolean,
  mapBarcode: boolean,
): { product: Pick<Product, 'hasSku' | 'colors' | 'sizes' | 'skus' | 'stock'> } | { error: string } {
  const colors: string[] = []
  const sizes: string[] = []
  const pushUnique = (list: string[], value: string) => {
    if (value && list.indexOf(value) < 0) list.push(value)
  }
  if (prev && isSkuProduct(prev)) {
    for (const c of prev.colors || []) pushUnique(colors, trimCell(c))
    for (const s of prev.sizes || []) pushUnique(sizes, trimCell(s))
  }
  for (const line of lines) {
    pushUnique(colors, line.color)
    pushUnique(sizes, line.size)
  }
  if (colors.length > MAX_AXIS || sizes.length > MAX_AXIS) {
    return { error: '颜色或尺码超过 16 个' }
  }
  const prevCells = prev && isSkuProduct(prev) ? prev.skus || [] : []
  const skus: ProductSkuCell[] = []
  for (const color of colors) {
    for (const size of sizes) {
      const old = cellOf(prevCells, color, size)
      const hit = lines.find((x) => x.color === color && x.size === size)
      let stock = old && old.stock != null && Number.isFinite(Number(old.stock)) ? Number(old.stock) : null
      let barcode = trimCell(old?.barcode)
      if (hit) {
        if (mapStock) stock = applyStock(stock, hit.stock, mode, true)
        if (mapBarcode && hit.barcode) {
          barcode = mode === 'overwrite' || !barcode ? hit.barcode : barcode
        }
      }
      skus.push({ color, size, stock, barcode: barcode || null })
    }
  }
  const draft: Product = {
    code: '',
    name: '',
    price: 0,
    hasSku: true,
    colors,
    sizes,
    skus,
    stock: null,
  }
  const anyCell = skus.some((x) => x.stock != null)
  if (anyCell) {
    draft.stock = displayStock(draft)
  } else if (poolMapped) {
    const prevPool = prev && prev.stock != null ? Number(prev.stock) : null
    draft.stock = applyStock(prevPool, pool, mode, true)
  } else if (prev && prev.stock != null) {
    draft.stock = Number(prev.stock)
  } else {
    draft.stock = null
  }
  return { product: draft }
}

function baseProduct(code: string): Product {
  return {
    code,
    name: code,
    unit: '件',
    price: 0,
    stock: null,
    category: '',
    spec: '',
    barcode: '',
    cost: null,
    countInStats: true,
    hasSku: false,
    colors: [],
    sizes: [],
    skus: [],
    imageUrls: [],
    remark: '',
  }
}

export function buildImportPlan(opts: {
  rows: string[][]
  headerIndex: number
  mapping: Array<ImportField | ''>
  existing: Product[]
  categories: string[]
  mode: ImportMode
  staff: boolean
}): { error?: string; plan?: ImportPlan } {
  const mapping = normalizeMapping(opts.mapping || [])
  if (!mapping.includes('code')) return { error: '请先把一列对应到货号' }
  const colorOn = mapping.includes('color')
  const sizeOn = mapping.includes('size')
  if (colorOn !== sizeOn) return { error: '颜色和尺码要一起对应，或两列都选不导入' }
  if (opts.headerIndex < 0 || opts.headerIndex >= (opts.rows || []).length) {
    return { error: '请选择表头所在的行' }
  }
  const bags = dataRows(opts.rows, opts.headerIndex, mapping)
  if (!bags.length) return { error: '表头下面没有数据' }
  if (bags.length > MAX_DATA_ROWS) return { error: '数据超过 5000 行，请拆开后再导入' }

  const byCode = new Map<string, CellBag[]>()
  const order: string[] = []
  const skips: SkipItem[] = []
  for (const bag of bags) {
    const code = trimCell(bag.code)
    if (!code) {
      skips.push({ code: '(空货号)', rows: 1, reason: '货号是空的' })
      continue
    }
    if (badScience(code)) {
      skips.push({ code, rows: 1, reason: '货号被写成科学计数，无法还原' })
      continue
    }
    if (tooLong(code)) {
      skips.push({ code: code.slice(0, 32), rows: 1, reason: '货号超过 64 个字' })
      continue
    }
    if (!byCode.has(code)) {
      byCode.set(code, [])
      order.push(code)
    }
    byCode.get(code)!.push(bag)
  }

  const existing = new Map<string, Product>()
  for (const p of opts.existing || []) {
    const code = trimCell(p.code)
    if (code && !existing.has(code)) existing.set(code, p)
  }
  const knownCats = new Set((opts.categories || []).map((x) => trimCell(x)).filter(Boolean))
  const createCategories: string[] = []
  const notes: string[] = []
  const products: Product[] = []
  let addCount = 0
  let updateCount = 0
  const mapped = new Set(mapping.filter(Boolean) as ImportField[])

  const skipCode = (code: string, rows: number, reason: string) => {
    skips.push({ code, rows, reason })
  }

  for (const code of order) {
    const group = byCode.get(code) || []
    if (!colorOn) {
      if (group.length > 1) {
        skipCode(code, group.length, '货号重复，已跳过')
        continue
      }
    }
    const built = buildOne({
      code,
      group,
      colorOn,
      prev: existing.get(code),
      mode: opts.mode,
      staff: opts.staff,
      mapped,
    })
    if ('error' in built) {
      skipCode(code, group.length, built.error)
      continue
    }
    if (built.note) notes.push(`${code}：${built.note}`)
    const prev = existing.get(code)
    if (prev && !changed(prev, built.product, opts.staff)) {
      skipCode(code, group.length, built.note || '没有需要写入的新内容')
      continue
    }
    const cat = trimCell(built.product.category)
    if (!opts.staff && cat && !knownCats.has(cat)) {
      knownCats.add(cat)
      createCategories.push(cat)
    }
    const priceCell = group.some((bag) => trimCell(bag.price))
    if (!prev && !priceCell) notes.push(`${code}：新商品没有单价，按 0 写入`)
    products.push(built.product)
    if (prev) updateCount += 1
    else addCount += 1
  }

  return {
    plan: { addCount, updateCount, skips, createCategories, notes, products },
  }
}

function buildOne(args: {
  code: string
  group: CellBag[]
  colorOn: boolean
  prev?: Product
  mode: ImportMode
  staff: boolean
  mapped: Set<ImportField>
}): { product: Product; note?: string } | { error: string } {
  const { code, group, prev, mode, staff, mapped } = args
  for (const bag of group) {
    for (const key of ['name', 'unit', 'category', 'color', 'size'] as ImportField[]) {
      if (tooLong(bag[key] || '')) return { error: `${IMPORT_FIELD_LABEL[key]}超过 64 个字` }
    }
    if (tooLong(bag.skuBarcode || '')) return { error: 'SKU条码超过 64 个字' }
  }

  const first = (field: ImportField): string => {
    for (const bag of group) {
      const v = trimCell(bag[field])
      if (v) return v
    }
    return ''
  }

  let note = ''
  let lines: SkuLine[] = []
  let skuOn = args.colorOn
  if (args.colorOn) {
    const filled: SkuLine[] = []
    const bare: CellBag[] = []
    let dropped = 0
    const seen = new Set<string>()
    for (const bag of group) {
      const color = trimCell(bag.color)
      const size = trimCell(bag.size)
      if (!color && !size) {
        bare.push(bag)
        continue
      }
      if (!color || !size) {
        dropped += 1
        continue
      }
      const key = `${color}\0${size}`
      if (seen.has(key)) return { error: '同一货号的颜色尺码重复，已跳过' }
      seen.add(key)
      const stock = parseStock(bag.skuStock || '')
      if (stock === 'bad') return { error: 'SKU库存不是整数' }
      let barcode = trimCell(bag.skuBarcode)
      if (badScience(barcode)) {
        barcode = ''
        note = '有条码被写成科学计数，这一格没有写入条码'
      }
      filled.push({ color, size, stock, barcode })
    }
    if (filled.length && bare.length) return { error: '同一货号不能混着有颜色尺码和没有颜色尺码' }
    if (!filled.length && bare.length > 1) return { error: '货号重复，已跳过' }
    if (!filled.length) skuOn = false
    else lines = filled
    if (dropped && filled.length) note = '有的行只填了颜色或尺码，这些行已跳过'
    if (!filled.length && dropped) return { error: '颜色和尺码要同时填写' }
  }

  if (prev && isSkuProduct(prev) && !skuOn) {
    if (mapped.has('stock')) note = note || '这件货已有颜色尺码，本次不改总库存'
  }

  const priceRaw = first('price')
  const priceParsed = parsePrice(priceRaw)
  if (priceParsed === 'bad') return { error: '单价不是数字' }
  const stockRaw = first('stock')
  const stockParsed = parseStock(stockRaw)
  if (stockParsed === 'bad') return { error: '库存不是整数' }

  const seed = prev ? { ...prev, colors: [...(prev.colors || [])], sizes: [...(prev.sizes || [])], skus: [...(prev.skus || [])] } : baseProduct(code)
  const next: Product = { ...seed, code }

  if (!staff) {
    const nameIn = first('name')
    next.name = applyText(trimCell(prev?.name), nameIn, mode, mapped.has('name')) || (prev ? trimCell(prev.name) : code)
    if (!trimCell(next.name)) next.name = code
    const unitIn = first('unit')
    const unit = applyText(trimCell(prev?.unit), unitIn, mode, mapped.has('unit'))
    next.unit = unit || (prev ? trimCell(prev.unit) : '') || '件'
    if (mapped.has('price') && priceParsed != null) {
      if (mode === 'overwrite' || prev == null || prev.price == null) next.price = priceParsed
    } else if (!prev) {
      next.price = 0
    }
    const catIn = first('category')
    next.category = applyText(trimCell(prev?.category), catIn, mode, mapped.has('category'))
  } else if (!prev) {
    next.name = first('name') || code
    next.unit = first('unit') || '件'
    next.price = 0
    next.category = ''
    next.cost = null
  } else {
    next.name = prev.name
    next.unit = prev.unit
    next.price = prev.price
    next.category = prev.category
    next.cost = prev.cost
  }

  if (skuOn) {
    const anyLineStock = lines.some((x) => x.stock != null)
    const merged = mergeSku(
      prev,
      lines,
      anyLineStock ? null : stockParsed,
      mapped.has('stock') && !anyLineStock,
      mode,
      mapped.has('skuStock'),
      mapped.has('skuBarcode'),
    )
    if ('error' in merged) return merged
    next.hasSku = true
    next.colors = merged.product.colors
    next.sizes = merged.product.sizes
    next.skus = merged.product.skus
    next.stock = merged.product.stock
  } else if (prev && isSkuProduct(prev)) {
    next.hasSku = true
    next.colors = prev.colors
    next.sizes = prev.sizes
    next.skus = prev.skus
    next.stock = prev.stock
  } else if (!staff || !prev) {
    next.hasSku = false
    next.colors = []
    next.sizes = []
    next.skus = []
    next.stock = applyStock(prev?.stock, stockParsed, mode, mapped.has('stock') || !prev)
    if (!mapped.has('stock') && prev) next.stock = prev.stock
    if (!prev && !mapped.has('stock')) next.stock = null
  } else if (mapped.has('stock')) {
    next.stock = applyStock(prev.stock, stockParsed, mode, true)
  }

  if (prev) {
    next.barcode = prev.barcode
    next.cost = prev.cost
    next.countInStats = prev.countInStats
    next.imageUrls = prev.imageUrls
    next.videoUrl = prev.videoUrl
    next.isNewArrival = prev.isNewArrival
    next.suggestedRetailPrice = prev.suggestedRetailPrice
    next.spec = prev.spec
    next.remark = prev.remark
  }
  return { product: next, note: note || undefined }
}

function numText(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = String(n)
  if (!/e/i.test(s)) return s
  return n.toFixed(10).replace(/\.?0+$/, '')
}

function guardFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

function exportStock(v: number | null | undefined): string {
  if (v == null) return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return String(Math.trunc(n))
}

export function exportTable(products: Product[]): string[][] {
  const body: string[][] = []
  for (const raw of products || []) {
    const code = trimCell(raw.code)
    if (!code) continue
    const name = trimCell(raw.name) || code
    const unit = trimCell(raw.unit)
    const price = numText(Number(raw.price || 0))
    const category = trimCell(raw.category)
    if (!isSkuProduct(raw)) {
      body.push([code, name, unit, price, exportStock(raw.stock), category, '', '', '', ''].map(guardFormula))
      continue
    }
    const cells = rebuildSkuMatrix(raw.colors || [], raw.sizes || [], raw.skus || [])
    const any = cells.some((x) => x.stock != null)
    const pool = any ? '' : exportStock(raw.stock)
    for (const cell of cells) {
      body.push(
        [
          code,
          name,
          unit,
          price,
          pool,
          category,
          cell.color,
          cell.size,
          any ? exportStock(cell.stock) : '',
          trimCell(cell.barcode),
        ].map(guardFormula),
      )
    }
  }
  return body
}

/** 按商品切开，每个文件最多 5000 行数据，同一货号的规格行留在同一个文件。 */
export function splitExport(body: string[][]): string[][][] {
  const groups: string[][][] = []
  let cur: string[][] = []
  for (const row of body) {
    const code = row[0]
    if (!cur.length || cur[0][0] !== code) {
      if (cur.length) groups.push(cur)
      cur = [row]
    } else cur.push(row)
  }
  if (cur.length) groups.push(cur)
  const files: string[][][] = []
  let file: string[][] = []
  for (const group of groups) {
    if (file.length && file.length + group.length > MAX_DATA_ROWS) {
      files.push(file)
      file = []
    }
    file.push(...group)
  }
  if (file.length) files.push(file)
  return files
}
