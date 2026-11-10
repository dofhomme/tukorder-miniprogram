import { API_BASE, getOrCreateClientId, request, genJobNo } from './api'
import { getSession, isGuest, isLoggedIn, setSession } from './session'
import { isCloudSyncAllowed } from './subscription'
import { isAgentWorkspace } from './workspace'
import { CacheKeys, CacheTTL, cacheGet, cachePeek, cacheSet } from './cache'
import { dehydrateProduct, hydrateCatalog, skuSpec } from './product-sku'
import { t } from './i18n'

/** 游客 / 未登录 / 未订阅云同步：只读写本机，不访问云端 */
function localOnly() {
  return isGuest() || !isLoggedIn() || !isCloudSyncAllowed()
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** 网关重启 / 短暂断连：502 502 页往往是 HTML，request 会报「服务响应异常(502)」 */
function isTransientCloudError(httpStatus?: number, message?: string) {
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return true
  const m = String(message || '')
  return /服务响应异常\((502|503|504)\)|网络错误|fail to connect|timeout/i.test(m)
}

export interface Product {
  code: string
  name: string
  spec?: string | null
  unit?: string | null
  price: number
  cost?: number | null
  category?: string | null
  stock?: number | null
  barcode?: string | null
  remark?: string | null
  countInStats?: boolean
  /** ImageOK 同一套图，只存 https://imageok.cn/... */
  imageUrls?: string[]
  /** 货号 15 秒短视频，只存 https://imageok.cn/... */
  videoUrl?: string
  /** 封面 dHash，16 位 hex */
  coverDhash?: string
  isNewArrival?: boolean
  newArrivalAt?: string | null
  suggestedRetailPrice?: number | null
  /** 本款是否启用颜色×尺码库存 */
  hasSku?: boolean
  colors?: string[]
  sizes?: string[]
  /** 一手里每个尺码的件数，顺序跟 sizes 对齐 */
  hand?: number[]
  skus?: Array<{
    color: string
    size: string
    stock: number | null
    barcode?: string | null
  }>
}

const PRODUCT_IMAGE_URL_RE = /^https:\/\/([a-z0-9-]+\.)?imageok\.cn\//i

/** 商家上传、代理货盘共用：只展示 ImageOK 域名下的商品图 */
export function productImageUrls(raw?: string[] | null): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const u = String(item || '').trim()
    if (!PRODUCT_IMAGE_URL_RE.test(u)) continue
    out.push(u)
    if (out.length >= 9) break
  }
  return out
}

/** 货号短视频：只展示 ImageOK 域名 */
export function productVideoUrl(raw?: string | null): string {
  const u = String(raw || '').trim()
  return PRODUCT_IMAGE_URL_RE.test(u) ? u : ''
}

/**
 * 商品列表封面：默认最小图 thumb_（约 49px）。
 * size=m 用 thumb_m_（约 200px），size=g 用 thumb_g_（约 480px）。
 */
export function productListThumbUrl(url?: string | null, size: 's' | 'm' | 'g' = 's'): string {
  const raw = String(url || '').trim()
  if (!PRODUCT_IMAGE_URL_RE.test(raw)) return ''
  const q = raw.indexOf('?')
  const pathPart = q >= 0 ? raw.slice(0, q) : raw
  const query = q >= 0 ? raw.slice(q) : ''
  const idx = pathPart.lastIndexOf('/')
  if (idx < 0) return raw
  const file = pathPart.slice(idx + 1).replace(/^thumb_(g_|m_)?/i, '')
  const stem = file.replace(/\.[^/.]+$/, '') || 'img'
  const prefix = size === 'g' ? 'thumb_g_' : size === 'm' ? 'thumb_m_' : 'thumb_'
  return `${pathPart.slice(0, idx + 1)}${prefix}${stem}.jpg${query}`
}

/** 点击列表图预览：灵感广场尺寸 thumb_g_（约 480px） */
export function productGalleryUrls(raw?: string[] | null): string[] {
  return productImageUrls(raw).map((u) => productListThumbUrl(u, 'g') || u)
}

export interface Category {
  id?: number
  name: string
  sortOrder?: number
}

export interface ShopInfo {
  hasShop?: boolean
  shopName?: string
  /** 店名下方副标题，可多行 */
  subtitle?: string | null
  address?: string | null
  phone?: string | null
  footer?: string | null
  hasLogo?: boolean
  /** 云端返回的 Logo（base64，可能较大） */
  logoBase64?: string | null
}

export interface Customer {
  id: string
  name: string
  phone?: string | null
  deletedAt?: number | null
  /** 该客户名是否已绑微信（云端） */
  wxBound?: boolean
}

export interface CartItem {
  productCode: string
  productName: string
  spec?: string
  color?: string
  size?: string
  unit?: string
  price: number
  quantity: number
  subtotal: number
  countInStats: boolean
}

export interface OrderBrief {
  id: number
  orderNo: string
  customerName?: string | null
  customerPhone?: string | null
  customerId?: string | null
  remark?: string | null
  totalAmount: number
  totalQuantity: number
  createdAt?: string | null
  creatorUserId?: number
  creatorName?: string | null
  creatorPhone?: string | null
  isReturn?: boolean
  returnReason?: string | null
  returnForDate?: string | null
  isPaid?: boolean
  isPickedUp?: boolean
  isShipped?: boolean
  isDelivered?: boolean
  trackingNos?: string[]
  items?: CartItem[]
  /** 云端是否有送货照（列表轻量字段） */
  hasDeliveryPhoto?: boolean
  /** full 拉取时的送货照 base64 */
  deliveryPhotoBase64?: string
  /** 本机落盘路径（仅客户端） */
  deliveryPhotoPath?: string
  /** 云端静默同步状态；pending 合并时以本机为准 */
  syncStatus?: 'pending' | 'synced'
}

export interface ReturnPackage {
  id?: number
  cloudUid: string
  trackingNo: string
  carrier?: string | null
  packageCount: number
  items?: Array<{ code?: string; qty?: number; name?: string }>
  remark?: string | null
  isHandled?: boolean
  creatorName?: string | null
  createdAt?: string | null
  deletedAt?: string | null
}

export interface StockMovement {
  cloudUid: string
  productCode: string
  productName: string
  type: string
  quantity: number
  stockBefore?: number | null
  stockAfter?: number | null
  remark?: string | null
  color?: string
  size?: string
  orderNo?: string | null
  createdAt?: string | null
  createdByName?: string | null
}

export interface TeamMember {
  id: number
  userId: number
  phone: string
  displayName: string
  joinedAt?: string | null
  seatGranted?: boolean
  seatLimit?: number
  supplyEnabled?: boolean
}

function cid() {
  return getOrCreateClientId()
}

/**
 * 店主。已绑手机、还没加入别人的店（没有 ownerUserId）的号，就是自己的开单店，
 * 不能再当成待入职店员。代理号除外。
 */
export function isOwner(): boolean {
  const s = getSession()
  if (!s) return false
  const role = String(s.team?.role || '')
  if (role === 'owner') return true
  if (!isLoggedIn() || isGuest()) return false
  if (role !== 'member') return false
  if (Number(s.team?.ownerUserId || 0) > 0) return false
  const acct = String((s.team as { accountType?: string } | undefined)?.accountType || '')
    .trim()
    .toLowerCase()
  if (acct === 'agent') return false
  setSession({
    ...s,
    team: { ...(s.team || {}), role: 'owner' },
  })
  return true
}

/** 已加入别人店铺的店员。没有 ownerUserId 的号不是店员。 */
export function isJoinedEmployee(): boolean {
  const s = getSession()
  if (!s || !isLoggedIn() || isGuest()) return false
  if (String(s.team?.role || '') !== 'member') return false
  return Number(s.team?.ownerUserId || 0) > 0
}

/** ImageOK 角色是代理，且当前会话不是本店店主。 */
export function isAgentAccount(): boolean {
  if (isOwner()) return false
  const acct = String((getSession()?.team as { accountType?: string } | undefined)?.accountType || '')
    .trim()
    .toLowerCase()
  return acct === 'agent'
}

/** 店主或游客可改商品；店员、代理不行。 */
export function canEditCatalog(): boolean {
  if (isAgentWorkspace() || isAgentAccount()) return false
  return isOwner() || isGuest() || !isLoggedIn()
}

export function catalogEditDeniedText(): string {
  if (isAgentWorkspace() || isAgentAccount()) return '代理不能修改商家商品'
  if (isJoinedEmployee()) return '仅商家可编辑'
  return '仅商家可编辑'
}

/**
 * 供应链：付费云同步才可进。
 * 代理一律不可。店员还要商家单独开通。
 * 返回 pay / agent / staff，空字符串表示可以进。
 */
