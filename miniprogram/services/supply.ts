import { request, type ApiResult } from './api'
import { mediaCheckAsync, msgSecCheck } from './sec-check'
import { productListThumbUrl } from './team'

function supplyTexts(value: unknown, out: string[], depth: number) {
  if (depth > 6 || out.length > 40) return
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return
    if (/^https?:\/\//i.test(text)) return
    if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text)) return
    out.push(text.length > 2400 ? text.slice(0, 2400) : text)
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return
  if (Array.isArray(value)) {
    value.forEach((item) => supplyTexts(item, out, depth + 1))
    return
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (key === 'uid' || key === 'url' || key === 'token' || key === 'imageBase64') return
      supplyTexts(item, out, depth + 1)
    })
  }
}

function supplyBlocked<T>(message: string): ApiResult<T> {
  return { ok: false, code: 0, message, data: null }
}

/** 供应链用户输入：官方 security.msgSecCheck，scene=1 资料。 */
async function guardSupplyBody<T>(body: unknown): Promise<ApiResult<T> | null> {
  const parts: string[] = []
  supplyTexts(body, parts, 0)
  const text = parts.join('\n').trim()
  if (!text) return null
  wx.showLoading({ title: '安全检测', mask: true })
  try {
    const checked = await msgSecCheck(text, 1)
    if (checked.ok) return null
    return supplyBlocked(checked.error || '内容含违规信息，请修改后再试')
  } finally {
    wx.hideLoading()
  }
}

export interface SupplyBlock {
  key: string
  title: string
  count: number | null
  unit: string
  amount: number | null
  hint: string
  alert: boolean
  hit: boolean
}

export interface SupplyParty {
  id: number
  uid: string
  name: string
  phone: string
  settleMode: string
  remark: string
  disabled: boolean
  roles: string[]
  roleLabels: string[]
  unpaid?: number | null
}

export interface SupplyMaterial {
  id: number
  uid: string
  kind: string
  name: string
  color: string
  spec: string
  unit: string
  refPrice: number
  disabled: boolean
}

export interface SupplyStd {
  cmt: number
  package: number
  buy: number
  label: string
}

export interface SupplyStyle {
  productCode: string
  productName: string
  fabricMaterialId: number | null
  fabricMaterialIds?: number[]
  metersPerPiece: number
  trimMaterialId: number | null
  trimMaterialIds?: number[]
  trimQtyPerPiece: number
  processPrice: number
  packagePrice: number
  buyPrice: number
  avgMaterialCost?: number
  std: SupplyStd
  priceText?: string
  priceAmount?: string
  parts?: Array<{ label: string; amount: string; kind: string }>
  linkSource?: string
  links?: string[]
  memberCodes?: string[]
  coverUrl?: string
  coverFull?: string
}

function archiveAmount(prefer: number | undefined, fallback: number) {
  const n = Number(prefer)
  return n > 0 ? n : fallback
}

export function moneyText(n: number) {
  if (!(n > 0)) return ''
  return n.toFixed(2)
}

export function archiveNumber(item: {
  processPrice?: number
  packagePrice?: number
  buyPrice?: number
  std?: { cmt?: number; package?: number; buy?: number } | null
} | null | undefined) {
  if (!item) return 0
  const process = Number(item.processPrice) || 0
  const pack = Number(item.packagePrice) || 0
  const buy = Number(item.buyPrice) || 0
  const std = item.std
  if (pack > 0 && process <= 0 && buy <= 0) return archiveAmount(std && std.package, pack)
  if (buy > 0 && process <= 0 && pack <= 0) return archiveAmount(std && std.buy, buy)
  return archiveAmount(std && std.cmt, process)
}

function materialIds(raw: number[] | null | undefined, one: number | null | undefined) {
  const many = Array.isArray(raw) ? raw.map((item) => Number(item) || 0).filter((item) => item > 0) : []
  if (many.length) return Array.from(new Set(many))
  const single = Number(one) || 0
  return single > 0 ? [single] : []
}

function priceSum(list: Array<{ id: number; refPrice: number }>, ids: number[]) {
  return ids.reduce((sum, id) => {
    const row = list.find((item) => item.id === id)
    return sum + (row ? Number(row.refPrice) || 0 : 0)
  }, 0)
}

