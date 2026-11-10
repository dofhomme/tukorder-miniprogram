import { isLoggedIn, canBrowseApp, isGuest } from '../../services/session'
import { loadPrintTemplate } from '../../services/print-template'
import { getTabItems, i18nState, t, tabIndexFor } from '../../services/i18n'
import { requireCloudAccount } from '../../services/account-gate'
import { catalogEditDeniedText, fetchCatalog, fetchCategories, fetchOrders, isOwner, markTeamMetaPulled, patchCatalog, shouldPullTeamMeta, peekCachedCatalog, peekCachedCategories, productGalleryUrls, productImageUrls, productListThumbUrl, productVideoUrl } from '../../services/team'
import type { Product } from '../../services/team'
import { displayStock, isSkuProduct, skuHint, skuSpec } from '../../services/product-sku'
import {
  addToAgentFolder,
  addAgentWishlist,
  createAgentShare,
  fetchAgentCatalog,
  merchantRenewShare,
  fetchAgentFolders,
  fetchAgentProduct,
  searchAgentImage,
  setAgentRestockWatch,
  submitAgentOrder,
  upsertAgentFolder,
  type AgentCatalogProduct,
  type AgentFolder,
} from '../../services/lookup'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import type { ImportField, ImportPlan } from '../../services/product-import'
import { loadSheetKit, type SheetKit } from '../../services/pack-lazy'
import { isAgentWorkspace, openAgentProfileGate, peekAgentOwnerId, peekAgentProfileOk, tabBarTheme } from '../../services/workspace'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { takeVoiceJump } from '../../services/voice-jump'
import { dhashOfImage } from '../../utils/dhash'
import { fetchSupplyFinalCosts, fetchSupplyStyles, styleLinkText } from '../../services/supply'

type AgentCartLine = {
  key: string
  code: string
  name: string
  spec: string
  color: string
  size: string
  unit: string
  price: number
  qty: number
  subLabel: string
  ownerUserId?: number
}

function money(n: number) {
  return Number(n || 0).toFixed(2)
}

/** 货盘行：原价=商品库价，代理价=客户上次成交价（无则同原价） */
function mapAgentRow(p: AgentCatalogProduct) {
  const base = Number(p.basePrice != null ? p.basePrice : p.price) || 0
  const agent = Number(p.agentPrice != null ? p.agentPrice : p.price) || 0
  const urls = productImageUrls(p.imageUrls)
  return {
    ...p,
    imageUrls: urls,
    basePrice: base,
    price: agent,
    agentPrice: agent,
    basePriceLabel: money(base),
    priceLabel: money(agent),
    priceDiff: Math.abs(base - agent) > 0.0001,
    skuHint: p.hasSku ? `${(p.colors || []).length}色 ${(p.sizes || []).length}码` : '',
    coverUrl: p.coverUrl || productListThumbUrl(urls[0], 'm') || urls[0] || '',
    coverFullUrl: urls[0] || p.coverUrl || '',
    imageCount: p.imageCount || urls.length,
    isNewArrival: !!p.isNewArrival,
    watching: !!p.watching,
    stockLevel: p.stockLevel || 'in',
    rowKey: `${Number(p.ownerUserId || 0)}-${p.code}`,
    stockLabel:
      p.stockLevel === 'out' ? t('lookStockOut') : p.stockLevel === 'low' ? t('lookStockLow') : t('lookStockIn'),
    hasVideo: !!productVideoUrl(p.videoUrl),
    videoUrl: productVideoUrl(p.videoUrl),
  }
}

function asProduct(p: AgentCatalogProduct): Product {
  return {
    code: p.code,
    name: p.name,
    unit: p.unit,
    price: Number(p.price) || 0,
    stock: p.stock,
    hasSku: !!p.hasSku,
    colors: p.colors || [],
    sizes: p.sizes || [],
    skus: (p.skus || []).map((x) => ({
      color: x.color,
      size: x.size,
      stock: x.stock == null ? null : Number(x.stock),
    })),
  }
}

type SortKey = 'codeAsc' | 'codeDesc' | 'priceAsc' | 'priceDesc' | 'stockDesc' | 'salesDesc' | 'salesAsc'
type SheetSort = Exclude<SortKey, 'salesAsc'>
type ViewMode = 'table' | 'thumb'

function readViewMode(): ViewMode {
  try {
    return wx.getStorageSync('tuk_product_view') === 'thumb' ? 'thumb' : 'table'
  } catch (_) {
    return 'table'
  }
}

function sortLabels(): Record<SheetSort, string> {
  return {
    codeAsc: t('sortCodeAsc'),
    codeDesc: t('sortCodeDesc'),
    priceAsc: t('sortPriceAsc'),
    priceDesc: t('sortPriceDesc'),
    stockDesc: t('sortStockDesc'),
    salesDesc: t('sortSalesDesc'),
  }
}

/** 首屏只画一屏多。表格大约 16 行，封面宫格大约两屏。其余滚到底再补。 */
const PAGE_SIZE = 16
/** 销量 / 供应链成本 / 关联货号：拉一次 500 单明细较重，切页回来不每次重算 */
const EXTRAS_TTL_MS = 5 * 60 * 1000
const AGENT_PAGE_SIZE = 6

type Row = Product & {
  priceLabel: string
  stockLabel: string
  skuHint: string
  hasSku: boolean
  salesLabel: string
  stockNum: number
  linked: boolean
  coverUrl?: string
  coverCardUrl?: string
  coverFullUrl?: string
}

function fmtQty(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '0'
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return String(Number(v.toFixed(2)))
}

function toRow(p: Product, salesByCode: Record<string, number>, linked = false): Row {
  const sales = salesByCode[p.code] || 0
  const stock = displayStock(p)
  const stockNum = stock == null ? 0 : Number(stock)
  const hint = skuHint(p)
  const full = productImageUrls(p.imageUrls)[0] || ''
  return {
    ...p,
    priceLabel: Number(p.price || 0).toFixed(2),
    stockLabel: stock == null ? '-' : String(stock),
    skuHint: hint,
    hasSku: !!hint,
    salesLabel: fmtQty(sales),
    stockNum: Number.isFinite(stockNum) ? stockNum : 0,
    linked,
    coverUrl: productListThumbUrl(full, 's') || full,
    coverCardUrl: productListThumbUrl(full, 'm') || full,
    coverFullUrl: full,
  }
}

