import {
  fetchSupplyMaterials,
  fetchSupplyStyles,
  moneyText,
  saveSupplyStyle,
  saveSupplyStyleLinks,
  styleCover,
  styleCoverLarge,
  styleLinkCodes,
  styleLinkText,
  styleMemberCodes,
  type SupplyMaterial,
  type SupplyStyle,
} from '../../../services/supply'
import { i18nState, t } from '../../../services/i18n'

function styleKey(body: {
  fabricMaterialIds: number[]
  metersPerPiece: number
  trimMaterialIds: number[]
  trimQtyPerPiece: number
  processPrice: number
  packagePrice: number
  buyPrice: number
}) {
  return JSON.stringify(body)
}

function materialIds(raw: unknown, one: unknown) {
  const many = Array.isArray(raw) ? raw.map((item) => Number(item) || 0).filter((item) => item > 0) : []
  if (many.length) return Array.from(new Set(many))
  const single = Number(one) || 0
  return single > 0 ? [single] : []
}

function materialLabel(item: { name?: string; color?: string }) {
  const name = String(item.name || '').trim()
  const color = String(item.color || '').trim()
  return color ? `${name} ${color}` : name
}

function pickText(list: Array<{ id: number; label: string }>, ids: number[]) {
  const names = ids.map((id) => {
    const row = list.find((item) => item.id === id)
    return row ? row.label : ''
  }).filter(Boolean)
  return names.length ? names.join('、') : '不选'
}

function priceSum(list: Array<{ id: number; refPrice: number }>, ids: number[]) {
  return ids.reduce((sum, id) => {
    const row = list.find((item) => item.id === id)
    return sum + (row ? Number(row.refPrice) || 0 : 0)
  }, 0)
}

function avgMaterialText(value: unknown) {
  const n = Number(value)
  if (!(n >= 0.005)) return ''
  return `裁剪用料均价 ¥${n.toFixed(2)}`
}

function pickRowsOf(list: Array<{ id: number; label: string }>, ids: number[], query: string) {
  const q = query.trim().toLowerCase()
  const picked = new Set(ids)
  return list
    .filter((item) => item.id > 0)
    .map((item) => ({ id: item.id, label: item.label, on: picked.has(item.id) }))
    .filter((item) => !q || item.label.toLowerCase().indexOf(q) >= 0)
}

function priceModeOf(processPrice: string, packagePrice: string, buyPrice: string) {
  const process = Number(processPrice) || 0
  const pack = Number(packagePrice) || 0
  const buy = Number(buyPrice) || 0
  if (pack > 0 && process <= 0 && buy <= 0) return 'package'
  if (buy > 0 && process <= 0 && pack <= 0) return 'buy'
  if (process > 0) return 'cmt'
  if (pack > 0) return 'package'
  if (buy > 0) return 'buy'
  return 'cmt'
}