export function filledSupplyPrice(item: Parameters<typeof archiveNumber>[0]) {
  const n = archiveNumber(item)
  return n > 0 ? `理论成本 ¥${moneyText(n)}` : ''
}

export function styleParts(
  item: {
    processPrice?: number
    packagePrice?: number
    buyPrice?: number
    metersPerPiece?: number
    trimQtyPerPiece?: number
    fabricMaterialId?: number | null
    fabricMaterialIds?: number[] | null
    trimMaterialId?: number | null
    trimMaterialIds?: number[] | null
  } | null | undefined,
  fabrics: Array<{ id: number; refPrice: number }>,
  trims: Array<{ id: number; refPrice: number }>,
) {
  if (!item) return [] as Array<{ label: string; amount: string; kind: string }>
  const process = Number(item.processPrice) || 0
  const pack = Number(item.packagePrice) || 0
  const buy = Number(item.buyPrice) || 0
  if (pack > 0 && process <= 0 && buy <= 0) return []
  if (buy > 0 && process <= 0 && pack <= 0) return []
  const fabricAmt = Math.round(((Number(item.metersPerPiece) || 0) * priceSum(fabrics, materialIds(item.fabricMaterialIds, item.fabricMaterialId))) * 100) / 100
  const trimAmt = Math.round(((Number(item.trimQtyPerPiece) || 0) * priceSum(trims, materialIds(item.trimMaterialIds, item.trimMaterialId))) * 100) / 100
  const parts: Array<{ label: string; amount: string; kind: string }> = []
  if (fabricAmt > 0) parts.push({ kind: 'fabric', label: '面料', amount: moneyText(fabricAmt) })
  if (trimAmt > 0) parts.push({ kind: 'trim', label: '辅料', amount: moneyText(trimAmt) })
  if (process > 0) parts.push({ kind: 'process', label: '加工费', amount: moneyText(process) })
  return parts.length >= 2 ? parts : []
}

export function styleCover(url?: string | null) {
  return productListThumbUrl(url, 's') || ''
}

export function styleCoverLarge(url?: string | null) {
  return productListThumbUrl(url, 'g') || ''
}

export function styleMemberCodes(item: { linkSource?: string; links?: string[]; productCode?: string } | null | undefined) {
  if (!item) return [] as string[]
  const self = String(item.productCode || '').trim()
  const source = String(item.linkSource || '').trim()
  const ordered = [source || self, self, ...(item.links || []).map((code) => String(code || '').trim())]
  const out: string[] = []
  for (const code of ordered) {
    if (code && out.indexOf(code) < 0) out.push(code)
  }
  return out
}

export function groupSupplyStyles<T extends { productCode: string; linkSource?: string; links?: string[]; coverUrl?: string; coverFull?: string }>(items: T[]) {
  const buckets = new Map<string, T[]>()
  const order: string[] = []
  for (const item of items) {
    const key = String(item.linkSource || item.productCode || '').trim()
    if (!key) continue
    if (!buckets.has(key)) {
      order.push(key)
      buckets.set(key, [])
    }
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
  }
  return order.map((key) => {
    const members = buckets.get(key) || []
    const head = members.find((item) => !String(item.linkSource || '').trim()) || members[0]
    const seen: string[] = []
    for (const item of members) {
      for (const code of styleMemberCodes(item)) {
        if (seen.indexOf(code) < 0) seen.push(code)
      }
    }
    const anchor = String(head.productCode || key).trim()
    const cover = members.find((item) => item.coverUrl) || head
    return {
      ...head,
      coverUrl: cover.coverUrl,
      coverFull: cover.coverFull,
      memberCodes: [anchor, ...seen.filter((code) => code !== anchor)],
    }
  })
}

function costYuan(value: unknown) {
  return (Number(value) || 0).toFixed(2)
}

export function supplyStyleHasCost(item: { calcAverage?: string; priceAmount?: string } | null | undefined) {
  return !!(item && (item.calcAverage || item.priceAmount))
}

