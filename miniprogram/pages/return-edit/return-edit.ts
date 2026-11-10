import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { isLoggedIn } from '../../services/session'
import { assertMsgSecCheck } from '../../services/sec-check'
import { detectCourier } from '../../services/courier'
import { softDeleteReturnPackage } from '../../services/recycle-bin'
import {
  fetchReturnPackages,
  upsertReturnPackage,
} from '../../services/team'

/** 对齐 App ReturnPackageService.carrierOptions */
const CARRIERS = [
  '顺丰快递',
  '中通快递',
  '圆通快递',
  '韵达快递',
  '申通快递',
  '极兔快递',
  '京东物流',
  '邮政 EMS',
  '德邦快递',
  '其它',
]

type ItemRow = { key: string; code: string; name: string; qty: string }

function newItem(): ItemRow {
  return { key: `i-${Date.now()}-${Math.random()}`, code: '', name: '', qty: '1' }
}

function fmtMetaTime(raw?: string | null): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    cloudUid: '',
    trackingNo: '',
    carrier: '',
    carrierIndex: 0,
    carriers: CARRIERS,
    packageCount: '1',
    remark: '',
    isHandled: false,
    isNew: true,
    items: [newItem()] as ItemRow[],
    saving: false,
    metaTime: '',
    metaWho: '',
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, this.data.isNew ? 'newReturnNav' : 'returnDetailNav')
  },

  onLoad(q: Record<string, string | undefined>) {
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const uid = decodeURIComponent(q.uid || '')
    const isNew = !uid
    this.setData({ isNew })
    this.applyLocale()
    if (uid) {
      this.setData({ cloudUid: uid, isNew: false })
      this.applyLocale()
      void this.load(uid)
    }
  },

  onShow() {
    this.applyLocale()
  },

  async load(uid: string) {
    const r = await fetchReturnPackages()
    const p = (r.list || []).find((x) => x.cloudUid === uid)
    if (!p) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      return
    }
    const items =
      (p.items || [])
        .filter((it) => (it.code || '').trim())
        .map((it) => ({
          key: `i-${it.code}-${Math.random()}`,
          code: it.code || '',
          name: it.name || '',
          qty: String(it.qty || 1),
        })) || []
    const carrier = p.carrier || ''
    let carrierIndex = CARRIERS.indexOf(carrier)
    if (carrierIndex < 0) carrierIndex = 0
    const metaTime = fmtMetaTime(p.createdAt)
    this.setData({
      trackingNo: p.trackingNo,
      carrier,
      carrierIndex,
      packageCount: String(p.packageCount || 1),
      remark: p.remark || '',
      isHandled: !!p.isHandled,
      items: items.length ? items : [newItem()],
      metaTime,
      metaWho: (p.creatorName || '').trim(),
    })
  },

  onBack() {
    wx.navigateBack()
  },

  onOpenTrackingScan() {
    if (this.data.isHandled) return
    const initial = String(this.data.trackingNo || '')
      .split(/[\s,，/;]+/)
      .map((n) => n.trim())
      .filter(Boolean)
    wx.navigateTo({
      url: '/pages/tracking-scan/tracking-scan',
      events: {
        done: (data: { nos?: string[] }) => {
          const nos = Array.isArray(data?.nos)
            ? data.nos.map((n) => String(n).trim()).filter(Boolean)
            : []
          const trackingNo = nos[nos.length - 1] || ''
          if (!trackingNo) return
          const patch: Record<string, string | number> = { trackingNo }
          const kind = detectCourier(trackingNo)
          const carrier =
            kind === 'zto' ? '中通快递' : kind === 'sf' ? '顺丰快递' : ''
          if (carrier) {
            const i = CARRIERS.indexOf(carrier)
            patch.carrier = carrier
            if (i >= 0) patch.carrierIndex = i
          }
          if (nos.length > 1) patch.packageCount = String(nos.length)
          this.setData(patch)
        },
      },
      success: (res) => {
        res.eventChannel.emit('init', { nos: initial })
      },
    })
  },
  onCarrier(e: WechatMiniprogram.Input) {
    this.setData({ carrier: e.detail.value })
  },
  onCarrierPick(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value)
    this.setData({ carrierIndex: i, carrier: CARRIERS[i] || '' })
  },
  onCount(e: WechatMiniprogram.Input) {
    this.setData({ packageCount: e.detail.value })
  },
  onRemark(e: WechatMiniprogram.Input | WechatMiniprogram.TextareaInput) {
    this.setData({ remark: e.detail.value })
  },
  onAddItem() {
    this.setData({ items: this.data.items.concat([newItem()]) })
  },
  onRemoveItem(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.i)
    const items = this.data.items.slice()
    items.splice(i, 1)
    if (!items.length) items.push(newItem())
    this.setData({ items })
  },
  onItemField(e: WechatMiniprogram.Input) {
    const i = Number(e.currentTarget.dataset.i)
    const f = String(e.currentTarget.dataset.f || '') as keyof ItemRow
    const items = this.data.items.slice()
    const row = { ...items[i] }
    if (f === 'code' || f === 'name' || f === 'qty') row[f] = e.detail.value
    items[i] = row
    this.setData({ items })
  },

  collectItems() {
    return (this.data.items || [])
      .map((it) => ({
        code: (it.code || '').trim(),
        name: (it.name || '').trim(),
        qty: Number(it.qty) || 0,
      }))
      .filter((it) => it.code && it.qty > 0)
  },

  async save(markHandled: boolean) {
    if (this.data.isHandled) {
      wx.showToast({ title: '已处理的记录不能再修改', icon: 'none' })
      return
    }
    if (this.data.saving) return
    const trackingNo = (this.data.trackingNo || '').trim()
    if (!trackingNo) {
      wx.showToast({ title: '请输入快递单号', icon: 'none' })
      return
    }
    const pkgCount = Number(this.data.packageCount)
    if (!pkgCount || pkgCount <= 0) {
      wx.showToast({ title: '请填写有效的包裹数', icon: 'none' })
      return
    }
    const items = this.collectItems()
    if (!items.length) {
      const go = await new Promise<boolean>((resolve) => {
        wx.showModal({
          title: '未填写任何货号',
          content: '当前没有有效的「货号+件数」明细，是否仍要保存？',
          cancelText: '继续填写',
          confirmText: '仍要保存',
          success: (r) => resolve(!!r.confirm),
        })
      })
      if (!go) return
    }

    if (
      !(await assertMsgSecCheck([
        trackingNo,
        this.data.carrier,
        this.data.remark,
        ...items.map((it) => it.code),
        ...items.map((it) => it.name),
      ]))
    ) {
      return
    }

    this.setData({ saving: true })
    const r = await upsertReturnPackage({
      cloudUid: this.data.cloudUid || undefined,
      trackingNo,
      carrier: this.data.carrier,
      packageCount: pkgCount,
      remark: this.data.remark,
      items,
      isHandled: markHandled || this.data.isHandled,
      handledAt: markHandled ? new Date().toISOString() : undefined,
    })
    this.setData({ saving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    wx.showToast({
      title: markHandled ? '已保存并标记为已处理' : '已保存',
      icon: 'success',
    })
    setTimeout(() => wx.navigateBack(), 400)
  },

  onSave() {
    void this.save(false)
  },

  onSaveHandled() {
    // 官方 wx.showModal：confirmText / cancelText 最多 4 个字符
    // https://developers.weixin.qq.com/miniprogram/dev/api/ui/interaction/wx.showModal.html
    wx.showModal({
      title: '标记为已处理？',
      content:
        '标记后该记录将变为只读，不能再修改字段，但仍可删除入回收站。确认现在标记吗？',
      confirmText: '确认',
      cancelText: '取消',
      confirmColor: '#2e7d32',
      success: (res) => {
        if (res.confirm) void this.save(true)
      },
      fail: () => {
        wx.showToast({ title: t('loadFailed'), icon: 'none' })
      },
    })
  },

  onDelete() {
    if (!this.data.cloudUid) return
    wx.showModal({
      title: '删除退包登记？',
      content: '删除后将进入回收站，可在「我的 → 回收站」中恢复或永久删除。',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const list = await fetchReturnPackages()
        const pkg =
          (list.list || []).find((x) => x.cloudUid === this.data.cloudUid) ||
          ({
            cloudUid: this.data.cloudUid,
            trackingNo: this.data.trackingNo,
            carrier: this.data.carrier,
            packageCount: Number(this.data.packageCount) || 1,
            items: [],
            remark: this.data.remark,
            isHandled: this.data.isHandled,
          } as any)
        const r = await softDeleteReturnPackage(pkg)
        if (!r.ok) {
          wx.showToast({ title: r.error || '删除失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已移入回收站', icon: 'success' })
        wx.navigateBack()
      },
    })
  },
})
