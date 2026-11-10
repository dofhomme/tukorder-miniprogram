import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { getSession, isLoggedIn } from '../../services/session'
import {
  fetchCatalog,
  fetchCategories,
  fetchCustomers,
  fetchOrders,
  fetchReturnPackages,
  fetchShop,
  fetchStockMovements,
  isOwner,
  patchCatalog,
  peekCachedCatalog,
  peekCachedCustomers,
  peekCachedOrders,
  peekCachedShop,
  uploadCustomers,
  uploadShop,
  mergeRemoteOrdersIntoCache,
} from '../../services/team'
import {
  peekUserPriceCount,
  pullUserPrices,
  pushUserPrices,
} from '../../services/customer-price'

type PendingRow = { key: string; label: string; count: number }

const LAST_SYNC_KEY = 'tuk_team_last_sync'

Page({
  data: {
    phone: '',
    roleLabel: '',
    shopName: '',
    productCount: 0,
    orderCount: 0,
    customerCount: 0,
    pendingRows: [] as PendingRow[],
    pendingTotal: 0,
    lastSyncLabel: t('lastSyncNever'),
    canManageTeam: false,
    hint: '',
    busy: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'teamDataTitle')
    this.refreshLocal()
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.refreshLocal()
  },

  onPullDownRefresh() {
    void this.onPullCloud().finally(() => wx.stopPullDownRefresh())
  },

  refreshLocal() {
    isOwner()
    const s = getSession()
    const role = String(s?.team?.role || '')
    let roleLabel = t('unknownRole')
    if (role === 'owner') {
      roleLabel = s?.isAdmin ? t('roleMerchantAdmin') : t('roleMerchant')
    } else if (role === 'member' && Number(s?.team?.ownerUserId || 0) > 0) {
      roleLabel = t('teamMember')
    } else if (s?.isAdmin) {
      roleLabel = t('superAdmin')
    }

    const products = peekCachedCatalog()
    const customers = peekCachedCustomers()
    const orders = peekCachedOrders()
    const shop =
      peekCachedShop()?.shopName ||
      String(s?.team?.ownerShopName || s?.team?.shopName || '')

    // 小程序以云端为准，无本地脏队列；待同步恒为 0（与 App「已对齐」态一致）
    const pendingRows: PendingRow[] = [
      { key: 'orders', label: t('ordersShort'), count: 0 },
      { key: 'products', label: t('productCatalog'), count: 0 },
      { key: 'categories', label: t('catProducts'), count: 0 },
      { key: 'customers', label: t('customerProfiles'), count: 0 },
      { key: 'stock', label: t('stockLedger'), count: 0 },
      { key: 'prices', label: t('personalPrice'), count: peekUserPriceCount() },
      { key: 'returns', label: t('returnsTitle'), count: 0 },
    ]

    let lastSyncLabel = t('lastSyncNever')
    try {
      const synced = wx.getStorageSync(LAST_SYNC_KEY)
      if (synced) lastSyncLabel = `${t('lastSyncAt')}${String(synced)}`
    } catch (_) {}

    this.setData({
      phone: s?.phone || '—',
      roleLabel,
      shopName: shop,
      productCount: products.length,
      orderCount: orders.length,
      customerCount: customers.length,
      pendingRows,
      pendingTotal: 0,
      lastSyncLabel,
      canManageTeam: isOwner() || role === 'owner',
    })
  },

  markSynced() {
    const now = new Date()
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
    const label = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    try {
      wx.setStorageSync(LAST_SYNC_KEY, label)
    } catch (_) {}
    this.setData({ lastSyncLabel: `上次同步：${label}` })
  },

  go(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string
    if (url === '/pages/products/products') {
      wx.switchTab({ url })
      return
    }
    wx.navigateTo({ url })
  },

  async onPullCloud() {
    if (this.data.busy) return
    this.setData({ busy: true, hint: '' })
    wx.showLoading({ title: '同步账单/客户/商品…', mask: true })
    // 先尽量上传本地缓存，再拉取
    await this.pushLocalSilent()
    const [shop, cat, cats, cust, ord, ret, stock, prices] = await Promise.all([
      fetchShop(),
      fetchCatalog(),
      fetchCategories(),
      fetchCustomers(),
      fetchOrders({ full: true, limit: 500 }),
      fetchReturnPackages(),
      fetchStockMovements(200),
      pullUserPrices(),
    ])
    if (ord.ok) mergeRemoteOrdersIntoCache(ord.orders)
    if (prices.ok) await pushUserPrices()
    wx.hideLoading()
    this.setData({ busy: false })
    this.refreshLocal()
    if (shop.ok && shop.shop?.shopName) {
      this.setData({ shopName: shop.shop.shopName })
    }
    const fails = [shop, cat, cust, ord].filter((x) => !x.ok)
    if (fails.length) {
      this.setData({
        hint: `部分失败：${fails.map((x) => x.error).join('；')}`,
      })
      wx.showToast({ title: '同步有失败', icon: 'none' })
      return
    }
    this.markSynced()
    this.setData({
      hint: `已同步 账单${ord.orders.length} / 客户${cust.customers.length} / 商品${cat.products.length}` +
        (cats.ok ? ` / 分类${cats.categories.length}` : '') +
        (ret.ok ? ` / 退包${ret.list.length}` : '') +
        (stock.ok ? ` / 流水${stock.list.length}` : '') +
        (prices.ok ? ` / 历史价${prices.count}` : ''),
    })
    wx.showToast({
      title: `已同步账单${ord.orders.length}、客户${cust.customers.length}、商品${cat.products.length}`,
      icon: 'none',
      duration: 2500,
    })
  },

  async pushLocalSilent() {
    const shop = peekCachedShop()
    if (shop?.shopName) {
      await uploadShop({
        shopName: shop.shopName,
        address: shop.address || '',
        phone: shop.phone || '',
        footer: shop.footer || '',
      })
    }
    const products = peekCachedCatalog()
    if (products.length) await patchCatalog(products)
    const customers = peekCachedCustomers()
    if (customers.length) await uploadCustomers(customers)
  },

  async onPushCloud() {
    if (this.data.busy) return
    this.setData({ busy: true })
    wx.showLoading({ title: '上传中', mask: true })
    await this.pushLocalSilent()
    wx.hideLoading()
    this.setData({ busy: false })
    this.markSynced()
    this.refreshLocal()
    this.setData({ hint: '本地缓存已上传到云端' })
    wx.showToast({ title: '上传完成', icon: 'success' })
  },

  async onSyncCustomers() {
    if (this.data.busy) return
    this.setData({ busy: true })
    wx.showLoading({ title: '同步客户', mask: true })
    const r = await fetchCustomers()
    wx.hideLoading()
    this.setData({ busy: false })
    this.refreshLocal()
    if (!r.ok) {
      wx.showToast({ title: r.error || '失败', icon: 'none' })
      return
    }
    this.markSynced()
    this.setData({ hint: `客户已同步 ${r.customers.length} 位` })
    wx.showToast({ title: '客户已同步', icon: 'success' })
  },
})