Component({
  properties: {
    productCode: { type: String, value: '' },
  },
  data: {
    ...i18nState(),
    productName: '',
    fabrics: [] as Array<SupplyMaterial & { label: string }>,
    trims: [] as Array<SupplyMaterial & { label: string }>,
    fabricIds: [] as number[],
    trimIds: [] as number[],
    fabricText: '不选',
    trimText: '不选',
    pickIds: [] as number[],
    avgMaterialText: '',
    pickOpen: false,
    pickKind: '',
    pickTitle: '',
    pickQuery: '',
    pickRows: [] as Array<{ id: number; label: string; on: boolean }>,
    metersPerPiece: '',
    trimQtyPerPiece: '',
    priceMode: 'cmt',
    processPrice: '',
    packagePrice: '',
    buyPrice: '',
    quoteAmount: '',
    quoteParts: [] as Array<{ label: string; amount: string; kind: string }>,
    coverUrl: '',
    coverFull: '',
    linkSource: '',
    links: [] as string[],
    linkText: '',
    linkCodes: [] as string[],
    linkSide: '',
    linkOn: false,
    linkQuery: '',
    linkShown: [] as Array<{ code: string; on: boolean }>,
    linkMore: false,
    busy: false,
  },
    lifetimes: {
    attached() {
      this.setData(i18nState())
      this._snap = ''
      this._catalog = []
      this._picked = new Set<string>()
      if (this.data.productCode) void this.load(this.data.productCode)
    },
  },
  methods: {
    noop() {},
    async load(code: string) {
      const [styleRes, fabricRes, trimRes] = await Promise.all([
        fetchSupplyStyles(code),
        fetchSupplyMaterials('fabric'),
        fetchSupplyMaterials('trim'),
      ])
      const item = styleRes.data?.item
      const fabrics = (fabricRes.data?.items || []).map((m) => ({ ...m, label: materialLabel(m) }))
      const trims = (trimRes.data?.items || []).map((m) => ({ ...m, label: materialLabel(m) }))
      const fabricIds = materialIds(item?.fabricMaterialIds, item?.fabricMaterialId).filter((id) => fabrics.some((m) => m.id === id))
      const trimIds = materialIds(item?.trimMaterialIds, item?.trimMaterialId).filter((id) => trims.some((m) => m.id === id))
      const processPrice = item ? String(item.processPrice || '') : ''
      const packagePrice = item ? String(item.packagePrice || '') : ''
      const buyPrice = item ? String(item.buyPrice || '') : ''
      const priceMode = priceModeOf(processPrice, packagePrice, buyPrice)
      const metersPerPiece = item ? String(item.metersPerPiece || '') : ''
      const trimQtyPerPiece = item ? String(item.trimQtyPerPiece || '') : ''
      this._snap = styleKey({
        fabricMaterialIds: fabricIds,
        metersPerPiece: Number(metersPerPiece) || 0,
        trimMaterialIds: trimIds,
        trimQtyPerPiece: Number(trimQtyPerPiece) || 0,
        processPrice: priceMode === 'cmt' ? Number(processPrice) || 0 : 0,
        packagePrice: priceMode === 'package' ? Number(packagePrice) || 0 : 0,
        buyPrice: priceMode === 'buy' ? Number(buyPrice) || 0 : 0,
      })
      this.setData({
        productName: item?.productName || '',
        fabrics,
        trims,
        fabricIds,
        trimIds,
        fabricText: pickText(fabrics, fabricIds),
        trimText: pickText(trims, trimIds),
        avgMaterialText: avgMaterialText(item && item.avgMaterialCost),
        metersPerPiece,
        trimQtyPerPiece,
        priceMode,
        processPrice,
        packagePrice,
        buyPrice,
        linkSource: item?.linkSource || '',
        links: item?.links || [],
        linkText: styleLinkText(item),
        linkCodes: styleMemberCodes(item),
        linkSide: styleLinkCodes(item),
        coverUrl: styleCover(item?.coverUrl),
        coverFull: styleCoverLarge(item?.coverUrl),
      }, () => this.refreshQuote())
    },
    refreshQuote() {
      const mode = this.data.priceMode
      const parts: Array<{ label: string; amount: string; kind: string }> = []
      let amount = 0
      if (mode === 'package') {
        amount = Number(this.data.packagePrice) || 0
      } else if (mode === 'buy') {
        amount = Number(this.data.buyPrice) || 0
      } else {
        const fabricAmt = Math.round(((Number(this.data.metersPerPiece) || 0) * priceSum(this.data.fabrics, this.data.fabricIds)) * 100) / 100
        const trimAmt = Math.round(((Number(this.data.trimQtyPerPiece) || 0) * priceSum(this.data.trims, this.data.trimIds)) * 100) / 100
        const process = Number(this.data.processPrice) || 0
        if (fabricAmt > 0) parts.push({ kind: 'fabric', label: '面料', amount: moneyText(fabricAmt) })
        if (trimAmt > 0) parts.push({ kind: 'trim', label: '辅料', amount: moneyText(trimAmt) })
        if (process > 0) parts.push({ kind: 'process', label: '加工费', amount: moneyText(process) })
        amount = Math.round((fabricAmt + trimAmt + process) * 100) / 100
      }
      this.setData({
        quoteAmount: amount > 0 ? moneyText(amount) : '',
        quoteParts: parts.length >= 2 ? parts : [],
      })
    },
    onOpenPick(e: WechatMiniprogram.TouchEvent) {
      const kind = String(e.currentTarget.dataset.kind || '')
      if (kind !== 'fabric' && kind !== 'trim') return
      const list = kind === 'trim' ? this.data.trims : this.data.fabrics
      const pickIds = (kind === 'trim' ? this.data.trimIds : this.data.fabricIds).slice()
      this.data.pickIds = pickIds
      this.setData({
        pickOpen: true,
        pickKind: kind,
        pickTitle: kind === 'trim' ? '辅料' : '面料',
        pickQuery: '',
        pickIds,
        pickRows: pickRowsOf(list, pickIds, ''),
      })
    },
    onPickQuery(e: WechatMiniprogram.Input) {
      const query = e.detail.value
      const list = this.data.pickKind === 'trim' ? this.data.trims : this.data.fabrics
      this.setData({ pickQuery: query, pickRows: pickRowsOf(list, this.data.pickIds, query) })
    },
    onClearPickQuery() {
      const list = this.data.pickKind === 'trim' ? this.data.trims : this.data.fabrics
      this.setData({ pickQuery: '', pickRows: pickRowsOf(list, this.data.pickIds, '') })
    },
    onClosePick() { this.setData({ pickOpen: false, pickIds: [] }) },
    onPickRow(e: WechatMiniprogram.TouchEvent) {
      const id = Number(e.currentTarget.dataset.id) || 0
      if (!id) return
      const pickIds = this.data.pickIds.slice()
      const at = pickIds.indexOf(id)
      if (at >= 0) pickIds.splice(at, 1)
      else pickIds.push(id)
      this.data.pickIds = pickIds
      const list = this.data.pickKind === 'trim' ? this.data.trims : this.data.fabrics
      this.setData({ pickIds, pickRows: pickRowsOf(list, pickIds, this.data.pickQuery) })
    },
    onConfirmPick() {
      const kind = this.data.pickKind
      const pickIds = this.data.pickIds.slice()
      if (kind === 'trim') {
        this.setData({
          trimIds: pickIds,
          trimText: pickText(this.data.trims, pickIds),
          pickOpen: false,
          pickIds: [],
        }, () => this.refreshQuote())
        return
      }
      this.setData({
        fabricIds: pickIds,
        fabricText: pickText(this.data.fabrics, pickIds),
        pickOpen: false,
        pickIds: [],
      }, () => this.refreshQuote())
    },
    onMeters(e: WechatMiniprogram.Input) { this.setData({ metersPerPiece: e.detail.value }, () => this.refreshQuote()) },
    onTrimQty(e: WechatMiniprogram.Input) { this.setData({ trimQtyPerPiece: e.detail.value }, () => this.refreshQuote()) },
    onPriceMode(e: WechatMiniprogram.TouchEvent) {
      const mode = String(e.currentTarget.dataset.mode || 'cmt')
      if (mode !== 'cmt' && mode !== 'package' && mode !== 'buy') return
      this.setData({ priceMode: mode }, () => this.refreshQuote())
    },
    onProcess(e: WechatMiniprogram.Input) { this.setData({ processPrice: e.detail.value }, () => this.refreshQuote()) },
    onPackage(e: WechatMiniprogram.Input) { this.setData({ packagePrice: e.detail.value }, () => this.refreshQuote()) },
    onCoverError() { this.setData({ coverUrl: '', coverFull: '' }) },
    onPreview() {
      const url = this.data.coverFull
      if (!url) return
      wx.previewImage({ current: url, urls: [url] })
    },
    onBuy(e: WechatMiniprogram.Input) { this.setData({ buyPrice: e.detail.value }, () => this.refreshQuote()) },
    async onSave() {
      if (this.data.busy) return
      const fabricIds = this.data.fabricIds.slice()
      const trimIds = this.data.trimIds.slice()
      const body = {
        fabricMaterialIds: fabricIds,
        metersPerPiece: Number(this.data.metersPerPiece) || 0,
        trimMaterialIds: trimIds,
        trimQtyPerPiece: Number(this.data.trimQtyPerPiece) || 0,
        processPrice: this.data.priceMode === 'cmt' ? Number(this.data.processPrice) || 0 : 0,
        packagePrice: this.data.priceMode === 'package' ? Number(this.data.packagePrice) || 0 : 0,
        buyPrice: this.data.priceMode === 'buy' ? Number(this.data.buyPrice) || 0 : 0,
      }
      if (!this._snap) {
        wx.showToast({ title: '正在加载', icon: 'none' })
        return
      }
      if (styleKey(body) === this._snap) {
        wx.showToast({ title: '未修改，不用保存', icon: 'none' })
        return
      }
      this.setData({ busy: true })
      const r = await saveSupplyStyle({
        productCode: this.data.productCode,
        fabricMaterialId: fabricIds[0] || null,
        trimMaterialId: trimIds[0] || null,
        ...body,
      })
      this.setData({ busy: false })
      if (!r.ok) {
        wx.showToast({ title: r.message || '保存失败', icon: 'none' })
        return
      }
      this._snap = styleKey(body)
      wx.showToast({ title: '已保存', icon: 'none' })
      this.triggerEvent('saved')
    },
    onJump(e: WechatMiniprogram.TouchEvent) {
      const to = String(e.currentTarget.dataset.to || '')
      const code = encodeURIComponent(this.data.productCode)
      if (to === 'cost') wx.navigateTo({ url: `/pages/supply/cost?code=${code}` })
      if (to === 'sales') wx.navigateTo({ url: `/pages/analytics/analytics?tab=2&code=${code}` })
    },
    onOpenLink() {
      if (!this.data.productCode) {
        wx.showToast({ title: '正在加载', icon: 'none' })
        return
      }
      void this.openLink()
    },
    async openLink() {
      const r = await fetchSupplyStyles()
      const anchor = this.data.linkSource || this.data.productCode
      const picked = new Set((this.data.links || []).filter((code) => code !== anchor))
      this._catalog = (r.data?.items || [])
        .map((item: SupplyStyle) => item.productCode)
        .filter((code) => code && code !== anchor)
      this._picked = picked
      const query = String(this.data.productCode || '').trim()
      this.data.linkQuery = query
      this.setData({ linkOn: true, linkQuery: query })
      this.showLinks(10)
    },
    showLinks(count: number) {
      const query = this.data.linkQuery.trim().toLowerCase()
      const all = (this._catalog || []).filter((code) => !query || code.toLowerCase().indexOf(query) >= 0)
      this.setData({
        linkShown: all.slice(0, count).map((code) => ({ code, on: !!this._picked && this._picked.has(code) })),
        linkMore: all.length > count,
      })
    },
    onLinkQuery(e: WechatMiniprogram.Input) {
      this.setData({ linkQuery: e.detail.value })
      this.showLinks(10)
    },
    onLinkMore() {
      if (!this.data.linkMore) return
      this.showLinks(this.data.linkShown.length + 10)
    },
    onToggleLink(e: WechatMiniprogram.TouchEvent) {
      const code = String(e.currentTarget.dataset.code || '')
      if (!code || !this._picked) return
      if (this._picked.has(code)) this._picked.delete(code)
      else this._picked.add(code)
      this.showLinks(Math.max(this.data.linkShown.length, 10))
    },
    onCloseLink() {
      this.setData({ linkOn: false })
    },
    async onSaveLinks() {
      if (this.data.busy) return
      const codes = this._picked ? Array.from(this._picked) : []
      this.setData({ busy: true })
      const r = await saveSupplyStyleLinks(this.data.productCode, codes)
      this.setData({ busy: false })
      if (!r.ok) {
        wx.showToast({ title: r.message || t('linkFail'), icon: 'none' })
        return
      }
      const item = r.data?.item
      this.setData({
        linkOn: false,
        linkSource: item?.linkSource || '',
        links: item?.links || [],
        linkText: styleLinkText(item || { productCode: this.data.productCode, links: item?.links || codes }),
        linkCodes: styleMemberCodes(item || { productCode: this.data.productCode, linkSource: item?.linkSource || '', links: item?.links || codes }),
        linkSide: styleLinkCodes(item || { productCode: this.data.productCode, linkSource: item?.linkSource || '', links: item?.links || codes }),
      })
      wx.showToast({ title: t('linkedOk'), icon: 'none' })
      this.triggerEvent('linked')
    },
  },
})