/** 成衣成本列表同一套分组：有平均成本或理论成本才算会显示的一款。 */
export function decorateSupplyCostStyles(
  items: SupplyStyle[],
  averages: Array<{ productCode: string; average?: number | null; count?: number }>,
) {
  const book = new Map(averages.map((row) => [row.productCode, row]))
  return groupSupplyStyles(items.map((item) => {
    const avg = book.get(item.productCode)
    return {
      ...item,
      priceAmount: moneyText(archiveNumber(item)),
      linkText: styleLinkText(item),
      linkSide: styleLinkCodes(item),
      coverUrl: styleCover(item.coverUrl),
      coverFull: styleCoverLarge(item.coverUrl),
      calcAverage: avg && avg.average != null ? costYuan(avg.average) : '',
      calcCount: avg ? avg.count || 0 : 0,
    }
  })).map((item) => {
    if (item.calcAverage) return item
    for (const member of item.memberCodes || []) {
      const avg = book.get(member)
      if (avg && avg.average != null) {
        return { ...item, calcAverage: costYuan(avg.average), calcCount: avg.count || 0 }
      }
    }
    return item
  })
}

export async function countListedSupplyCosts() {
  const [styles, calcs] = await Promise.all([
    fetchSupplyStyles(),
    fetchSupplyCostCalcs(),
  ])
  if (!styles.ok || !calcs.ok) return null
  const items = (styles.data && styles.data.items) || []
  const averages = (calcs.data && calcs.data.averages) || []
  return decorateSupplyCostStyles(items, averages).filter(supplyStyleHasCost).length
}

export function styleLinkCodes(item: { linkSource?: string; links?: string[]; productCode?: string } | null | undefined) {
  if (!item) return ''
  const self = String(item.productCode || '').trim()
  const others = Array.from(new Set(
    [item.linkSource || '', ...(item.links || [])]
      .map((code) => String(code || '').trim())
      .filter((code) => code && code !== self),
  ))
  return others.join('、')
}

export function styleLinkText(item: { linkSource?: string; links?: string[]; productCode?: string } | null | undefined) {
  if (!item) return ''
  const self = item.productCode || ''
  const others = (item.links || []).filter((code) => code && code !== self)
  if (item.linkSource && others.length) return `同货 ${item.linkSource} · 还有 ${others.join('、')}`
  if (item.linkSource) return `同货 ${item.linkSource}`
  if (others.length) return `已关联 ${others.join('、')}`
  return ''
}

export interface SupplyAgent {
  name: string
  unpaid: number | null
  unpaidSales?: number
  unpaidRefund?: number
  sales: number
  refund: number
  orders: number
  returns: number
}

export function newSupplyUid(): string {
  const raw = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  return raw.replace(/[^a-z0-9]/gi, '').slice(0, 32)
}

export function fetchSupplyAccess() {
  return request<{ role: string }>({ path: '/api/v1/team/supply/access' })
}

export function fetchSupplyMap(q?: string) {
  const query = (q || '').trim()
  const path = query
    ? `/api/v1/team/supply/map?q=${encodeURIComponent(query)}`
    : '/api/v1/team/supply/map'
  return request<{ blocks: SupplyBlock[]; query: string }>({ path })
}

export function fetchSupplyParties(role?: string, state?: 'disabled' | 'all') {
  const params: string[] = []
  if (role) params.push(`role=${encodeURIComponent(role)}`)
  if (state) params.push(`state=${state}`)
  const path = '/api/v1/team/supply/parties' + (params.length ? `?${params.join('&')}` : '')
  return request<{ items: SupplyParty[] }>({ path })
}

export async function saveSupplyParty(body: {
  id?: number
  uid?: string
  name: string
  phone: string
  settleMode: string
  remark: string
  roles: string[]
}) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  if (body.id) {
    return request<SupplyParty>({
      path: `/api/v1/team/supply/parties/${body.id}`,
      method: 'PUT',
      data: body,
    })
  }
  return request<SupplyParty>({
    path: '/api/v1/team/supply/parties',
    method: 'POST',
    data: body,
  })
}

export function disableSupplyParty(id: number) {
  return request<{ id: number }>({
    path: `/api/v1/team/supply/parties/${id}/disable`,
    method: 'POST',
    data: {},
  })
}

export function enableSupplyParty(id: number) {
  return request<{ id: number }>({
    path: `/api/v1/team/supply/parties/${id}/enable`,
    method: 'POST',
    data: {},
  })
}

