/**
 * 把已经读好的表写成商品。云端只走 catalog/patch，不上传文件，不删除货号。
 */
import { msgSecCheck } from './sec-check'
import { dehydrateProduct } from './product-sku'
import {
  fetchCategories,
  forgetUnsyncedCatalog,
  isOwner,
  peekCachedCategories,
  pushCatalogPatch,
  rememberUnsyncedCatalog,
  uploadCategories,
  writeCatalogProducts,
  type Category,
  type Product,
} from './team'
import { isCloudSyncAllowed } from './subscription'
import { isGuest, isLoggedIn } from './session'
import {
  EXPORT_HEADERS,
  exportTable,
  splitExport,
  type ImportMode,
  type ImportPlan,
  type SkipItem,
} from './product-import'

const BODY_LIMIT = 7_000_000
let busy = false

export function importBusy(): boolean {
  return busy
}

export function setImportBusy(on: boolean) {
  busy = on
}

function cloudOn(): boolean {
  return !isGuest() && isLoggedIn() && isCloudSyncAllowed()
}

function trim(v: unknown): string {
  return String(v ?? '').trim()
}

async function checkTexts(values: string[]): Promise<{ blocked: Set<string>; stopped: string }> {
  const uniq = Array.from(new Set(values.map(trim).filter(Boolean)))
  const blocked = new Set<string>()
  const chunks: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const text of uniq) {
    if (cur.length && size + text.length + 1 > 2000) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(text)
    size += text.length + 1
  }
  if (cur.length) chunks.push(cur)
  for (const chunk of chunks) {
    const hit = await classify(chunk)
    if (hit === 'limited') return { blocked, stopped: '安全检测过于频繁，请稍后再导入。这次没有写入。' }
    if (hit === 'blocked') {
      const bad = await isolate(chunk)
      if (bad === 'limited') return { blocked, stopped: '安全检测过于频繁，请稍后再导入。这次没有写入。' }
      for (const text of bad) blocked.add(text)
    }
  }
  return { blocked, stopped: '' }
}

async function classify(parts: string[]): Promise<'ok' | 'blocked' | 'limited'> {
  const r = await msgSecCheck(parts.join('\n'), 1)
  if (r.ok) return 'ok'
  if (/频繁|限流|RATE_LIMIT|45009/.test(r.error || '')) return 'limited'
  return 'blocked'
}

async function isolate(parts: string[]): Promise<string[] | 'limited'> {
  if (parts.length <= 1) return parts
  const mid = Math.ceil(parts.length / 2)
  const left = await classify(parts.slice(0, mid))
  if (left === 'limited') return 'limited'
  const right = await classify(parts.slice(mid))
  if (right === 'limited') return 'limited'
  const bad: string[] = []
  if (left === 'blocked') {
    const more = await isolate(parts.slice(0, mid))
    if (more === 'limited') return 'limited'
    bad.push(...more)
  }
  if (right === 'blocked') {
    const more = await isolate(parts.slice(mid))
    if (more === 'limited') return 'limited'
    bad.push(...more)
  }
  return bad
}

function productTexts(p: Product): string[] {
  const out = [p.code, p.name, p.unit, ...(p.colors || []), ...(p.sizes || [])]
  for (const cell of p.skus || []) if (cell.barcode) out.push(String(cell.barcode))
  return out.map(trim).filter(Boolean)
}

function batchOf(products: Product[]): { batches: Product[][]; tooBig: string[] } {
  const batches: Product[][] = []
  const tooBig: string[] = []
  let cur: Product[] = []
  let size = 80
  const flush = () => {
    if (!cur.length) return
    batches.push(cur)
    cur = []
    size = 80
  }
  for (const product of products) {
    const bytes = JSON.stringify(dehydrateProduct(product)).length
    if (bytes > BODY_LIMIT) {
      tooBig.push(product.code)
      continue
    }
    if (cur.length >= 500 || (cur.length && size + bytes > BODY_LIMIT)) flush()
    cur.push(product)
    size += bytes + 1
  }
  flush()
  return { batches, tooBig }
}

