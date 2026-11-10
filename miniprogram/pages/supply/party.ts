import {
  disableSupplyParty,
  fetchSupplyParties,
  newSupplyUid,
  saveSupplyParty,
  type SupplyParty,
} from '../../services/supply'

const ROLE_DEFS = [
  { key: 'fabric', label: '面料商' },
  { key: 'trim', label: '辅料商' },
  { key: 'factory', label: '加工厂' },
  { key: 'supplier', label: '供应商' },
]

Page({
  _snap: '',
  data: {
    id: 0,
    uid: '',
    name: '',
    phone: '',
    remark: '',
    settleMode: 'monthly',
    roles: ROLE_DEFS.map((r) => ({ ...r, on: false })),
    busy: false,
  },

  onLoad(query: Record<string, string>) {
    const id = Number(query.id || 0)
    const role = query.role || ''
    const roles = ROLE_DEFS.map((r) => ({ ...r, on: r.key === role }))
    this.setData({ id, uid: newSupplyUid(), roles })
    if (id) void this.load(id)
  },

  async load(id: number) {
    const r = await fetchSupplyParties()
    const item = (r.data?.items || []).find((p: SupplyParty) => p.id === id)
    if (!item) return
    const picked = new Set(item.roles || [])
    const roles = ROLE_DEFS.map((role) => ({ ...role, on: picked.has(role.key) }))
    const name = item.name
    const phone = item.phone || ''
    const remark = item.remark || ''
    const settleMode = item.settleMode || 'monthly'
    this._snap = JSON.stringify({
      name: name.trim(),
      phone: phone.trim(),
      settleMode,
      remark: remark.trim(),
      roles: roles.filter((role) => role.on).map((role) => role.key),
    })
    this.setData({
      uid: item.uid,
      name,
      phone,
      remark,
      settleMode,
      roles,
    })
  },

  onName(e: WechatMiniprogram.Input) { this.setData({ name: e.detail.value }) },
  onPhone(e: WechatMiniprogram.Input) { this.setData({ phone: e.detail.value }) },
  onRemark(e: WechatMiniprogram.Input) { this.setData({ remark: e.detail.value }) },
  onSettle(e: WechatMiniprogram.TouchEvent) {
    this.setData({ settleMode: String(e.currentTarget.dataset.mode || 'monthly') })
  },
  onRole(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    const roles = this.data.roles.map((r) => (r.key === key ? { ...r, on: !r.on } : r))
    this.setData({ roles })
  },

  async onSave() {
    if (this.data.busy) return
    const roles = this.data.roles.filter((r) => r.on).map((r) => r.key)
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    if (!roles.length) {
      wx.showToast({ title: '请选择身份', icon: 'none' })
      return
    }
    const body = {
      name: this.data.name.trim(),
      phone: this.data.phone.trim(),
      settleMode: this.data.settleMode,
      remark: this.data.remark.trim(),
      roles,
    }
    if (this.data.id && !this._snap) {
      wx.showToast({ title: '正在加载', icon: 'none' })
      return
    }
    if (this.data.id && JSON.stringify(body) === this._snap) {
      wx.showToast({ title: '未修改，不用保存', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await saveSupplyParty({
      id: this.data.id || undefined,
      uid: this.data.uid,
      ...body,
    })
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || '保存失败', icon: 'none' })
      return
    }
    wx.navigateBack()
  },

  onDisable() {
    if (!this.data.id) return
    wx.showModal({
      title: '停用往来',
      content: '停用后这家不计入欠款，外面的数字会去掉这家。记录还在，可以再启用。',
      success: async (res) => {
        if (!res.confirm) return
        const r = await disableSupplyParty(this.data.id)
        if (!r.ok) {
          wx.showToast({ title: r.message || '停用失败', icon: 'none' })
          return
        }
        wx.navigateBack()
      },
    })
  },
})
