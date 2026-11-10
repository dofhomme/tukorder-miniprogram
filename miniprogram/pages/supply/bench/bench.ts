import { assertMediaCheckAsync } from '../../../services/sec-check'
import { uploadProductImage } from '../../../services/team'
import {
  addSupplyDocFile,
  acceptSupplyDoc,
  createSupplyBatch,
  createSupplyDoc,
  deleteSupplyDoc,
  deleteSupplyStatement,
  setSupplyDocPaid,
  fetchSupplyDoc,
  fetchSupplyDocs,
  fetchSupplyMaterials,
  fetchSupplyParties,
  fetchSupplyStatements,
  fetchSupplyStyles,
  createSupplyInvite,
  newSupplyUid,
  submitSupplyDoc,
  updateSupplyDoc,
  type SupplyMaterial,
  type SupplyParty,
} from '../../../services/supply'

const TABS: Record<string, Array<{ key: string; label: string }>> = {
  fabric: [{ key: 'fabric_in', label: '发面料' }],
  trim: [{ key: 'trim_in', label: '发辅料' }],
  factory: [
    { key: 'delivery', label: '送货' },
    { key: 'cut', label: '裁剪' },
  ],
  supplier: [
    { key: 'po', label: '补货' },
    { key: 'delivery', label: '送货' },
  ],
}

const NEED_BATCH = ['cut', 'delivery', 'po']
const NEED_MATERIAL = ['fabric_in', 'trim_in']
const SHOW_METERS = ['fabric_in']
const SHOW_QTY = ['trim_in', 'cut', 'delivery', 'po']
const SHOW_SIZE = ['cut', 'po']
const SHOW_PRICE = ['fabric_in', 'trim_in', 'delivery', 'po']
const SHOW_BOLTS = ['fabric_in']
const SHOW_ISSUED = ['fabric_in']
const SHOW_FACTORY = ['fabric_in', 'trim_in']
const DROPPED = ['issue', 'leftover']

const STATUS: Record<string, string> = {
  pending: '待验收',
  accepted: '已验收',
  posted: '已入账',
}

function fabricPriceText(row?: { refPrice?: number } | null) {
  const price = Number(row && row.refPrice) || 0
  return price > 0 ? String(price) : ''
}

function lineAmount(docType: string, meters: string, qty: string, unitPrice: string) {
  const useMeters = docType === 'fabric_in' || docType === 'issue' || docType === 'leftover'
  const measure = Number(useMeters ? meters : qty) || 0
  const price = Number(unitPrice) || 0
  return (Math.round(measure * price * 100) / 100).toFixed(2)
}

