import {
  fetchSupplyMaterials,
  fetchSupplyStyles,
  filledSupplyPrice,
  saveSupplyStyle,
  type SupplyMaterial,
} from '../../services/supply'

function styleKey(body: {
  fabricMaterialId: number | null
  metersPerPiece: number
  trimMaterialId: number | null
  trimQtyPerPiece: number
  processPrice: number
  packagePrice: number
  buyPrice: number
}) {
  return JSON.stringify(body)
}

function avgMaterialText(value: unknown) {
  const n = Number(value)
  if (!(n >= 0.005)) return ''
  return `裁剪用料均价 ¥${n.toFixed(2)}`
}

function pickRowsOf(list: Array<{ label: string }>, current: number, query: string) {
  const q = query.trim().toLowerCase()
  return list
    .map((item, index) => ({ index, label: item.label, on: index === current }))
    .filter((item) => !q || String(item.label || '').toLowerCase().indexOf(q) >= 0)
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

Page({
  _snap: '',
  data: {
    productCode: '',
    productName: '',
    fabrics: [] as Array<SupplyMaterial & { label: string }>,
    trims: [] as Array<SupplyMaterial & { label: string }>,
    fabricIndex: 0,
    trimIndex: 0,
    fabricText: '不选',
    trimText: '不选',
    avgMaterialText: '',
    pickOpen: false,
    pickKind: '',
    pickTitle: '',
    pickQuery: '',
    pickRows: [] as Array<{ index: number; label: string; on: boolean }>,
    metersPerPiece: '',
    trimQtyPerPiece: '',
    priceMode: 'cmt',
    processPrice: '',
    packagePrice: '',
    buyPrice: '',
    stdText: '',
    busy: false,
  },

  onLoad(query: Record<string, string>) {
    const code = decodeURIComponent(query.code || '')
    this.setData({ productCode: code })
    void this.load(code)
  },

  async load(code: string) {
    const [styleRes, fabricRes, trimRes] = await Promise.all([
      fetchSupplyStyles(code),
      fetchSupplyMaterials('fabric'),
      fetchSupplyMaterials('trim'),
    ])
    const item = styleRes.data?.item
    const fabrics = [{ id: 0, name: '不选', unit: '', refPrice: 0, kind: 'fabric', uid: '', color: '', spec: '', disabled: false, label: '不选' } as SupplyMaterial & { label: string }].concat(
      (fabricRes.data?.items || []).map((m) => ({ ...m, label: m.name })),
    )
    const trims = [{ id: 0, name: '不选', unit: '', refPrice: 0, kind: 'trim', uid: '', color: '', spec: '', disabled: false, label: '不选' } as SupplyMaterial & { label: string }].concat(
      (trimRes.data?.items || []).map((m) => ({ ...m, label: m.name })),
    )
    const fabricIndex = Math.max(0, fabrics.findIndex((m) => m.id === (item?.fabricMaterialId || 0)))
    const trimIndex = Math.max(0, trims.findIndex((m) => m.id === (item?.trimMaterialId || 0)))
    const processPrice = item ? String(item.processPrice || '') : ''
    const packagePrice = item ? String(item.packagePrice || '') : ''
    const buyPrice = item ? String(item.buyPrice || '') : ''
    const priceMode = priceModeOf(processPrice, packagePrice, buyPrice)
    const metersPerPiece = item ? String(item.metersPerPiece || '') : ''
    const trimQtyPerPiece = item ? String(item.trimQtyPerPiece || '') : ''
    this._snap = styleKey({
      fabricMaterialId: fabrics[fabricIndex] && fabrics[fabricIndex].id ? fabrics[fabricIndex].id : null,
      metersPerPiece: Number(metersPerPiece) || 0,
      trimMaterialId: trims[trimIndex] && trims[trimIndex].id ? trims[trimIndex].id : null,
      trimQtyPerPiece: Number(trimQtyPerPiece) || 0,
      processPrice: priceMode === 'cmt' ? Number(processPrice) || 0 : 0,
      packagePrice: priceMode === 'package' ? Number(packagePrice) || 0 : 0,
      buyPrice: priceMode === 'buy' ? Number(buyPrice) || 0 : 0,
    })
    this.setData({
      productName: item?.productName || '',
      fabrics,
      trims,
      fabricIndex,
      trimIndex,
      fabricText: (fabrics[fabricIndex] && fabrics[fabricIndex].label) || '不选',
      trimText: (trims[trimIndex] && trims[trimIndex].label) || '不选',
      avgMaterialText: avgMaterialText(item && item.avgMaterialCost),
      metersPerPiece,
      trimQtyPerPiece,
      priceMode,
      processPrice,
      packagePrice,
      buyPrice,
      stdText: filledSupplyPrice(item),
    })
  },

  onOpenPick(e: WechatMiniprogram.TouchEvent) {
    const kind = String(e.currentTarget.dataset.kind || '')
    if (kind !== 'fabric' && kind !== 'trim') return
    const list = kind === 'trim' ? this.data.trims : this.data.fabrics
    const current = kind === 'trim' ? this.data.trimIndex : this.data.fabricIndex
    this.setData({
      pickOpen: true,
      pickKind: kind,
      pickTitle: kind === 'trim' ? '辅料' : '面料',
      pickQuery: '',
      pickRows: pickRowsOf(list, current, ''),
    })
  },
  onPickQuery(e: WechatMiniprogram.Input) {
    const query = e.detail.value
    const kind = this.data.pickKind
    const list = kind === 'trim' ? this.data.trims : this.data.fabrics
    const current = kind === 'trim' ? this.data.trimIndex : this.data.fabricIndex
    this.setData({ pickQuery: query, pickRows: pickRowsOf(list, current, query) })
  },
  onClearPickQuery() {
    const kind = this.data.pickKind
    const list = kind === 'trim' ? this.data.trims : this.data.fabrics
    const current = kind === 'trim' ? this.data.trimIndex : this.data.fabricIndex
    this.setData({ pickQuery: '', pickRows: pickRowsOf(list, current, '') })
  },
  onClosePick() { this.setData({ pickOpen: false }) },
  onPickRow(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const kind = this.data.pickKind
    const list = kind === 'trim' ? this.data.trims : this.data.fabrics
    const item = list[index]
    if (!item) return
    if (kind === 'trim') this.setData({ trimIndex: index, trimText: item.label, pickOpen: false })
    else this.setData({ fabricIndex: index, fabricText: item.label, pickOpen: false })
  },
  onMeters(e: WechatMiniprogram.Input) { this.setData({ metersPerPiece: e.detail.value }) },
  onTrimQty(e: WechatMiniprogram.Input) { this.setData({ trimQtyPerPiece: e.detail.value }) },
  onPriceMode(e: WechatMiniprogram.TouchEvent) {
    const mode = String(e.currentTarget.dataset.mode || 'cmt')
    if (mode !== 'cmt' && mode !== 'package' && mode !== 'buy') return
    this.setData({ priceMode: mode })
  },
  onProcess(e: WechatMiniprogram.Input) { this.setData({ processPrice: e.detail.value }) },
  onPackage(e: WechatMiniprogram.Input) { this.setData({ packagePrice: e.detail.value }) },
  onBuy(e: WechatMiniprogram.Input) { this.setData({ buyPrice: e.detail.value }) },

  async onSave() {
    if (this.data.busy) return
    const fabric = this.data.fabrics[this.data.fabricIndex]
    const trim = this.data.trims[this.data.trimIndex]
    const body = {
      fabricMaterialId: fabric && fabric.id ? fabric.id : null,
      metersPerPiece: Number(this.data.metersPerPiece) || 0,
      trimMaterialId: trim && trim.id ? trim.id : null,
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
      ...body,
    })
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || '保存失败', icon: 'none' })
      return
    }
    this.setData({ stdText: filledSupplyPrice(r.data?.item) })
    this._snap = styleKey(body)
    wx.showToast({ title: '已保存', icon: 'none' })
  },
})
