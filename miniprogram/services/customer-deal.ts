/**
 * 客户历史价（每个客户、每个货号一条）。
 * 开单保存后覆盖；商家改过的价优先于旧单；删掉的货号不再从旧单里带出来。
 * 只存本机，不另建云端表。本人记忆价仍走 user-prices。
 */
const KEY = 'tuk_customer_deal_v1'

export type DealCell = {
  code: string
  price: number
  deleted: boolean
}

type Book = Record<string, Record<string, DealCell>>

export type DealOrder = {
  isReturn?: boolean
  customerName?: string | null
  createdAt?: string | null
  id?: number
  items?: Array<{ productCode?: string; price?: number }>
}

export type DealRow = {
  code: string
  price: number
  listPrice: number | null
}

function codeKey(code: string): string {
  return String(code || '').trim().toLowerCase()
}

function readBook(): Book {
  try {
    const raw = wx.getStorageSync(KEY) as Book
    if (raw && typeof raw === 'object') return raw
  } catch (_) {
    /* ignore */
  }
  return {}
}

function writeBook(book: Book) {
  try {
    wx.setStorageSync(KEY, book)
  } catch (_) {
    /* ignore */
  }
}

export function peekDealCell(customerName: string, productCode: string): DealCell | null {
  const name = String(customerName || '').trim()
  const key = codeKey(productCode)
  if (!name || !key) return null
  const cell = readBook()[name]?.[key]
  if (!cell || typeof cell !== 'object') return null
  const code = String(cell.code || productCode).trim()
  const price = Number(cell.price)
  return {
    code: code || String(productCode).trim(),
    price: Number.isFinite(price) ? price : 0,
    deleted: !!cell.deleted,
  }
}

export function setDealPrice(customerName: string, productCode: string, price: number) {
  const name = String(customerName || '').trim()
  const code = String(productCode || '').trim()
  const key = codeKey(code)
  if (!name || !key || !(price > 0)) return
  const book = readBook()
  const row = book[name] || {}
  row[key] = { code, price, deleted: false }
  book[name] = row
  writeBook(book)
}

export function deleteDeal(customerName: string, productCode: string) {
  const name = String(customerName || '').trim()
  const code = String(productCode || '').trim()
  const key = codeKey(code)
  if (!name || !key) return
  const book = readBook()
  const row = book[name] || {}
  const prev = row[key]
  row[key] = {
    code: String(prev?.code || code).trim() || code,
    price: Number(prev?.price) || 0,
    deleted: true,
  }
  book[name] = row
  writeBook(book)
}

/** 非退单保存后，用这一单的单价覆盖该客户这些货号的历史价。 */
export function applyOrderDealPrices(
  customerName: string,
  items: Array<{ productCode?: string; price?: number }>,
) {
  const name = String(customerName || '').trim()
  if (!name || !items || !items.length) return
  const book = readBook()
  const row = book[name] || {}
  let changed = false
  for (const it of items) {
    const code = String(it.productCode || '').trim()
    const key = codeKey(code)
    const price = Number(it.price)
    if (!key || !(price > 0)) continue
    row[key] = { code, price, deleted: false }
    changed = true
  }
  if (!changed) return
  book[name] = row
  writeBook(book)
}

function sameMoney(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100)
}

function orderTime(o: DealOrder): number {
  const t = Date.parse(String(o.createdAt || ''))
  return Number.isFinite(t) ? t : 0
}

/** 该客户开过的货号。改过的价优先；已删除的不出现。原价另由商品库标价填。 */
export function listCustomerDeals(
  customerName: string,
  orders: DealOrder[],
  catalog: Array<{ code: string; price: number }>,
): DealRow[] {
  const name = String(customerName || '').trim()
  if (!name) return []
  const book = readBook()[name] || {}
  const latest = new Map<string, { code: string; price: number; t: number; id: number }>()
  for (const o of orders || []) {
    if (o.isReturn) continue
    if (String(o.customerName || '').trim() !== name) continue
    const t = orderTime(o)
    const id = Number(o.id) || 0
    for (const it of o.items || []) {
      const code = String(it.productCode || '').trim()
      const key = codeKey(code)
      const price = Number(it.price)
      if (!key || !(price > 0)) continue
      const prev = latest.get(key)
      if (!prev || t > prev.t || (t === prev.t && id > prev.id)) {
        latest.set(key, { code, price, t, id })
      }
    }
  }
  const listPrice = new Map<string, number>()
  for (const p of catalog || []) {
    const key = codeKey(p.code)
    if (!key || listPrice.has(key)) continue
    const price = Number(p.price)
    if (Number.isFinite(price)) listPrice.set(key, price)
  }
  const keys = new Set<string>([...latest.keys(), ...Object.keys(book)])
  const rows: DealRow[] = []
  for (const key of keys) {
    const cell = book[key]
    if (cell && cell.deleted) continue
    const order = latest.get(key)
    const code = String((cell && cell.code) || order?.code || '').trim()
    if (!code) continue
    const overridden = cell && !cell.deleted && Number(cell.price) > 0
    const price = overridden ? Number(cell.price) : order?.price
    if (!(Number(price) > 0)) continue
    const shelf = listPrice.has(key) ? listPrice.get(key)! : null
    if (shelf != null && sameMoney(Number(price), shelf)) continue
    rows.push({ code, price: Number(price), listPrice: shelf })
  }
  rows.sort((a, b) => a.code.toLowerCase().localeCompare(b.code.toLowerCase()))
  return rows
}