export function deleteSupplyParty(id: number) {
  return request<{ id: number }>({
    path: `/api/v1/team/supply/parties/${id}`,
    method: 'DELETE',
  })
}

export function fetchSupplyMaterials(kind?: string) {
  const path = kind
    ? `/api/v1/team/supply/materials?kind=${encodeURIComponent(kind)}`
    : '/api/v1/team/supply/materials'
  return request<{ items: SupplyMaterial[] }>({ path })
}

export async function saveSupplyMaterial(body: {
  id?: number
  uid?: string
  kind: string
  name: string
  color: string
  spec: string
  unit: string
  refPrice: number
}) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  if (body.id) {
    return request<SupplyMaterial>({
      path: `/api/v1/team/supply/materials/${body.id}`,
      method: 'PUT',
      data: body,
    })
  }
  return request<SupplyMaterial>({
    path: '/api/v1/team/supply/materials',
    method: 'POST',
    data: body,
  })
}

export function fetchSupplyStyles(code?: string) {
  const path = code
    ? `/api/v1/team/supply/style-cost?code=${encodeURIComponent(code)}`
    : '/api/v1/team/supply/style-cost'
  return request<{ items?: SupplyStyle[]; item?: SupplyStyle | null }>({ path })
}

export async function saveSupplyStyle(body: {
  productCode: string
  fabricMaterialId: number | null
  fabricMaterialIds: number[]
  metersPerPiece: number
  trimMaterialId: number | null
  trimMaterialIds: number[]
  trimQtyPerPiece: number
  processPrice: number
  packagePrice: number
  buyPrice: number
}) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  return request<{ item: SupplyStyle | null }>({
    path: '/api/v1/team/supply/style-cost',
    method: 'PUT',
    data: body,
  })
}

export async function saveSupplyStyleLinks(productCode: string, codes: string[]) {
  const blocked = await guardSupplyBody({ productCode, codes })
  if (blocked) return blocked
  return request<{ item: SupplyStyle | null }>({
    path: '/api/v1/team/supply/style-links',
    method: 'PUT',
    data: { productCode, codes },
  })
}

export function fetchSupplyAgents() {
  return request<{ items: SupplyAgent[] }>({ path: '/api/v1/team/supply/agents' })
}

export async function createSupplyBatch(body: {
  mode: string
  partyId: number
  productCode: string
  color?: string
}) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  return request<{ id: number; batchNo: string }>({
    path: '/api/v1/team/supply/batches',
    method: 'POST',
    data: body,
  })
}

export function fetchSupplyDocs(
  partyId: number,
  docType?: string,
  page?: { q?: string; offset?: number; limit?: number; factoryPartyId?: number; unaccepted?: boolean },
) {
  const parts: string[] = []
  if (partyId) parts.push(`partyId=${partyId}`)
  if (docType) parts.push(`docType=${encodeURIComponent(docType)}`)
  const word = (page && page.q ? page.q : '').trim()
  if (word) parts.push(`q=${encodeURIComponent(word)}`)
  if (page && page.offset) parts.push(`offset=${page.offset}`)
  if (page && page.limit) parts.push(`limit=${page.limit}`)
  if (page && page.factoryPartyId) parts.push(`factoryPartyId=${page.factoryPartyId}`)
  if (page && page.unaccepted) parts.push('unaccepted=1')
  return request<{ items: Array<Record<string, unknown>>; more?: boolean }>({
    path: `/api/v1/team/supply/docs?${parts.join('&')}`,
  })
}

/** 往来列表批量取最近单据；factory 返回 cut / delivery，其余返回 items */
export function fetchSupplyRecentDocs(partyIds: number[], factory: boolean) {
  const ids = partyIds.filter((id) => id > 0).slice(0, 50)
  return request<{
    parties: Record<string, {
      items?: Array<Record<string, unknown>>
      cut?: Array<Record<string, unknown>>
      delivery?: Array<Record<string, unknown>>
    }>
  }>({
    path: `/api/v1/team/supply/docs/recent?partyIds=${ids.join(',')}${factory ? '&mode=factory' : ''}`,
  })
}

export async function createSupplyDoc(body: Record<string, unknown>) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  return request<Record<string, unknown>>({
    path: '/api/v1/team/supply/docs',
    method: 'POST',
    data: body,
  })
}

