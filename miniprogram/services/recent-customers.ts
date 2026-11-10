/** 首页选客户「最近客户」本地记录。删除/彻底删除必须同步清掉，不能靠客户库缺失再伪造一条。 */

export const RECENT_CUST_KEY = 'tuk_recent_customers'

export type RecentCust = { id: string; name: string; phone: string; usedAt: number }

function namePhoneKey(name: string, phone?: string | null) {
  return `${(name || '').trim()}|${String(phone || '')}`
}

export function loadRecentCustomers(): RecentCust[] {
  try {
    const raw = wx.getStorageSync(RECENT_CUST_KEY)
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x) => x && x.name)
      .map((x) => ({
        id: String(x.id || ''),
        name: String(x.name || ''),
        phone: String(x.phone || ''),
        usedAt: Number(x.usedAt) || 0,
      }))
  } catch (_) {
    return []
  }
}

function persist(list: RecentCust[]) {
  try {
    wx.setStorageSync(RECENT_CUST_KEY, list)
  } catch (_) {
    /* ignore */
  }
}

export function saveRecentCustomer(c: { id: string; name: string; phone?: string | null }) {
  const name = (c.name || '').trim()
  if (!name) return
  const phone = String(c.phone || '')
  const key = namePhoneKey(name, phone)
  const now = Date.now()
  const prev = loadRecentCustomers().filter((x) => namePhoneKey(x.name, x.phone) !== key)
  prev.unshift({ id: c.id || '', name, phone, usedAt: now })
  persist(prev.slice(0, 20))
}

export function removeRecentCustomer(name: string, phone?: string | null) {
  const key = namePhoneKey(name, phone)
  persist(loadRecentCustomers().filter((x) => namePhoneKey(x.name, x.phone) !== key))
}

/** 客户库软删 / 彻底删除后调用：按 id 和 名称+电话 都去掉。 */
export function forgetRecentCustomer(c: { id?: string; name?: string; phone?: string | null }) {
  const id = String(c.id || '').trim()
  const hasName = !!(c.name || '').trim()
  const key = hasName ? namePhoneKey(String(c.name), c.phone) : ''
  persist(
    loadRecentCustomers().filter((x) => {
      if (id && x.id === id) return false
      if (key && namePhoneKey(x.name, x.phone) === key) return false
      return true
    }),
  )
}

/** 打开选择器时：客户库已不存在的正式客户，从最近列表剔除，禁止伪造 recent: 行。 */
export function pruneRecentCustomers(live: { id: string }[]): RecentCust[] {
  const liveIds = new Set(live.map((c) => String(c.id || '')).filter(Boolean))
  const prev = loadRecentCustomers()
  const next = prev.filter((x) => {
    const id = String(x.id || '')
    if (!id || id.startsWith('recent:')) return true
    return liveIds.has(id)
  })
  if (next.length !== prev.length) persist(next)
  return next
}
