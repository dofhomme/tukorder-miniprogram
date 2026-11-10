import { deleteSupplyParty, enableSupplyParty, fetchSupplyDocs, fetchSupplyParties, fetchSupplyRecentDocs, setSupplyDocAccepted, setSupplyDocPaid, type SupplyParty } from '../../services/supply'

const DOC_LABEL: Record<string, string> = {
  fabric_in: '发面料',
  trim_in: '发辅料',
  issue: '发料',
  cut: '裁剪',
  delivery: '送货',
  leftover: '余料',
  po: '补货',
}

const STATUS: Record<string, string> = {
  pending: '待验收',
  accepted: '已验收',
  posted: '已入账',
}

function statusLabel(status: string, docType: string, boundCutId = 0) {
  const material = docType === 'fabric_in' || docType === 'trim_in'
  if (material && (status === 'accepted' || status === 'posted' || boundCutId > 0)) return '已裁'
  if (!status || status === 'draft') return ''
  return STATUS[status] || ''
}

function recordTime(item: Record<string, unknown>) {
  const issued = String(item.issuedAt || '').trim()
  const created = String(item.createdAt || '').trim()
  return (issued || created).replace('T', ' ').slice(0, 16)
}

function qtyText(n: number) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000
  return v ? String(v) : '0'
}

function recordLine(item: Record<string, unknown>, mode: 'full' | 'cut' | 'ship' = 'full', role = '') {
  const lines = Array.isArray(item.lines) ? item.lines as Array<Record<string, unknown>> : []
  const line = lines[0] || {}
  const meters = Number(line.meters) || 0
  const qty = Number(line.qty) || 0
  const bolts = Number(line.bolts) || 0
  const docType = String(item.docType || '')
  const factoryName = String(item.factoryName || '').trim()
  const bits = [
    mode === 'full' ? (DOC_LABEL[docType] || '') : '',
    mode === 'ship' ? '' : String(line.productCode || ''),
    meters ? `${meters}米` : '',
    qty ? `${qtyText(qty)}件` : '',
    bolts ? `${bolts}匹` : '',
  ].filter(Boolean)
  const amount = Number(item.amount) || 0
  const status = String(item.status || '')
  const delivered = Number(item.deliveredQty) || 0
  const bound = Number(item.boundCutId) || 0
  const material = docType === 'fabric_in' || docType === 'trim_in'
  const accepted = status === 'accepted' || status === 'posted' || (material && bound > 0)
  const canToggleAccept = material || (role === 'supplier' && (docType === 'po' || docType === 'delivery'))
  const canPay = docType === 'fabric_in' || docType === 'trim_in' || docType === 'po' || docType === 'delivery'
  return {
    id: Number(item.id),
    docType,
    cutDocId: Number(item.cutDocId) || 0,
    text: bits.join(' · ') || String(item.docNo || ''),
    sentText: docType === 'cut' ? (delivered > 0 ? `已送${qtyText(delivered)}件` : '还没送货') : '',
    done: docType === 'cut' && qty > 0 && delivered + 0.001 >= qty,
    filledBy: String(item.filledBy || ''),
    factoryText: (docType === 'fabric_in' || docType === 'trim_in') && factoryName ? `发往 ${factoryName}` : '',
    canAccept: docType === 'delivery' && role !== 'supplier' && status !== 'accepted' && status !== 'posted',
    canToggleAccept,
    accepted,
    acceptText: accepted ? '已验收' : '未验收',
    boundCutId: bound,
    productCode: String(line.productCode || ''),
    qty: lines.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    amount: `¥${amount.toFixed(2)}`,
    timeText: recordTime(item),
    statusText: canToggleAccept ? '' : statusLabel(status, docType, bound),
    canPay,
    paid: !!item.paid,
  }
}

type RecordRow = ReturnType<typeof recordLine>
type CutGroup = RecordRow & { ships: RecordRow[] }

function groupCuts(cuts: RecordRow[], ships: RecordRow[]) {
  const ids = new Set(cuts.map((cut) => cut.id))
  const by = new Map<number, RecordRow[]>()
  ships.forEach((ship) => {
    if (!ship.cutDocId || !ids.has(ship.cutDocId)) return
    const list = by.get(ship.cutDocId) || []
    list.push(ship)
    by.set(ship.cutDocId, list)
  })
  return cuts.map((cut) => ({ ...cut, ships: by.get(cut.id) || [] }))
}

const TITLES: Record<string, string> = {
  fabric: '面料商',
  trim: '辅料商',
  factory: '加工厂',
  supplier: '供应商',
}

const PAGE = 10

type PartyRow = SupplyParty & {
  labelText: string
  unpaidText: string
  folded: boolean
  recordsReady: boolean
  records: RecordRow[]
  groups: CutGroup[]
}