function nowParts() {
  const d = new Date()
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return {
    issuedDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    issuedClock: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}

function tabLabel(tabs: Array<{ key: string; label: string }>, docType: string) {
  const hit = tabs.find((item) => item.key === docType)
  return hit ? hit.label : ''
}

function emptyRatio() {
  return { size: '', ratio: '' }
}

function defaultCutRatio() {
  return [
    { size: 'M', ratio: '' },
    { size: 'L', ratio: '' },
    { size: 'XL', ratio: '' },
    { size: '2XL', ratio: '' },
  ]
}

function sizeQtySum(rows: Array<{ ratio: string }>) {
  return (rows || []).reduce((sum, row) => {
    const n = Number(row.ratio)
    return sum + (n > 0 ? n : 0)
  }, 0)
}

function unpackCutPieces(raw: string, totalQty: number) {
  const text = String(raw || '').trim()
  const rows = text ? unpackRatio(text) : defaultCutRatio()
  const sum = sizeQtySum(rows)
  if (sum > 0 && totalQty > 0 && Math.abs(sum - totalQty) > 0.001) {
    return rows.map((row) => ({ size: row.size, ratio: '' }))
  }
  return rows
}

function materialCostText(value: unknown) {
  const n = Number(value) || 0
  if (!(n > 0)) return ''
  return `每件用料 ¥${n.toFixed(2)}`
}

function packRatio(rows: Array<{ size: string; ratio: string }>) {
  const filled = (rows || []).filter((row) => String(row.size || '').trim())
  if (!filled.length) return ''
  const names = filled.map((row) => String(row.size).trim()).join(':')
  const ratios = filled.map((row) => String(row.ratio || '').trim())
  if (!ratios.some(Boolean)) return names
  return `${names} ${ratios.map((item) => item || '0').join(':')}`
}

function unpackRatio(raw: string) {
  const text = String(raw || '').trim()
  if (!text) return [emptyRatio()]
  const space = text.indexOf(' ')
  if (space < 0) {
    if (text.indexOf(':') < 0) return [{ size: text, ratio: '' }]
    return text.split(':').filter(Boolean).map((size) => ({ size, ratio: '' }))
  }
  const names = text.slice(0, space).split(':').filter(Boolean)
  const ratios = text.slice(space + 1).split(':')
  if (!names.length) return [{ size: text, ratio: '' }]
  return names.map((size, index) => ({
    size,
    ratio: ratios[index] && ratios[index] !== '0' ? ratios[index] : '',
  }))
}

function pieceText(value: number) {
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return String(Math.round(value * 1000) / 1000)
}

function pickName(list: Array<{ id: number; label?: string; name?: string }>, id: number, empty: string) {
  if (!id) return empty
  const row = list.find((item) => item.id === id)
  return (row && (row.label || row.name)) || empty
}

function styleCodes(list: Array<{ id: number; productCode?: string }>, ids: number[]) {
  const out: string[] = []
  ids.forEach((id) => {
    const row = list.find((item) => item.id === id)
    const code = row && row.productCode ? String(row.productCode) : ''
    if (code && out.indexOf(code) < 0) out.push(code)
  })
  return out
}

function pickManyText(list: Array<{ id: number; label?: string; name?: string }>, ids: number[], empty: string) {
  const names = (ids || []).map((id) => {
    const row = list.find((item) => item.id === id)
    return row ? (row.label || row.name || '') : ''
  }).filter(Boolean)
  if (!names.length) return ids && ids.length ? `已选 ${ids.length} 种` : empty
  if (names.length <= 2) return names.join('、')
  return `${names.slice(0, 2).join('、')} 等${names.length}种`
}

function idList(raw: unknown, one: unknown) {
  const many = Array.isArray(raw) ? raw.map((item) => Number(item) || 0).filter(Boolean) : []
  if (many.length) return many
  const single = Number(one) || 0
  return single ? [single] : []
}

function feedLabel(doc: Record<string, unknown>, partyName: string, materialName: string) {
  const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
  const line = lines[0] || {}
  const meters = Number(line.meters) || 0
  const bolts = Number(line.bolts) || 0
  const qty = Number(line.qty) || 0
  const bits = [
    String(line.productCode || ''),
    partyName,
    materialName,
    meters ? `${meters}米` : '',
    bolts ? `${bolts}匹` : '',
    qty ? `${qty}` : '',
  ].filter(Boolean)
  return bits.join(' · ') || String(doc.docNo || '记录')
}

function docFilled(d: {
  productCode?: string
  meters?: string
  qty?: string
  bolts?: string
  unitPrice?: string
  size?: string
  logisticsNo?: string
  logisticsName?: string
  slipPath?: string
}) {
  return !!(
    String(d.productCode || '').trim()
    || Number(d.meters) > 0
    || Number(d.qty) > 0
    || Number(d.bolts) > 0
    || Number(d.unitPrice) > 0
    || String(d.size || '').trim()
    || String(d.logisticsNo || '').trim()
    || String(d.logisticsName || '').trim()
    || String(d.slipPath || '')
  )
}

const PAGE = 10

Component({
  properties: {
    partyId: { type: Number, value: 0 },
    role: { type: String, value: 'fabric' },
    editId: { type: Number, value: 0 },
    editType: { type: String, value: '' },
  },
  data: {
    name: '',
    tabs: TABS.fabric,
    docType: 'fabric_in',
    tabLabel: '发面料',
    needBatch: false,
    needMaterial: false,
    showMeters: true,
    showQty: false,
    showSize: false,
    showPrice: true,
    showBolts: true,
    showIssuedAt: true,
    showPaid: false,
    paid: false,
    bolts: '',
    issuedDate: '',
    issuedClock: '',
    priceLabel: '单价',
    batchMode: 'cmt',
    lockProcess: false,
    lockFabricPrice: true,
    showFactory: false,
    pickParty: false,
    partyLabel: '',
    partyChoices: [] as Array<{ id: number; name: string }>,
    partyChoiceIndex: 0,
    pickedPartyId: 0,
    factories: [] as Array<{ id: number; name: string }>,
    factoryIndex: 0,
    factoryId: 0,
    cutFabrics: [] as Array<{ id: number; label: string; boundCutId: number; productCode: string; status: string }>,
    cutTrims: [] as Array<{ id: number; label: string; boundCutId: number; productCode: string; status: string }>,
    factoriesReady: false,
    cutFabricIds: [] as number[],
    cutTrimIds: [] as number[],
    cutFabricText: '稍后选择',
    cutTrimText: '稍后选择',
    pickMulti: false,
    pickIds: [] as number[],
    cutFactoryText: '请选择加工厂',
    deliveryCuts: [] as Array<{ id: number; label: string; cutQty: number; deliveredQty: number; batchId: number; partyId: number; productCode: string }>,
    deliveryCutId: 0,
    deliveryCutText: '请选择裁剪',
    deliveryOwnQty: 0,
    deliveryOwnCutId: 0,
    materials: [] as Array<{ id: number; label: string; refPrice: number }>,
    materialIndex: 0,
    materialId: 0,
    pickOpen: false,
    pickKind: '',
    pickTitle: '',
    pickQuery: '',
    pickRows: [] as Array<{ index: number; label: string; on: boolean }>,
    productCode: '',
    codeHits: [] as string[],
    qty: '',
    unitPrice: '',
    size: '',
    sizeRatios: [{ size: '', ratio: '' }] as Array<{ size: string; ratio: string }>,
    sizeRatioText: '',
    materialUnitText: '',
    inviteToken: '',
    inviteNote: '',
    logisticsNo: '',
    logisticsName: '',
    slipPath: '',
    amountText: '0.00',
    acceptId: 0,
    acceptNo: '',
    acceptStatus: '',
    acceptPhoto: '',
    busy: false,
    docs: [] as Array<Record<string, unknown>>,
    editingId: 0,
    anchor: '',
    statements: [] as Array<Record<string, unknown>>,
    docMore: false,
    docsReady: false,
    editOn: false,
  },
  lifetimes: {
    attached() {
    this._docs = []
    this._codes = [] as string[]
    this._process = {} as Record<string, number>
    this._editApplied = false
    this._cutStamp = 0
    this.boot()
    },
  },
  pageLifetimes: {
    show() {
      if (this.data.docType === 'cut' && this.data.factoryId) void this.loadCutFeeds()
      if (this.locksProcess() && this.data.productCode) {
        void this.loadCodes().then(() => this.applyProcessPrice())
      }
    },
  },
  methods: {
  boot() {
    const role = TABS[this.data.role] ? this.data.role : 'fabric'
    const tabs = TABS[role]
    const prefer = String(this.data.editType || '')
    const start = tabs.some((item) => item.key === prefer) ? prefer : tabs[0].key
    this.applyType(start, tabs)
    this.setData({ role, tabs, editOn: false })
    void this.loadParty()
    void this.loadPartyChoices()
    void this.loadFactories()
    void this.loadCutFeeds()
    void this.loadCodes()
    if (Number(this.data.editId)) void this.loadMaterials(start).then(() => this.loadDocs())
    else {
      void this.loadMaterials(start)
      void this.loadDocs()
    }
  },

  picksParty() {
    return !Number(this.data.partyId) && !!TABS[this.data.role]
  },

  applyType(docType: string, tabs?: Array<{ key: string; label: string }>) {
    const list = tabs || this.data.tabs
    this.setData({
      docType,
      tabLabel: tabLabel(list, docType),
      needBatch: NEED_BATCH.indexOf(docType) >= 0,
      needMaterial: NEED_MATERIAL.indexOf(docType) >= 0,
      showMeters: SHOW_METERS.indexOf(docType) >= 0,
      showQty: SHOW_QTY.indexOf(docType) >= 0,
      showSize: SHOW_SIZE.indexOf(docType) >= 0,
      showPrice: SHOW_PRICE.indexOf(docType) >= 0,
      showBolts: SHOW_BOLTS.indexOf(docType) >= 0,
      showIssuedAt: SHOW_ISSUED.indexOf(docType) >= 0,
      showFactory: SHOW_FACTORY.indexOf(docType) >= 0,
      factoryId: 0,
      factoryIndex: 0,
      showPaid: docType === 'fabric_in' || docType === 'trim_in' || docType === 'po' || docType === 'delivery',
      paid: false,
      lockProcess: this.data.role === 'factory' && this.data.batchMode === 'cmt' && docType === 'delivery',
      lockFabricPrice: docType === 'fabric_in',
      priceLabel: docType === 'issue' ? '单价（发料按最近签收价）' : '单价',
      productCode: '',
      codeHits: [],
      meters: '',
      qty: '',
      unitPrice: '',
      size: '',
      sizeRatios: docType === 'cut' ? defaultCutRatio() : [emptyRatio()],
      sizeRatioText: '',
      materialUnitText: '',
      inviteToken: '',
      inviteNote: '',
      logisticsNo: '',
      logisticsName: '',
      slipPath: '',
      amountText: '0.00',
      editingId: 0,
      anchor: '',
      bolts: '',
      cutFabricIds: [],
      cutTrimIds: [],
      cutFabricText: '稍后选择',
      cutTrimText: '稍后选择',
      cutFactoryText: '请选择加工厂',
      deliveryCutId: 0,
      deliveryCutText: '请选择裁剪',
      deliveryOwnQty: 0,
      deliveryOwnCutId: 0,
      ...nowParts(),
    })
    if (docType === 'cut') this.prefillCutFactory()
  },

  async loadCodes() {
    const r = await fetchSupplyStyles()
    const items = r.data?.items || []
    this._codes = items.map((item) => item.productCode).filter(Boolean)
    const prices: Record<string, number> = {}
    items.forEach((item) => {
      if (!item.productCode) return
      prices[item.productCode.toLowerCase()] = Number(item.processPrice) || 0
    })
    this._process = prices
  },

  locksProcess() {
    return this.data.role === 'factory' && this.data.batchMode === 'cmt' && this.data.docType === 'delivery'
  },

  processFee(code: string) {
    return Number(this._process[code.trim().toLowerCase()]) || 0
  },

  async applyProcessPrice(code?: string) {
    if (!this.locksProcess()) return
    if (!this._codes.length) await this.loadCodes()
    const fee = this.processFee(code != null ? code : this.data.productCode)
    this.touchAmount({ unitPrice: fee > 0 ? String(fee) : '' })
  },

  onCreateProcess() {
    if (!this.locksProcess()) return
    const code = String(this.data.productCode || '').trim()
    if (!code || Number(this.data.unitPrice) > 0) return
    wx.navigateTo({ url: `/pages/supply/styles?code=${encodeURIComponent(code)}` })
  },

  async loadPartyChoices() {
    const labels: Record<string, string> = {
      fabric: '面料商',
      trim: '辅料商',
      factory: '加工厂',
      supplier: '供应商',
    }
    if (!this.picksParty()) {
      this.setData({ pickParty: false, partyChoices: [], pickedPartyId: 0, partyLabel: '' })
      return
    }
    const partyLabel = labels[this.data.role] || '往来'
    this.setData({ pickParty: true, partyLabel, pickedPartyId: 0, partyChoiceIndex: 0 })
    const r = await fetchSupplyParties(this.data.role)
    const partyChoices = (r.data?.items || []).map((item) => ({ id: item.id, name: item.name }))
    this.setData({ partyChoices })
  },

  async loadFactories() {
    if (this.data.role !== 'fabric' && this.data.role !== 'trim' && this.data.role !== 'factory') {
      this.setData({ factories: [], factoryId: 0, factoryIndex: 0 })
      return
    }
    const r = await fetchSupplyParties('factory')
    const factories = (r.data?.items || []).map((item) => ({ id: item.id, name: item.name }))
    if (this.data.role !== 'factory') {
      this.setData({ factories, factoryId: 0, factoryIndex: 0 })
      return
    }
    const keep = Number(this.data.factoryId) || Number(this.data.partyId) || 0
    const named = factories.find((item) => item.id === keep)
    this.data.factoryId = keep
    this.setData({
      factories,
      factoriesReady: true,
      factoryId: keep,
      factoryIndex: Math.max(0, factories.findIndex((item) => item.id === keep)),
      cutFactoryText: named ? named.name : '请选择加工厂',
    })
    if (keep) void this.loadCutFeeds()
  },

  prefillCutFactory() {
    const id = Number(this.data.partyId) || 0
    const named = this.data.factories.find((item) => item.id === id)
    if (!named) return
    this.data.factoryId = id
    this.setData({
      factoryId: id,
      factoryIndex: Math.max(0, this.data.factories.findIndex((item) => item.id === id)),
      cutFactoryText: named.name,
    })
  },

  async loadCutFeeds() {
    if (this.data.role !== 'factory') return
    const cutFactoryId = Number(this.data.partyId) || Number(this.data.pickedPartyId) || 0
    const materialFactoryId = Number(this.data.factoryId) || Number(this.data.partyId) || 0
    const stamp = (this._cutStamp = (this._cutStamp || 0) + 1)
    const [fabrics, trims, cuts, fabricParties, trimParties, materials] = await Promise.all([
      materialFactoryId ? fetchSupplyDocs(0, 'fabric_in', { limit: 100, factoryPartyId: materialFactoryId }) : Promise.resolve(null),
      materialFactoryId ? fetchSupplyDocs(0, 'trim_in', { limit: 100, factoryPartyId: materialFactoryId }) : Promise.resolve(null),
      cutFactoryId ? fetchSupplyDocs(cutFactoryId, 'cut', { limit: 100 }) : Promise.resolve(null),
      fetchSupplyParties('fabric'),
      fetchSupplyParties('trim'),
      fetchSupplyMaterials(),
    ])
    if (stamp !== this._cutStamp) return
    const fabricNames = new Map((fabricParties.data?.items || []).map((item) => [item.id, item.name]))
    const trimNames = new Map((trimParties.data?.items || []).map((item) => [item.id, item.name]))
    const materialNames = new Map((materials.data?.items || []).map((item) => {
      const label = `${item.name}${item.color ? ' ' + item.color : ''}`
      return [item.id, label]
    }))
    const mapFeed = (rows: Array<Record<string, unknown>>, names: Map<number, string>) => rows.map((doc) => {
      const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
      const line = lines[0] || {}
      return {
        id: Number(doc.id) || 0,
        boundCutId: Number(doc.boundCutId) || 0,
        status: String(doc.status || ''),
        label: feedLabel(doc, names.get(Number(doc.partyId)) || '', materialNames.get(Number(line.materialId)) || ''),
        productCode: String(line.productCode || ''),
      }
    })
    const sameFactory = (doc: Record<string, unknown>) => !materialFactoryId || Number(doc.factoryPartyId) === materialFactoryId
    const cutFabrics = mapFeed((fabrics && fabrics.data && fabrics.data.items || []).filter(sameFactory), fabricNames)
    const cutTrims = mapFeed((trims && trims.data && trims.data.items || []).filter(sameFactory), trimNames)
    const deliveryCuts = ((cuts && cuts.data && cuts.data.items) || []).map((doc) => {
      const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
      const line = lines[0] || {}
      const qty = lines.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
      const sent = Number(doc.deliveredQty) || 0
      const bits = [
        String(line.productCode || ''),
        qty ? `裁剪${pieceText(qty)}件` : '',
        sent ? `已送${pieceText(sent)}件` : '未送',
        String(line.size || ''),
      ].filter(Boolean)
      return {
        id: Number(doc.id) || 0,
        label: bits.join(' · ') || String(doc.docNo || '裁剪'),
        cutQty: qty,
        deliveredQty: sent,
        batchId: Number(doc.batchId) || 0,
        partyId: Number(doc.partyId) || 0,
        productCode: String(line.productCode || ''),
      }
    })
    const fabricIds = materialFactoryId
      ? this.data.cutFabricIds.filter((id) => cutFabrics.some((item) => item.id === id))
      : this.data.cutFabricIds
    const trimIds = materialFactoryId
      ? this.data.cutTrimIds.filter((id) => cutTrims.some((item) => item.id === id))
      : this.data.cutTrimIds
    this.setData({
      cutFabrics,
      cutTrims,
      deliveryCuts,
      cutFabricIds: fabricIds,
      cutTrimIds: trimIds,
      cutFabricText: pickManyText(cutFabrics, fabricIds, '稍后选择'),
      cutTrimText: pickManyText(cutTrims, trimIds, '稍后选择'),
      deliveryCutText: pickName(deliveryCuts, this.data.deliveryCutId, '请选择裁剪'),
    })
  },

  async loadParty() {
    const r = await fetchSupplyParties()
    const party = (r.data?.items || []).find((p: SupplyParty) => p.id === this.data.partyId)
    if (party) this.setData({ name: party.name })
  },

  async loadMaterials(docType: string) {
    if (NEED_MATERIAL.indexOf(docType) < 0) {
      this.setData({ materials: [], materialId: 0, materialIndex: 0 })
      return
    }
    const kind = docType === 'fabric_in' ? 'fabric' : docType === 'trim_in' ? 'trim' : ''
    const r = await fetchSupplyMaterials(kind || undefined)
    const materials = (r.data?.items || []).map((item: SupplyMaterial) => ({
      id: item.id,
      label: `${item.name}${item.color ? ' ' + item.color : ''}`,
      refPrice: Number(item.refPrice) || 0,
    }))
    const first = materials[0]
    const quoted = docType === 'fabric_in' ? fabricPriceText(first) : ''
    this.setData({
      materials,
      materialIndex: 0,
      materialId: first ? first.id : 0,
      ...(docType === 'fabric_in'
        ? {
            unitPrice: quoted,
            amountText: lineAmount(docType, this.data.meters, this.data.qty, quoted),
          }
        : {}),
    })
  },

  quotedFabricPrice() {
    const row = this.data.materials.find((item) => item.id === this.data.materialId)
      || this.data.materials[this.data.materialIndex]
    return Number(row && row.refPrice) || 0
  },

  async loadDocs() {
    if (!Number(this.data.partyId)) {
      this.setData({ docs: [], statements: [], docsReady: true, docMore: false })
      return
    }
    const [docs, statements] = await Promise.all([
      fetchSupplyDocs(this.data.partyId, this.data.docType),
      fetchSupplyStatements(this.data.partyId),
    ])
    this._docs = (docs.data?.items || []).filter((item) => DROPPED.indexOf(String(item.docType || '')) < 0).map((item) => {
      const lines = Array.isArray(item.lines) ? item.lines as Array<Record<string, unknown>> : []
      const line = lines[0] || {}
      const bolts = Number(line.bolts) || 0
      const meters = Number(line.meters) || 0
      const qty = Number(line.qty) || 0
      const code = String(line.productCode || '')
      const bits = [
        item.factoryName ? String(item.factoryName) : '',
        code,
        meters ? `${meters}米` : '',
        qty ? `${qty}件` : '',
        bolts ? `${bolts}匹` : '',
        line.size ? String(line.size) : '',
      ].filter(Boolean)
      const extra = [item.issuedAt, bolts ? `${bolts}匹` : ''].filter(Boolean).join(' · ')
      return {
        ...item,
        statusText: STATUS[String(item.status || '')] || '',
        summary: bits.join(' · '),
        paid: !!item.paid,
        extra,
      }
    })
    this.setData({
      docs: this._docs.slice(0, PAGE),
      docMore: this._docs.length > PAGE,
      docsReady: true,
      statements: (statements.data?.items || []).filter((s) => s.role === this.data.role),
    })
    const editId = Number(this.data.editId)
    if (editId && !this._editApplied) {
      this._editApplied = true
      let doc = this._docs.find((item) => Number(item.id) === editId)
      if (!doc) {
        const one = await fetchSupplyDoc(editId)
        doc = one.ok && one.data ? one.data : undefined
      }
      if (doc) this.fillDoc(doc)
    }
  },

  onMore() {
    if (!this.data.docMore) return
    const n = this.data.docs.length + PAGE
    this.setData({
      docs: this._docs.slice(0, n),
      docMore: this._docs.length > n,
    })
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const docType = String(e.currentTarget.dataset.key || '')
    if (!docType || docType === this.data.docType) return
    this.applyType(docType)
    this.setData({ docs: [], docsReady: false, docMore: false })
    void this.loadMaterials(docType)
    void this.loadCutFeeds()
    void this.loadDocs()
  },

  pickSource(kind: string) {
    if (kind === 'party') {
      return this.data.partyChoices.map((item, index) => ({
        index,
        label: item.name,
        on: !!this.data.pickedPartyId && index === this.data.partyChoiceIndex,
      }))
    }
    if (kind === 'factory' || kind === 'cutFactory') {
      const current = kind === 'cutFactory' ? this.data.factoryId : this.data.factoryId
      return this.data.factories.map((item, index) => ({
        index,
        id: item.id,
        label: item.name,
        on: kind === 'cutFactory' ? item.id === current : !!this.data.factoryId && index === this.data.factoryIndex,
      }))
    }
    if (kind === 'cutFabric' || kind === 'cutTrim') {
      const list = kind === 'cutFabric' ? this.data.cutFabrics : this.data.cutTrims
      const selected = this.data.pickIds.length || this.data.pickMulti
        ? this.data.pickIds
        : (kind === 'cutFabric' ? this.data.cutFabricIds : this.data.cutTrimIds)
      return list
        .filter((item) => {
          if (selected.indexOf(item.id) >= 0) return true
          if (item.boundCutId && item.boundCutId !== this.data.editingId) return false
          return item.status !== 'accepted' && item.status !== 'posted'
        })
        .map((item, index) => ({
          index,
          id: item.id,
          label: item.label,
          on: selected.indexOf(item.id) >= 0,
        }))
    }
    if (kind === 'style') {
      return this._codes.map((code, index) => ({
        index,
        label: code,
        on: code === this.data.productCode,
      }))
    }
    if (kind === 'deliveryCut') {
      const factoryId = Number(this.data.partyId) || Number(this.data.pickedPartyId) || 0
      return this.data.deliveryCuts
        .filter((item) => {
          if (item.partyId && factoryId && item.partyId !== factoryId) return false
          if (this.data.editingId && item.id === this.data.deliveryCutId) return true
          return item.cutQty > item.deliveredQty + 0.001
        })
        .map((item, index) => ({
          index,
          id: item.id,
          label: item.label,
          on: item.id === this.data.deliveryCutId,
        }))
    }
    return this.data.materials.map((item, index) => ({
      index,
      label: item.label,
      on: !!this.data.materialId && index === this.data.materialIndex,
    }))
  },

  async onOpenPick(e: WechatMiniprogram.TouchEvent) {
    const kind = String(e.currentTarget.dataset.kind || '')
    if (kind === 'style' && !this._codes.length) await this.loadCodes()
    if (kind === 'cutFactory') {
      if (!this.data.factoriesReady) {
        wx.showToast({ title: '正在加载', icon: 'none' })
        return
      }
      if (!this.data.factories.length) {
        this.askFactory()
        return
      }
    }
    if (kind === 'cutFabric' && !this.data.cutFabrics.length) {
      this.askFeed('还没有面料', '去新建发面料？', '/pages/supply/parties?role=fabric&create=1')
      return
    }
    if (kind === 'cutTrim' && !this.data.cutTrims.length) {
      this.askFeed('还没有辅料', '辅料可以不选。要去新建发辅料吗？', '/pages/supply/parties?role=trim&create=1')
      return
    }
    const source = this.pickSource(kind)
    if (!source.length) {
      const title = kind === 'party'
        ? `请先建立${this.data.partyLabel}`
        : kind === 'factory' || kind === 'cutFactory'
          ? '请先建立加工厂'
              : kind === 'cutFabric'
            ? (this.data.cutFabrics.length ? '验收过的面料不能再选' : '这家厂还没有可选用的面料')
            : kind === 'cutTrim'
              ? (this.data.cutTrims.length ? '验收过的辅料不能再选' : '这家厂还没有可选用的辅料')
              : kind === 'deliveryCut'
                ? (this.data.deliveryCuts.length ? '这家厂的裁剪都已送完' : '这家厂还没有裁剪')
                : kind === 'style'
                  ? '请先在商品里建立款号'
                : '请先在物料档案里建好'
      wx.showToast({ title, icon: 'none' })
      return
    }
    const pickTitle = kind === 'party'
      ? `选择${this.data.partyLabel}`
      : kind === 'factory' || kind === 'cutFactory'
        ? '选择加工厂'
        : kind === 'cutFabric'
          ? '选择本次面料'
          : kind === 'cutTrim'
            ? '选择本次辅料'
            : kind === 'deliveryCut'
              ? '选择本次裁剪'
              : kind === 'style'
                ? '选择款号'
                : '选择物料'
    const multi = kind === 'cutFabric' || kind === 'cutTrim'
    const pickIds = multi
      ? (kind === 'cutFabric' ? this.data.cutFabricIds : this.data.cutTrimIds).slice()
      : []
    this.data.pickMulti = multi
    this.data.pickIds = pickIds
    this.setData({
      pickOpen: true,
      pickKind: kind,
      pickTitle,
      pickQuery: '',
      pickMulti: multi,
      pickIds,
      pickRows: multi ? this.pickSource(kind).map((item) => ({ ...item, on: pickIds.indexOf(item.id) >= 0 })) : source,
    })
  },

  onPickQuery(e: WechatMiniprogram.Input) {
    const pickQuery = String(e.detail.value || '')
    const q = pickQuery.trim().toLowerCase()
    const ids = this.data.pickIds
    const pickRows = this.pickSource(this.data.pickKind)
      .filter((item) => !q || item.label.toLowerCase().indexOf(q) >= 0)
      .map((item) => (this.data.pickMulti ? { ...item, on: ids.indexOf(item.id) >= 0 } : item))
    this.setData({ pickQuery, pickRows })
  },

  onClearPickQuery() {
    this.setData({ pickQuery: '', pickRows: this.pickSource(this.data.pickKind) })
  },

  askFactory() {
    wx.showModal({
      title: '还没有加工厂',
      content: '去新建一个加工厂？',
      confirmText: '去新建',
      success: (res) => {
        if (!res.confirm) return
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1] as WechatMiniprogram.Page.Instance<Record<string, unknown>, Record<string, unknown>> | undefined
        if (cur && cur.route === 'pages/supply/parties' && this.data.role === 'factory') {
          this.triggerEvent('createfactory')
          return
        }
        wx.navigateTo({ url: '/pages/supply/parties?role=factory&createParty=1' })
      },
    })
  },

  askFeed(title: string, content: string, url: string) {
    wx.showModal({
      title,
      content,
      confirmText: '去新建',
      success: (res) => {
        if (!res.confirm) return
        wx.navigateTo({ url })
      },
    })
  },

  onClosePick() {
    this.setData({ pickOpen: false, pickMulti: false, pickIds: [] })
  },

  onConfirmPick() {
    const ids = this.data.pickIds.slice()
    const kind = this.data.pickKind
    if (kind === 'cutFabric') {
      const codes = styleCodes(this.data.cutFabrics, ids)
      if (ids.length && !codes.length) {
        wx.showToast({ title: '这批面料还没有款号', icon: 'none' })
        return
      }
      if (codes.length > 1) {
        wx.showToast({ title: '请选同一款的面料', icon: 'none' })
        return
      }
      this.setData({
        cutFabricIds: ids,
        cutFabricText: pickManyText(this.data.cutFabrics, ids, '稍后选择'),
        productCode: codes[0] || '',
        codeHits: [],
        pickOpen: false,
        pickMulti: false,
        pickIds: [],
      })
      return
    }
    if (kind === 'cutTrim') {
      this.setData({
        cutTrimIds: ids,
        cutTrimText: pickManyText(this.data.cutTrims, ids, '稍后选择'),
        pickOpen: false,
        pickMulti: false,
        pickIds: [],
      })
    }
  },

  onPickRow(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const kind = this.data.pickKind
    if (kind === 'cutFabric' || kind === 'cutTrim') {
      const id = Number(e.currentTarget.dataset.id) || 0
      if (!id) return
      const pickIds = this.data.pickIds.slice()
      const at = pickIds.indexOf(id)
      if (at >= 0) pickIds.splice(at, 1)
      else pickIds.push(id)
      this.data.pickIds = pickIds
      const q = String(this.data.pickQuery || '').trim().toLowerCase()
      this.setData({
        pickOpen: true,
        pickIds,
        pickRows: this.pickSource(kind).filter((item) => !q || item.label.toLowerCase().indexOf(q) >= 0)
          .map((item) => ({ ...item, on: pickIds.indexOf(item.id) >= 0 })),
      })
      return
    }
    this.setData({ pickOpen: false })
    if (kind === 'style') {
      const code = String(e.currentTarget.dataset.label || '')
      this.setData({ productCode: code, codeHits: [] })
      return
    }
    if (kind === 'party') {
      const row = this.data.partyChoices[index]
      const pickedPartyId = row ? row.id : 0
      if (this.data.role === 'factory') {
        this.data.pickedPartyId = pickedPartyId
        this.data.deliveryCutId = 0
      }
      this.setData({
        partyChoiceIndex: index,
        pickedPartyId,
        ...(this.data.role === 'factory' ? { deliveryCutId: 0, deliveryCutText: '请选择裁剪' } : {}),
      })
      if (this.data.role === 'factory') void this.loadCutFeeds()
      return
    }
    if (kind === 'factory') {
      const row = this.data.factories[index]
      this.setData({ factoryIndex: index, factoryId: row ? row.id : 0 })
      return
    }
    if (kind === 'cutFactory') {
      const id = Number(e.currentTarget.dataset.id) || 0
      const row = this.data.factories.find((item) => item.id === id)
      const changed = id !== this.data.factoryId
      this.data.factoryId = row ? row.id : 0
      if (changed) {
        this.data.cutFabricIds = []
        this.data.cutTrimIds = []
      }
      this.setData({
        factoryId: row ? row.id : 0,
        factoryIndex: Math.max(0, this.data.factories.findIndex((item) => item.id === id)),
        cutFactoryText: row ? row.name : '请选择加工厂',
        ...(changed ? {
          cutFabricIds: [],
          cutTrimIds: [],
          cutFabricText: '稍后选择',
          cutTrimText: '稍后选择',
          productCode: '',
          codeHits: [],
        } : {}),
      })
      if (changed) void this.loadCutFeeds()
      return
    }
    if (kind === 'deliveryCut') {
      const id = Number(e.currentTarget.dataset.id) || 0
      const next = id === this.data.deliveryCutId ? 0 : id
      const row = this.data.deliveryCuts.find((item) => item.id === next)
      const patch: Record<string, string | number | string[]> = {
        deliveryCutId: next,
        deliveryCutText: row ? row.label : '请选择裁剪',
      }
      if (row && row.productCode) {
        patch.productCode = row.productCode
        patch.codeHits = []
      }
      this.setData(patch)
      if (row && row.productCode && this.locksProcess()) void this.applyProcessPrice(row.productCode)
      return
    }
    const row = this.data.materials[index]
    this.setData({ materialIndex: index, materialId: row ? row.id : 0 })
    if (this.data.docType === 'fabric_in') this.touchAmount({ unitPrice: fabricPriceText(row) })
  },

  onMode(e: WechatMiniprogram.TouchEvent) {
    const batchMode = String(e.currentTarget.dataset.mode || 'cmt')
    const lockProcess = this.data.role === 'factory' && batchMode === 'cmt' && this.data.docType === 'delivery'
    const clearCut = batchMode !== 'cmt'
    this.setData({
      batchMode,
      lockProcess,
      ...(clearCut ? { deliveryCutId: 0, deliveryCutText: '请选择裁剪' } : {}),
    })
    if (lockProcess) void this.applyProcessPrice()
    else if (this.data.docType === 'delivery') this.touchAmount({ unitPrice: '' })
  },

  onPaid(e: WechatMiniprogram.TouchEvent) {
    this.setData({ paid: String(e.currentTarget.dataset.paid || '') === '1' })
  },
  onCode(e: WechatMiniprogram.Input) {
    const raw = e.detail.value
    const q = raw.trim().toLowerCase()
    const hits = q
      ? this._codes.filter((code) => code.toLowerCase().indexOf(q) >= 0).slice(0, 8)
      : []
    const exact = this._codes.some((code) => code.toLowerCase() === q)
    this.setData({ productCode: raw, codeHits: exact ? [] : hits })
    if (this.locksProcess()) {
      if (exact) void this.applyProcessPrice(raw.trim())
      else this.touchAmount({ unitPrice: '' })
    }
  },
  onPickCode(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code) return
    this.setData({ productCode: code, codeHits: [] })
    void this.applyProcessPrice(code)
  },
  onMeters(e: WechatMiniprogram.Input) { this.touchAmount({ meters: e.detail.value }) },
  onQty(e: WechatMiniprogram.Input) { this.touchAmount({ qty: e.detail.value }) },
  onPrice(e: WechatMiniprogram.Input) { this.touchAmount({ unitPrice: e.detail.value }) },
  onSize(e: WechatMiniprogram.Input) { this.setData({ size: e.detail.value }) },

  paintRatio(sizeRatios: Array<{ size: string; ratio: string }>) {
    const total = sizeQtySum(sizeRatios)
    this.setData({
      sizeRatios,
      sizeRatioText: total > 0 ? `尺码合计 ${pieceText(total)} 件` : '',
    })
  },

  onRatioSize(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRatios = this.data.sizeRatios.map((row) => ({ ...row }))
    if (!sizeRatios[index]) return
    sizeRatios[index].size = e.detail.value
    this.paintRatio(sizeRatios)
  },

  onRatioNum(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRatios = this.data.sizeRatios.map((row) => ({ ...row }))
    if (!sizeRatios[index]) return
    sizeRatios[index].ratio = e.detail.value
    this.paintRatio(sizeRatios)
  },

  onAddRatio() {
    this.paintRatio(this.data.sizeRatios.concat([emptyRatio()]))
  },

  onRemoveRatio(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRatios = this.data.sizeRatios.filter((_, at) => at !== index)
    this.paintRatio(sizeRatios.length ? sizeRatios : [emptyRatio()])
  },
  onLogistics(e: WechatMiniprogram.Input) { this.setData({ logisticsNo: e.detail.value }) },
  onLogisticsName(e: WechatMiniprogram.Input) { this.setData({ logisticsName: e.detail.value }) },
  onBolts(e: WechatMiniprogram.Input) { this.setData({ bolts: e.detail.value }) },
  onIssuedDate(e: WechatMiniprogram.PickerChange) { this.setData({ issuedDate: e.detail.value }) },
  onIssuedClock(e: WechatMiniprogram.PickerChange) { this.setData({ issuedClock: e.detail.value }) },

  touchAmount(patch: { meters?: string; qty?: string; unitPrice?: string }) {
    const meters = patch.meters !== undefined ? patch.meters : this.data.meters
    const qty = patch.qty !== undefined ? patch.qty : this.data.qty
    const unitPrice = patch.unitPrice !== undefined ? patch.unitPrice : this.data.unitPrice
    this.setData({
      ...patch,
      amountText: lineAmount(this.data.docType, meters, qty, unitPrice),
    })
  },

  onSlip() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: res.tapIndex === 0 ? ['camera'] : ['album'],
          success: (picked) => {
            const path = picked.tempFiles && picked.tempFiles[0] && picked.tempFiles[0].tempFilePath
            if (path) this.setData({ slipPath: path })
          },
        })
      },
    })
  },

  onClearSlip() {
    this.setData({ slipPath: '' })
  },

  async onInviteCut() {
    if (this.data.busy || this.data.editingId || this.data.docType !== 'cut') return
    const factoryId = Number(this.data.factoryId) || Number(this.data.partyId) || 0
    if (!factoryId) {
      wx.showToast({ title: '先选择加工厂', icon: 'none' })
      return
    }
    const fabricIds = this.data.cutFabricIds || []
    if (!fabricIds.length) {
      wx.showToast({ title: '先选择本次面料', icon: 'none' })
      return
    }
    if (fabricIds.length > 1) {
      wx.showToast({ title: '邀请一次对应一张面料', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await createSupplyInvite(fabricIds[0], 24, factoryId)
    this.setData({ busy: false })
    if (!r.ok || !r.data || !r.data.token) {
      wx.showToast({ title: (r.message || '邀请失败').slice(0, 20), icon: 'none' })
      return
    }
    const token = r.data.token
    this.setData({
      inviteToken: token,
      inviteNote: '口令已复制。发给加工厂，在填裁剪里粘贴提交。件数会直接写入，并标成厂里提供。这张面料已验收，这里不用再保存。',
    })
    wx.setClipboardData({ data: token })
  },

  onCopyInvite() {
    const token = this.data.inviteToken
    if (!token) return
    wx.setClipboardData({ data: token })
  },

  async onSave() {
    if (this.data.busy) return
    if (this.data.inviteToken && this.data.docType === 'cut' && !this.data.editingId) {
      wx.showToast({ title: '已邀请厂里填写', icon: 'none' })
      return
    }
    if (!docFilled(this.data)) {
      wx.showToast({ title: '未填写，不用保存', icon: 'none' })
      return
    }
    let productCode = this.data.productCode.trim()
    const needStyle = this.data.docType === 'fabric_in' || this.data.docType === 'trim_in'
    if (needStyle) {
      if (!this._codes.length) await this.loadCodes()
      if (!productCode) {
        wx.showToast({ title: '请选择款号', icon: 'none' })
        return
      }
      const exactStyle = this._codes.find((code) => code.toLowerCase() === productCode.toLowerCase())
      if (!exactStyle) {
        wx.showToast({ title: '请从款号里选择', icon: 'none' })
        return
      }
      productCode = exactStyle
    }
    if (this.data.docType === 'cut') {
      if (this.data.factoriesReady && !this.data.factories.length) {
        this.askFactory()
        return
      }
      if (!this.data.factoryId) {
        wx.showToast({ title: '请选择加工厂', icon: 'none' })
        return
      }
      if (!this.data.cutFabricIds.length) {
        if (!this.data.cutFabrics.length) this.askFeed('还没有面料', '去新建发面料？', '/pages/supply/parties?role=fabric&create=1')
        else wx.showToast({ title: '请选择面料', icon: 'none' })
        return
      }
      const codes = styleCodes(this.data.cutFabrics, this.data.cutFabricIds)
      if (codes.length > 1) {
        wx.showToast({ title: '请选同一款的面料', icon: 'none' })
        return
      }
      if (codes.length === 1) productCode = codes[0]
      else if (!productCode) {
        wx.showToast({ title: '这批面料还没有款号', icon: 'none' })
        return
      }
    }
    if (this.data.needBatch && this.data.docType !== 'cut') {
      if (!this._codes.length) await this.loadCodes()
      if (!productCode) {
        wx.showToast({ title: '请填写货号', icon: 'none' })
        return
      }
      const exact = this._codes.find((code) => code.toLowerCase() === productCode.toLowerCase())
      if (this._codes.length && !exact) {
        wx.showToast({ title: '请从货号里选择', icon: 'none' })
        return
      }
      if (exact) productCode = exact
    }
    if (this.data.pickParty && this.data.docType !== 'cut' && !this.data.pickedPartyId) {
      const label = this.data.partyLabel || '往来'
      wx.showToast({
        title: this.data.partyChoices.length ? `请选择${label}` : `请先建立${label}`,
        icon: 'none',
      })
      return
    }
    const needCut = this.data.docType === 'delivery' && this.data.role === 'factory' && this.data.batchMode === 'cmt'
    if (needCut && !this.data.deliveryCutId) {
      wx.showToast({ title: '请选择裁剪记录', icon: 'none' })
      return
    }
    if (needCut) {
      const cut = this.data.deliveryCuts.find((item) => item.id === this.data.deliveryCutId)
      const adding = Number(this.data.qty) || 0
      if (cut && cut.cutQty > 0) {
        const own = this.data.editingId && cut.id === this.data.deliveryOwnCutId ? this.data.deliveryOwnQty : 0
        const already = Math.max(0, cut.deliveredQty - own)
        if (already + adding > cut.cutQty + 0.001) {
          wx.showToast({
            title: `已送${pieceText(already)}件，不能超过裁剪${pieceText(cut.cutQty)}件`,
            icon: 'none',
          })
          return
        }
      }
    }
    if (this.data.showFactory && !this.data.factoryId) {
      wx.showToast({ title: this.data.factories.length ? '请选择加工厂' : '请先建立加工厂', icon: 'none' })
      return
    }
    let quoted = 0
    const cutSum = this.data.docType === 'cut' ? sizeQtySum(this.data.sizeRatios) : 0
    const cutQty = this.data.docType === 'cut' ? (Number(this.data.qty) || 0) : 0
    if (this.data.docType === 'cut') {
      if (!(cutQty > 0)) {
        wx.showToast({ title: '请填写裁剪总数', icon: 'none' })
        return
      }
      if (this.data.sizeRatios.some((row) => Number(row.ratio) > 0 && !String(row.size || '').trim())) {
        wx.showToast({ title: '请填写尺码', icon: 'none' })
        return
      }
      if (!(cutSum > 0)) {
        wx.showToast({ title: '请填写各尺码件数', icon: 'none' })
        return
      }
      if (Math.abs(cutSum - cutQty) > 0.001) {
        wx.showToast({ title: `尺码合计 ${pieceText(cutSum)} 件，要等于裁剪总数`, icon: 'none' })
        return
      }
    }
    if (this.data.docType === 'fabric_in') {
      if (!this.data.materialId) {
        wx.showToast({ title: this.data.materials.length ? '请选择面料' : '请先建立面料', icon: 'none' })
        return
      }
      quoted = this.quotedFabricPrice()
      if (!(quoted > 0)) {
        wx.showToast({ title: '请先填写该面料单价', icon: 'none' })
        return
      }
    }
    this.setData({ busy: true })
    const useMeters = this.data.docType === 'fabric_in' || this.data.docType === 'issue' || this.data.docType === 'leftover'
    const measure = this.data.docType === 'cut' ? cutQty : (Number(useMeters ? this.data.meters : this.data.qty) || 0)
    let price = this.data.docType === 'fabric_in' ? quoted : (Number(this.data.unitPrice) || 0)
    if (this.locksProcess()) {
      if (!this._codes.length) await this.loadCodes()
      price = this.processFee(productCode)
      if (!(price > 0)) {
        this.setData({ busy: false })
        this.onCreateProcess()
        return
      }
    }
    const slipPath = this.data.slipPath
    const payload = {
      logisticsNo: this.data.logisticsNo,
      logisticsName: this.data.logisticsName,
      issuedAt: this.data.showIssuedAt ? `${this.data.issuedDate} ${this.data.issuedClock}` : '',
      paid: !!this.data.paid,
      factoryPartyId: this.data.docType === 'cut'
        ? (this.data.factoryId || Number(this.data.partyId) || 0)
        : (this.data.showFactory ? this.data.factoryId : undefined),
      fabricDocIds: this.data.docType === 'cut' ? this.data.cutFabricIds : undefined,
      trimDocIds: this.data.docType === 'cut' ? this.data.cutTrimIds : undefined,
      cutDocId: this.data.docType === 'delivery' && this.data.role === 'factory' && this.data.batchMode === 'cmt'
        ? (this.data.deliveryCutId || 0)
        : undefined,
      lines: [{
        materialId: this.data.materialId || undefined,
        productCode,
        size: this.data.docType === 'cut' ? packRatio(this.data.sizeRatios) : (this.data.docType === 'delivery' ? '' : this.data.size.trim()),
        bolts: Number(this.data.bolts) || 0,
        meters: Number(this.data.meters) || 0,
        qty: this.data.docType === 'cut' ? cutQty : (Number(this.data.qty) || 0),
        unitPrice: price,
        amount: Math.round(measure * price * 100) / 100,
      }],
    }
    if (this.data.editingId) {
      const updated = await updateSupplyDoc(this.data.editingId, payload)
      const editedId = this.data.editingId
      this.setData({ busy: false })
      if (!updated.ok) {
        wx.showToast({ title: updated.message || '保存失败', icon: 'none' })
        return
      }
      if (slipPath) {
        if (!(await assertMediaCheckAsync({ filePath: slipPath, mediaType: 2, scene: 1 }))) return
        const up = await uploadProductImage(slipPath)
        if (!up.ok || !up.url) {
          wx.showToast({ title: up.error || '物流单照片没传上', icon: 'none' })
          return
        }
        const saved = await addSupplyDocFile(editedId, up.url)
        if (!saved.ok) {
          wx.showToast({ title: saved.message || '物流单照片没挂上', icon: 'none' })
          return
        }
        this.setData({ slipPath: '' })
      }
      wx.showToast({ title: '修改成功', icon: 'success' })
      this.triggerEvent('saved')
      void this.loadCutFeeds()
      return
    }
    let partyId = Number(this.data.partyId) || this.data.pickedPartyId
    if (this.data.docType === 'cut' && this.data.factoryId) partyId = this.data.factoryId
    if (this.data.docType === 'cut' && !partyId) {
      this.setData({ busy: false })
      wx.showToast({ title: '请选择加工厂', icon: 'none' })
      return
    }
    let batchId: number | undefined
    const linkedCut = this.data.docType === 'delivery' && this.data.batchMode === 'cmt'
      ? this.data.deliveryCuts.find((item) => item.id === this.data.deliveryCutId)
      : undefined
    if (linkedCut && linkedCut.batchId) {
      batchId = linkedCut.batchId
      if (linkedCut.partyId) partyId = linkedCut.partyId
    } else if (this.data.needBatch) {
      const mode = this.data.role === 'supplier' ? 'buy' : (this.data.docType === 'delivery' ? this.data.batchMode : 'cmt')
      const batch = await createSupplyBatch({
        mode,
        partyId,
        productCode,
      })
      if (!batch.ok || !batch.data) {
        this.setData({ busy: false })
        wx.showToast({ title: batch.message || '批次失败', icon: 'none' })
        return
      }
      batchId = batch.data.id
    }
    const created = await createSupplyDoc({
      uid: newSupplyUid(),
      docType: this.data.docType,
      role: this.data.role,
      partyId,
      batchId,
      ...payload,
    })
    this.setData({ busy: false })
    if (!created.ok || !created.data) {
      wx.showToast({ title: created.message || '保存失败', icon: 'none' })
      return
    }
    const id = Number(created.data.id)
    let slipOk = true
    if (slipPath) {
      if (!(await assertMediaCheckAsync({ filePath: slipPath, mediaType: 2, scene: 1 }))) return
      const up = await uploadProductImage(slipPath)
      if (!up.ok || !up.url) {
        slipOk = false
        wx.showToast({ title: up.error || '物流单照片没传上', icon: 'none' })
      } else {
        const saved = await addSupplyDocFile(id, up.url)
        if (!saved.ok) {
          slipOk = false
          wx.showToast({ title: saved.message || '物流单照片没挂上', icon: 'none' })
        }
      }
    }
    if (slipOk) {
      wx.showToast({ title: '保存成功', icon: 'success' })
      this.triggerEvent('saved')
    }
    this.applyType(this.data.docType)
    void this.loadCutFeeds()
    void this.loadDocs()
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    if (this.data.docType === 'fabric_in') return
    const status = String(e.currentTarget.dataset.status || '')
    if (status !== 'draft' && status !== 'pending') return
    this.setData({
      acceptId: Number(e.currentTarget.dataset.id),
      acceptNo: String(e.currentTarget.dataset.no || ''),
      acceptStatus: status,
      acceptPhoto: '',
    })
  },

  onEditDoc(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const doc = this._docs.find((item) => Number(item.id) === id)
    if (doc) this.fillDoc(doc)
  },

  fillDoc(doc: Record<string, unknown>) {
    const id = Number(doc.id)
    const lines = Array.isArray(doc.lines) ? doc.lines as Array<Record<string, unknown>> : []
    const line = lines[0] || {}
    const issued = String(doc.issuedAt || '')
    const materialId = Number(line.materialId) || 0
    const materialIndex = this.data.materials.findIndex((item) => item.id === materialId)
    const picked = materialIndex >= 0 ? this.data.materials[materialIndex] : undefined
    const unitPrice = this.data.docType === 'fabric_in'
      ? fabricPriceText(picked)
      : (line.unitPrice ? String(line.unitPrice) : '')
    const factoryId = this.data.docType === 'cut'
      ? (Number(doc.partyId) || 0)
      : (Number(doc.factoryPartyId) || 0)
    const cutFabricIds = idList(doc.fabricDocIds, doc.fabricDocId)
    const cutTrimIds = idList(doc.trimDocIds, doc.trimDocId)
    const deliveryCutId = Number(doc.cutDocId) || 0
    const ownQty = lines.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
    const storedQty = Number(line.qty) || 0
    const sizeRows = this.data.docType === 'cut'
      ? unpackCutPieces(String(line.size || ''), storedQty)
      : [emptyRatio()]
    const pieceSum = this.data.docType === 'cut' ? sizeQtySum(sizeRows) : 0
    this.setData({
      editingId: id,
      anchor: 'editor',
      productCode: String(line.productCode || ''),
      codeHits: [],
      meters: line.meters ? String(line.meters) : '',
      qty: this.data.docType === 'cut'
        ? (storedQty > 0 ? pieceText(storedQty) : (pieceSum > 0 ? pieceText(pieceSum) : ''))
        : (line.qty ? String(line.qty) : ''),
      unitPrice,
      size: String(line.size || ''),
      sizeRatios: sizeRows,
      sizeRatioText: this.data.docType === 'cut' && pieceSum > 0 ? `尺码合计 ${pieceText(pieceSum)} 件` : '',
      materialUnitText: this.data.docType === 'cut' ? materialCostText(doc.materialUnitCost) : '',
      bolts: line.bolts ? String(line.bolts) : '',
      logisticsNo: String(doc.logisticsNo || ''),
      logisticsName: String(doc.logisticsName || ''),
      materialId,
      materialIndex: materialIndex >= 0 ? materialIndex : 0,
      factoryId,
      factoryIndex: Math.max(0, this.data.factories.findIndex((item) => item.id === factoryId)),
      cutFabricIds,
      cutTrimIds,
      cutFabricText: pickManyText(this.data.cutFabrics, cutFabricIds, '稍后选择'),
      cutTrimText: pickManyText(this.data.cutTrims, cutTrimIds, '稍后选择'),
      cutFactoryText: pickName(this.data.factories, factoryId, '请选择加工厂'),
      deliveryCutId,
      deliveryOwnQty: this.data.docType === 'delivery' ? ownQty : 0,
      deliveryOwnCutId: this.data.docType === 'delivery' ? deliveryCutId : 0,
      deliveryCutText: pickName(this.data.deliveryCuts, deliveryCutId, '请选择裁剪'),
      issuedDate: issued.slice(0, 10) || this.data.issuedDate,
      issuedClock: issued.slice(11, 16) || this.data.issuedClock,
      slipPath: '',
      paid: !!doc.paid,
      amountText: lineAmount(
        this.data.docType,
        line.meters ? String(line.meters) : '',
        line.qty ? String(line.qty) : '',
        unitPrice,
      ),
    })
    void this.applyProcessPrice(String(line.productCode || ''))
  },

  onCancelEdit() {
    this.applyType(this.data.docType)
  },

  async onTogglePaid(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id || this.data.busy) return
    const paid = e.currentTarget.dataset.paid === true || e.currentTarget.dataset.paid === 'true' || e.currentTarget.dataset.paid === 1
    const out = await setSupplyDocPaid(id, !paid)
    if (!out.ok) {
      wx.showToast({ title: out.message || '没改成', icon: 'none' })
      return
    }
    void this.loadDocs()
  },

  onDeleteDoc(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const no = String(e.currentTarget.dataset.no || '')
    wx.showModal({
      title: '删除这条记录',
      content: no ? `删除 ${no}？` : '删除后不能恢复',
      success: async (res) => {
        if (!res.confirm) return
        const out = await deleteSupplyDoc(id)
        if (!out.ok) {
          wx.showToast({ title: out.message || '删除失败', icon: 'none' })
          return
        }
        if (this.data.editingId === id) this.applyType(this.data.docType)
        void this.loadDocs()
      },
    })
  },

  onCloseAccept() {
    if (this.data.busy) return
    this.setData({ acceptId: 0, acceptNo: '', acceptStatus: '', acceptPhoto: '' })
  },

  noop() {},

  onAcceptPhoto(e: WechatMiniprogram.TouchEvent) {
    const source = String(e.currentTarget.dataset.source || 'album')
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: source === 'camera' ? ['camera'] : ['album'],
      success: (picked) => {
        const path = picked.tempFiles && picked.tempFiles[0] && picked.tempFiles[0].tempFilePath
        if (path) this.setData({ acceptPhoto: path })
      },
    })
  },

  async onConfirmAccept() {
    if (this.data.docType === 'fabric_in') return
    const id = this.data.acceptId
    if (!id || this.data.busy) return
    this.setData({ busy: true })
    if (this.data.acceptPhoto) {
      if (!(await assertMediaCheckAsync({ filePath: this.data.acceptPhoto, mediaType: 2, scene: 1 }))) {
        this.setData({ busy: false })
        return
      }
      const up = await uploadProductImage(this.data.acceptPhoto)
      if (!up.ok || !up.url) {
        this.setData({ busy: false })
        wx.showToast({ title: up.error || '照片没传上', icon: 'none' })
        return
      }
      const saved = await addSupplyDocFile(id, up.url)
      if (!saved.ok) {
        this.setData({ busy: false })
        wx.showToast({ title: saved.message || '照片没挂上', icon: 'none' })
        return
      }
    }
    if (this.data.acceptStatus === 'draft') {
      const submitted = await submitSupplyDoc(id)
      if (!submitted.ok) {
        this.setData({ busy: false })
        wx.showToast({ title: submitted.message || '提交失败', icon: 'none' })
        return
      }
    }
    const accepted = await acceptSupplyDoc(id)
    this.setData({ busy: false })
    if (!accepted.ok) {
      wx.showToast({ title: accepted.message || '验收失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已验收', icon: 'none' })
    this.setData({ acceptId: 0, acceptNo: '', acceptStatus: '', acceptPhoto: '' })
    void this.loadDocs()
  },

  onEdit() {
    this.setData({ editOn: true })
  },

  onCloseEdit() {
    this.setData({ editOn: false })
  },

  onPartySaved() {
    this.setData({ editOn: false })
    void this.loadParty()
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  onDeleteStatement(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    wx.showModal({
      title: '删除对账单',
      content: '对账单和付款截图会一起删除，单据照片仍留在单据上',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteSupplyStatement(id)
        if (!r.ok) {
          wx.showToast({ title: r.message || '删除失败', icon: 'none' })
          return
        }
        void this.loadDocs()
      },
    })
  },
  },
})
