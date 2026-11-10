import { bindPageI18n, i18nState } from '../../services/i18n'
import { fetchTeamStats } from '../../services/team'
import { applySupplyCalcCost, archiveNumber, decorateSupplyCostStyles, deleteSupplyCostCalc, fetchSupplyCostCalcs, fetchSupplyDocs, fetchSupplyMaterials, fetchSupplyParties, fetchSupplyStyles, groupSupplyStyles, moneyText, saveSupplyCostCalc, styleCover, styleCoverLarge, styleLinkCodes, styleLinkText, styleMemberCodes, styleParts, supplyStyleHasCost, type SupplyMaterial, type SupplyParty, type SupplyStyle } from '../../services/supply'

const PAGE = 10

function qtyText(value: unknown) {
  const n = Number(value) || 0
  if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n))
  return String(Math.round(n * 1000) / 1000)
}

function yuan(value: unknown) {
  return (Number(value) || 0).toFixed(2)
}

function idList(raw: unknown, one: unknown) {
  const many = Array.isArray(raw) ? raw.map((item) => Number(item) || 0).filter(Boolean) : []
  if (many.length) return many
  const single = Number(one) || 0
  return single ? [single] : []
}

function materialName(list: SupplyMaterial[], ids: number[]) {
  return ids.map((id) => {
    const row = list.find((item) => item.id === id)
    if (!row) return ''
    return `${row.name}${row.color ? ' ' + row.color : ''}`
  }).filter(Boolean).join('、')
}

function styleFacts(item: SupplyStyle, fabrics: SupplyMaterial[], trims: SupplyMaterial[]) {
  const facts: Array<{ k: string; v: string }> = []
  const fabricName = materialName(fabrics, idList(item.fabricMaterialIds, item.fabricMaterialId))
  const trimName = materialName(trims, idList(item.trimMaterialIds, item.trimMaterialId))
  if (fabricName) facts.push({ k: '面料', v: fabricName })
  if (Number(item.metersPerPiece) > 0) facts.push({ k: '单件用料', v: `${qtyText(item.metersPerPiece)} 米` })
  if (trimName) facts.push({ k: '辅料', v: trimName })
  if (Number(item.trimQtyPerPiece) > 0) facts.push({ k: '辅料用量', v: qtyText(item.trimQtyPerPiece) })
  if (Number(item.processPrice) > 0) facts.push({ k: '加工单价', v: `¥${yuan(item.processPrice)}` })
  if (Number(item.packagePrice) > 0) facts.push({ k: '包工包料', v: `¥${yuan(item.packagePrice)}` })
  if (Number(item.buyPrice) > 0) facts.push({ k: '外采进货价', v: `¥${yuan(item.buyPrice)}` })
  return facts
}

function calcRow(item: Record<string, unknown>) {
  const basisQty = Number(item.basisQty) || 0
  return {
    ...item,
    unitText: yuan(item.unitCost),
    archiveText: Number(item.archivePrice) > 0 ? yuan(item.archivePrice) : '',
    fabricText: yuan(item.fabricAmount),
    trimText: yuan(item.trimAmount),
    processText: Number(item.processAmount) > 0 ? yuan(item.processAmount) : '',
    basisQty: Math.abs(basisQty - Math.round(basisQty)) < 0.001 ? String(Math.round(basisQty)) : qtyText(basisQty),
    when: String(item.createdAt || ''),
  }
}

function emptySale() {
  return { amount: '0.00', qty: '0', refundAmount: '0.00', refundQty: '0' }
}

type CostPick = {
  key: string
  name: string
  meters: string
  bolts: string
  qty: string
  unit: string
  amount: string
  amountNum: number
}

function materialBook(items: SupplyMaterial[]) {
  const names = new Map<number, string>()
  const units = new Map<number, string>()
  items.forEach((item) => {
    names.set(item.id, `${item.name}${item.color ? ' ' + item.color : ''}`)
    units.set(item.id, item.unit || '')
  })
  return { names, units }
}