Page({
  _all: [] as Array<SupplyParty & { labelText: string; unpaidText: string }>,
  _folded: {} as Record<number, boolean>,
  _records: {} as Record<number, RecordRow[]>,
  _groups: {} as Record<number, CutGroup[]>,
  _loadSeq: 0,
  _openCreate: false,
  _openParty: false,
  _didOpen: false,
  data: {
    role: '',
    title: '往来',
    loaded: false,
    more: false,
    items: [] as PartyRow[],
    disabledItems: [] as Array<SupplyParty & { unpaidText: string }>,
    acceptOn: false,
    acceptId: 0,
    acceptCode: '',
    acceptQty: 0,
    benchOn: false,
    benchId: 0,
    benchEditId: 0,
    benchEditType: '',
    partyOn: false,
    formId: 0,
  },

  onLoad(query: Record<string, string>) {
    const role = query.role || ''
    const title = TITLES[role] || '往来'
    this._openCreate = query.create === '1'
    this._openParty = query.createParty === '1'
    this.setData({ role, title })
    wx.setNavigationBarTitle({ title })
  },

  onShow() {
    void this.load()
  },

  async load() {
    const role = this.data.role || undefined
    const [r, off] = await Promise.all([
      fetchSupplyParties(role),
      fetchSupplyParties(role, 'disabled'),
    ])
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '加载失败', icon: 'none' })
      return
    }
    const disabledItems = (off.data?.items || []).map((item) => ({
      ...item,
      unpaidText: '-¥0.00',
    }))
    this.setData({ disabledItems })
    const pageTitle = this.data.title
    this._all = (r.data.items || []).map((item) => ({
      ...item,
      labelText: (item.roleLabels || []).filter((label) => label !== pageTitle).join(' · '),
      unpaidText: item.unpaid == null ? '' : `-¥${Number(item.unpaid).toFixed(2)}`,
    }))
    const count = Math.max(PAGE, this.data.items.length)
    const seq = ++this._loadSeq
    this.paint(count)
    this.openAsked()
    const records: Record<number, RecordRow[]> = {}
    const groups: Record<number, CutGroup[]> = {}
    await this.fillRecords(this._all.slice(0, count), { records, groups })
    if (seq !== this._loadSeq) return
    this._records = records
    this._groups = groups
    this.paint(Math.max(count, this.data.items.length))
  },

  openAsked() {
    if (this._didOpen) return
    if (this._openParty) {
      this._didOpen = true
      this.onCreate()
      return
    }
    if (this._openCreate) {
      this._didOpen = true
      this.onCreateRecord()
    }
  },

  async fillRecords(
    list: Array<SupplyParty & { labelText: string; unpaidText: string }>,
    target?: { records: Record<number, RecordRow[]>; groups: Record<number, CutGroup[]> },
  ) {
    const records = target ? target.records : this._records
    const groups = target ? target.groups : this._groups
    const factory = this.data.role === 'factory'
    const todo = list.filter((item) => !records[item.id])
    if (!todo.length) return
    const ids = todo.map((item) => item.id)
    const chunks: number[][] = []
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))
    const results = await Promise.all(chunks.map((chunk) => fetchSupplyRecentDocs(chunk, factory)))
    if (results.every((r) => r.ok && r.data && r.data.parties)) {
      const parties: Record<string, { items?: Array<Record<string, unknown>>; cut?: Array<Record<string, unknown>>; delivery?: Array<Record<string, unknown>> }> = {}
      for (const r of results) Object.assign(parties, r.data!.parties)
      for (const item of todo) {
        const hit = parties[String(item.id)] || {}
        if (factory) {
          const cutRows = (hit.cut || []).map((row) => recordLine(row, 'cut', 'factory'))
          const shipRows = (hit.delivery || []).map((row) => recordLine(row, 'ship', 'factory'))
          groups[item.id] = groupCuts(cutRows, shipRows)
          records[item.id] = cutRows.concat(shipRows)
        } else {
          const rows = (hit.items || []).filter((row) => row.docType !== 'issue' && row.docType !== 'leftover')
          records[item.id] = rows.slice(0, 5).map((row) => recordLine(row, 'full', this.data.role))
        }
      }
      return
    }
    await Promise.all(todo.map(async (item) => {
      if (factory) {
        const [cuts, deliveries] = await Promise.all([
          fetchSupplyDocs(item.id, 'cut', { limit: 4 }),
          fetchSupplyDocs(item.id, 'delivery', { limit: 40 }),
        ])
        const cutRows = (cuts.ok && cuts.data ? cuts.data.items || [] : []).map((row) => recordLine(row, 'cut', 'factory'))
        const shipRows = (deliveries.ok && deliveries.data ? deliveries.data.items || [] : []).map((row) => recordLine(row, 'ship', 'factory'))
        groups[item.id] = groupCuts(cutRows, shipRows)
        records[item.id] = cutRows.concat(shipRows)
        return
      }
      const r = await fetchSupplyDocs(item.id, undefined, { limit: 8 })
      const rows = r.ok && r.data ? (r.data.items || []).filter((row) => row.docType !== 'issue' && row.docType !== 'leftover') : []
      records[item.id] = rows.slice(0, 5).map((row) => recordLine(row, 'full', this.data.role))
    }))
  },

  paint(count: number) {
    const slice = this._all.slice(0, count)
    this.setData({
      loaded: true,
      items: slice.map((item) => ({
        ...item,
        folded: !!this._folded[item.id],
        recordsReady: this._records[item.id] !== undefined,
        records: this._records[item.id] || [],
        groups: this._groups[item.id] || [],
      })),
      more: this._all.length > count,
    })
  },

  onMore() {
    if (!this.data.more) return
    const n = this.data.items.length + PAGE
    void this.fillRecords(this._all.slice(this.data.items.length, n)).then(() => this.paint(n))
  },

  onAccept(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id || this.data.role === 'supplier') return
    this.setData({
      acceptOn: true,
      acceptId: id,
      acceptCode: String(e.currentTarget.dataset.code || ''),
      acceptQty: Number(e.currentTarget.dataset.qty) || 0,
    })
  },

  onAcceptDone() {
    this.setData({ acceptOn: false, acceptId: 0 })
    wx.showToast({ title: '已验收', icon: 'success' })
    void this.load()
  },

  onAcceptFail(e: WechatMiniprogram.CustomEvent) {
    this.setData({ acceptOn: false, acceptId: 0 })
    wx.showToast({ title: (e.detail && e.detail.message) || '验收失败', icon: 'none' })
  },

  onAcceptClose() {
    this.setData({ acceptOn: false, acceptId: 0 })
  },

  async onTogglePaid(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    const paid = e.currentTarget.dataset.paid === true || e.currentTarget.dataset.paid === 'true' || e.currentTarget.dataset.paid === 1
    const out = await setSupplyDocPaid(id, !paid)
    if (!out.ok) {
      wx.showToast({ title: out.message || '没改成', icon: 'none' })
      return
    }
    void this.load()
  },

  async onToggleAccept(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    const accepted = e.currentTarget.dataset.accepted === true || e.currentTarget.dataset.accepted === 'true' || e.currentTarget.dataset.accepted === 1
    const bound = Number(e.currentTarget.dataset.bound) || 0
    if (accepted && bound) {
      wx.showToast({ title: '已经用于裁剪', icon: 'none' })
      return
    }
    const out = await setSupplyDocAccepted(id, !accepted)
    if (!out.ok) {
      wx.showToast({ title: out.message || '没改成', icon: 'none' })
      return
    }
    void this.load()
  },

  onAll(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    const name = encodeURIComponent(String(e.currentTarget.dataset.name || ''))
    wx.navigateTo({
      url: `/pages/supply/records?partyId=${id}&role=${encodeURIComponent(this.data.role)}&name=${name}`,
    })
  },

  onFold(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    this._folded[id] = !this._folded[id]
    this.paint(this.data.items.length)
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    this.setData({ partyOn: true, formId: id })
  },

  onEditRecord(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const partyId = Number(e.currentTarget.dataset.party)
    if (!id || !partyId) return
    this.setData({
      benchOn: true,
      benchId: partyId,
      benchEditId: id,
      benchEditType: String(e.currentTarget.dataset.type || ''),
    })
  },

  onCloseBench() {
    this.setData({ benchOn: false, benchId: 0, benchEditId: 0, benchEditType: '' })
    void this.load()
  },

  onJumpFactory() {
    this.setData({
      benchOn: false,
      benchId: 0,
      benchEditId: 0,
      benchEditType: '',
      partyOn: true,
      formId: 0,
    })
  },

  onCreateRecord() {
    this.setData({ benchOn: true, benchId: 0, benchEditId: 0, benchEditType: '' })
  },

  onCreateTyped(e: WechatMiniprogram.TouchEvent) {
    const editType = String(e.currentTarget.dataset.type || '')
    this.setData({ benchOn: true, benchId: 0, benchEditId: 0, benchEditType: editType })
  },

  async onEnable(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    if (!id) return
    const out = await enableSupplyParty(id)
    if (!out.ok) {
      wx.showToast({ title: out.message || '启用失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已启用', icon: 'success' })
    void this.load()
  },

  onDeleteParty(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const name = String(e.currentTarget.dataset.name || '这家')
    if (!id) return
    wx.showModal({
      title: '删除往来',
      content: `只有没开过单、没对过账的往来户能删除；已有记录的请用停用。确定删除「${name}」？`,
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const out = await deleteSupplyParty(id)
        if (!out.ok) {
          wx.showToast({ title: out.message || '删除失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已删除', icon: 'success' })
        void this.load()
      },
    })
  },

  onCreate() {
    this.setData({ partyOn: true, formId: 0 })
  },

  onCloseParty() {
    this.setData({ partyOn: false, formId: 0 })
  },

  onPartySaved() {
    this.setData({ partyOn: false, formId: 0 })
    void this.load()
  },
})
