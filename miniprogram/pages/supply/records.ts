import { deleteSupplyDoc, fetchSupplyDocs, setSupplyDocAccepted, setSupplyDocPaid } from '../../services/supply'

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

const PAGE = 10

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
  const logistics = [item.logisticsName, item.logisticsNo].filter(Boolean).join(' ')
  return {
    id: Number(item.id),
    docNo: String(item.docNo || ''),
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
    logistics,
    canPay: docType === 'fabric_in' || docType === 'trim_in' || docType === 'po' || docType === 'delivery',
    paid: !!item.paid,
  }
}

type RecordRow = ReturnType<typeof recordLine>
type CutGroup = RecordRow & { ships: RecordRow[] }

function groupCuts(cuts: RecordRow[], ships: RecordRow[]) {
  const ids = new Set(cuts.map((cut) => cut.id))
  const by = new Map<number, RecordRow[]>()
  const loose: RecordRow[] = []
  ships.forEach((ship) => {
    if (ship.cutDocId && ids.has(ship.cutDocId)) {
      const list = by.get(ship.cutDocId) || []
      list.push(ship)
      by.set(ship.cutDocId, list)
      return
    }
    loose.push(ship)
  })
  return {
    groups: cuts.map((cut) => ({ ...cut, ships: by.get(cut.id) || [] })),
    loose,
  }
}

Page({
  _timer: 0 as unknown as number,
  data: {
    partyId: 0,
    role: 'fabric',
    name: '',
    tabs: TABS.fabric,
    docType: '',
    q: '',
    loaded: false,
    more: false,
    grouped: false,
    groups: [] as CutGroup[],
    loose: [] as RecordRow[],
    items: [] as RecordRow[],
    acceptOn: false,
    acceptId: 0,
    acceptCode: '',
    acceptQty: 0,
    benchOn: false,
    editId: 0,
    editType: '',
  },

  onLoad(query: Record<string, string>) {
    const role = TABS[query.role || ''] ? String(query.role) : 'fabric'
    const name = decodeURIComponent(query.name || '') || '全部记录'
    this.setData({
      partyId: Number(query.partyId) || 0,
      role,
      name,
      tabs: TABS[role],
    })
    wx.setNavigationBarTitle({ title: name })
  },

  onShow() {
    if (this.data.benchOn) return
    void this.reload()
  },

  onFind(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value })
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => { void this.reload() }, 300) as unknown as number
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const docType = String(e.currentTarget.dataset.key || '')
    if (docType === this.data.docType) return
    this.setData({ docType })
    void this.reload()
  },

  async reload() {
    const partyId = this.data.partyId
    if (!partyId) return
    const q = this.data.q.trim()
    if (this.data.role === 'factory' && !this.data.docType) {
      const [cuts, deliveries] = await Promise.all([
        fetchSupplyDocs(partyId, 'cut', { q, offset: 0, limit: 100 }),
        fetchSupplyDocs(partyId, 'delivery', { q, offset: 0, limit: 100 }),
      ])
      if (!cuts.ok || !cuts.data || !deliveries.ok || !deliveries.data) {
        wx.showToast({ title: cuts.message || deliveries.message || '加载失败', icon: 'none' })
        return
      }
      const grouped = groupCuts(
        (cuts.data.items || []).map((row) => recordLine(row, 'cut', 'factory')),
        (deliveries.data.items || []).map((row) => recordLine(row, 'ship', 'factory')),
      )
      this.setData({
        loaded: true,
        grouped: true,
        groups: grouped.groups,
        loose: grouped.loose,
        items: [],
        more: false,
      })
      return
    }
    const r = await fetchSupplyDocs(partyId, this.data.docType || undefined, {
      q,
      offset: 0,
      limit: PAGE,
    })
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '加载失败', icon: 'none' })
      return
    }
    const items = (r.data.items || []).filter((row) => row.docType !== 'issue' && row.docType !== 'leftover').map((row) => recordLine(row, 'full', this.data.role))
    this.setData({
      loaded: true,
      grouped: false,
      groups: [],
      loose: [],
      items,
      more: !!r.data.more,
    })
  },

  onMore() {
    if (this.data.grouped || !this.data.more) return
    const offset = this.data.items.length
    void fetchSupplyDocs(this.data.partyId, this.data.docType || undefined, {
      q: this.data.q.trim(),
      offset,
      limit: PAGE,
    }).then((r) => {
      if (!r.ok || !r.data) return
      if (offset !== this.data.items.length) return
      this.setData({
        items: this.data.items.concat((r.data.items || []).filter((row) => row.docType !== 'issue' && row.docType !== 'leftover').map((row) => recordLine(row, 'full', this.data.role))),
        more: !!r.data.more,
      })
    })
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
    void this.reload()
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
    void this.reload()
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
    void this.reload()
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const editId = Number(e.currentTarget.dataset.id)
    if (!editId) return
    this.setData({
      benchOn: true,
      editId,
      editType: String(e.currentTarget.dataset.type || ''),
    })
  },

  onCloseBench() {
    this.setData({ benchOn: false, editId: 0, editType: '' })
    void this.reload()
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const no = String(e.currentTarget.dataset.no || '')
    const docType = String(e.currentTarget.dataset.type || '')
    if (docType === 'cut') {
      wx.showToast({ title: '裁剪只能修改，不能删除', icon: 'none' })
      return
    }
    const isDelivery = docType === 'delivery'
    wx.showModal({
      title: '删除这条记录',
      content: isDelivery
        ? '删除后不能恢复。已经入库的数量会按这次送货减掉。'
        : (no ? `删除 ${no}？` : '删除后不能恢复'),
      success: async (res) => {
        if (!res.confirm) return
        const out = await deleteSupplyDoc(id)
        if (!out.ok) {
          wx.showToast({ title: out.message || '删除失败', icon: 'none' })
          return
        }
        void this.reload()
      },
    })
  },
})