export function setSupplyDocPaid(id: number, paid: boolean) {
  return request<{ id: number; paid: boolean }>({
    path: `/api/v1/team/supply/docs/${id}/paid`,
    method: 'POST',
    data: { paid },
  })
}

export function setSupplyDocAccepted(id: number, accepted: boolean) {
  return request<{ id: number; accepted: boolean }>({
    path: `/api/v1/team/supply/docs/${id}/checked`,
    method: 'POST',
    data: { accepted },
  })
}

export async function updateSupplyDoc(id: number, body: Record<string, unknown>) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/docs/${id}`,
    method: 'PUT',
    data: body,
  })
}

export function fetchSupplyDoc(id: number) {
  return request<Record<string, unknown>>({ path: `/api/v1/team/supply/docs/${id}` })
}

export function addSupplyDocFile(id: number, url: string) {
  return request({ path: `/api/v1/team/supply/docs/${id}/files`, method: 'POST', data: { url } })
}

export function deleteSupplyDocFile(docId: number, fileId: number) {
  return request({ path: `/api/v1/team/supply/docs/${docId}/files/${fileId}`, method: 'DELETE' })
}

export function deleteSupplyDoc(id: number) {
  return request({ path: `/api/v1/team/supply/docs/${id}`, method: 'DELETE' })
}

export function deleteSupplyStatement(id: number) {
  return request({ path: `/api/v1/team/supply/statements/${id}`, method: 'DELETE' })
}

export function submitSupplyDoc(id: number) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/docs/${id}/submit`,
    method: 'POST',
    data: {},
  })
}

export function acceptSupplyDoc(id: number, pieces?: Array<{ color: string; size: string; qty: number }>) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/docs/${id}/accept`,
    method: 'POST',
    data: pieces && pieces.length ? { pieces } : {},
  })
}

export function fetchSupplyStatements(partyId: number) {
  return request<{ items: Array<Record<string, unknown>> }>({
    path: `/api/v1/team/supply/statements?partyId=${partyId}`,
  })
}

export function createSupplyStatement(body: {
  partyId: number
  role: string
  docIds: number[]
}) {
  return request<Record<string, unknown>>({
    path: '/api/v1/team/supply/statements',
    method: 'POST',
    data: body,
  })
}

export function createSupplyPayment(body: {
  uid: string
  statementId: number
  amount: number
  url: string
}) {
  return request({ path: '/api/v1/team/supply/payments', method: 'POST', data: body })
}

export function fetchSupplyInvites(partyId: number) {
  return request<{ items: Array<Record<string, unknown>> }>({
    path: `/api/v1/team/supply/invites?partyId=${partyId}`,
  })
}

export function createSupplyInvite(fabricDocId: number, hours: number, partyId: number) {
  return request<{ id: number; token: string; expiresAt: string; productCode: string }>({
    path: '/api/v1/team/supply/invites',
    method: 'POST',
    data: { fabricDocId, hours, partyId },
  })
}

export function fetchSupplyInvite(id: number) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/invites/by-id/${id}`,
  })
}

export async function saveSupplyInviteLines(id: number, lines: Array<Record<string, unknown>>) {
  const blocked = await guardSupplyBody({ lines })
  if (blocked) return blocked
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/invites/by-id/${id}/lines`,
    method: 'PUT',
    data: { lines },
  })
}

export function recognizeSupplyInvite(id: number) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/invites/by-id/${id}/recognize`,
    method: 'POST',
    data: {},
    timeout: 90000,
  })
}

