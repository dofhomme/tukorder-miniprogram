import { canBrowseApp, isGuest, isLoggedIn } from '../../services/session'
import { isOwner, fetchCategories, uploadCategories } from '../../services/team'
import {
  emptyRecycleBin,
  listTrashCategories,
  listTrashCustomers,
  listTrashOrders,
  listTrashProducts,
  listTrashReturnPackages,
  pullRecycleBinFromCloud,
  purgeCategory,
  purgeCustomer,
  purgeOrder,
  purgeProduct,
  purgeReturnPackage,
  restoreCategory,
  restoreCustomer,
  restoreOrder,
  restoreProduct,
  restoreReturnPackage,
} from '../../services/recycle-bin'
import { formatMoney } from '../../services/analytics'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

type TabKey = 'order' | 'product' | 'category' | 'customer' | 'return'

function recycleTabLabel(key: TabKey) {
  if (key === 'order') return t('tabOrders')
  if (key === 'product') return t('tabProducts')
  if (key === 'category') return t('category')
  if (key === 'customer') return t('tabCustomers')
  return t('returns')
}

function timeLabel(raw?: string | null) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    loading: true,
    tab: 'order' as TabKey,
    tabList: [] as { key: TabKey; label: string; count: number }[],
    orders: [] as any[],
    products: [] as any[],
    categories: [] as any[],
    customers: [] as any[],
    returns: [] as any[],
    canPurge: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'recycleBin')
    if (this.data.tabList.length) {
      this.setData({
        tabList: this.data.tabList.map((x) => ({
          ...x,
          label: recycleTabLabel(x.key),
        })),
      })
    }
  },

  _returnsAll: [] as any[],

  onShow() {
    this.applyLocale()
    if (!canBrowseApp()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    void this.load()
  },

  onLoad() {
    this.applyLocale()
  },

  /** 右上角清空：用页面内按钮代替，App 用 appBar action */
  onReady() {
    // 通过自定义：在页面加清空入口 — 用 navigation 无法方便加 icon，改用分享菜单
  },

  async load() {
    this.setData({ loading: true })
    await pullRecycleBinFromCloud()
    // 游客本机回收站：可视同商家权限管理本地软删数据
    const guest = isGuest() || !isLoggedIn()
    const canProduct = isOwner() || guest
    const canPurge = isOwner() || guest
    const orders = listTrashOrders().map((o) => ({
      ...o,
      amountLabel: formatMoney(Number(o.totalAmount || 0)),
      timeLabel: timeLabel(o.createdAt),
    }))
    const products = canProduct
      ? listTrashProducts().map((p) => ({
          ...p,
          priceLabel: formatMoney(Number(p.price || 0)),
        }))
      : []
    const categories = canProduct ? listTrashCategories() : []
    const [customers, returns] = await Promise.all([
      listTrashCustomers(),
      listTrashReturnPackages(),
    ])
    this._returnsAll = returns

    const tabList: { key: TabKey; label: string; count: number }[] = [
      { key: 'order', label: recycleTabLabel('order'), count: orders.length },
    ]
    if (canProduct) {
      tabList.push({ key: 'product', label: recycleTabLabel('product'), count: products.length })
      tabList.push({ key: 'category', label: recycleTabLabel('category'), count: categories.length })
    }
    tabList.push({ key: 'customer', label: recycleTabLabel('customer'), count: customers.length })
    tabList.push({ key: 'return', label: recycleTabLabel('return'), count: returns.length })

    let tab = this.data.tab
    if (!tabList.some((t) => t.key === tab)) tab = tabList[0].key

    this.setData({
      loading: false,
      tab,
      tabList,
      orders,
      products,
      categories,
      customers,
      returns,
      canPurge,
    })
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: e.currentTarget.dataset.key as TabKey })
  },

  confirm(title: string, content: string, confirmText = '确定') {
    return new Promise<boolean>((resolve) => {
      wx.showModal({
        title,
        content,
        confirmText,
        confirmColor: confirmText.includes('删') ? '#e53935' : '#1E4D8C',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
  },

  async onRestoreOrder(e: WechatMiniprogram.TouchEvent) {
    const no = e.currentTarget.dataset.no as string
    if (!(await this.confirm('恢复账单', `确定恢复账单「${no}」？`, '恢复'))) return
    const r = await restoreOrder(no)
    wx.showToast({ title: r.ok ? '已恢复' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) void this.load()
  },

  denyPurge(): boolean {
    if (isOwner()) return false
    wx.showToast({ title: '仅商家可永久删除', icon: 'none' })
    return true
  },

  async onPurgeOrder(e: WechatMiniprogram.TouchEvent) {
    if (this.denyPurge()) return
    const no = e.currentTarget.dataset.no as string
    if (!(await this.confirm('永久删除账单', `确定永久删除账单「${no}」？删除后无法恢复。`, '永久删除')))
      return
    await purgeOrder(no)
    wx.showToast({ title: '已永久删除', icon: 'success' })
    await this.load()
  },

  async onRestoreProduct(e: WechatMiniprogram.TouchEvent) {
    const code = e.currentTarget.dataset.code as string
    if (!(await this.confirm('恢复商品', `确定恢复商品「${code}」？`, '恢复'))) return
    const r = await restoreProduct(code)
    wx.showToast({ title: r.ok ? '已恢复' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) void this.load()
  },

  async onPurgeProduct(e: WechatMiniprogram.TouchEvent) {
    if (this.denyPurge()) return
    const code = e.currentTarget.dataset.code as string
    if (!(await this.confirm('永久删除商品', `确定永久删除商品「${code}」？`, '永久删除'))) return
    await purgeProduct(code)
    wx.showToast({ title: '已永久删除', icon: 'success' })
    await this.load()
  },

  async onRestoreCategory(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string
    if (!(await this.confirm('恢复分类', `确定恢复分类「${name}」？`, '恢复'))) return
    const cats = await fetchCategories()
    const r = await restoreCategory(name, cats.categories || [], async (list) => {
      const up = await uploadCategories(list)
      return { ok: up.ok, error: up.error }
    })
    wx.showToast({ title: r.ok ? '已恢复' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) void this.load()
  },

  async onPurgeCategory(e: WechatMiniprogram.TouchEvent) {
    if (this.denyPurge()) return
    const name = e.currentTarget.dataset.name as string
    if (
      !(await this.confirm(
        '永久删除分类',
        `确定永久删除分类「${name}」？关联商品将变为无分类。`,
        '永久删除',
      ))
    )
      return
    await purgeCategory(name)
    wx.showToast({ title: '已永久删除', icon: 'success' })
    await this.load()
  },

  async onRestoreCustomer(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const name = this.data.customers.find((c) => c.id === id)?.name || id
    if (!(await this.confirm('恢复客户', `确定恢复客户「${name}」？`, '恢复'))) return
    const r = await restoreCustomer(id)
    wx.showToast({ title: r.ok ? '已恢复' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) void this.load()
  },

  async onPurgeCustomer(e: WechatMiniprogram.TouchEvent) {
    if (this.denyPurge()) return
    const id = e.currentTarget.dataset.id as string
    const name = this.data.customers.find((c) => c.id === id)?.name || id
    if (!(await this.confirm('永久删除客户', `确定永久删除客户「${name}」？`, '永久删除'))) return
    const r = await purgeCustomer(id)
    wx.showToast({ title: r.ok ? '已永久删除' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) await this.load()
  },

  async onRestoreReturn(e: WechatMiniprogram.TouchEvent) {
    const uid = e.currentTarget.dataset.uid as string
    const pkg = this._returnsAll.find((x) => x.cloudUid === uid)
    if (!pkg) return
    if (!(await this.confirm('恢复退包登记', '确定恢复该退包登记？', '恢复'))) return
    const r = await restoreReturnPackage(pkg)
    wx.showToast({ title: r.ok ? '已恢复' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) void this.load()
  },

  async onPurgeReturn(e: WechatMiniprogram.TouchEvent) {
    if (this.denyPurge()) return
    const uid = e.currentTarget.dataset.uid as string
    if (!(await this.confirm('永久删除', '确定永久删除该退包登记？', '永久删除'))) return
    const r = await purgeReturnPackage(uid)
    wx.showToast({ title: r.ok ? '已永久删除' : r.error || '失败', icon: r.ok ? 'success' : 'none' })
    if (r.ok) await this.load()
  },

  async onEmpty() {
    if (this.denyPurge()) return
    const total = this.data.tabList.reduce((s, t) => s + t.count, 0)
    if (!total) {
      wx.showToast({ title: '回收站为空', icon: 'none' })
      return
    }
    if (
      !(await this.confirm(
        '清空回收站',
        `将永久删除回收站中的 ${total} 项，且无法恢复。确定继续？`,
        '清空',
      ))
    )
      return
    wx.showLoading({ title: '清空中', mask: true })
    await emptyRecycleBin()
    wx.hideLoading()
    wx.showToast({ title: '回收站已清空', icon: 'success' })
    await this.load()
  },
})