export type CommitResult = {
  written: number
  cloudMiss: string[]
  skipped: SkipItem[]
  categoryNote: string
  stopped: string
  synced: boolean
}

export async function commitImport(plan: ImportPlan, staff: boolean): Promise<CommitResult> {
  const skipped: SkipItem[] = plan.skips.slice()
  let products = plan.products.slice()
  const categoryNote: string[] = []
  const texts: string[] = []
  for (const p of products) texts.push(...productTexts(p))
  for (const name of plan.createCategories) texts.push(name)
  const checked = await checkTexts(texts)
  if (checked.stopped) {
    return { written: 0, cloudMiss: [], skipped, categoryNote: '', stopped: checked.stopped, synced: false }
  }
  if (checked.blocked.size) {
    const blockedCat = new Set(plan.createCategories.filter((name) => checked.blocked.has(name)))
    products = products.filter((p) => {
      const fields = productTexts(p).filter((text) => text !== trim(p.category))
      const bad = fields.find((text) => checked.blocked.has(text))
      if (bad) {
        skipped.push({ code: p.code, rows: 1, reason: '内容未通过安全检测' })
        return false
      }
      return true
    })
    if (blockedCat.size) {
      products = products.map((p) => (blockedCat.has(trim(p.category)) ? { ...p, category: '' } : p))
      categoryNote.push(`这些分类未通过安全检测，没有创建：${Array.from(blockedCat).join('、')}`)
    }
  }
  const createCategories = plan.createCategories.filter((name) => !checked.blocked.has(name) && products.some((p) => trim(p.category) === name))
  if (!products.length) {
    return { written: 0, cloudMiss: [], skipped, categoryNote: categoryNote.join('\n'), stopped: '', synced: false }
  }
  if (!staff && createCategories.length && cloudOn()) {
    const fetched = await fetchCategories()
    if (!fetched.ok || fetched.fromCache) categoryNote.push('分类名单没有同步到云端，商品仍会写入')
    else {
      const prev = fetched.categories || []
      const names = new Set(prev.map((c) => trim(c.name)))
      const next: Category[] = prev.slice()
      for (const name of createCategories) {
        if (names.has(name)) continue
        names.add(name)
        next.push({ name, sortOrder: next.length })
      }
      const up = await uploadCategories(next)
      if (!up.ok) categoryNote.push('分类名单没有同步到云端，商品仍会写入')
    }
  } else if (!staff && createCategories.length) {
    const prev = peekCachedCategories()
    const names = new Set(prev.map((c) => trim(c.name)))
    const next = prev.slice()
    for (const name of createCategories) {
      if (names.has(name)) continue
      names.add(name)
      next.push({ name, sortOrder: next.length })
    }
    await uploadCategories(next)
  }
  writeCatalogProducts(products)
  if (cloudOn()) rememberUnsyncedCatalog(products)
  const { batches, tooBig } = batchOf(products)
  for (const code of tooBig) skipped.push({ code, rows: 1, reason: '这一件商品太大，没有同步到云端' })
  const cloudMiss: string[] = tooBig.slice()
  if (cloudOn()) {
    let failed = false
    for (const batch of batches) {
      if (failed) {
        cloudMiss.push(...batch.map((p) => p.code))
        continue
      }
      const res = await pushCatalogPatch(batch)
      if (!res.ok) {
        failed = true
        cloudMiss.push(...batch.map((p) => p.code))
      } else {
        forgetUnsyncedCatalog(batch.map((p) => p.code))
      }
    }
  }
  return {
    written: products.length,
    cloudMiss,
    skipped,
    categoryNote: categoryNote.join('\n'),
    stopped: '',
    synced: cloudOn() && cloudMiss.length === 0,
  }
}

export function exportFiles(products: Product[]): string[][][] {
  const body = exportTable(products)
  if (!body.length) return []
  return splitExport(body).map((rows) => [EXPORT_HEADERS, ...rows])
}

export function staffUser(): boolean {
  return isLoggedIn() && !isGuest() && !isOwner()
}

export type { ImportMode, ImportPlan }