export function archiveSupplyInvite(id: number) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/invites/by-id/${id}/archive`,
    method: 'POST',
    data: {},
  })
}

export function revokeSupplyInvite(id: number) {
  return request({
    path: `/api/v1/team/supply/invites/by-id/${id}/revoke`,
    method: 'POST',
    data: {},
  })
}

export function fetchSupplyFill(token: string) {
  return request<Record<string, unknown>>({
    path: `/api/v1/team/supply/invites/${encodeURIComponent(token)}`,
    needAuth: false,
  })
}

export async function submitSupplyFill(token: string, lines: Array<{ size: string; qty: number; productCode: string }>) {
  const blocked = await guardSupplyBody({ lines })
  if (blocked) return blocked
  return request({
    path: `/api/v1/team/supply/invites/${encodeURIComponent(token)}/lines`,
    method: 'POST',
    needAuth: false,
    data: { lines },
  })
}

export async function photoSupplyFill(token: string, imageBase64: string) {
  wx.showLoading({ title: '安全检测', mask: true })
  let media: { ok: boolean; error?: string }
  try {
    media = await mediaCheckAsync({ imageBase64, mediaType: 2, scene: 1 })
  } finally {
    wx.hideLoading()
  }
  if (!media.ok) return supplyBlocked(media.error || '图片含违规内容，请更换后再试')
  return request({
    path: `/api/v1/team/supply/invites/${encodeURIComponent(token)}/photo`,
    method: 'POST',
    needAuth: false,
    data: { imageBase64 },
    timeout: 60000,
  })
}

export function fetchSupplyCostCalcs(code?: string) {
  const q = code ? `?code=${encodeURIComponent(code)}` : ''
  return request<{
    averages?: Array<{ productCode: string; average: number; count: number }>
    items?: Array<Record<string, unknown>>
    average?: number | null
    count?: number
    archivePrice?: number
  }>({ path: `/api/v1/team/supply/cost-calcs${q}` })
}

export async function saveSupplyCostCalc(body: {
  cutDocId?: number
  productCode?: string
  factoryPartyId?: number
  fabricAmount?: number
  trimAmount?: number
  cutQty?: number
  deliveryQty?: number
  basis?: 'cut' | 'delivery'
}) {
  const blocked = await guardSupplyBody(body)
  if (blocked) return blocked
  return request<{
    average?: number | null
    count?: number
    archivePrice?: number
    items?: Array<Record<string, unknown>>
  }>({
    path: '/api/v1/team/supply/cost-calcs',
    method: 'POST',
    data: body,
  })
}

export function deleteSupplyCostCalc(id: number) {
  return request<{ id: number }>({
    path: `/api/v1/team/supply/cost-calcs/${id}`,
    method: 'DELETE',
  })
}

export function fetchSupplyFinalCosts() {
  return request<{ items: Array<{ productCode: string; unitCost: number }> }>({
    path: '/api/v1/team/supply/final-costs',
  })
}

export function fetchSupplyCost(code?: string) {
  const q = code ? `?code=${encodeURIComponent(code)}` : ''
  return request<{ items: Array<Record<string, unknown>> }>({
    path: `/api/v1/team/supply/cost${q}`,
  })
}

export function fetchSupplyMargin(code?: string) {
  const q = code ? `?code=${encodeURIComponent(code)}` : ''
  return request<Record<string, unknown>>({ path: `/api/v1/team/supply/margin${q}` })
}

export async function applySupplyCost(productCode: string, batchId: number) {
  const blocked = await guardSupplyBody({ productCode })
  if (blocked) return blocked
  return request<{ unitCost: number }>({
    path: '/api/v1/team/supply/style-cost/apply',
    method: 'POST',
    data: { productCode, batchId },
  })
}

export async function applySupplyCalcCost(productCode: string) {
  const blocked = await guardSupplyBody({ productCode })
  if (blocked) return blocked
  return request<{ unitCost: number }>({
    path: '/api/v1/team/supply/style-cost/apply',
    method: 'POST',
    data: { productCode, source: 'calc' },
  })
}

export function fetchSupplyAgentOrders(name: string) {
  return request<{ items: Array<Record<string, unknown>> }>({
    path: `/api/v1/team/supply/agents/orders?name=${encodeURIComponent(name)}`,
  })
}

export async function markSupplyAgentPaid(name: string, orderIds: number[]) {
  const blocked = await guardSupplyBody({ name })
  if (blocked) return blocked
  return request<{ count: number }>({
    path: '/api/v1/team/supply/agent-orders/paid',
    method: 'POST',
    data: { name, orderIds },
  })
}

export function setSupplyStaff(memberId: number, enabled: boolean) {
  return request<{ memberId: number; enabled: boolean }>({
    path: '/api/v1/team/supply/staff',
    method: 'PUT',
    data: { memberId, enabled },
  })
}
