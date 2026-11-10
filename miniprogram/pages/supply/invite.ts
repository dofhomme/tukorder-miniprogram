import {
  archiveSupplyInvite,
  createSupplyInvite,
  fetchSupplyDocs,
  fetchSupplyInvite,
  fetchSupplyInvites,
  recognizeSupplyInvite,
  revokeSupplyInvite,
  saveSupplyInviteLines,
} from '../../services/supply'

const STATUS: Record<string, string> = {
  open: '待填写',
  submitted: '待归档',
  archived: '已归档',
  revoked: '已作废',
  expired: '已过期',
}

function fabricLabel(doc: Record<string, unknown>) {
  const lines = (doc.lines || []) as Array<{ productCode?: string; meters?: number; bolts?: number }>
  const code = (lines[0] && lines[0].productCode) || ''
  const meters = lines.reduce((sum, line) => sum + (Number(line.meters) || 0), 0)
  const bolts = lines.reduce((sum, line) => sum + (Number(line.bolts) || 0), 0)
  const date = String(doc.issuedAt || doc.createdAt || '').slice(0, 10)
  const bits = [code || String(doc.docNo || '面料')]
  if (bolts) bits.push(`${bolts}匹`)
  if (meters) bits.push(`${meters}米`)
  if (date) bits.push(date)
  return { code, label: bits.join(' · ') }
}

Page({
  _snap: '',
  _ready: false,
  data: {
    partyId: 0,
    id: 0,
    hours: '24',
    batches: [] as Array<{ docId: number; productCode: string; label: string }>,
    chosenDocId: 0,
    chosenLabel: '',
    invites: [] as Array<Record<string, unknown>>,
    item: null as Record<string, unknown> | null,
    token: '',
    qtyText: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      partyId: Number(query.partyId || 0),
      id: Number(query.id || 0),
    })
  },

  onShow() {
    if (this.data.id) void this.loadOne()
    else void this.loadList()
  },

  async loadList() {
    const [docs, invites] = await Promise.all([
      fetchSupplyDocs(0, 'fabric_in', {
        factoryPartyId: this.data.partyId,
        unaccepted: true,
        limit: 100,
      }),
      fetchSupplyInvites(this.data.partyId),
    ])
    if (!docs.ok) {
      wx.showToast({ title: docs.message || '面料加载失败', icon: 'none' })
    }
    const batches = (docs.data?.items || [])
      .filter((doc) => doc.docType === 'fabric_in')
      .filter((doc) => doc.status === 'draft' || doc.status === 'pending')
      .filter((doc) => !this.data.partyId || Number(doc.factoryPartyId) === this.data.partyId)
      .map((doc) => {
        const shown = fabricLabel(doc)
        return { docId: Number(doc.id), productCode: shown.code, label: shown.label }
      })
    this.setData({
      batches,
      invites: (invites.data?.items || []).map((item) => ({
        ...item,
        statusText: STATUS[String(item.status || '')] || item.status,
      })),
    })
  },

  async loadOne() {
    const r = await fetchSupplyInvite(this.data.id)
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '加载失败', icon: 'none' })
      return
    }
    const lines = (r.data.lines || []) as Array<{ size?: string; qty?: number; source?: string }>
    const qtyText = lines.map((line) => `${line.size} ${line.qty} (${line.source})`).join('\n')
    this._snap = qtyText.trim()
    this._ready = true
    this.setData({
      item: { ...r.data, statusText: STATUS[String(r.data.status || '')] || r.data.status },
      qtyText,
    })
  },

  onHours(e: WechatMiniprogram.Input) { this.setData({ hours: e.detail.value }) },
  onBatch(e: WechatMiniprogram.TouchEvent) {
    const docId = Number(e.currentTarget.dataset.id)
    const item = this.data.batches.find((row) => row.docId === docId)
    if (!item) return
    this.setData({ chosenDocId: item.docId, chosenLabel: item.label })
  },
  onQty(e: WechatMiniprogram.Input) { this.setData({ qtyText: e.detail.value }) },

  async onCreate() {
    if (!this.data.chosenDocId) {
      wx.showToast({ title: '请选择未验收的面料', icon: 'none' })
      return
    }
    const r = await createSupplyInvite(this.data.chosenDocId, Number(this.data.hours) || 24, this.data.partyId)
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '创建失败', icon: 'none' })
      return
    }
    this.setData({ token: r.data.token, id: r.data.id })
    wx.setClipboardData({
      data: r.data.token,
      complete: () => wx.showToast({ title: '已绑定，面料已验收', icon: 'none' }),
    })
    void this.loadOne()
  },

  onCopy() {
    if (!this.data.token) return
    wx.setClipboardData({ data: this.data.token })
  },

  async onRecognize() {
    const r = await recognizeSupplyInvite(this.data.id)
    if (!r.ok) {
      wx.showToast({ title: r.message || '识别失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已写入识别草稿', icon: 'none' })
    void this.loadOne()
  },

  async onSaveLines() {
    if (!this._ready) {
      wx.showToast({ title: '正在加载', icon: 'none' })
      return
    }
    if (this.data.qtyText.trim() === this._snap) {
      wx.showToast({ title: '未修改，不用保存', icon: 'none' })
      return
    }
    const item = this.data.item || {}
    const code = String(item.productCode || '')
    const lines = this.data.qtyText.split('\n').map((row) => {
      const parts = row.trim().split(/\s+/)
      return { productCode: code, size: parts[0] || '', qty: Number(parts[1]) || 0 }
    }).filter((line) => line.size && line.qty > 0)
    const r = await saveSupplyInviteLines(this.data.id, lines)
    if (!r.ok) {
      wx.showToast({ title: r.message || '保存失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已改成本店核对', icon: 'none' })
    void this.loadOne()
  },

  async onArchive() {
    const r = await archiveSupplyInvite(this.data.id)
    if (!r.ok) {
      wx.showToast({ title: r.message || '归档失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已生成裁剪单', icon: 'none' })
    void this.loadOne()
  },

  async onRevoke() {
    const r = await revokeSupplyInvite(this.data.id)
    if (!r.ok) {
      wx.showToast({ title: r.message || '作废失败', icon: 'none' })
      return
    }
    void this.loadOne()
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    wx.navigateTo({ url: `/pages/supply/invite?id=${id}` })
  },

  onShareAppMessage() {
    return {
      title: '填写裁剪件数',
      path: `/pages/supply/fill?token=${this.data.token}`,
    }
  },
})