export function supplyEntryBlock(): '' | 'pay' | 'agent' | 'staff' {
  if (isAgentWorkspace() || isAgentAccount()) return 'agent'
  if (!isLoggedIn() || isGuest() || !isCloudSyncAllowed()) return 'pay'
  if (!isJoinedEmployee()) return ''
  const flag = (getSession()?.team as { supplyEnabled?: boolean } | undefined)?.supplyEnabled
  if (flag === false) return 'staff'
  return ''
}

export type OrderCreatorRef = {
  creatorUserId?: number | null
  createdByUserId?: number | null
}

/** 商家：本店任意订单；员工：仅自己开的单；游客/未登录：本机单据。 */
export function canEditOrder(order?: OrderCreatorRef | null): boolean {
  if (isGuest() || !isLoggedIn()) return true
  if (isOwner()) return true
  const s = getSession()
  if (!s) return true
  if ((s.team?.role || '') !== 'member') return true
  const creator = Number(order?.creatorUserId ?? order?.createdByUserId ?? 0)
  return !!creator && creator === Number(s.userId)
}

export function canDeleteOrder(order?: OrderCreatorRef | null): boolean {
  return canEditOrder(order)
}

export function filterOrdersForRole(orders: OrderBrief[]): OrderBrief[] {
  const s = getSession()
  if (!s) return orders
  if (isOwner()) return orders
  return orders.filter((o) => o.creatorUserId === s.userId)
}

