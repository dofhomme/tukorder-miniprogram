import { archiveNumber, fetchSupplyMaterials, fetchSupplyStyles, groupSupplyStyles, moneyText, styleCover, styleCoverLarge, styleLinkCodes, styleLinkText, styleParts, type SupplyMaterial, type SupplyStyle } from '../../services/supply'

const PAGE = 10

Page({
  _styles: [] as SupplyStyle[],
  _fabrics: [] as SupplyMaterial[],
  _trims: [] as SupplyMaterial[],
  _openCode: '',
  _back: false,

  data: {
    tab: 'style',
    loaded: false,
    styles: [] as SupplyStyle[],
    fabrics: [] as SupplyMaterial[],
    trims: [] as SupplyMaterial[],
    styleMore: false,
    fabricMore: false,
    trimMore: false,
    styleOn: false,
    styleCode: '',
    materialOn: false,
    materialId: 0,
    materialKind: 'fabric',
    q: '',
  },

  onShow() {
    void this.load()
  },

  onLoad(query: Record<string, string>) {
    this._openCode = decodeURIComponent(query.code || '')
    this._back = query.back === '1'
  },

  noop() {},

  leaveIfBack() {
    if (!this._back) return false
    wx.navigateBack()
    return true
  },

  show(kind: 'style' | 'fabric' | 'trim', count: number) {
    const rows = this.visible(kind)
    if (kind === 'style') {
      this.setData({
        styles: (rows as SupplyStyle[]).slice(0, count),
        styleMore: rows.length > count,
      })
      return
    }
    if (kind === 'fabric') {
      this.setData({
        fabrics: (rows as SupplyMaterial[]).slice(0, count),
        fabricMore: rows.length > count,
      })
      return
    }
    this.setData({
      trims: (rows as SupplyMaterial[]).slice(0, count),
      trimMore: rows.length > count,
    })
  },

  visible(kind: 'style' | 'fabric' | 'trim') {
    const q = String(this.data.q || '').trim().toLowerCase()
    if (kind === 'style') {
      if (!q) return this._styles
      return this._styles.filter((item) => {
        const text = (item.memberCodes || [item.productCode]).join(' ').toLowerCase()
        return text.indexOf(q) >= 0
      })
    }
    const list = kind === 'fabric' ? this._fabrics : this._trims
    if (!q) return list
    return list.filter((item) => String(item.name || '').toLowerCase().indexOf(q) >= 0)
  },

  onFind(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value }, () => {
      this.show('style', PAGE)
      this.show('fabric', PAGE)
      this.show('trim', PAGE)
    })
  },

  async load(styleCount?: number) {
    const [styles, fabrics, trims] = await Promise.all([
      fetchSupplyStyles(),
      fetchSupplyMaterials('fabric'),
      fetchSupplyMaterials('trim'),
    ])
    const fabricItems = fabrics.data?.items || []
    const trimItems = trims.data?.items || []
    this._styles = groupSupplyStyles((styles.data?.items || []).map((item) => ({
      ...item,
      priceAmount: moneyText(archiveNumber(item)),
      parts: styleParts(item, fabricItems, trimItems),
      linkText: styleLinkText(item),
      linkSide: styleLinkCodes(item),
      coverUrl: styleCover(item.coverUrl),
      coverFull: styleCoverLarge(item.coverUrl),
    })))
    this._fabrics = fabricItems
    this._trims = trimItems
    this.setData({ loaded: true })
    this.show('style', styleCount || PAGE)
    this.show('fabric', PAGE)
    this.show('trim', PAGE)
    if (this._openCode) {
      const code = this._openCode
      this._openCode = ''
      this.setData({ styleOn: true, styleCode: code })
    }
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: String(e.currentTarget.dataset.tab || 'style') })
  },

  onMore() {
    const tab = this.data.tab
    if (tab === 'style' && this.data.styleMore) this.show('style', this.data.styles.length + PAGE)
    if (tab === 'fabric' && this.data.fabricMore) this.show('fabric', this.data.fabrics.length + PAGE)
    if (tab === 'trim' && this.data.trimMore) this.show('trim', this.data.trims.length + PAGE)
  },

  onCoverError(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    this._styles = this._styles.map((item) => (item.productCode === code ? { ...item, coverUrl: '', coverFull: '' } : item))
    this.show('style', Math.max(this.data.styles.length, PAGE))
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.full || '')
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  onAddStyle() {
    wx.navigateTo({ url: '/pages/product-edit/product-edit' })
  },

  onManageProducts() {
    wx.switchTab({ url: '/pages/products/products' })
  },

  onStyle(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    this.setData({ styleOn: true, styleCode: code })
  },

  onCloseStyle() {
    this.setData({ styleOn: false, styleCode: '' })
    this.leaveIfBack()
  },

  onStyleLinked() {
    void this.load(Math.max(this.data.styles.length, PAGE))
  },

  onStyleSaved() {
    this.setData({ styleOn: false, styleCode: '' })
    if (this.leaveIfBack()) return
    void this.load()
  },

  onMaterial(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const kind = String(e.currentTarget.dataset.kind || 'fabric')
    this.setData({ materialOn: true, materialId: id, materialKind: kind === 'trim' ? 'trim' : 'fabric' })
  },

  onNewMaterial() {
    const kind = this.data.tab === 'trim' ? 'trim' : 'fabric'
    this.setData({ materialOn: true, materialId: 0, materialKind: kind })
  },

  onCloseMaterial() {
    this.setData({ materialOn: false })
  },

  onMaterialSaved() {
    this.setData({ materialOn: false })
    void this.load()
  },
})