function costPicks(
  items: Array<Record<string, unknown>>,
  book: { names: Map<number, string>; units: Map<number, string> },
  kind: 'fabric' | 'trim',
) {
  const rows: CostPick[] = []
  items.forEach((doc) => {
    const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
    lines.forEach((line, index) => {
      const materialId = Number(line.materialId) || 0
      rows.push({
        key: `${doc.id}-${line.id || index}`,
        name: book.names.get(materialId) || (kind === 'fabric' ? '面料' : '辅料'),
        meters: qtyText(line.meters),
        bolts: qtyText(line.bolts),
        qty: qtyText(line.qty),
        unit: book.units.get(materialId) || (kind === 'trim' ? '个' : ''),
        amount: yuan(line.amount),
        amountNum: Number(line.amount) || 0,
      })
    })
  })
  return rows
}

function saleOf(row: { amountLabel?: string; amount?: number; qty?: number; refundAmountLabel?: string; refundQty?: number } | null | undefined) {
  if (!row) return emptySale()
  return {
    amount: row.amountLabel || yuan(row.amount),
    qty: qtyText(row.qty),
    refundAmount: row.refundAmountLabel || '0.00',
    refundQty: qtyText(row.refundQty),
  }
}

Page({
  _styles: [] as SupplyStyle[],
  _cutCosts: [] as Array<Record<string, unknown>>,
  _factories: [] as SupplyParty[],
  _calcStyles: [] as string[],
  _askedProcess: false,
  data: {
    ...i18nState(),
    styles: [] as SupplyStyle[],
    code: '',
    q: '',
    loaded: false,
    more: false,
    sheetOn: false,
    sheetCode: '',
    sheetCodes: [] as string[],
    sheetLinked: false,
    sheetStyles: [] as SupplyStyle[],
    view: 'style',
    facts: [] as Array<{ k: string; v: string }>,
    parts: [] as Array<{ label: string; amount: string; kind: string }>,
    sale: emptySale(),
    calcs: [] as Array<Record<string, unknown>>,
    calcAverage: '',
    calcArchive: '',
    calcCount: 0,
    sheetCalcs: [] as Array<Record<string, unknown>>,
    sheetAverage: '',
    sheetArchive: '',
    sheetCount: 0,
    calcOn: false,
    calcReady: false,
    cutCosts: [] as Array<Record<string, unknown>>,
    calcCode: '',
    calcCodes: [] as string[],
    calcLinked: false,
    calcQuery: '',
    calcShown: [] as string[],
    calcMore: false,
    calcFactories: [] as SupplyParty[],
    calcFactoryId: 0,
    calcFactoryName: '',
    fabricAmount: '',
    trimAmount: '',
    fabricPicks: [] as CostPick[],
    trimPicks: [] as CostPick[],
    fabricPick: '',
    trimPick: '',
    cutQty: '',
    deliveryQty: '',
    basis: 'cut',
    calcBusy: false,
  },

  onLoad(query: Record<string, string>) {
    this.data.code = decodeURIComponent(query.code || '')
    this.setData({ code: this.data.code })
  },

  onShow() {
    bindPageI18n(this)
    void this.load()
    if (this.data.calcOn) void this.loadCutCosts()
  },

  noop() {},

  async load() {
    const code = this.data.code
    const [styles, fabrics, trims, calcs, saleRes] = await Promise.all([
      fetchSupplyStyles(code || undefined),
      code ? fetchSupplyMaterials('fabric') : Promise.resolve(null),
      code ? fetchSupplyMaterials('trim') : Promise.resolve(null),
      fetchSupplyCostCalcs(code || undefined),
      code ? fetchTeamStats({ tab: 'codes', range: 'all', code }) : Promise.resolve(null),
    ])
    const styleItems = this.data.code
      ? (styles.data?.item ? [styles.data.item] : [])
      : (styles.data?.items || [])
    const detailCalcs = (calcs.data?.items || []).map((row) => calcRow(row))
    const detailAverage = calcs.data && calcs.data.average != null ? yuan(calcs.data.average) : ''
    if (code) {
      this._styles = groupSupplyStyles(styleItems.map((item) => {
        const avg = { average: calcs.data?.average, count: calcs.data?.count || 0 }
        return {
          ...item,
          priceAmount: moneyText(archiveNumber(item)),
          linkText: styleLinkText(item),
          linkSide: styleLinkCodes(item),
          coverUrl: styleCover(item.coverUrl),
          coverFull: styleCoverLarge(item.coverUrl),
          calcAverage: avg.average != null ? yuan(avg.average) : '',
          calcCount: avg.count || 0,
        }
      }))
    } else {
      this._styles = decorateSupplyCostStyles(styleItems, calcs.data?.averages || [])
    }
    const matched = this.matchedStyles()
    const style = this.data.code ? this._styles[0] : undefined
    const fabricItems = fabrics && fabrics.data ? fabrics.data.items || [] : []
    const trimItems = trims && trims.data ? trims.data.items || [] : []
    this.setData({
      loaded: true,
      styles: this.data.code ? this._styles : matched.slice(0, PAGE),
      more: this.data.code ? false : matched.length > PAGE,
      facts: style ? styleFacts(style, fabricItems, trimItems) : [],
      parts: style ? styleParts(style, fabricItems, trimItems) : [],
      sale: this.data.code ? saleOf(saleRes && saleRes.data ? saleRes.data.focusSale : null) : emptySale(),
      calcs: this.data.code ? detailCalcs : [],
      calcAverage: this.data.code ? detailAverage : '',
      calcArchive: this.data.code && Number(calcs.data?.archivePrice) > 0 ? yuan(calcs.data?.archivePrice) : '',
      calcCount: this.data.code ? detailCalcs.length : 0,
    })
  },

  onMore() {
    if (!this.data.more || this.data.code) return
    const all = this.matchedStyles()
    const n = this.data.styles.length + PAGE
    this.setData({
      styles: all.slice(0, n),
      more: all.length > n,
    })
  },

  matchedStyles() {
    const q = String(this.data.q || '').trim().toLowerCase()
    const rows = this._styles.filter((item) => supplyStyleHasCost(item))
    if (!q) return rows
    return rows.filter((item) => {
      const text = [item.productName, ...(item.memberCodes || [item.productCode])].join(' ').toLowerCase()
      return text.indexOf(q) >= 0
    })
  },

  rememberAverage(code: string, average: string, count: number) {
    this._styles = this._styles.map((item) => {
      const codes = item.memberCodes && item.memberCodes.length ? item.memberCodes : [item.productCode]
      if (codes.indexOf(code) < 0) return item
      return { ...item, calcAverage: average, calcCount: count }
    })
    const all = this.matchedStyles()
    const n = Math.max(this.data.styles.length, PAGE)
    this.setData({
      styles: all.slice(0, n),
      more: all.length > n,
    })
  },

  onFind(e: WechatMiniprogram.Input) {
    this.data.q = String(e.detail.value || '')
    const all = this.matchedStyles()
    this.setData({
      q: this.data.q,
      styles: all.slice(0, PAGE),
      more: all.length > PAGE,
    })
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code || this.data.code) return
    void this.openSheet(code)
  },

  onCloseSheet() {
    this.setData({ sheetOn: false, sheetCode: '', sheetCodes: [], sheetLinked: false })
  },

  onView(e: WechatMiniprogram.TouchEvent) {
    const view = String(e.currentTarget.dataset.view || 'style')
    if (view === this.data.view) return
    this.setData({ view })
  },

  async openSheet(code: string) {
    const [styles, fabrics, trims, calcs, saleRes] = await Promise.all([
      fetchSupplyStyles(code),
      fetchSupplyMaterials('fabric'),
      fetchSupplyMaterials('trim'),
      fetchSupplyCostCalcs(code),
      fetchTeamStats({ tab: 'codes', range: 'all', code }),
    ])
    const styleItems = styles.data?.item ? [styles.data.item] : []
    const fabricItems = fabrics.data?.items || []
    const trimItems = trims.data?.items || []
    const sheetCalcs = (calcs.data?.items || []).map((row) => calcRow(row))
    const shown = styleItems.map((item) => ({
      ...item,
      priceAmount: moneyText(archiveNumber(item)),
      linkText: styleLinkText(item),
      linkSide: styleLinkCodes(item),
      coverUrl: styleCover(item.coverUrl),
      coverFull: styleCoverLarge(item.coverUrl),
      calcAverage: calcs.data && calcs.data.average != null ? yuan(calcs.data.average) : '',
      calcCount: sheetCalcs.length,
    }))
    const sheetCodes = styleMemberCodes(shown[0])
    this.setData({
      sheetOn: true,
      sheetLinked: sheetCodes.length > 1,
      sheetCode: code,
      sheetCodes,
      sheetStyles: shown,
      facts: shown[0] ? styleFacts(shown[0], fabricItems, trimItems) : [],
      parts: shown[0] ? styleParts(shown[0], fabricItems, trimItems) : [],
      sale: saleOf(saleRes.data ? saleRes.data.focusSale : null),
      sheetCalcs,
      sheetAverage: calcs.data && calcs.data.average != null ? yuan(calcs.data.average) : '',
      sheetArchive: Number(calcs.data?.archivePrice) > 0 ? yuan(calcs.data?.archivePrice) : '',
      sheetCount: sheetCalcs.length,
    })
  },

  onCoverError(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    const drop = (item: SupplyStyle) => (item.productCode === code ? { ...item, coverUrl: '', coverFull: '' } : item)
    this._styles = this._styles.map(drop)
    this.setData({
      styles: this.data.styles.map(drop),
      sheetStyles: this.data.sheetStyles.map(drop),
    })
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.full || '')
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  async onApplyCalc() {
    const code = (this.data.sheetOn ? this.data.sheetCode : this.data.code).trim()
    if (!code) return
    const r = await applySupplyCalcCost(code)
    wx.showToast({ title: r.ok ? `已写入成本 ${r.data?.unitCost}` : (r.message || '写入失败'), icon: 'none' })
  },

  showCalcStyles(count: number) {
    const query = (this.data.calcQuery || '').trim().toLowerCase()
    const all = (this._calcStyles || []).filter((code) => !query || code.toLowerCase().indexOf(query) >= 0)
    this.setData({
      calcShown: all.slice(0, count),
      calcMore: all.length > count,
    })
  },

  async onOpenCalc() {
    const code = this.data.sheetOn ? this.data.sheetCode : this.data.code
    this._askedProcess = false
    this.data.calcOn = true
    this.setData({
      calcOn: true,
      calcReady: false,
      calcCode: code,
      calcCodes: this.data.sheetOn && this.data.sheetCodes.length ? this.data.sheetCodes.slice() : (code ? [code] : []),
      calcQuery: '',
      cutCosts: [],
    })
    await this.loadCutCosts()
  },

  async loadCutCosts() {
    const [cuts, fabrics, trims, styles, parties] = await Promise.all([
      fetchSupplyDocs(0, 'cut', { limit: 100 }),
      fetchSupplyDocs(0, 'fabric_in', { limit: 100 }),
      fetchSupplyDocs(0, 'trim_in', { limit: 100 }),
      fetchSupplyStyles(),
      fetchSupplyParties('factory'),
    ])
    if (!this.data.calcOn) return
    const amountOf = (rows: Array<Record<string, unknown>>) => {
      const book = new Map<number, number>()
      rows.forEach((doc) => {
        const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
        const amount = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
        book.set(Number(doc.id) || 0, amount)
      })
      return book
    }
    const fabricAmount = amountOf(fabrics.data?.items || [])
    const trimAmount = amountOf(trims.data?.items || [])
    const processOf = new Map((styles.data?.items || []).map((item) => [item.productCode.toLowerCase(), Number(item.processPrice) || 0]))
    const linked = new Set(
      (styles.data?.items || [])
        .filter((item) => styleLinkText(item))
        .map((item) => String(item.productCode || '').trim().toLowerCase())
        .filter(Boolean),
    )
    const factoryName = new Map((parties.data?.items || []).map((item) => [item.id, item.name]))
    this._cutCosts = (cuts.data?.items || []).map((doc) => {
      const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
      const line = lines[0] || {}
      const qty = lines.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
      const code = String(line.productCode || '')
      const fabricIds = idList(doc.fabricDocIds, doc.fabricDocId)
      const trimIds = idList(doc.trimDocIds, doc.trimDocId)
      const fabric = fabricIds.reduce((sum, item) => sum + (fabricAmount.get(item) || 0), 0)
      const trim = trimIds.reduce((sum, item) => sum + (trimAmount.get(item) || 0), 0)
      const process = processOf.get(code.toLowerCase()) || 0
      const missing = [
        code ? '' : '没有货号',
        qty > 0 ? '' : '没有裁剪件数',
        fabricIds.length ? '' : '还没绑面料',
        trimIds.length ? '' : '还没绑辅料',
      ].filter(Boolean).join('，')
      const unit = qty > 0 ? (fabric + trim) / qty + process : 0
      return {
        id: Number(doc.id) || 0,
        productCode: code || '未填货号',
        linked: !!code && linked.has(code.toLowerCase()),
        factoryName: factoryName.get(Number(doc.partyId) || 0) || '',
        fabricText: yuan(fabric),
        trimText: yuan(trim),
        process,
        processText: yuan(process),
        qtyText: qtyText(qty),
        unitText: yuan(unit),
        missing,
      }
    })
    this.paintCuts(PAGE)
    this.askMissingProcess()
  },

  askMissingProcess() {
    if (this._askedProcess || !this.data.calcOn) return
    const code = String(this.data.calcCode || '').trim()
    if (!code) return
    const row = (this._cutCosts || []).find((item) => String(item.productCode || '').toLowerCase() === code.toLowerCase())
    if (!row || Number(row.process) > 0) return
    this._askedProcess = true
    this.promptProcess(code)
  },

  promptProcess(code: string) {
    const name = String(code || '').trim()
    if (!name || name === '未填货号') {
      wx.showToast({ title: '这款还没有货号', icon: 'none' })
      return
    }
    wx.showModal({
      title: '加工费',
      content: '这款还没有填写加工费，是否去增加？',
      confirmText: '去填写',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        wx.navigateTo({ url: `/pages/supply/styles?code=${encodeURIComponent(name)}&back=1` })
      },
    })
  },

  paintCuts(count: number) {
    const codes = (this.data.calcCodes || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    const q = String(this.data.calcQuery || '').trim().toLowerCase()
    const all = (this._cutCosts || []).filter((item) => {
      const name = String(item.productCode || '').toLowerCase()
      if (codes.length && codes.indexOf(name) < 0) return false
      if (q && name.indexOf(q) < 0 && String(item.factoryName || '').toLowerCase().indexOf(q) < 0) return false
      return true
    })
    this.setData({
      calcReady: true,
      calcLinked: codes.length > 0 && all.some((item) => item.linked && codes.indexOf(String(item.productCode || '').toLowerCase()) >= 0),
      cutCosts: all.slice(0, count),
      calcMore: all.length > count,
    })
  },

  async loadCalcPicks() {
    const [fabrics, trims, fabricDocs, trimDocs] = await Promise.all([
      fetchSupplyMaterials('fabric'),
      fetchSupplyMaterials('trim'),
      fetchSupplyDocs(0, 'fabric_in', { limit: 20 }),
      fetchSupplyDocs(0, 'trim_in', { limit: 20 }),
    ])
    if (!this.data.calcOn) return
    this.setData({
      fabricPicks: costPicks(fabricDocs.data?.items || [], materialBook(fabrics.data?.items || []), 'fabric'),
      trimPicks: costPicks(trimDocs.data?.items || [], materialBook(trims.data?.items || []), 'trim'),
    })
  },

  onCloseCalc() {
    this.setData({ calcOn: false })
  },

  onCalcQuery(e: WechatMiniprogram.Input) {
    this.data.calcQuery = String(e.detail.value || '')
    this.setData({ calcQuery: this.data.calcQuery })
    this.paintCuts(PAGE)
  },

  onCalcMore() {
    if (!this.data.calcMore) return
    this.paintCuts(this.data.cutCosts.length + PAGE)
  },

  onClearStyle() {
    this.setData({ calcCode: '', calcCodes: [], calcQuery: '' })
    this.paintCuts(PAGE)
  },

  onGuideStyle() {
    const code = String(this.data.calcCode || this.data.sheetCode || this.data.code || '').trim()
    if (!code) {
      wx.navigateTo({ url: '/pages/supply/styles' })
      return
    }
    wx.navigateTo({ url: `/pages/supply/styles?code=${encodeURIComponent(code)}&back=1` })
  },

  onGuideCut() {
    wx.navigateTo({ url: '/pages/supply/parties?role=factory' })
  },

  async onUseCut(e: WechatMiniprogram.TouchEvent) {
    if (this.data.calcBusy) return
    const id = Number(e.currentTarget.dataset.id) || 0
    const row = (this._cutCosts || []).find((item) => Number(item.id) === id)
    if (!row) return
    if (!(Number(row.process) > 0)) {
      this.promptProcess(String(row.productCode || this.data.calcCode || ''))
      return
    }
    if (row.missing) {
      wx.showToast({ title: String(row.missing), icon: 'none' })
      return
    }
    this.setData({ calcBusy: true })
    const r = await saveSupplyCostCalc({ cutDocId: id, productCode: String(row.productCode || '') })
    this.setData({ calcBusy: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || '计算失败', icon: 'none' })
      return
    }
    this.setData({ calcOn: false })
    wx.showToast({ title: '已写入成本', icon: 'success' })
    const code = String(row.productCode || '')
    if (this.data.code) {
      void this.load()
      return
    }
    const average = r.data && r.data.average != null ? yuan(r.data.average) : ''
    const count = (r.data && r.data.count) || 0
    this.rememberAverage(code, average, count)
    void this.openSheet(code)
  },

  onPickStyle(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    this.setData({ calcCode: code })
  },

  onPickFactory(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id) || 0
    const name = String(e.currentTarget.dataset.name || '')
    this.setData({ calcFactoryId: id, calcFactoryName: name })
  },

  onPickFabric(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    if (!key || key === this.data.fabricPick) {
      this.setData({ fabricPick: '', fabricAmount: '' })
      return
    }
    const row = this.data.fabricPicks.find((item) => item.key === key)
    this.setData({ fabricPick: key, fabricAmount: row ? String(row.amountNum) : '' })
  },

  onPickTrim(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    if (!key || key === this.data.trimPick) {
      this.setData({ trimPick: '', trimAmount: '' })
      return
    }
    const row = this.data.trimPicks.find((item) => item.key === key)
    this.setData({ trimPick: key, trimAmount: row ? String(row.amountNum) : '' })
  },

  onCalcInput(e: WechatMiniprogram.Input) {
    const key = String(e.currentTarget.dataset.key || '')
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  onBasis(e: WechatMiniprogram.TouchEvent) {
    const basis = String(e.currentTarget.dataset.basis || 'cut')
    if (basis !== 'cut' && basis !== 'delivery') return
    this.setData({ basis })
  },

  async onSubmitCalc() {
    if (this.data.calcBusy) return
    const code = (this.data.calcCode || '').trim()
    if (!code) {
      wx.showToast({ title: '请选择商品', icon: 'none' })
      return
    }
    if (!this.data.calcFactoryId) {
      wx.showToast({ title: '请选择加工厂', icon: 'none' })
      return
    }
    const fabric = Number(this.data.fabricAmount)
    const trim = Number(this.data.trimAmount)
    const cut = Number(this.data.cutQty)
    const delivery = Number(this.data.deliveryQty)
    if (this.data.fabricAmount !== '' && Number.isNaN(fabric)) {
      wx.showToast({ title: '发料成本不正确', icon: 'none' })
      return
    }
    if (this.data.trimAmount !== '' && Number.isNaN(trim)) {
      wx.showToast({ title: '辅料成本不正确', icon: 'none' })
      return
    }
    const basis = this.data.basis === 'delivery' ? 'delivery' : 'cut'
    if (basis === 'cut' && !(cut > 0)) {
      wx.showToast({ title: '请填写裁剪件数', icon: 'none' })
      return
    }
    if (basis === 'delivery' && !(delivery > 0)) {
      wx.showToast({ title: '请填写实际送货件数', icon: 'none' })
      return
    }
    this.setData({ calcBusy: true })
    const r = await saveSupplyCostCalc({
      productCode: code,
      factoryPartyId: this.data.calcFactoryId,
      fabricAmount: Number.isNaN(fabric) ? 0 : fabric,
      trimAmount: Number.isNaN(trim) ? 0 : trim,
      cutQty: Number.isNaN(cut) ? 0 : cut,
      deliveryQty: Number.isNaN(delivery) ? 0 : delivery,
      basis,
    })
    this.setData({ calcBusy: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || '计算失败', icon: 'none' })
      return
    }
    this.setData({ calcOn: false })
    wx.showToast({ title: '已写入成本', icon: 'success' })
    if (this.data.code) {
      void this.load()
      return
    }
    const average = r.data && r.data.average != null ? yuan(r.data.average) : ''
    const count = (r.data && r.data.count) || 0
    this.rememberAverage(code, average, count)
    void this.openSheet(code)
  },

  onDeleteCalc(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id) || 0
    if (!id) return
    wx.showModal({
      title: '删除这次计算',
      content: '删除后，平均成本会按剩下的记录重算。',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteSupplyCostCalc(id)
        if (!r.ok) {
          wx.showToast({ title: r.message || '删除失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已删除', icon: 'none' })
        if (this.data.sheetOn && this.data.sheetCode) void this.openSheet(this.data.sheetCode)
        if (this.data.code || !this.data.sheetOn) void this.load()
      },
    })
  },
})