Page({
  data: {
    keyword: '',
    list: [] as Row[],
    isOwner: false,
    loading: false,
    hasMore: false,
    count: 0,
    sort: 'codeAsc' as SortKey,
    sortLabel: t('sortCodeAsc'),
    viewMode: readViewMode(),
    indexFolded: false,
    category: '' as string,
    categoryLabel: t('allCats'),
    categories: [] as string[],
    totalStockLabel: '0',
    styleCountLabel: '0',
    totalAmountLabel: '0.00',
    guestMode: false,
    agentMode: false,
    agentClosed: false,
    agentMerchantExpired: false,
    agentShopName: '',
    agentAllShops: true,
    agentCustomerName: '',
    agentShown: [] as Array<
      AgentCatalogProduct & {
        priceLabel: string
        basePriceLabel: string
        priceDiff: boolean
        skuHint: string
        coverUrl?: string
        coverFullUrl?: string
        imageCount?: number
        watching?: boolean
        hasVideo?: boolean
        videoUrl?: string
      }
    >,
    agentHasMore: false,
    agentCount: 0,
    agentCart: [] as AgentCartLine[],
    agentCartCount: 0,
    agentCartAmt: '0.00',
    agentTab: 'all' as 'all' | 'new',
    pickOn: false,
    pickName: '',
    pickImages: [] as string[],
    pickColors: [] as string[],
    pickSizes: [] as string[],
    pickColor: '',
    pickSize: '',
    pickQty: 1,
    submitting: false,
    shipOn: false,
    shipText: '',
    shipUrgent: false,
    folderPickOn: false,
    folderList: [] as AgentFolder[],
    searchingImage: false,
    imageSearchOn: false,
    importOn: false,
    importStep: 'menu' as 'menu' | 'header' | 'map' | 'preview' | 'result',
    importSheetName: '',
    importHeaderRows: [] as string[],
    importCols: [] as Array<{ index: number; header: string; samples: string; field: string; fieldLabel: string }>,
    importChoiceLabels: [] as string[],
    importAdd: 0,
    importUpdate: 0,
    importSkipText: '',
    importCatText: '',
    importNoteText: '',
    importModeLabel: '只填空白',
    importResult: '',
    importCanSend: false,
    exportHead: [] as string[],
    exportRows: [] as string[][],
    ...capsuleStyleDefaults(),
    ...i18nState(),
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  _agentAll: [] as AgentCatalogProduct[],
  _agentFiltered: [] as AgentCatalogProduct[],
  _agentShowCount: AGENT_PAGE_SIZE,
  _agentCursor: '',
  _agentServerPaged: false,
  _loadingMore: false,
  _ownerUserId: 0,
  _pick: null as AgentCatalogProduct | null,
  _openShipAfterPick: false,
  _watch: new Set<string>(),
  _folderCode: '',
  _clientOrderId: '',
  _imageHits: [] as AgentCatalogProduct[],

  _all: [] as Product[],
  _filtered: [] as Product[],
  _salesByCode: {} as Record<string, number>,
  _extrasAt: 0,
  _metaGate: null as null | { owner: number; rev: number },
  _costByCode: {} as Record<string, number>,
  _linked: {} as Record<string, boolean>,
  _aliasOf: {} as Record<string, string>,
  _adjusting: false,
  _voiceExport: false,
  _showCount: PAGE_SIZE,
  _importRows: [] as string[][],
  _importHeader: 0,
  _importMapping: [] as Array<ImportField | ''>,
  _importPlan: null as ImportPlan | null,
  _importMode: 'fill' as 'fill' | 'overwrite',
  _exportPaths: [] as string[],
  _exportTables: [] as string[][][],
  _exportAt: 0,
  _kit: null as SheetKit | null,

  async sheetKit() {
    if (this._kit) return this._kit
    try {
      wx.showLoading({ title: '请稍候', mask: true })
      this._kit = await loadSheetKit()
      return this._kit
    } catch (_) {
      wx.showToast({ title: '导入模块加载失败', icon: 'none' })
      return null
    } finally {
      try {
        wx.hideLoading()
      } catch (_) {}
    }
  },

  exportPreview() {
    const tables = this._exportTables
    const at = Math.min(this._exportAt, Math.max(0, tables.length - 1))
    const table = tables[at] || []
    const body = table.slice(1)
    const shown = body.length > 600 ? body.slice(0, 600) : body
    const fileNote = tables.length > 1 ? `第 ${at + 1}/${tables.length} 个文件 · ` : ''
    const tail = shown.length < body.length ? `，预览前 ${shown.length} 行` : ''
    return {
      exportHead: table[0] || [],
      exportRows: shown,
      exportXHeight: Math.max(64, (shown.length + 1) * 64),
      importResult: `${fileNote}共 ${body.length} 行${tail}，可上下滑动查看。确认后点发送到聊天。`,
    }
  },

  _sheetIndexShown: null as boolean | null,

  applySheetIndexPref() {
    const shown = loadPrintTemplate().showSheetIndex !== false
    if (this._sheetIndexShown === shown) return
    this._sheetIndexShown = shown
    this.setData({ indexFolded: !shown })
  },

  onShow() {
    try {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (_) {}
    this.applySheetIndexPref()
    const labels = sortLabels()
    const sort = this.data.sort as SortKey
    this.setData({
      ...i18nState(),
      sortLabel: (sort === 'salesAsc' ? '' : labels[sort]) || labels.codeAsc,
      categoryLabel: this.data.category ? this.data.category : t('allCats'),
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: tabIndexFor('products'),
        hidden: false,
        list: getTabItems(),
        theme: tabBarTheme(),
      })
    }
    if (isAgentWorkspace()) {
      try {
        const tab = String(wx.getStorageSync('tuk_agent_catalog_tab') || '')
        if (tab === 'new' || tab === 'all') {
          wx.removeStorageSync('tuk_agent_catalog_tab')
          this.setData({ agentTab: tab })
        }
        const jumpQ = String(wx.getStorageSync('tuk_agent_catalog_q') || '')
        if (jumpQ) {
          wx.removeStorageSync('tuk_agent_catalog_q')
          this.setData({ keyword: jumpQ })
        } else {
          const opts = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : null
          const scene = Number(opts?.scene || 0)
          const qTab = String((opts?.query as Record<string, string> | undefined)?.tab || '')
          if (qTab === 'new' || scene === 1107 || scene === 1014) {
            this.setData({ agentTab: 'new' })
          }
        }
      } catch (_) {}
      this.setData({ agentMode: true, guestMode: false })
      wx.setNavigationBarTitle({ title: t('tabAgentCatalog') })
      if (!peekAgentProfileOk()) {
        openAgentProfileGate()
        return
      }
      void this.loadAgentCatalog()
      return
    }
    this.setData({ agentMode: false })
    wx.setNavigationBarTitle({ title: t('navProducts') })
    const jump = takeVoiceJump('products')
    if (jump && jump.keyword) this.setData({ keyword: jump.keyword })
    if (jump?.action === 'import') this.onImportData()
    else if (jump?.action === 'export') this._voiceExport = true
    if (isGuest() || !isLoggedIn()) {
      this.setData({ guestMode: false, isOwner: true })
      // 游客：只读本地商品缓存，可新增到本机
      void this.loadLocalOnly()
      return
    }
    this.setData({ guestMode: false, isOwner: isOwner() })
    void this.load()
  },

  onGuestBind() {
    requireCloudAccount('sync')
  },

  async loadAgentCatalog() {
    this.setData({ loading: true })
    const r = await fetchAgentCatalog(peekAgentOwnerId() || undefined, {
      tab: this.data.agentTab,
      q: this.data.keyword,
      limit: AGENT_PAGE_SIZE,
    })
    if (!r.ok || !r.data) {
      const expired = String(r.error || '') === '商家账户到期'
      this._agentAll = []
      this.setData({
        loading: false,
        agentMerchantExpired: expired,
        agentShown: [],
        agentCount: 0,
        agentCart: expired ? [] : this.data.agentCart,
      })
      if (!expired) wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this._ownerUserId = peekAgentOwnerId() || Number(r.data.ownerUserId || 0) || 0
    this._watch = new Set(r.data.restockWatch || [])
    this._agentAll = (r.data.products || []).map((p) => ({
      ...p,
      imageUrls: productImageUrls(p.imageUrls),
      videoUrl: productVideoUrl(p.videoUrl),
      watching: this._watch.has(p.code),
    }))
    this._agentCursor = r.data.nextCursor || ''
    this._agentServerPaged = typeof r.data.hasMore === 'boolean'
    this.setData({
      loading: false,
      agentMerchantExpired: false,
      agentClosed: !r.data.acceptAgentOrders,
      agentShopName: peekAgentOwnerId() ? r.data.shopName || '' : t('allShops'),
      agentCustomerName: r.data.customerName || '',
      agentAllShops: !peekAgentOwnerId(),
    })
    if (this._agentServerPaged) {
      this.setData({
        agentShown: this._agentAll.map(mapAgentRow),
        agentHasMore: !!r.data.hasMore,
        agentCount: this._agentAll.length,
      })
    } else {
      this.applyAgentFilter(this.data.keyword)
    }
    this.consumeFolderCart()
  },

  applyAgentFilter(keyword: string) {
    const q = keyword.trim().toLowerCase()
    const list = this._agentAll
      .filter((p) => {
        if (this.data.agentTab === 'new' && !p.isNewArrival) return false
        if (!q) return true
        return (
          p.code.toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
        )
      })
      .slice()
      .sort((a, b) => {
        const an = a.isNewArrival ? 1 : 0
        const bn = b.isNewArrival ? 1 : 0
        if (an !== bn) return bn - an
        return String(a.code || '').localeCompare(String(b.code || ''), 'zh')
      })
    this._agentFiltered = list
    this._agentShowCount = AGENT_PAGE_SIZE
    const n = Math.min(this._agentShowCount, list.length)
    this.setData({
      keyword,
      agentShown: list.slice(0, n).map(mapAgentRow),
      agentCount: list.length,
      agentHasMore: n < list.length,
    })
  },

  onAgentReachBottom() {
    if (this.data.imageSearchOn) return
    if (this._agentServerPaged) {
      void this.loadMoreAgentPage()
      return
    }
    this.loadMoreAgentRows()
  },

  async loadMoreAgentPage() {
    if (!this.data.agentHasMore || this._loadingMore || !this._agentCursor) return
    this._loadingMore = true
    const r = await fetchAgentCatalog(this._ownerUserId || peekAgentOwnerId() || undefined, {
      tab: this.data.agentTab,
      q: this.data.keyword,
      cursor: this._agentCursor,
      limit: AGENT_PAGE_SIZE,
    })
    this._loadingMore = false
    if (!r.ok || !r.data) return
    const extra = (r.data.products || []).map((p) => ({
      ...p,
      imageUrls: productImageUrls(p.imageUrls),
      videoUrl: productVideoUrl(p.videoUrl),
      watching: this._watch.has(p.code),
    }))
    this._agentAll = this._agentAll.concat(extra)
    this._agentCursor = r.data.nextCursor || ''
    this.setData({
      agentShown: this._agentAll.map(mapAgentRow),
      agentHasMore: !!r.data.hasMore,
      agentCount: this._agentAll.length,
    })
  },

  loadMoreAgentRows() {
    if (!this.data.agentHasMore || this._loadingMore) return
    this._loadingMore = true
    this._agentShowCount += AGENT_PAGE_SIZE
    const list = this._agentFiltered
    const n = Math.min(this._agentShowCount, list.length)
    this.setData(
      {
        agentShown: list.slice(0, n).map(mapAgentRow),
        agentHasMore: n < list.length,
      },
      () => {
        this._loadingMore = false
      },
    )
  },

  onAgentKeyword(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value
    this.setData({ keyword, imageSearchOn: false })
    this._imageHits = []
    if (this._agentServerPaged) {
      void this.loadAgentCatalog()
      return
    }
    this.applyAgentFilter(keyword)
  },

  onWhoHas() {
    const q = (this.data.keyword || '').trim()
    if (!q) {
      wx.showToast({ title: t('whoHasHint'), icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/agent-who/agent-who?q=${encodeURIComponent(q)}` })
  },

  async onSearchByImage() {
    if (this.data.searchingImage) return
    const choose = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult | null>((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: resolve,
        fail: () => resolve(null),
      })
    })
    const f = choose?.tempFiles?.[0]
    if (!f) return
    if ((f.size || 0) > 5 * 1024 * 1024) {
      wx.showToast({ title: '单张不能超过 5MB', icon: 'none' })
      return
    }
    if (!(await assertMediaCheckAsync({ filePath: f.tempFilePath, mediaType: 2 }))) return
    this.setData({ searchingImage: true })
    const dhash = await dhashOfImage(f.tempFilePath)
    const r = await searchAgentImage({
      filePath: f.tempFilePath,
      dhash,
      ownerUserId: this._ownerUserId || peekAgentOwnerId() || undefined,
    })
    this.setData({ searchingImage: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    const hits = r.data?.hits || []
    const products: AgentCatalogProduct[] = hits
      .map((h) => {
        const code = String(h.code || '').trim()
        if (!code) return null
        const existing = this._agentAll.find((x) => x.code === code)
        if (existing) return existing
        return {
          code,
          name: String(h.name || code),
          price: Number(h.price) || 0,
          coverUrl: String(h.coverUrl || ''),
          stockLevel: (h.stockLevel as AgentCatalogProduct['stockLevel']) || 'in',
          isNewArrival: !!h.isNewArrival,
          videoUrl: productVideoUrl(h.videoUrl),
        } as AgentCatalogProduct
      })
      .filter((x): x is AgentCatalogProduct => !!x)
    for (const p of products) {
      if (!this._agentAll.find((x) => x.code === p.code)) this._agentAll.push(p)
    }
    this._imageHits = products
    this.setData({
      imageSearchOn: true,
      agentShown: products.map(mapAgentRow),
      agentHasMore: false,
      agentCount: products.length,
    })
    wx.showToast({
      title: products.length ? `${products.length}` : t('searchByImageEmpty'),
      icon: 'none',
    })
  },

  onPlayVideo(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const p =
      this._agentAll.find((x) => x.code === code) ||
      this.data.agentShown.find((x) => x.code === code)
    const url = productVideoUrl(p?.videoUrl)
    if (!url) return
    wx.previewMedia({
      sources: [{ url, type: 'video', poster: String(p?.coverUrl || '') }],
    })
  },

  onAgentTab(e: WechatMiniprogram.TouchEvent) {
    const tab = String(e.currentTarget.dataset.tab || 'all') === 'new' ? 'new' : 'all'
    this.setData({ agentTab: tab, imageSearchOn: false })
    this._imageHits = []
    if (this._agentServerPaged) {
      void this.loadAgentCatalog()
      return
    }
    this.applyAgentFilter(this.data.keyword)
  },

  onAgentTapProduct(e: WechatMiniprogram.TouchEvent) {
    if (this.data.agentClosed) {
      wx.showToast({ title: t('shopNotOpenAgent'), icon: 'none' })
      return
    }
    const code = String(e.currentTarget.dataset.code || '')
    const p = this._agentAll.find((x) => x.code === code)
    if (!p) return
    if (isSkuProduct(asProduct(p))) {
      this._pick = p
      this.setData({
        pickOn: true,
        pickName: p.code || p.name,
        pickImages: productImageUrls(p.imageUrls),
        pickColors: p.colors || [],
        pickSizes: p.sizes || [],
        pickColor: (p.colors || [])[0] || '',
        pickSize: (p.sizes || [])[0] || '',
        pickQty: 1,
      })
      return
    }
    this.addAgentLine(p, '', '', 1)
  },

  onPickColor(e: WechatMiniprogram.TouchEvent) {
    this.setData({ pickColor: String(e.currentTarget.dataset.v || '') })
  },
  onPickSize(e: WechatMiniprogram.TouchEvent) {
    this.setData({ pickSize: String(e.currentTarget.dataset.v || '') })
  },
  onPickQty(e: WechatMiniprogram.TouchEvent) {
    const dir = Number(e.currentTarget.dataset.dir || 0)
    this.setData({ pickQty: Math.max(1, Math.min(999, (this.data.pickQty || 1) + dir)) })
  },
  onPickClose() {
    this._pick = null
    this._openShipAfterPick = false
    this.setData({ pickOn: false, pickImages: [] })
  },

  onAgentPreviewImage(e: WechatMiniprogram.TouchEvent) {
    this.onPreviewGallery(e)
  },

  async onAgentShare(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await createAgentShare(code, this._ownerUserId || peekAgentOwnerId() || undefined)
    wx.hideLoading()
    if (!r.ok || !r.data?.token) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/agent-share/agent-share?t=${encodeURIComponent(r.data.token)}`,
    })
  },

  onOpenFolders() {
    wx.navigateTo({ url: '/pages/agent-folders/agent-folders' })
  },

  onOpenPlaza() {
    wx.navigateTo({ url: '/pages/agent-plaza/agent-plaza' })
  },

  async onAgentWish(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    const r = await addAgentWishlist(code, this._ownerUserId || peekAgentOwnerId() || undefined)
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    const go = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: t('wishAdded'),
        content: t('wishToPendingQ'),
        confirmText: t('wishToPending'),
        cancelText: t('cancel'),
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
    if (!go) return
    const p = this._agentAll.find((x) => x.code === code)
    if (!p) return
    if (isSkuProduct(asProduct(p))) {
      this._pick = p
      this._openShipAfterPick = true
      this.setData({
        pickOn: true,
        pickName: p.code || p.name,
        pickImages: productImageUrls(p.imageUrls),
        pickColors: p.colors || [],
        pickSizes: p.sizes || [],
        pickColor: (p.colors || [])[0] || '',
        pickSize: (p.sizes || [])[0] || '',
        pickQty: 1,
      })
      return
    }
    this.addAgentLine(p, '', '', 1, true)
    this.setData({ shipOn: true })
  },

  async onAgentAddFolder(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    this._folderCode = code
    const r = await fetchAgentFolders(this._ownerUserId || peekAgentOwnerId() || undefined)
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this.setData({ folderPickOn: true, folderList: r.data?.folders || [] })
  },

  onFolderPickClose() {
    this.setData({ folderPickOn: false })
    this._folderCode = ''
  },

  async onPickFolder(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const code = this._folderCode
    if (!id || !code) return
    const r = await addToAgentFolder(id, code, this._ownerUserId || peekAgentOwnerId() || undefined)
    this.setData({ folderPickOn: false })
    this._folderCode = ''
    wx.showToast({ title: r.ok ? t('folderSaved') : r.error || t('loadFailed'), icon: 'none' })
  },

  async onCreateFolderFromPick() {
    const title = await new Promise<string>((resolve) => {
      wx.showModal({
        title: t('newFolder'),
        editable: true,
        placeholderText: t('folderTitle'),
        success: (r) => resolve(r.confirm ? String(r.content || '').trim() : ''),
        fail: () => resolve(''),
      })
    })
    if (!title) return
    if (!(await assertMsgSecCheck([title]))) return
    const created = await upsertAgentFolder({
      ownerUserId: this._ownerUserId || peekAgentOwnerId() || undefined,
      title,
    })
    if (!created.ok || !created.data?.folder?.id) {
      wx.showToast({ title: created.error || t('loadFailed'), icon: 'none' })
      return
    }
    const code = this._folderCode
    if (code) {
      await addToAgentFolder(
        created.data.folder.id,
        code,
        this._ownerUserId || peekAgentOwnerId() || undefined,
      )
    }
    this.setData({ folderPickOn: false })
    this._folderCode = ''
    wx.showToast({ title: t('folderSaved'), icon: 'none' })
  },

  async onAgentRestock(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    const on = !this._watch.has(code)
    const r = await setAgentRestockWatch(code, on, this._ownerUserId || peekAgentOwnerId() || undefined)
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this._watch = new Set(r.data?.codes || [])
    this._agentAll = this._agentAll.map((p) => ({ ...p, watching: this._watch.has(p.code) }))
    if (this._agentServerPaged) {
      this.setData({ agentShown: this._agentAll.map(mapAgentRow) })
    } else {
      this.applyAgentFilter(this.data.keyword)
    }
    wx.showToast({ title: on ? t('restockWatchOn') : t('restockWatch'), icon: 'none' })
  },

  consumeFolderCart() {
    let raw: Array<{ code: string; color?: string; size?: string }> = []
    try {
      raw = (wx.getStorageSync('tuk_agent_folder_cart') as typeof raw) || []
      wx.removeStorageSync('tuk_agent_folder_cart')
    } catch (_) {
      raw = []
    }
    if (!Array.isArray(raw) || !raw.length) return
    let n = 0
    for (const it of raw) {
      const p = this._agentAll.find((x) => x.code === it.code)
      if (!p) continue
      this.addAgentLine(p, it.color || '', it.size || '', 1, true)
      n += 1
    }
    if (n) {
      let openShip = false
      try {
        openShip = !!wx.getStorageSync('tuk_agent_open_ship')
        wx.removeStorageSync('tuk_agent_open_ship')
      } catch (_) {}
      if (openShip) this.setData({ shipOn: true })
      wx.showToast({ title: openShip ? t('wishToPendingHint') : `${t('folderToCart')} ${n}`, icon: 'none' })
    }
  },

  async onPreviewGallery(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const p = this._agentAll.find((x) => x.code === code) || this._all.find((x) => x.code === code)
    let urls = productGalleryUrls(p?.imageUrls)
    if (!urls.length && this.data.agentMode && code) {
      const det = await fetchAgentProduct(code, this._ownerUserId || peekAgentOwnerId() || undefined)
      urls = (det.data?.galleryUrls || productGalleryUrls(det.data?.imageUrls) || []).filter(Boolean)
    }
    if (urls.length) {
      wx.previewImage({ current: urls[0], urls })
      return
    }
    const fallback = String(e.currentTarget.dataset.full || '')
    const g = productListThumbUrl(fallback, 'g') || fallback
    if (!g) return
    wx.previewImage({ current: g, urls: [g] })
  },

  onAgentPreviewPick(e: WechatMiniprogram.TouchEvent) {
    const current = productListThumbUrl(String(e.currentTarget.dataset.url || ''), 'g')
      || String(e.currentTarget.dataset.url || '')
    const urls = productGalleryUrls(this.data.pickImages)
    if (!urls.length) return
    wx.previewImage({ current: current || urls[0], urls })
  },
  onPickAdd() {
    const p = this._pick
    if (!p) return
    const color = this.data.pickColor
    const size = this.data.pickSize
    if (!color || !size) {
      wx.showToast({ title: t('skuColor'), icon: 'none' })
      return
    }
    this.addAgentLine(p, color, size, this.data.pickQty || 1)
    const openShip = this._openShipAfterPick
    this.onPickClose()
    if (openShip) this.setData({ shipOn: true })
  },

  addAgentLine(p: AgentCatalogProduct, color: string, size: string, qty: number, silent = false) {
    const ownerId = Number(p.ownerUserId || this._ownerUserId || peekAgentOwnerId() || 0)
    if (!ownerId) {
      wx.showToast({ title: t('plazaEntry'), icon: 'none' })
      return
    }
    const cartOwner = Number(this.data.agentCart[0]?.ownerUserId || 0)
    if (cartOwner && cartOwner !== ownerId) {
      wx.showToast({ title: t('switchShop'), icon: 'none' })
      return
    }
    const spec = skuSpec(color, size)
    const key = `${ownerId}|${p.code}|${color}|${size}`
    const cart = this.data.agentCart.slice()
    const i = cart.findIndex((x) => x.key === key)
    if (i >= 0) {
      cart[i].qty += qty
      cart[i].subLabel = money(cart[i].price * cart[i].qty)
    } else {
      cart.push({
        key,
        code: p.code,
        name: p.name || p.code,
        spec,
        color,
        size,
        unit: p.unit || '件',
        price: Number(p.price) || 0,
        qty,
        subLabel: money((Number(p.price) || 0) * qty),
        ownerUserId: ownerId,
      })
    }
    this.setAgentCart(cart)
    if (!silent) wx.showToast({ title: t('addToCart'), icon: 'none' })
  },

  onAgentCartQty(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    const dir = Number(e.currentTarget.dataset.dir || 0)
    const cart = this.data.agentCart
      .map((x) => {
        if (x.key !== key) return x
        const qty = x.qty + dir
        if (qty < 1) return null
        return { ...x, qty, subLabel: money(x.price * qty) }
      })
      .filter(Boolean) as AgentCartLine[]
    this.setAgentCart(cart)
  },

  setAgentCart(cart: AgentCartLine[]) {
    const count = cart.reduce((s, x) => s + x.qty, 0)
    const amt = cart.reduce((s, x) => s + x.price * x.qty, 0)
    this.setData({ agentCart: cart, agentCartCount: count, agentCartAmt: money(amt) })
  },

  noop() {},

  async onAgentSubmit() {
    if (this.data.submitting || !this.data.agentCart.length || this.data.agentClosed) return
    this.setData({ shipOn: true })
  },

  onShipClose() {
    this.setData({ shipOn: false })
  },
  onShipText(e: WechatMiniprogram.TextareaInput) {
    this.setData({ shipText: e.detail.value })
  },
  onShipUrgent(e: WechatMiniprogram.SwitchChange) {
    this.setData({ shipUrgent: !!e.detail.value })
  },

  async onShipConfirm() {
    if (this.data.submitting || !this.data.agentCart.length) return
    const shipText = String(this.data.shipText || '').trim()
    // 官方 security.msgSecCheck，scene=1 资料
    // https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html
    if (!(await assertMsgSecCheck([shipText], 1))) return
    this.setData({ submitting: true })
    if (!this._clientOrderId) {
      this._clientOrderId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }
    const phone = (shipText.match(/1[3-9]\d{9}/) || [''])[0]
    const r = await submitAgentOrder(
      this.data.agentCart.map((x) => ({
        code: x.code,
        qty: x.qty,
        color: x.color,
        size: x.size,
      })),
      {
        ownerUserId: this.data.agentCart[0]?.ownerUserId || this._ownerUserId || peekAgentOwnerId() || undefined,
        remark: '',
        shipToName: shipText,
        shipToPhone: phone,
        shipToAddress: shipText,
        urgent: this.data.shipUrgent,
        clientOrderId: this._clientOrderId,
      },
    )
    this.setData({ submitting: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this._clientOrderId = ''
    this.setAgentCart([])
    this.setData({ shipOn: false, shipText: '' })
    wx.showToast({ title: `${t('submitToShop')} ${r.data?.orderNo || ''}`, icon: 'none' })
  },

  /** 游客：只用本地缓存，不拉云端 */
  async loadLocalOnly() {
    this.setData({ loading: true })
    const cached = peekCachedCatalog()
    this._all = cached
    const fromProducts = this._all
      .map((p) => (p.category || '').trim())
      .filter(Boolean)
    const fromStored = peekCachedCategories()
      .map((c) => (c.name || '').trim())
      .filter(Boolean)
    const cats = Array.from(new Set([...fromStored, ...fromProducts])).sort((a, b) =>
      a.localeCompare(b, 'zh'),
    )
    this.setData({ categories: cats, loading: false })
    this.apply()
  },

  onHide() {},

  onReachBottom() {
    this.loadMoreRows()
  },

  onListReachBottom() {
    this.loadMoreRows()
  },

  async load(waitExtras?: boolean) {
    const cached = peekCachedCatalog()
    if (cached.length && !this._all.length) {
      this._all = cached
      const cats = Array.from(
        new Set(
          this._all
            .map((p) => (p.category || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, 'zh'))
      this.setData({ categories: cats })
      this.apply()
    }

    if (!waitExtras) {
      const gate = await shouldPullTeamMeta('catalog', cached.length > 0)
      if (!gate.pull) {
        const latest = peekCachedCatalog()
        if (latest.length) {
          this._all = latest
          this.apply()
        }
        if (isLoggedIn() && !isGuest() && Date.now() - this._extrasAt >= EXTRAS_TTL_MS) {
          void this.refreshProductExtras()
        }
        return
      }
      this._metaGate = gate
    } else {
      this._metaGate = null
    }

    this.setData({ loading: !this._all.length })
    const cat = await fetchCatalog()
    this.setData({ loading: false })
    if (!cat.ok) {
      if (!this._all.length) {
        wx.showToast({ title: cat.error || '加载失败', icon: 'none' })
      }
      return
    }
    this._all = cat.products || []
    if (!cat.fromCache && this._metaGate) {
      markTeamMetaPulled(['catalog'], this._metaGate.owner, this._metaGate.rev)
    }
    await this.refreshCategories()
    this.apply()
    if (isLoggedIn() && !isGuest()) {
      if (waitExtras) await this.refreshProductExtras()
      else if (Date.now() - this._extrasAt >= EXTRAS_TTL_MS) void this.refreshProductExtras()
    }
  },

  /** 销量、供应链成本、关联货号：列表出来后再拉，打开商品页不等它们 */
  async refreshProductExtras() {
    this._extrasAt = Date.now()
    const [orders, costs, styles] = await Promise.all([
      fetchOrders({ full: true, limit: 500 }),
      fetchSupplyFinalCosts(),
      fetchSupplyStyles(),
    ])
    const sales: Record<string, number> = {}
    const statsOff = new Set(
      this._all
        .filter((p) => p.countInStats === false)
        .map((p) => (p.code || '').trim())
        .filter(Boolean),
    )
    if (orders.ok) {
      for (const o of orders.orders || []) {
        const isReturn = !!o.isReturn
        for (const it of o.items || []) {
          if (it.countInStats === false) continue
          const code = String(it.productCode || '').trim()
          if (!code || statsOff.has(code)) continue
          const q = Math.abs(Number(it.quantity || 0))
          sales[code] = (sales[code] || 0) + (isReturn ? -q : q)
        }
      }
    }
    this._salesByCode = sales
    const costMap: Record<string, number> = {}
    if (costs && costs.ok) {
      for (const item of (costs.data && costs.data.items) || []) {
        const code = String(item.productCode || '').trim()
        const unit = Number(item.unitCost)
        if (code && Number.isFinite(unit)) costMap[code] = unit
      }
    }
    this._costByCode = costMap
    const linked: Record<string, boolean> = {}
    const aliasOf: Record<string, string> = {}
    if (styles && styles.ok) {
      for (const item of (styles.data && styles.data.items) || []) {
        const code = String(item.productCode || '').trim()
        const source = String(item.linkSource || '').trim()
        if (code && source && source !== code) aliasOf[code] = source
        if (code && styleLinkText(item)) linked[code] = true
      }
    }
    this._linked = linked
    this._aliasOf = aliasOf
    this.apply()
  },

  async refreshCategories() {
    const fromProducts = Array.from(
      new Set(
        this._all
          .map((p) => (p.category || '').trim())
          .filter(Boolean),
      ),
    )
    const r = await fetchCategories()
    const fromCloud = (r.categories || [])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => (c.name || '').trim())
      .filter(Boolean)
    const seen = new Set(fromCloud)
    const merged = [...fromCloud]
    for (const n of fromProducts.sort((a, b) => a.localeCompare(b, 'zh'))) {
      if (!seen.has(n)) {
        seen.add(n)
        merged.push(n)
      }
    }
    this.setData({ categories: merged })
  },

  onRefresh() {
    this.onImportData()
  },

  onImportData() {
    if (this._kit && this._kit.importBusy()) {
      wx.showToast({ title: '上一次导入还没结束', icon: 'none' })
      return
    }
    this._clearExportFiles()
    this.setData({
      importOn: true,
      importStep: 'menu',
      importResult: '',
      importCanSend: false,
      exportHead: [],
      exportRows: [],
    })
  },

  onImportClose() {
    if (this._kit && this._kit.importBusy()) return
    this._clearExportFiles()
    this._importPlan = null
    this.setData({ importOn: false, importStep: 'menu' })
  },

  _clearExportFiles() {
    if (this._kit) this._kit.removeExportFiles(this._exportPaths)
    this._exportPaths = []
    this._exportAt = 0
  },

  _staffMapping(mapping: Array<ImportField | ''>, kit: SheetKit) {
    if (!kit.staffUser()) return mapping
    return mapping.map((field) => (field === 'price' || field === 'category' ? '' : field))
  },

  _tooManyRows() {
    let n = 0
    for (let i = this._importHeader + 1; i < this._importRows.length; i++) {
      if ((this._importRows[i] || []).some((cell) => String(cell || '').trim())) n += 1
      if (n > 5000) return true
    }
    return false
  },

  async _paintCols() {
    const kit = this._kit || (await this.sheetKit())
    if (!kit) return
    const choices = kit.fieldChoices(kit.staffUser())
    const cols = kit.columnViews(this._importRows, this._importHeader, this._importMapping).map((col) => ({
      index: col.index,
      header: col.header,
      samples: col.samples.join('、') || '（空）',
      field: col.field,
      fieldLabel: choices.find((item) => item.id === col.field)?.label || '不导入',
    }))
    this.setData({ importCols: cols, importChoiceLabels: choices.map((item) => item.label) })
  },

  async _paintPreview() {
    const kit = this._kit || (await this.sheetKit())
    if (!kit) return false
    const plan = kit.buildImportPlan({
      rows: this._importRows,
      headerIndex: this._importHeader,
      mapping: this._importMapping,
      existing: this._all,
      categories: this.data.categories,
      mode: this._importMode,
      staff: kit.staffUser(),
    })
    if (plan.error || !plan.plan) {
      wx.showToast({ title: plan.error || '无法导入', icon: 'none' })
      return false
    }
    this._importPlan = plan.plan as ImportPlan
    const skips = plan.plan.skips
      .slice(0, 8)
      .map((item) => `${item.code}（${item.rows}行）${item.reason}`)
      .join('\n')
    this.setData({
      importStep: 'preview',
      importAdd: plan.plan.addCount,
      importUpdate: plan.plan.updateCount,
      importSkipText: skips || '没有跳过的货号',
      importCatText: plan.plan.createCategories.length ? plan.plan.createCategories.join('、') : '没有要新建的分类',
      importNoteText: plan.plan.notes.slice(0, 6).join('\n'),
      importModeLabel: this._importMode === 'fill' ? '只填空白' : '覆盖已映射的列',
    })
    return true
  },

  async onImportFile() {
    const kit = await this.sheetKit()
    if (!kit || kit.importBusy()) return
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'csv', 'XLSX', 'CSV'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        this._readPickedSheet(file.path, file.size, file.name)
      },
    })
  },

  async _readPickedSheet(path: string, size: number, name: string) {
    const kit = this._kit || (await this.sheetKit())
    if (!kit) return
    kit.setImportBusy(true)
    wx.showLoading({ title: '读取表格', mask: true })
    void kit
      .readUserSheet(path, size, name)
      .then(async (read) => {
        wx.hideLoading()
        if (!read.ok) {
          wx.showToast({ title: read.error, icon: 'none' })
          return
        }
        this._importRows = read.table.rows
        this._importPlan = null
        this._importMode = 'fill'
        const headerOk = kit.looksLikeHeader(read.table.rows[0] || [])
        this.setData({ importSheetName: read.table.sheetName, importOn: true })
        if (!headerOk) {
          this.setData({
            importStep: 'header',
            importHeaderRows: read.table.rows.slice(0, 8).map((row) => row.filter(Boolean).slice(0, 4).join(' / ') || '（空行）'),
          })
          return
        }
        this._importHeader = 0
        this._importMapping = this._staffMapping(kit.autoMapping(read.table.rows[0] || []) as Array<ImportField | ''>, kit)
        if (this._tooManyRows()) {
          wx.showToast({ title: '数据超过 5000 行，请拆开后再导入', icon: 'none' })
          this.setData({ importStep: 'menu' })
          return
        }
        this.setData({ importStep: 'map' })
        await this._paintCols()
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '文件读不出来', icon: 'none' })
      })
      .finally(() => kit.setImportBusy(false))
  },

  async onPickHeaderRow(e: WechatMiniprogram.TouchEvent) {
    const kit = this._kit || (await this.sheetKit())
    if (!kit) return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0 || index >= this._importRows.length) return
    this._importHeader = index
    this._importMapping = this._staffMapping(kit.autoMapping(this._importRows[index] || []) as Array<ImportField | ''>, kit)
    if (this._tooManyRows()) {
      wx.showToast({ title: '数据超过 5000 行，请拆开后再导入', icon: 'none' })
      this.setData({ importStep: 'menu' })
      return
    }
    this.setData({ importStep: 'map' })
    await this._paintCols()
  },

  async onMapField(e: WechatMiniprogram.CustomEvent) {
    const kit = this._kit || (await this.sheetKit())
    if (!kit) return
    const index = Number(e.currentTarget.dataset.index)
    const choices = kit.fieldChoices(kit.staffUser())
    const picked = choices[Number(e.detail.value)]
    if (!picked || !Number.isInteger(index)) return
    const mapping = this._importMapping.slice()
    while (mapping.length <= index) mapping.push('')
    if (picked.id) {
      for (let i = 0; i < mapping.length; i++) {
        if (i !== index && mapping[i] === picked.id) mapping[i] = ''
      }
    }
    mapping[index] = picked.id as ImportField | ''
    this._importMapping = mapping
    await this._paintCols()
  },

  async onImportNext() {
    if (!(await this._paintPreview())) return
  },

  async onToggleImportMode() {
    this._importMode = this._importMode === 'fill' ? 'overwrite' : 'fill'
    await this._paintPreview()
  },

  async onImportCommit() {
    const kit = this._kit || (await this.sheetKit())
    const plan = this._importPlan
    if (!kit || !plan || kit.importBusy()) return
    if (!plan.products.length) {
      wx.showToast({ title: '没有可以写入的商品', icon: 'none' })
      return
    }
    kit.setImportBusy(true)
    wx.showLoading({ title: '写入商品', mask: true })
    void kit.commitImport(plan, kit.staffUser())
      .then((result) => {
        wx.hideLoading()
        if (result.stopped) {
          this.setData({ importStep: 'result', importResult: result.stopped, importCanSend: false })
          return
        }
        this._all = peekCachedCatalog()
        this.apply()
        void this.refreshCategories()
        const lines = [`已写入本机 ${result.written} 个货号`]
        if (result.cloudMiss.length) lines.push(`未同步到云端：${result.cloudMiss.slice(0, 12).join('、')}`)
        else if (result.synced) lines.push('已同步到云端')
        if (result.categoryNote) lines.push(result.categoryNote)
        if (result.skipped.length) {
          lines.push(
            result.skipped
              .slice(0, 8)
              .map((item) => `${item.code}：${item.reason}`)
              .join('\n'),
          )
        }
        this.setData({ importStep: 'result', importResult: lines.join('\n'), importCanSend: false })
      })
      .catch(() => {
        wx.hideLoading()
        this.setData({ importStep: 'result', importResult: '写入中断。已经写入本机的会保留。', importCanSend: false })
      })
      .finally(() => kit.setImportBusy(false))
  },

  async onExportAsk() {
    const kit = await this.sheetKit()
    if (!kit || kit.importBusy()) return
    const rows = kit.exportFiles(this._filtered)
    if (!rows.length) {
      wx.showToast({ title: '暂无商品', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: ['导出 Excel', '导出 CSV'],
      success: (res) => {
        const kind = res.tapIndex === 1 ? 'csv' : 'xlsx'
        this._clearExportFiles()
        try {
          this._exportTables = rows
          this._exportPaths = rows.map((table, index) => kit.writeExportFile(table, kind, index + 1))
          this._exportAt = 0
          this.setData({
            importOn: true,
            importStep: 'result',
            importCanSend: true,
            ...this.exportPreview(),
          })
        } catch (_) {
          this._clearExportFiles()
          wx.showToast({ title: '导出失败', icon: 'none' })
        }
      },
    })
  },

  onSendExport() {
    const path = this._exportPaths[this._exportAt]
    if (!path) return
    const share = (wx as WechatMiniprogram.Wx & {
      shareFileMessage?: (opts: { filePath: string; fail?: () => void; success?: () => void }) => void
    }).shareFileMessage
    if (!share) {
      wx.showToast({ title: '当前微信不能直接发送，请打开文件后再转发', icon: 'none' })
      return
    }
    share({
      filePath: path,
      fail: () => wx.showToast({ title: '发送失败，可以改用打开', icon: 'none' }),
      success: () => {
        this._exportAt += 1
        if (this._exportAt >= this._exportPaths.length) {
          wx.showToast({ title: '已发送', icon: 'success' })
        } else {
          this.setData(this.exportPreview())
          wx.showToast({ title: `还剩 ${this._exportPaths.length - this._exportAt} 个文件`, icon: 'none' })
        }
      },
    })
  },

  onOpenExport() {
    const path = this._exportPaths[Math.min(this._exportAt, this._exportPaths.length - 1)]
    if (!path) return
    const fileType = /\.xlsx$/i.test(path) ? 'xlsx' : ''
    wx.openDocument({
      filePath: path,
      showMenu: true,
      ...(fileType ? { fileType: fileType as 'xlsx' } : {}),
      fail: () => wx.showToast({ title: '打不开这个文件', icon: 'none' }),
    })
  },

  /** 已登录用供应链写入的单件成本。游客没有供应链，用商品里填写的成本。 */
  unitCostOf(p: { code?: string; cost?: number | null }) {
    const code = (p.code || '').trim()
    const supply = this._costByCode[code]
    if (supply != null && Number.isFinite(supply)) return supply
    if (!isGuest() && isLoggedIn()) return null
    if (p.cost == null) return null
    const local = Number(p.cost)
    return Number.isFinite(local) ? local : null
  },

  apply() {
    const q = (this.data.keyword || '').trim().toLowerCase()
    const cat = this.data.category
    let list = this._all.slice()
    if (cat) {
      list = list.filter((p) => (p.category || '').trim() === cat)
    }
    if (q) {
      list = list.filter(
        (p) =>
          (p.code || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q),
      )
    }
    if (this.data.sort === 'salesDesc' || this.data.sort === 'salesAsc') {
      list = list.filter((p) => p.countInStats !== false)
    }
    const sort = this.data.sort
    const sales = this._salesByCode
    list.sort((a, b) => {
      if (sort === 'codeAsc') return (a.code || '').localeCompare(b.code || '', 'zh')
      if (sort === 'codeDesc') return (b.code || '').localeCompare(a.code || '', 'zh')
      if (sort === 'priceAsc') return Number(a.price || 0) - Number(b.price || 0)
      if (sort === 'priceDesc') return Number(b.price || 0) - Number(a.price || 0)
      if (sort === 'salesDesc' || sort === 'salesAsc') {
        const diff = (sales[b.code] || 0) - (sales[a.code] || 0)
        const signed = sort === 'salesAsc' ? -diff : diff
        if (signed) return signed
        return (a.code || '').localeCompare(b.code || '', 'zh')
      }
      const sa = displayStock(a) == null ? -1 : Number(displayStock(a))
      const sb = displayStock(b) == null ? -1 : Number(displayStock(b))
      return sb - sa
    })

    let stockSum = 0
    let amountSum = 0
    const styleGroups = new Set<string>()
    for (const p of list) {
      if (p.countInStats === false) continue
      const code = (p.code || '').trim()
      if (code && code !== '(无货号)') styleGroups.add(this._aliasOf[code] || code)
      const st = displayStock(p) == null ? 0 : Number(displayStock(p))
      if (Number.isFinite(st)) {
        stockSum += st
        const unit = this.unitCostOf(p)
        if (unit != null && Number.isFinite(unit)) amountSum += unit * st
      }
    }

    this._filtered = list
    this._showCount = PAGE_SIZE
    const n = Math.min(this._showCount, list.length)
    this.setData({
      list: list.slice(0, n).map((p) => toRow(p, this._salesByCode, !!this._linked[(p.code || '').trim()])),
      count: list.length,
      hasMore: n < list.length,
      totalStockLabel: String(stockSum),
      styleCountLabel: String(styleGroups.size),
      totalAmountLabel: amountSum.toFixed(2),
    })
    if (this._voiceExport) {
      this._voiceExport = false
      this.onExportAsk()
    }
  },

  loadMoreRows() {
    if (this.data.agentMode || !this.data.hasMore || this._loadingMore) return
    this._loadingMore = true
    this._showCount += PAGE_SIZE
    const list = this._filtered
    const n = Math.min(this._showCount, list.length)
    this.setData(
      {
        list: list.slice(0, n).map((p) => toRow(p, this._salesByCode, !!this._linked[(p.code || '').trim()])),
        hasMore: n < list.length,
      },
      () => {
        this._loadingMore = false
      },
    )
  },

  onKeyword(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
    this.apply()
  },

  onClearKeyword() {
    this.setData({ keyword: '' })
    this.apply()
  },

  onToggleIndexCol() {
    this.setData({ indexFolded: !this.data.indexFolded })
  },

  onViewMode(e: WechatMiniprogram.TouchEvent) {
    const mode = String(e.currentTarget.dataset.mode || '')
    if (mode !== 'table' && mode !== 'thumb') return
    if (mode === this.data.viewMode) return
    this.setData({ viewMode: mode })
    try {
      wx.setStorageSync('tuk_product_view', mode)
    } catch (_) {}
  },

  onSalesSort() {
    const sort: SortKey = this.data.sort === 'salesDesc' ? 'salesAsc' : 'salesDesc'
    this.data.sort = sort
    this.setData({ sort })
    this.apply()
  },

  onPickSort() {
    const labels = sortLabels()
    const keys = Object.keys(labels) as SortKey[]
    wx.showActionSheet({
      itemList: keys.map((k) => labels[k]),
      success: (res) => {
        const sort = keys[res.tapIndex]
        this.setData({ sort, sortLabel: labels[sort] })
        this.apply()
      },
    })
  },

  onPickCategory() {
    const cats = [t('allCats'), ...this.data.categories]
    // ActionSheet 最多 6 项；分类多时分页选
    const show = (offset: number) => {
      const chunk = cats.slice(offset, offset + 5)
      const hasMore = offset + 5 < cats.length
      const items = hasMore ? [...chunk, t('more')] : chunk
      wx.showActionSheet({
        itemList: items,
        success: (res) => {
          if (hasMore && res.tapIndex === items.length - 1) {
            show(offset + 5)
            return
          }
          const name = chunk[res.tapIndex]
          if (!name || name === t('allCats')) {
            this.setData({ category: '', categoryLabel: t('allCats') })
          } else {
            this.setData({ category: name, categoryLabel: name })
          }
          this.apply()
        },
      })
    }
    show(0)
  },

  onManageCategory() {
    if (!this.data.isOwner) return
    wx.navigateTo({ url: '/pages/category-manage/category-manage' })
  },

  onCoverError(e: WechatMiniprogram.ImageError) {
    const code = String(e.currentTarget.dataset.code || '')
    const full = String(e.currentTarget.dataset.full || '')
    const field = String(e.currentTarget.dataset.field || 'coverUrl')
    if (!code || !full) return
    if (this.data.agentMode) {
      const agentShown = (this.data.agentShown || []).map((row) =>
        row.code === code && row.coverUrl !== full ? { ...row, coverUrl: full } : row,
      )
      this.setData({ agentShown })
      return
    }
    const useCard = field === 'coverCardUrl'
    const list = (this.data.list || []).map((row) => {
      if (row.code !== code) return row
      if (useCard) return row.coverCardUrl === full ? row : { ...row, coverCardUrl: full }
      return row.coverUrl === full ? row : { ...row, coverUrl: full }
    })
    this.setData({ list })
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/product-edit/product-edit' })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.isOwner) {
      wx.showToast({ title: catalogEditDeniedText(), icon: 'none' })
      return
    }
    const code = e.currentTarget.dataset.code as string
    wx.navigateTo({
      url: `/pages/product-edit/product-edit?code=${encodeURIComponent(code)}`,
    })
  },

  async onAdjustStock(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.isOwner || this._adjusting) return
    const code = String(e.currentTarget.dataset.code || '')
    const op = String(e.currentTarget.dataset.op || '')
    const delta = op === 'plus' ? 1 : op === 'minus' ? -1 : 0
    if (!code || !delta) return

    const p = this._all.find((x) => x.code === code)
    if (!p) return
    if (isSkuProduct(p)) {
      wx.navigateTo({
        url: `/pages/product-edit/product-edit?code=${encodeURIComponent(code)}`,
      })
      return
    }

    const cur = p.stock == null ? 0 : Number(p.stock)
    const curSafe = Number.isFinite(cur) ? cur : 0
    if (delta < 0 && curSafe <= 0) {
      wx.showToast({ title: '库存不足', icon: 'none' })
      return
    }
    const nextStock = Math.max(0, curSafe + delta)

    this._adjusting = true
    const updated: Product = { ...p, stock: nextStock }
    this._all = this._all.map((x) => (x.code === code ? updated : x))
    this.apply()

    try {
      const r = await patchCatalog([updated])
      if (!r.ok) {
        this._all = this._all.map((x) => (x.code === code ? p : x))
        this.apply()
        wx.showToast({ title: r.error || '调整失败', icon: 'none' })
      }
    } finally {
      this._adjusting = false
    }
  },

  onEditStock(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.isOwner) return
    const code = String(e.currentTarget.dataset.code || '')
    const p = this._all.find((x) => x.code === code)
    if (!p) return
    if (isSkuProduct(p)) {
      wx.navigateTo({
        url: `/pages/product-edit/product-edit?code=${encodeURIComponent(code)}`,
      })
      return
    }
    wx.showModal({
      title: `库存 · ${p.code}`,
      editable: true,
      placeholderText: '库存数量',
      content: p.stock == null ? '0' : String(p.stock),
      success: async (res) => {
        if (!res.confirm) return
        const n = Number((res.content || '').trim())
        if (!Number.isFinite(n) || n < 0) {
          wx.showToast({ title: '请输入有效库存', icon: 'none' })
          return
        }
        const updated: Product = { ...p, stock: n }
        const r = await patchCatalog([updated])
        if (!r.ok) {
          wx.showToast({ title: r.error || '保存失败', icon: 'none' })
          return
        }
        this._all = this._all.map((x) => (x.code === code ? updated : x))
        this.apply()
      },
    })
  },

  onShareAppMessage() {
    return merchantRenewShare(this.data.agentShopName)
  },

  onShareTimeline() {
    const shop = String(this.data.agentShopName || '').trim()
    const page = t('navProducts')
    return { title: shop ? `${shop} ${page}` : page }
  },
})
