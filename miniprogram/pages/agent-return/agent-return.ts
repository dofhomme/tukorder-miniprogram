import {
  agentOrderKind,
  fetchAgentMe,
  submitAgentReturn,
  type LookupOrder,
} from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId } from '../../services/workspace'
import { assertMsgSecCheck } from '../../services/sec-check'

type PickRow = {
  code: string
  name: string
  max: number
  qty: number
  on: boolean
}

function pickupRows(orders: LookupOrder[]): PickRow[] {
  const map: Record<string, PickRow> = {}
  for (const o of orders) {
    if (o.isReturn) continue
    const kind = agentOrderKind(o.remark)
    if (kind === 'pending' || kind === 'rejected') continue
    for (const it of o.items || []) {
      const code = String(it.productCode || '').trim()
      if (!code) continue
      const q = Number(it.quantity || 0)
      if (!map[code]) {
        map[code] = {
          code,
          name: String(it.productName || code),
          max: 0,
          qty: 1,
          on: false,
        }
      }
      map[code].max += q
    }
  }
  return Object.keys(map)
    .map((k) => map[k])
    .filter((x) => x.max > 0)
    .sort((a, b) => a.code.localeCompare(b.code, 'zh'))
}

Page({
  data: {
    loading: true,
    rows: [] as PickRow[],
    remark: '',
    submitting: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'agentReturn')
  },

  onLoad() {
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
  },

  async refresh() {
    this.setData({ loading: true })
    const me = await fetchAgentMe(peekAgentOwnerId() || undefined, { allOrders: true })
    const orders = me.ok && me.data ? me.data.orders || [] : []
    this.setData({ loading: false, rows: pickupRows(orders) })
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const rows = this.data.rows.map((x) => (x.code === code ? { ...x, on: !x.on } : x))
    this.setData({ rows })
  },

  onQty(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const d = Number(e.currentTarget.dataset.d || 0)
    const rows = this.data.rows.map((x) => {
      if (x.code !== code) return x
      const qty = Math.max(1, Math.min(x.max, x.qty + d))
      return { ...x, qty }
    })
    this.setData({ rows })
  },

  onRemark(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const items = this.data.rows.filter((x) => x.on).map((x) => ({ code: x.code, qty: x.qty }))
    if (!items.length) {
      wx.showToast({ title: t('agentReturnEmpty'), icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([this.data.remark]))) return
    this.setData({ submitting: true })
    const r = await submitAgentReturn(items, {
      ownerUserId: peekAgentOwnerId() || undefined,
      remark: this.data.remark,
    })
    this.setData({ submitting: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    wx.showToast({ title: t('agentReturnOk'), icon: 'none' })
    setTimeout(() => wx.navigateBack(), 400)
  },
})