export async function fetchCatalog() {
  if (localOnly()) {
    const cached = peekCachedCatalog()
    return {
      ok: true as const,
      products: cached,
      fromCache: true as const,
      error: null as string | null,
    }
  }
  const res = await request<Product[]>({
    path: `/api/v1/team/catalog?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) {
    const cached = peekCachedCatalog()
    if (cached && cached.length) {
      return { ok: true as const, products: cached, fromCache: true, error: null as string | null }
    }
    return { ok: false as const, error: res.message, products: [] as Product[], fromCache: false }
  }
  const remote = hydrateCatalog(Array.isArray(res.data) ? res.data : [])
  const pending = readUnsyncedCatalog()
  const products = pending.length ? overlayUnsynced(remote, pending) : remote
  cacheSet(CacheKeys.catalog, products, cid())
  return { ok: true as const, products, fromCache: false, error: null as string | null }
}

export function peekCachedCatalog(): Product[] {
  return hydrateCatalog(cachePeek<Product[]>(CacheKeys.catalog) || [])
}

export function getFreshCachedCatalog(): Product[] | null {
  return cacheGet<Product[]>(CacheKeys.catalog, CacheTTL.catalog)
}

export type TeamMetaScope = 'home' | 'catalog'

type TeamMetaSyncState = {
  owner: number
  rev: number
  at: Partial<Record<TeamMetaScope, number>>
}

const TEAM_META_SYNC_KEY = 'tuk_team_meta_sync_v1'
/** 修订号没变也不跳过太久：部分服务端写入（代理、供应链、图片同步）不递增修订号 */
const META_MAX_SKIP_MS = 5 * 60 * 1000
/** 刚拉过：连修订号都不查 */
const META_QUIET_MS = 30 * 1000

function readMetaSyncState(): TeamMetaSyncState | null {
  try {
    const raw = wx.getStorageSync(TEAM_META_SYNC_KEY) as TeamMetaSyncState | ''
    if (raw && typeof raw === 'object' && raw.at) return raw
  } catch (_) {}
  return null
}

export async function fetchSyncRevision(): Promise<{ ok: boolean; owner: number; rev: number }> {
  if (localOnly()) return { ok: false, owner: 0, rev: 0 }
  const res = await request<{ ownerUserId?: number; dataRevision?: number }>({
    path: `/api/v1/team/sync-revision?clientId=${encodeURIComponent(cid())}`,
    timeout: 8000,
  })
  if (!res.ok || !res.data) return { ok: false, owner: 0, rev: 0 }
  return {
    ok: true,
    owner: Number(res.data.ownerUserId || 0),
    rev: Number(res.data.dataRevision || 0),
  }
}

/**
 * 是否需要重新拉商品/客户/店铺。
 * 返回的 owner/rev 是拉取「之前」读到的修订号（读不到时 rev=-1），拉完交给 markTeamMetaPulled。
 */
export async function shouldPullTeamMeta(
  scope: TeamMetaScope,
  hasCache: boolean,
): Promise<{ pull: boolean; owner: number; rev: number }> {
  const st = readMetaSyncState()
  const last = (st && st.at[scope]) || 0
  if (st && last && hasCache) {
    const age = Date.now() - last
    if (age < META_QUIET_MS) return { pull: false, owner: st.owner, rev: st.rev }
  }
  const remote = await fetchSyncRevision()
  if (!remote.ok) return { pull: true, owner: st?.owner || 0, rev: -1 }
  if (!st || !last || !hasCache || Date.now() - last >= META_MAX_SKIP_MS) {
    return { pull: true, owner: remote.owner, rev: remote.rev }
  }
  const same = remote.owner === st.owner && remote.rev === st.rev
  return { pull: !same, owner: remote.owner, rev: remote.rev }
}

export function markTeamMetaPulled(scopes: TeamMetaScope[], owner: number, rev: number) {
  if (rev < 0) return
  const prev = readMetaSyncState()
  const keep = prev && prev.owner === owner && prev.rev === rev ? prev.at : {}
  const now = Date.now()
  const at: Partial<Record<TeamMetaScope, number>> = { ...keep }
  for (const s of scopes) at[s] = now
  try {
    wx.setStorageSync(TEAM_META_SYNC_KEY, { owner, rev, at })
  } catch (_) {}
}

/**
 * 本机写入且本地缓存已同步时调用：服务端修订号正好只 +1（中间没有别的设备写）就跟进，
 * 免得下次进首页/商品页因为自己的写入又全量拉一遍。只用于不改商品/客户/店铺以外数据的写接口。
 */
function noteOwnTeamWrite(data: unknown) {
  const rev = Number((data as { dataRevision?: number } | null)?.dataRevision || 0)
  if (!(rev > 0)) return
  const st = readMetaSyncState()
  if (!st || rev !== st.rev + 1) return
  try {
    wx.setStorageSync(TEAM_META_SYNC_KEY, { ...st, rev })
  } catch (_) {}
}

export async function uploadProductImage(filePath: string) {
  if (localOnly()) {
    return { ok: false as const, error: '登录并开通云同步后才能传图', url: '' }
  }
  const token = (getSession()?.accessToken || '').trim()
  if (!token) {
    return { ok: false as const, error: '请先登录', url: '' }
  }
  return new Promise<{ ok: true; url: string; dhash: string } | { ok: false; error: string; url: string }>((resolve) => {
    wx.uploadFile({
      url: `${API_BASE}/api/v1/team/product-images/upload`,
      filePath,
      name: 'file',
      header: {
        Authorization: `Bearer ${token}`,
        'X-Client-Id': cid(),
      },
      formData: { clientId: cid() },
      success(res) {
        let body: { code?: number; message?: string; data?: { url?: string; dhash?: string } } | null = null
        try {
          body = JSON.parse(String(res.data || '')) as {
            code?: number
            message?: string
            data?: { url?: string; dhash?: string }
          }
        } catch (_) {
          body = null
        }
        const url = String(body?.data?.url || '').trim()
        const dhash = String(body?.data?.dhash || '').trim()
        if (res.statusCode === 200 && body && body.code === 0 && url.startsWith('https://imageok.cn/')) {
          resolve({ ok: true, url, dhash })
          return
        }
        resolve({
          ok: false,
          error: body?.message || `上传失败(${res.statusCode})`,
          url: '',
        })
      },
      fail(err) {
        resolve({ ok: false, error: err.errMsg || '上传失败', url: '' })
      },
    })
  })
}

export async function uploadProductVideo(filePath: string) {
  if (localOnly()) {
    return { ok: false as const, error: '登录并开通云同步后才能传视频', url: '' }
  }
  const token = (getSession()?.accessToken || '').trim()
  if (!token) {
    return { ok: false as const, error: '请先登录', url: '' }
  }
  return new Promise<{ ok: true; url: string } | { ok: false; error: string; url: string }>((resolve) => {
    wx.uploadFile({
      url: `${API_BASE}/api/v1/team/product-videos/upload`,
      filePath,
      name: 'file',
      timeout: 120000,
      header: {
        Authorization: `Bearer ${token}`,
        'X-Client-Id': cid(),
      },
      formData: { clientId: cid() },
      success(res) {
        let body: { code?: number; message?: string; data?: { url?: string } } | null = null
        try {
          body = JSON.parse(String(res.data || '')) as {
            code?: number
            message?: string
            data?: { url?: string }
          }
        } catch (_) {
          body = null
        }
        const url = String(body?.data?.url || '').trim()
        if (res.statusCode === 200 && body && body.code === 0 && url.startsWith('https://imageok.cn/')) {
          resolve({ ok: true, url })
          return
        }
        resolve({
          ok: false,
          error: body?.message || `上传失败(${res.statusCode})`,
          url: '',
        })
      },
      fail(err) {
        resolve({ ok: false, error: err.errMsg || '上传失败', url: '' })
      },
    })
  })
}

const UNSYNCED_CATALOG = 'tuk_catalog_unsynced'

function readUnsyncedCatalog(): Product[] {
  try {
    const raw = wx.getStorageSync(UNSYNCED_CATALOG)
    return Array.isArray(raw) ? hydrateCatalog(raw as Product[]) : []
  } catch (_) {
    return []
  }
}

function writeUnsyncedCatalog(products: Product[]) {
  try {
    if (!products.length) wx.removeStorageSync(UNSYNCED_CATALOG)
    else wx.setStorageSync(UNSYNCED_CATALOG, products)
  } catch (_) {
    /* 本机写失败时结果页会说明 */
  }
}

function overlayUnsynced(remote: Product[], pending: Product[]): Product[] {
  const map = new Map(remote.map((p) => [String(p.code || '').trim(), p]))
  for (const p of pending) {
    const code = String(p.code || '').trim()
    if (code) map.set(code, p)
  }
  return Array.from(map.values())
}

/** 导入先落本机。云端失败时保留这些货号，避免下次拉取把本机盖掉。 */
export function rememberUnsyncedCatalog(products: Product[]) {
  const map = new Map(readUnsyncedCatalog().map((p) => [String(p.code || '').trim(), p]))
  for (const p of products || []) {
    const code = String(p.code || '').trim()
    if (code) map.set(code, p)
  }
  writeUnsyncedCatalog(Array.from(map.values()))
}

export function forgetUnsyncedCatalog(codes: string[]) {
  const drop = new Set(codes.map((c) => String(c || '').trim()).filter(Boolean))
  writeUnsyncedCatalog(readUnsyncedCatalog().filter((p) => !drop.has(String(p.code || '').trim())))
}

/** 按货号覆盖或新增本机商品，不删除未出现的货号。 */
export function writeCatalogProducts(products: Product[]) {
  const map = new Map(peekCachedCatalog().map((p) => [String(p.code || '').trim(), p]))
  for (const p of hydrateCatalog(products || [])) {
    const code = String(p.code || '').trim()
    if (code) map.set(code, p)
  }
  cacheSet(CacheKeys.catalog, Array.from(map.values()), cid())
}

/** 只提交变更，不带删除。本机缓存由调用方先写入。 */
export async function pushCatalogPatch(products: Product[]) {
  if (localOnly()) return { ok: true as const, localOnly: true as const }
  const res = await request<{ count: number }>({
    path: '/api/v1/team/catalog/patch',
    method: 'POST',
    data: { clientId: cid(), products: products.map((p) => dehydrateProduct(p)), deleteCodes: [] },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  noteOwnTeamWrite(res.data)
  return { ok: true as const }
}

export async function patchCatalog(products: Product[], deleteCodes: string[] = []) {
  const mergeLocal = () => {
    const prev = peekCachedCatalog()
    if (prev.length || products.length || deleteCodes.length) {
      const map = new Map(prev.map((p) => [p.code, p]))
      for (const p of products) map.set(p.code, hydrateCatalog([p])[0] || p)
      for (const code of deleteCodes) map.delete(code)
      cacheSet(CacheKeys.catalog, Array.from(map.values()), cid())
    }
  }
  if (localOnly()) {
    mergeLocal()
    return { ok: true as const, count: products.length, localOnly: true as const }
  }
  const res = await request<{ count: number }>({
    path: '/api/v1/team/catalog/patch',
    method: 'POST',
    data: { clientId: cid(), products: products.map((p) => dehydrateProduct(p)), deleteCodes },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  mergeLocal()
  noteOwnTeamWrite(res.data)
  return { ok: true as const, count: res.data?.count || 0 }
}

export async function fetchCategories() {
  if (localOnly()) {
    const cached = peekCachedCategories()
    return {
      ok: true as const,
      categories: cached,
      fromCache: true as const,
      error: null as string | null,
    }
  }
  const res = await request<Category[]>({
    path: `/api/v1/team/categories?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) {
    const cached = peekCachedCategories()
    if (cached.length) {
      return {
        ok: true as const,
        categories: cached,
        fromCache: true as const,
        error: null as string | null,
      }
    }
    return { ok: false as const, error: res.message, categories: [] as Category[] }
  }
  const list = Array.isArray(res.data) ? res.data : []
  cacheSet(CacheKeys.categories, list, cid())
  return {
    ok: true as const,
    categories: list,
    fromCache: false as const,
    error: null as string | null,
  }
}

export function peekCachedCategories(): Category[] {
  return cachePeek<Category[]>(CacheKeys.categories) || []
}

/** 只把本机有、缓存没有的分类补进去，不覆盖已有项 */
export function mergeCategoriesIntoCache(categories: Category[]) {
  const prev = peekCachedCategories()
  const names = new Set(prev.map((c) => String(c.name || '').trim()).filter(Boolean))
  const next = [...prev]
  for (const c of categories || []) {
    const name = String(c.name || '').trim()
    if (!name || names.has(name)) continue
    names.add(name)
    next.push({ ...c, name })
  }
  cacheSet(CacheKeys.categories, next, cid())
}

/** 只把本机有、缓存没有的商品补进去，不覆盖已有货号 */
export function mergeCatalogIntoCache(products: Product[]) {
  const map = new Map(peekCachedCatalog().map((p) => [String(p.code || '').trim(), p]))
  for (const p of hydrateCatalog(products || [])) {
    const code = String(p.code || '').trim()
    if (!code || map.has(code)) continue
    map.set(code, p)
  }
  cacheSet(CacheKeys.catalog, Array.from(map.values()), cid())
}

/** 只把本机有、缓存没有的客户补进去（按 id，其次姓名+电话） */
export function mergeCustomersIntoCache(customers: Customer[]) {
  const prev = peekCachedCustomers()
  const byId = new Map(prev.map((c) => [String(c.id || '').trim(), c]))
  const fingerprints = new Set(
    prev.map((c) => `${String(c.name || '').trim()}|${String(c.phone || '').trim()}`),
  )
  for (const c of customers || []) {
    if (!c || !c.name || c.deletedAt) continue
    const id = String(c.id || '').trim()
    const fp = `${String(c.name || '').trim()}|${String(c.phone || '').trim()}`
    if (id && byId.has(id)) continue
    if (fingerprints.has(fp)) continue
    const key = id || `np:${fp}`
    byId.set(key, c)
    fingerprints.add(fp)
  }
  cacheSet(
    CacheKeys.customers,
    Array.from(byId.values()).filter((c) => c && c.name && !c.deletedAt),
    cid(),
  )
}

export async function uploadCategories(categories: Category[]) {
  const list = (categories || [])
    .map((c, i) => ({
      name: String(c.name || '').trim(),
      sortOrder: c.sortOrder ?? i,
      id: c.id,
    }))
    .filter((c) => c.name)
  if (localOnly()) {
    cacheSet(CacheKeys.categories, list, cid())
    return { ok: true as const, count: list.length, localOnly: true as const }
  }
  const res = await request<{ count: number }>({
    path: '/api/v1/team/categories/upload',
    method: 'POST',
    data: {
      clientId: cid(),
      categories: list.map((c, i) => ({
        name: c.name,
        sortOrder: c.sortOrder ?? i,
      })),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  cacheSet(CacheKeys.categories, list, cid())
  return { ok: true as const, count: res.data?.count || 0 }
}

export async function fetchShop() {
  // 未开通云同步也可以读店铺资料。否则非付费用户打印模版拿不到 Logo，预览是空的。
  if (isGuest() || !isLoggedIn()) {
    const cached = peekCachedShop()
    return {
      ok: true as const,
      shop: cached,
      fromCache: true as const,
      error: null as string | null,
    }
  }
  const res = await request<ShopInfo>({
    path: `/api/v1/team/shop?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) {
    const cached = cachePeek<ShopInfo>(CacheKeys.shop)
    if (cached) {
      return { ok: true as const, shop: cached, fromCache: true, error: null as string | null }
    }
    return { ok: false as const, error: res.message, shop: null as ShopInfo | null, fromCache: false }
  }
  if (res.data) {
    const prev = peekCachedShop()
    const incoming: ShopInfo = { ...res.data }
    if (incoming.hasLogo === false) {
      incoming.logoBase64 = ''
    } else if (!incoming.logoBase64 && prev?.logoBase64) {
      incoming.logoBase64 = prev.logoBase64
      incoming.hasLogo = true
    }
    cacheSet(CacheKeys.shop, incoming, cid())
    return { ok: true as const, shop: incoming, fromCache: false, error: null as string | null }
  }
  return { ok: true as const, shop: res.data, fromCache: false, error: null as string | null }
}

export function peekCachedShop(): ShopInfo | null {
  return cachePeek<ShopInfo>(CacheKeys.shop)
}

export async function uploadShop(shop: {
  shopName: string
  subtitle?: string
  address?: string
  phone?: string
  footer?: string
  /** 有值则更新 Logo；与 clearLogo 二选一 */
  logoBase64?: string
  clearLogo?: boolean
}) {
  const applyLocal = () => {
    const prev = peekCachedShop() || {}
    const next: ShopInfo = {
      ...prev,
      hasShop: true,
      shopName: shop.shopName,
      subtitle: shop.subtitle ?? prev.subtitle ?? '',
      address: shop.address ?? prev.address ?? '',
      phone: shop.phone ?? prev.phone ?? '',
      footer: shop.footer ?? prev.footer ?? '',
    }
    if (shop.clearLogo) {
      next.hasLogo = false
      next.logoBase64 = ''
    } else if (shop.logoBase64) {
      next.hasLogo = true
      next.logoBase64 = shop.logoBase64
    } else if (prev.logoBase64) {
      next.hasLogo = !!prev.hasLogo || !!prev.logoBase64
      next.logoBase64 = prev.logoBase64
    }
    cacheSet(CacheKeys.shop, next, cid())
  }
  if (localOnly()) {
    applyLocal()
    return { ok: true as const, localOnly: true as const }
  }
  const data: Record<string, unknown> = {
    clientId: cid(),
    shopName: shop.shopName,
    subtitle: shop.subtitle ?? '',
    address: shop.address ?? '',
    phone: shop.phone ?? '',
    footer: shop.footer ?? '',
  }
  if (shop.clearLogo) {
    data.clearLogo = true
  } else if (shop.logoBase64) {
    data.logoBase64 = shop.logoBase64
  }
  const res = await request({
    path: '/api/v1/team/shop/upload',
    method: 'POST',
    data,
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  applyLocal()
  return { ok: true as const }
}

export async function fetchCustomers() {
  if (localOnly()) {
    const cached = peekCachedCustomers()
    return {
      ok: true as const,
      customers: cached,
      fromCache: true as const,
      error: null as string | null,
    }
  }
  const res = await request<{ customers: Customer[]; count: number }>({
    path: `/api/v1/team/customers?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) {
    const cached = cachePeek<Customer[]>(CacheKeys.customers)
    if (cached && cached.length) {
      return { ok: true as const, customers: cached, fromCache: true, error: null as string | null }
    }
    return { ok: false as const, error: res.message, customers: [] as Customer[], fromCache: false }
  }
  const list = (res.data?.customers || []).filter((c) => c && c.name && !c.deletedAt)
  cacheSet(CacheKeys.customers, list, cid())
  return { ok: true as const, customers: list, fromCache: false, error: null as string | null }
}

export function peekCachedCustomers(): Customer[] {
  return cachePeek<Customer[]>(CacheKeys.customers) || []
}

/** 云端全部时间欠款。未登录或请求失败时返回 null，页面再用本机近期订单。 */
export async function fetchCustomerUnpaidTotals(): Promise<Map<string, number> | null> {
  if (localOnly()) return null
  const res = await request<{ items?: { name?: string; amount?: number }[] }>({
    path: '/api/v1/team/customers/unpaid',
  })
  if (!res.ok || !res.data) return null
  const map = new Map<string, number>()
  for (const item of res.data.items || []) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const amt = Number(item?.amount || 0)
    if (!Number.isFinite(amt)) continue
    map.set(name, Math.round(amt * 100) / 100)
  }
  return map
}

export async function uploadCustomers(customers: Customer[]) {
  const list = customers.filter((c) => c && c.name && !c.deletedAt)
  if (localOnly()) {
    mergeCustomersIntoCache(list)
    return { ok: true as const, count: list.length, localOnly: true as const }
  }
  const res = await request<{ count: number }>({
    path: '/api/v1/team/customers/upload',
    method: 'POST',
    data: {
      clientId: cid(),
      customers: list.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone || null,
      })),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  mergeCustomersIntoCache(list)
  return { ok: true as const, count: res.data?.count || 0 }
}

/** 订单有改动后，订单统计回到页面要丢掉时段缓存再拉。 */
let _teamStatsDirty = false

export function markTeamStatsDirty(): void {
  _teamStatsDirty = true
}

export function consumeTeamStatsDirty(): boolean {
  const dirty = _teamStatsDirty
  _teamStatsDirty = false
  return dirty
}

export async function uploadOrder(payload: {
  orderNo: string
  customerName?: string
  customerPhone?: string
  customerId?: string
  remark?: string
  totalAmount: number
  totalQuantity: number
  items: CartItem[]
  createdAt?: string
  isReturn?: boolean
  returnReason?: string
  returnForDate?: string
  isPaid?: boolean
  isPickedUp?: boolean
  isShipped?: boolean
  isDelivered?: boolean
  trackingNos?: string[]
  deliveryPhotoBase64?: string
  clearDeliveryPhoto?: boolean
  /** 仅写入本地缓存，不上云 */
  deliveryPhotoPath?: string
  /** 游客/本地开单：只写缓存不请求云端 */
  localOnly?: boolean
  /** 绑定上传等：等云端 POST 完成再返回（开单保存不要传） */
  waitCloud?: boolean
}) {
  const isReturn = !!payload.isReturn
  const trackingList = (payload.trackingNos || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
  // 对齐 App TrackingNosCodec.toDb：空则不传，有则 JSON 字符串
  const trackingNosJson = trackingList.length ? JSON.stringify(trackingList) : undefined
  const customerId = String(payload.customerId || '').trim()

  const items = (payload.items || []).map((it) => {
    const price = Number(it.price)
    const quantity = Number(it.quantity)
    const subtotal =
      it.subtotal != null && Number.isFinite(Number(it.subtotal))
        ? Number(it.subtotal)
        : (Number.isFinite(price) ? price : 0) * (Number.isFinite(quantity) ? quantity : 0)
    return {
      productCode: String(it.productCode || '').trim() || String(it.productName || '').trim(),
      productName: String(it.productName || '').trim() || String(it.productCode || '').trim(),
      spec: it.spec || '',
      color: it.color || '',
      size: it.size || '',
      unit: it.unit || '件',
      price: Number.isFinite(price) ? price : 0,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      countInStats: it.countInStats !== false,
    }
  })

  // MySQL DATETIME：用本地墙钟，禁止 toISOString（东八区会写成 UTC 04:00）
  const createdAtRaw = payload.createdAt || ''
  let createdAt = String(createdAtRaw).trim()
  if (createdAt) {
    createdAt = createdAt
      .replace('T', ' ')
      .replace(/Z$/i, '')
      .replace(/\.\d+/, '')
      .slice(0, 19)
  }
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(createdAt)) {
    const n = new Date()
    const p = (x: number) => String(x).padStart(2, '0')
    createdAt =
      `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ` +
      `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`
  }

  let photoB64 = payload.deliveryPhotoBase64
    ? String(payload.deliveryPhotoBase64).trim()
    : ''
  if (photoB64.startsWith('data:') && photoB64.includes(',')) {
    photoB64 = photoB64.split(',', 1)[1].trim()
  }

  const cachedNo = String(payload.orderNo || '').trim()
  const existing = cachedNo ? findCachedOrder(cachedNo) : null
  if (existing && !canEditOrder(existing)) {
    return { ok: false as const, error: t('orderEditOwnOnly') }
  }
  const createdAtWrite = String(existing?.createdAt || '').trim() || createdAt
  const body: Record<string, unknown> = {
    clientId: cid(),
    orderNo: payload.orderNo,
    customerName: payload.customerName || '',
    customerPhone: payload.customerPhone || '',
    remark: payload.remark || '',
    totalAmount: Number(payload.totalAmount) || 0,
    totalQuantity: Number(payload.totalQuantity) || 0,
    createdAt: createdAtWrite,
    isPaid: !!payload.isPaid,
    isPickedUp: !!payload.isPickedUp,
    isShipped: !!payload.isShipped,
    isDelivered: !!payload.isDelivered,
    isReturn,
    items,
  }
  if (customerId) body.customerId = customerId
  if (trackingNosJson) body.trackingNos = trackingNosJson
  if (payload.clearDeliveryPhoto) {
    body.clearDeliveryPhoto = true
  } else if (photoB64) {
    body.deliveryPhotoBase64 = photoB64
  }
  if (isReturn) {
    body.returnReason =
      String(payload.returnReason || '').trim() || '其他'
    if (payload.returnForDate) body.returnForDate = payload.returnForDate
  }

  const session = getSession()
  if (cachedNo) {
    upsertOrderInCache({
      id: existing?.id || Date.now(),
      orderNo: cachedNo,
      customerName: payload.customerName || '',
      customerPhone: payload.customerPhone || '',
      customerId: customerId || null,
      remark: payload.remark || '',
      totalAmount: Number(payload.totalAmount) || 0,
      totalQuantity: Number(payload.totalQuantity) || 0,
      createdAt: createdAtWrite,
      isReturn,
      returnReason: isReturn
        ? String(payload.returnReason || '').trim() || '其他'
        : payload.returnReason,
      returnForDate: payload.returnForDate,
      isPaid: !!payload.isPaid,
      isPickedUp: !!payload.isPickedUp,
      isShipped: !!payload.isShipped,
      isDelivered: !!payload.isDelivered,
      trackingNos: trackingList,
      items: items as CartItem[],
      deliveryPhotoBase64: photoB64 || undefined,
      deliveryPhotoPath: payload.deliveryPhotoPath || undefined,
      hasDeliveryPhoto: !!(photoB64 || payload.deliveryPhotoPath),
      creatorUserId: existing?.creatorUserId ?? session?.userId,
      creatorName:
        existing?.creatorName ??
        ((session?.team?.displayName || session?.phone || '').trim() || null),
      creatorPhone: existing?.creatorPhone ?? session?.phone ?? null,
      syncStatus: payload.localOnly || localOnly() ? 'synced' : 'pending',
    })
  }

  try {
    const cp = require('./customer-price') as typeof import('./customer-price')
    cp.rememberPricesFromItems(items as CartItem[])
    if (!isReturn) {
      const deal = require('./customer-deal') as typeof import('./customer-deal')
      deal.applyOrderDealPrices(String(payload.customerName || ''), items)
    }
    if (!localOnly() && !payload.localOnly) {
      void cp.pushUserPrices()
    }
  } catch (_) {
    /* ignore */
  }

  // 游客 / 未订阅：只落本机
  if (payload.localOnly || localOnly()) {
    markTeamStatsDirty()
    return { ok: true as const, orderNo: cachedNo || payload.orderNo, localOnly: true as const }
  }

  if (cachedNo) enqueueOrderSync(cachedNo)
  if (payload.waitCloud) {
    const posted = await postOrderBodyToCloud(body, cachedNo)
    if (!posted.ok) return { ok: false as const, error: posted.error }
    markTeamStatsDirty()
    return { ok: true as const, orderNo: posted.orderNo || cachedNo }
  }
  void flushOrderSyncQueue()
  markTeamStatsDirty()
  return { ok: true as const, orderNo: cachedNo || payload.orderNo }
}

const ORDER_SYNC_QUEUE_KEY = 'tuk_order_sync_queue'
let _orderFlushing = false

function readOrderSyncQueue(): string[] {
  try {
    const raw = wx.getStorageSync(ORDER_SYNC_QUEUE_KEY)
    if (!Array.isArray(raw)) return []
    return raw.map((x) => String(x || '').trim()).filter(Boolean)
  } catch (_) {
    return []
  }
}

function writeOrderSyncQueue(nos: string[]) {
  const uniq: string[] = []
  const seen = new Set<string>()
  for (const n of nos) {
    const no = String(n || '').trim()
    if (!no || seen.has(no)) continue
    seen.add(no)
    uniq.push(no)
  }
  try {
    wx.setStorageSync(ORDER_SYNC_QUEUE_KEY, uniq)
  } catch (_) {
    /* ignore */
  }
}

function enqueueOrderSync(orderNo: string) {
  const no = String(orderNo || '').trim()
  if (!no) return
  writeOrderSyncQueue([...readOrderSyncQueue(), no])
}

function dequeueOrderSync(orderNo: string) {
  const no = String(orderNo || '').trim()
  if (!no) return
  writeOrderSyncQueue(readOrderSyncQueue().filter((x) => x !== no))
}

function markOrderSynced(orderNo: string) {
  const row = findCachedOrder(orderNo)
  if (!row) return
  upsertOrderInCache({ ...row, syncStatus: 'synced' })
}

function applyCloudOrderNo(localNo: string, cloudNo: string) {
  if (!localNo || !cloudNo || localNo === cloudNo) return
  const prev = findCachedOrder(localNo)
  if (prev) upsertOrderInCache({ ...prev, orderNo: cloudNo, syncStatus: 'synced' })
  removeOrderFromCache(localNo)
  dequeueOrderSync(localNo)
}

async function postOrderBodyToCloud(
  body: Record<string, unknown>,
  localNo: string,
): Promise<{ ok: boolean; orderNo?: string; error?: string }> {
  const res = await request<{ orderNo: string }>({
    path: '/api/v1/team/orders',
    method: 'POST',
    data: body,
  })
  if (!res.ok) {
    const tip =
      res.httpStatus && res.httpStatus >= 500
        ? `${res.message || '同步失败'}（服务器 ${res.httpStatus}）`
        : res.message
    return { ok: false, error: tip }
  }
  const orderNo = res.data?.orderNo || localNo
  applyCloudOrderNo(localNo, orderNo)
  dequeueOrderSync(localNo)
  markOrderSynced(orderNo)
  noteOwnTeamWrite(res.data)
  return { ok: true, orderNo }
}

function buildPostBodyFromCachedOrder(order: OrderBrief): Record<string, unknown> | null {
  const items = (order.items || []).map((it) => ({
    productCode: String(it.productCode || '').trim() || String(it.productName || '').trim(),
    productName: String(it.productName || '').trim() || String(it.productCode || '').trim(),
    spec: it.spec || '',
    color: it.color || '',
    size: it.size || '',
    unit: it.unit || '件',
    price: Number(it.price) || 0,
    quantity: Number(it.quantity) || 0,
    subtotal: Number(it.subtotal) || 0,
    countInStats: it.countInStats !== false,
  }))
  if (!items.length) return null
  const trackingList = (order.trackingNos || []).map((n) => String(n || '').trim()).filter(Boolean)
  let createdAt = String(order.createdAt || '')
    .replace('T', ' ')
    .replace(/Z$/i, '')
    .replace(/\.\d+/, '')
    .slice(0, 19)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(createdAt)) {
    const n = new Date()
    const p = (x: number) => String(x).padStart(2, '0')
    createdAt =
      `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ` +
      `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`
  }
  const body: Record<string, unknown> = {
    clientId: cid(),
    orderNo: order.orderNo,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    remark: order.remark || '',
    totalAmount: Number(order.totalAmount) || 0,
    totalQuantity: Number(order.totalQuantity) || 0,
    createdAt,
    isPaid: !!order.isPaid,
    isPickedUp: !!order.isPickedUp,
    isShipped: !!order.isShipped,
    isDelivered: !!order.isDelivered,
    isReturn: !!order.isReturn,
    items,
  }
  if (order.customerId) body.customerId = String(order.customerId)
  if (trackingList.length) body.trackingNos = JSON.stringify(trackingList)
  if (order.deliveryPhotoBase64) {
    let photoB64 = String(order.deliveryPhotoBase64).trim()
    if (photoB64.startsWith('data:') && photoB64.includes(',')) {
      photoB64 = photoB64.split(',', 1)[1].trim()
    }
    if (photoB64) body.deliveryPhotoBase64 = photoB64
  }
  if (order.isReturn) {
    body.returnReason = String(order.returnReason || '').trim() || '其他'
    if (order.returnForDate) body.returnForDate = order.returnForDate
  }
  return body
}

/** 后台把 pending 订单静默推上云；失败留队列，不挡界面 */
export async function flushOrderSyncQueue() {
  if (_orderFlushing || localOnly()) return
  _orderFlushing = true
  try {
    const nos = readOrderSyncQueue()
    for (const no of nos) {
      const order = findCachedOrder(no)
      if (!order) {
        dequeueOrderSync(no)
        continue
      }
      if (!canEditOrder(order)) {
        dequeueOrderSync(no)
        continue
      }
      const body = buildPostBodyFromCachedOrder(order)
      if (!body) {
        dequeueOrderSync(no)
        continue
      }
      const posted = await postOrderBodyToCloud(body, no)
      if (!posted.ok) {
        if ((posted.error || '').includes('同事开的单') ||
            (posted.error || '').includes('只能修改')) {
          dequeueOrderSync(no)
          continue
        }
        break
      }
    }
  } finally {
    _orderFlushing = false
  }
}

/** 订单页默认只拉近 N 天，加快首屏；选更长时间段再按需补拉 */
export const DEFAULT_ORDER_PULL_DAYS = 15
const ORDERS_HORIZON_KEY = 'tuk_orders_pull_horizon_ms'
const ORDERS_LAST_SYNC_KEY = 'tuk_orders_last_sync_ms'

export function recentOrdersSinceMs(days = DEFAULT_ORDER_PULL_DAYS): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return today.getTime() - (days - 1) * 86400000
}

export function recentOrdersSinceIso(days = DEFAULT_ORDER_PULL_DAYS): string {
  return new Date(recentOrdersSinceMs(days)).toISOString()
}

/** 已拉到的最早时间：0 未拉，-1 全部，>0 为 since 毫秒 */
export function getOrdersPullHorizonMs(): number {
  try {
    const n = Number(wx.getStorageSync(ORDERS_HORIZON_KEY) || 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function markOrdersPullHorizon(sinceMs: number | 'all') {
  try {
    wx.setStorageSync(ORDERS_HORIZON_KEY, sinceMs === 'all' ? -1 : sinceMs)
  } catch (_) {}
}

export function widenOrdersPullHorizon(sinceMs: number | 'all') {
  const cur = getOrdersPullHorizonMs()
  if (sinceMs === 'all' || cur === -1) {
    markOrdersPullHorizon('all')
    return
  }
  if (!cur || sinceMs < cur) markOrdersPullHorizon(sinceMs)
}

export function clearOrdersPullHorizon() {
  try {
    wx.removeStorageSync(ORDERS_HORIZON_KEY)
  } catch (_) {}
}

/** 上次成功增量/静默同步的时间戳，用于只拉新单 */
export function getOrdersLastSyncMs(): number {
  try {
    const n = Number(wx.getStorageSync(ORDERS_LAST_SYNC_KEY) || 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function markOrdersLastSyncNow() {
  try {
    wx.setStorageSync(ORDERS_LAST_SYNC_KEY, Date.now())
  } catch (_) {}
}

export async function fetchOrders(opts?: {
  full?: boolean
  limit?: number
  offset?: number
  /** 订单统计用：与 App 一致，不过滤开单人（全店） */
  allCreators?: boolean
  /** ISO 时间：只拉该时间之后的订单 */
  since?: string
  /** 指定单号（详情补明细/送货照） */
  orderNo?: string
  /** 仅单号查询时可带送货照；列表禁止带照，避免真机空白 */
  includePhoto?: boolean
  /** 立刻对齐云端：禁缓存、不重试等待 */
  fresh?: boolean
}) {
  const limit = opts?.limit || 500
  const offset = opts?.offset || 0
  const since = String(opts?.since || '').trim()
  const orderNo = String(opts?.orderNo || '').trim()
  const includePhoto = !!(opts?.includePhoto && orderNo)
  if (localOnly()) {
    if (opts?.fresh) {
      return { ok: false as const, error: '未开通云同步', orders: [] as OrderBrief[] }
    }
    const all = peekCachedOrders().map(normalizeOrderBrief)
    const filtered = orderNo ? all.filter((o) => o.orderNo === orderNo) : all
    const sliced = filtered.slice(offset, offset + limit)
    return {
      ok: true as const,
      orders: opts?.allCreators ? sliced : filterOrdersForRole(sliced),
      error: null as string | null,
    }
  }
  const full = opts?.full ? '1' : '0'
  const fresh = !!opts?.fresh
  let path = `/api/v1/team/orders?clientId=${encodeURIComponent(cid())}&full=${full}&limit=${limit}&offset=${offset}`
  if (since) path += `&since=${encodeURIComponent(since)}`
  if (orderNo) path += `&orderNo=${encodeURIComponent(orderNo)}`
  if (includePhoto) path += '&includePhoto=1'
  if (fresh) path += `&_=${Date.now()}`
  const headers = fresh
    ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    : undefined
  let res = await request<OrderBrief[]>({ path, timeout: 60000, headers })
  if (!fresh) {
    for (let i = 0; i < 2 && !res.ok && isTransientCloudError(res.httpStatus, res.message); i++) {
      await sleep(600 * (i + 1))
      res = await request<OrderBrief[]>({ path, timeout: 60000, headers })
    }
  }
  if (!res.ok) return { ok: false as const, error: res.message, orders: [] as OrderBrief[] }
  const list = (Array.isArray(res.data) ? res.data : []).map(normalizeOrderBrief)
  return {
    ok: true as const,
    orders: opts?.allCreators ? list : filterOrdersForRole(list),
    error: null as string | null,
  }
}

export type TeamStatsTab = 'sales' | 'customers' | 'codes' | 'stmt'

export interface TeamStatsPayload {
  tab: TeamStatsTab
  range: string
  from?: string | null
  to?: string | null
  summary?: Record<string, number>
  summaryLabels?: Record<string, string | number>
  byDay?: any[]
  returnsByDay?: any[]
  byStaff?: any[]
  byCustomer?: any[]
  byCode?: any[]
  customerReturnRates?: any[]
  productReturnRates?: any[]
  stmtCustomers?: any[]
  focusSale?: {
    code?: string
    qty?: number
    amount?: number
    amountLabel?: string
    refundQty?: number
    refundAmount?: number
    refundAmountLabel?: string
    members?: string[]
  } | null
}

/** 统计页：只调当前 Tab + 时段的存储过程，不拉全量订单 */
export async function fetchTeamStats(opts: {
  tab: TeamStatsTab
  range: string
  from?: string
  to?: string
  code?: string
}): Promise<{ ok: boolean; error?: string; data: TeamStatsPayload | null }> {
  if (localOnly()) {
    return { ok: false, error: 'local', data: null }
  }
  let path =
    `/api/v1/team/stats?clientId=${encodeURIComponent(cid())}` +
    `&tab=${encodeURIComponent(opts.tab)}` +
    `&range=${encodeURIComponent(opts.range || '7d')}`
  if (opts.range === 'custom' && opts.from && opts.to) {
    path += `&from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`
  }
  if (opts.code) path += `&code=${encodeURIComponent(opts.code)}`
  const res = await request<TeamStatsPayload>({ path, timeout: 20000 })
  if (!res.ok) return { ok: false, error: res.message, data: null }
  return { ok: true, data: res.data || null }
}

/** 对账单 / 客户详情：按客户调存储过程，不含送货照 */
export async function fetchStmtOrders(opts: {
  customer: string
  range: string
  from?: string
  to?: string
}): Promise<{ ok: boolean; error?: string; orders: OrderBrief[] }> {
  const name = String(opts.customer || '').trim()
  if (!name) return { ok: false, error: '需要客户名', orders: [] }
  if (localOnly()) {
    return { ok: true, orders: peekCachedOrders().map(normalizeOrderBrief) }
  }
  let path =
    `/api/v1/team/stats/stmt-orders?clientId=${encodeURIComponent(cid())}` +
    `&customer=${encodeURIComponent(name)}` +
    `&range=${encodeURIComponent(opts.range || '7d')}`
  if (opts.range === 'custom' && opts.from && opts.to) {
    path += `&from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`
  }
  const res = await request<OrderBrief[]>({ path, timeout: 20000 })
  if (!res.ok) return { ok: false, error: res.message, orders: [] }
  const list = (Array.isArray(res.data) ? res.data : []).map(normalizeOrderBrief)
  return { ok: true, orders: list }
}

/** 解析云端订单字段（trackingNos 可能是 JSON 字符串） */
function normalizeOrderBrief(o: OrderBrief): OrderBrief {
  const raw = o as OrderBrief & { tracking_nos?: unknown; customerUid?: string }
  let trackingNos: string[] = []
  const src = raw.trackingNos ?? raw.tracking_nos
  if (Array.isArray(src)) {
    trackingNos = src.map((x) => String(x).trim()).filter(Boolean)
  } else if (typeof src === 'string' && src.trim()) {
    try {
      const parsed = JSON.parse(src)
      if (Array.isArray(parsed)) {
        trackingNos = parsed.map((x) => String(x).trim()).filter(Boolean)
      }
    } catch (_) {
      trackingNos = [src.trim()]
    }
  }
  return {
    ...o,
    customerId: (o as any).customerId || raw.customerUid || (o as any).customer_id || null,
    trackingNos,
  }
}

export function peekCachedOrders(): OrderBrief[] {
  const modern = cachePeek<OrderBrief[]>(CacheKeys.orders)
  if (modern && modern.length) return modern
  try {
    const legacy = wx.getStorageSync('tuk_orders_cache')
    if (Array.isArray(legacy) && legacy.length) return legacy as OrderBrief[]
  } catch (e) {
    /* ignore */
  }
  return []
}

/** 列表缓存禁止落送货照 base64，避免真机 storage 写爆后订单页空白 */
function stripOrderPhotosForCache(orders: OrderBrief[]): OrderBrief[] {
  return (orders || []).map((o) => {
    if (!o || !(o as any).deliveryPhotoBase64) return o
    const { deliveryPhotoBase64: _drop, ...rest } = o as OrderBrief & {
      deliveryPhotoBase64?: string
    }
    return {
      ...rest,
      hasDeliveryPhoto: !!(o.hasDeliveryPhoto || _drop),
    }
  })
}

let _legacyOrdersCacheDropped = false

export function writeOrdersCache(orders: OrderBrief[]) {
  const slim = stripOrderPhotosForCache(orders)
  cacheSet(CacheKeys.orders, slim, cid())
  if (!_legacyOrdersCacheDropped) {
    _legacyOrdersCacheDropped = true
    try {
      wx.removeStorageSync('tuk_orders_cache')
    } catch (e) {
      /* ignore */
    }
  }
}

/** 只拉单号（full=0），用于和本机对比空缺，避免把已有订单再下一遍 */
export async function listAllRemoteOrderNos(opts?: { since?: string }): Promise<{
  ok: boolean
  error?: string
  nos: Set<string>
}> {
  const nos = new Set<string>()
  if (localOnly()) {
    for (const o of peekCachedOrders()) {
      const no = String(o.orderNo || '').trim()
      if (no) nos.add(no)
    }
    return { ok: true, nos }
  }
  const limit = 500
  const maxPages = 40
  const since = String(opts?.since || '').trim() || undefined
  let offset = 0
  for (let page = 0; page < maxPages; page++) {
    const r = await fetchOrders({
      full: false,
      limit,
      offset,
      allCreators: true,
      since,
    })
    if (!r.ok) return { ok: false, error: r.error || '拉取失败', nos }
    for (const o of r.orders) {
      const no = String(o.orderNo || '').trim()
      if (no) nos.add(no)
    }
    if (r.orders.length < limit) break
    offset += limit
  }
  return { ok: true, nos }
}

/** 详情：按单号补明细/送货照（列表接口默认不带照） */
export async function fetchOrderByNo(
  orderNo: string,
  opts?: { includePhoto?: boolean; fresh?: boolean },
): Promise<{ ok: boolean; error?: string; order: OrderBrief | null }> {
  const no = String(orderNo || '').trim()
  if (!no) return { ok: false, error: '需要单号', order: null }
  const r = await fetchOrders({
    full: true,
    limit: 1,
    offset: 0,
    allCreators: true,
    orderNo: no,
    includePhoto: opts?.includePhoto !== false,
    fresh: opts?.fresh,
  })
  if (!r.ok) return { ok: false, error: r.error || '拉取失败', order: null }
  const order = r.orders[0] || null
  if (order) {
    if (opts?.fresh) replaceOrderInCache(order)
    else upsertOrderInCache(order)
  }
  return { ok: true, order }
}

export function hasOrderItems(order?: OrderBrief | null): boolean {
  return !!(order && Array.isArray(order.items) && order.items.length > 0)
}

export function findCachedOrder(orderNo: string): OrderBrief | null {
  const no = String(orderNo || '').trim()
  if (!no) return null
  return peekCachedOrders().find((o) => o.orderNo === no) || null
}

function orderTimeMs(o: OrderBrief): number {
  const s = String(o.createdAt || '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
    ).getTime()
  }
  const t = Date.parse(s)
  if (Number.isFinite(t)) return t
  return Number(o.id) || 0
}

function pickRicherOrder(local: OrderBrief | undefined, remote: OrderBrief): OrderBrief {
  if (!local) return { ...remote, syncStatus: remote.syncStatus || 'synced' }
  // 本机刚改、尚未上云：云端旧行不得盖掉
  if (local.syncStatus === 'pending') {
    return {
      ...remote,
      ...local,
      items: hasOrderItems(local) ? local.items : remote.items,
      deliveryPhotoPath: local.deliveryPhotoPath || remote.deliveryPhotoPath,
      deliveryPhotoBase64: local.deliveryPhotoBase64 || remote.deliveryPhotoBase64,
      syncStatus: 'pending',
    }
  }
  const remoteItems = hasOrderItems(remote)
  const localItems = hasOrderItems(local)
  return {
    ...local,
    ...remote,
    items: remoteItems ? remote.items : localItems ? local.items : remote.items,
    deliveryPhotoPath: remote.deliveryPhotoPath || local.deliveryPhotoPath,
    deliveryPhotoBase64: remote.deliveryPhotoBase64 || local.deliveryPhotoBase64,
    syncStatus: remote.syncStatus || local.syncStatus || 'synced',
  }
}

/** 点「更新」：云端整行覆盖本机，pending 改动不再盖住云端 */
export function replaceOrderInCache(order: OrderBrief) {
  const no = String(order.orderNo || '').trim()
  if (!no) return
  const prev = peekCachedOrders()
  const nextRow: OrderBrief = {
    ...order,
    orderNo: no,
    syncStatus: 'synced',
  }
  writeOrdersCache([nextRow, ...prev.filter((o) => o.orderNo !== no)])
}

/** 保存订单时立刻写入本地，打开订单优先读这里，不等云端落库 */
export function upsertOrderInCache(order: OrderBrief) {
  const no = String(order.orderNo || '').trim()
  if (!no) return
  const prev = peekCachedOrders()
  const existing = prev.find((o) => o.orderNo === no)
  const nextRow: OrderBrief = existing
    ? {
        ...existing,
        ...order,
        orderNo: no,
        items: hasOrderItems(order) ? order.items : existing.items,
        deliveryPhotoPath: order.deliveryPhotoPath || existing.deliveryPhotoPath,
        deliveryPhotoBase64: order.deliveryPhotoBase64 || existing.deliveryPhotoBase64,
      }
    : { ...order, orderNo: no }
  const next = [nextRow, ...prev.filter((o) => o.orderNo !== no)]
  writeOrdersCache(next)
}

export function removeOrderFromCache(orderNo: string) {
  const no = String(orderNo || '').trim()
  if (!no) return
  writeOrdersCache(peekCachedOrders().filter((o) => o.orderNo !== no))
}

/** 云端结果并入缓存：保留刚保存但尚未出现在库里的订单，且不丢本地明细 */
export function mergeRemoteOrdersIntoCache(remote: OrderBrief[]): OrderBrief[] {
  const local = peekCachedOrders()
  const localByNo = new Map<string, OrderBrief>()
  for (const o of local) {
    if (o && o.orderNo && !localByNo.has(o.orderNo)) localByNo.set(o.orderNo, o)
  }
  const map = new Map<string, OrderBrief>()
  for (const o of remote) {
    const no = String(o?.orderNo || '').trim()
    if (!no) continue
    map.set(no, pickRicherOrder(localByNo.get(no), { ...o, orderNo: no }))
  }
  for (const o of local) {
    const no = String(o?.orderNo || '').trim()
    if (!no || map.has(no)) continue
    map.set(no, o)
  }
  const merged = Array.from(map.values()).sort((a, b) => {
    const dt = orderTimeMs(b) - orderTimeMs(a)
    if (dt) return dt
    return (Number(b.id) || 0) - (Number(a.id) || 0)
  })
  writeOrdersCache(merged)
  return merged
}

export async function fetchAllOrdersFull(opts?: {
  allCreators?: boolean
  since?: string
}): Promise<{
  ok: boolean
  error?: string
  orders: OrderBrief[]
  complete?: boolean
}> {
  if (localOnly()) {
    const local = peekCachedOrders().map(normalizeOrderBrief)
    const orders = opts?.allCreators ? local : filterOrdersForRole(local)
    writeOrdersCache(orders)
    return { ok: true, orders, complete: true }
  }
  const limit = 500
  const maxPages = 40
  const concurrency = 3
  const since = String(opts?.since || '').trim() || undefined

  const first = await fetchOrders({
    full: true,
    limit,
    offset: 0,
    allCreators: opts?.allCreators,
    since,
  })
  if (!first.ok) {
    return { ok: false, error: first.error || '拉取失败', orders: [] }
  }

  const all: OrderBrief[] = [...first.orders]
  let complete = first.orders.length < limit
  if (complete) {
    const merged = mergeRemoteOrdersIntoCache(all)
    if (since) widenOrdersPullHorizon(Date.parse(since) || recentOrdersSinceMs())
    else markOrdersPullHorizon('all')
    return { ok: true, orders: merged, complete: true }
  }

  let offset = limit
  let pages = 1
  while (pages < maxPages) {
    const offsets: number[] = []
    for (let i = 0; i < concurrency && pages + i < maxPages; i++) {
      offsets.push(offset + i * limit)
    }
    const batch = await Promise.all(
      offsets.map((off) =>
        fetchOrders({
          full: true,
          limit,
          offset: off,
          allCreators: opts?.allCreators,
          since,
        }),
      ),
    )
    let ended = false
    for (const r of batch) {
      if (!r.ok) {
        return { ok: false, error: r.error || '拉取失败', orders: all }
      }
      all.push(...r.orders)
      pages += 1
      if (r.orders.length < limit) {
        ended = true
        break
      }
    }
    if (ended) {
      complete = true
      break
    }
    offset += concurrency * limit
  }

  const merged = mergeRemoteOrdersIntoCache(all)
  if (complete) {
    if (since) widenOrdersPullHorizon(Date.parse(since) || recentOrdersSinceMs())
    else markOrdersPullHorizon('all')
  }
  return { ok: true, orders: merged, complete }
}

export async function deleteOrderByNo(orderNo: string) {
  const cached = findCachedOrder(orderNo)
  if (cached && !canDeleteOrder(cached)) {
    return { ok: false as const, error: t('orderEditOwnOnly') }
  }
  if (localOnly()) {
    removeOrderFromCache(orderNo)
    return { ok: true as const, localOnly: true as const }
  }
  const res = await request({
    path: '/api/v1/team/orders/delete',
    method: 'POST',
    data: { clientId: cid(), orderNo },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  removeOrderFromCache(orderNo)
  return { ok: true as const }
}

export async function fetchReturnPackages() {
  if (localOnly()) {
    return { ok: true as const, list: [] as ReturnPackage[], error: null as string | null }
  }
  const res = await request<ReturnPackage[]>({
    path: `/api/v1/team/return-packages?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) return { ok: false as const, error: res.message, list: [] as ReturnPackage[] }
  const list = (Array.isArray(res.data) ? res.data : []).filter((x) => !x.deletedAt)
  return { ok: true as const, list, error: null as string | null }
}

export async function upsertReturnPackage(pkg: {
  cloudUid?: string
  trackingNo: string
  carrier?: string
  packageCount?: number
  items?: Array<{ code?: string; qty?: number; name?: string }>
  remark?: string
  isHandled?: boolean
  handledAt?: string
}) {
  const cloudUid = pkg.cloudUid || genJobNo()
  if (localOnly()) {
    return { ok: true as const, cloudUid, localOnly: true as const }
  }
  const res = await request({
    path: '/api/v1/team/return-packages',
    method: 'POST',
    data: {
      clientId: cid(),
      cloudUid,
      trackingNo: pkg.trackingNo,
      carrier: pkg.carrier || '',
      packageCount: pkg.packageCount || 1,
      items: pkg.items || [],
      remark: pkg.remark || '',
      isHandled: !!pkg.isHandled,
      handledAt: pkg.handledAt || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, cloudUid: null as string | null }
  return { ok: true as const, cloudUid }
}

export async function deleteCustomers(ids: string[]) {
  const list = (ids || []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!list.length) return { ok: true as const }
  if (localOnly()) {
    const set = new Set(list)
    const next = peekCachedCustomers().filter((c) => !set.has(c.id))
    cacheSet(CacheKeys.customers, next, cid())
    return { ok: true as const, localOnly: true as const }
  }
  const res = await request({
    path: '/api/v1/team/customers/delete',
    method: 'POST',
    data: { clientId: cid(), ids: list },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export async function deleteReturnPackage(cloudUid: string) {
  if (localOnly()) {
    return { ok: true as const, localOnly: true as const }
  }
  const res = await request({
    path: '/api/v1/team/return-packages/delete',
    method: 'POST',
    data: { clientId: cid(), cloudUid },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export async function fetchStockMovements(limit = 200) {
  if (localOnly()) {
    return {
      ok: true as const,
      list: [] as StockMovement[],
      error: null as string | null,
    }
  }
  const res = await request<StockMovement[]>({
    path: `/api/v1/team/stock-movements?clientId=${encodeURIComponent(cid())}&limit=${limit}`,
  })
  if (!res.ok) return { ok: false as const, error: res.message, list: [] as StockMovement[] }
  return {
    ok: true as const,
    list: Array.isArray(res.data) ? res.data : [],
    error: null as string | null,
  }
}

export async function uploadStockMovements(movements: StockMovement[]) {
  if (localOnly()) {
    return { ok: true as const, localOnly: true as const }
  }
  const s = getSession()
  const res = await request({
    path: '/api/v1/team/stock-movements',
    method: 'POST',
    data: {
      clientId: cid(),
      movements: movements.map((m) => ({
        cloudUid: m.cloudUid || genJobNo(),
        productCode: m.productCode,
        productName: m.productName,
        type: m.type,
        quantity: m.quantity,
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        remark: [skuSpec(m.color, m.size), m.remark].filter(Boolean).join(' ') || m.remark,
        orderNo: m.orderNo,
        createdByUserId: s?.userId,
        createdByPhone: s?.phone,
        createdByName: s?.team?.displayName || s?.phone,
        createdAt: m.createdAt || new Date().toISOString(),
      })),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export async function fetchMembers() {
  if (localOnly()) {
    return {
      ok: false as const,
      error: '未开通云同步',
      members: [] as TeamMember[],
      seatLimit: 0,
    }
  }
  const res = await request<TeamMember[] | { members?: TeamMember[]; seatLimit?: number }>({
    path: `/api/v1/team/members?clientId=${encodeURIComponent(cid())}`,
  })
  if (!res.ok) {
    return { ok: false as const, error: res.message, members: [] as TeamMember[], seatLimit: 0 }
  }
  const raw = res.data as TeamMember[] | { members?: TeamMember[]; seatLimit?: number } | null
  const members = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.members)
      ? raw!.members!
      : []
  const fromRow = members.length ? Number(members[0].seatLimit || 0) : 0
  const fromObj = !Array.isArray(raw) && typeof raw?.seatLimit === 'number' ? raw.seatLimit : 0
  return {
    ok: true as const,
    members,
    seatLimit: fromObj || fromRow,
    error: null as string | null,
  }
}

export async function saveEntitlementSeats(memberUserIds: number[]) {
  if (localOnly()) return { ok: false as const, error: '未开通云同步' }
  const res = await request<{ memberUserIds?: number[]; seatUsed?: number }>({
    path: '/api/v1/team/members/entitlement-seats',
    method: 'PUT',
    data: { clientId: cid(), memberUserIds },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const, memberUserIds: res.data?.memberUserIds || memberUserIds }
}

export async function checkMemberPhone(phone: string) {
  if (localOnly()) {
    return { ok: false as const, error: '未开通云同步', status: 'error' as const }
  }
  const res = await request<{ status?: string; phone?: string }>({
    path: '/api/v1/team/member/check',
    method: 'POST',
    data: { clientId: cid(), phone },
  })
  if (!res.ok) return { ok: false as const, error: res.message, status: 'error' as const }
  return {
    ok: true as const,
    error: res.message || null,
    status: String(res.data?.status || ''),
  }
}

export async function inviteMemberSms(phone: string) {
  if (localOnly()) return { ok: false as const, error: '未开通云同步' }
  const res = await request({
    path: '/api/v1/team/member/invite-sms',
    method: 'POST',
    data: { clientId: cid(), phone },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const, error: res.message || null }
}

export async function confirmMemberInvite(phone: string, smsCode: string, displayName: string) {
  if (localOnly()) return { ok: false as const, error: '未开通云同步' }
  const res = await request({
    path: '/api/v1/team/member/invite-confirm',
    method: 'POST',
    data: { clientId: cid(), phone, smsCode, displayName },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export async function registerMember(phone: string, password: string, displayName: string) {
  if (localOnly()) {
    return { ok: false as const, error: '未开通云同步', status: '' }
  }
  const res = await request<{ status?: string }>({
    path: '/api/v1/team/member/register',
    method: 'POST',
    data: { clientId: cid(), phone, password, displayName },
  })
  if (!res.ok) return { ok: false as const, error: res.message, status: '' }
  return { ok: true as const, status: String(res.data?.status || 'created') }
}

export async function removeMember(memberRowId: number) {
  if (localOnly()) return { ok: false as const, error: '未开通云同步' }
  const res = await request({
    path: `/api/v1/team/members/${memberRowId}?clientId=${encodeURIComponent(cid())}`,
    method: 'DELETE',
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export async function renameMember(displayName: string) {
  if (localOnly()) return { ok: false as const, error: '未开通云同步' }
  const res = await request({
    path: '/api/v1/team/member/name',
    method: 'PUT',
    data: { clientId: cid(), displayName },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const }
}

export { genJobNo }
