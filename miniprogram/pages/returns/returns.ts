import { requireCloudSync } from '../../services/account-gate'
import { isLoggedIn } from '../../services/session'
import { softDeleteReturnPackage } from '../../services/recycle-bin'
import { fetchReturnPackages } from '../../services/team'
import type { ReturnPackage } from '../../services/team'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { takeVoiceJump } from '../../services/voice-jump'

type Filter = 'all' | 'pending' | 'handled'

type Row = ReturnPackage & {
  title: string
  preview: string
  timeLabel: string
  selected: boolean
}

function fmtTime(raw?: string | null): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function previewOf(pkg: ReturnPackage): string {
  const items = pkg.items || []
  const parts: string[] = []
  for (const it of items.slice(0, 3)) {
    const code = (it.code || '').trim()
    const q = Number(it.qty || 0)
    if (code) parts.push(`${code}×${q || 0}`)
  }
  const qty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
  const more = items.length > 3 ? ` …+${items.length - 3}` : ''
  const head = parts.length ? `${parts.join('  ')}${more}` : '（无明细）'
  const packs = pkg.packageCount || 1
  return `${head}   ·  共 ${qty} 件 / ${packs} 包`
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    keyword: '',
    filter: 'all' as Filter,
    loading: true,
    refreshing: false,
    display: [] as Row[],
    emptyText: t('noReturns'),
    selectMode: false,
    selectedCount: 0,
    allSelected: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'returnsTitle')
    if (this._all.length || this.data.emptyText) this.apply()
  },

  _all: [] as ReturnPackage[],
  _selected: {} as Record<string, boolean>,

  onLoad() {
    applyCapsuleStyle(this)
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!requireCloudSync('returns')) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) })
      return
    }
    const jump = takeVoiceJump('returns')
    if (jump && jump.keyword) this.setData({ keyword: jump.keyword })
    void this.load()
  },

  onBack() {
    wx.navigateBack()
  },

  async load() {
    this.setData({ loading: !this._all.length })
    const r = await fetchReturnPackages()
    this.setData({ loading: false, refreshing: false })
    if (!r.ok) {
      if (!this._all.length) {
        wx.showToast({ title: r.error || '加载失败', icon: 'none' })
      }
      return
    }
    this._all = r.list || []
    // 清理已不存在的选中项
    const uids = new Set(this._all.map((p) => p.cloudUid))
    Object.keys(this._selected).forEach((k) => {
      if (!uids.has(k)) delete this._selected[k]
    })
    if (!Object.keys(this._selected).length && this.data.selectMode) {
      this.setData({ selectMode: false })
    }
    this.apply()
  },

  apply() {
    const kw = (this.data.keyword || '').trim().toLowerCase()
    const filter = this.data.filter
    let list = this._all.slice()
    if (filter === 'pending') list = list.filter((p) => !p.isHandled)
    if (filter === 'handled') list = list.filter((p) => !!p.isHandled)
    if (kw) {
      list = list.filter((p) => {
        const carrier = (p.carrier || '').toLowerCase()
        const no = (p.trackingNo || '').toLowerCase()
        const codes = (p.items || [])
          .map((it) => `${it.code || ''} ${it.name || ''}`)
          .join(' ')
          .toLowerCase()
        return carrier.includes(kw) || no.includes(kw) || codes.includes(kw)
      })
    }
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
    const display: Row[] = list.map((p) => ({
      ...p,
      title:
        (p.creatorName || '').trim() === '代理申请'
          ? t('agentReturn')
          : (p.carrier || '').trim()
            ? `${p.carrier}  ${p.trackingNo}`
            : p.trackingNo || '（无单号）',
      preview: previewOf(p),
      timeLabel: (() => {
        const who = (p.creatorName || '').trim() || '我'
        const t = fmtTime(p.createdAt)
        return t ? `${t}  ·  ${who}` : who
      })(),
      selected: !!this._selected[p.cloudUid],
    }))
    const selectedCount = display.filter((x) => x.selected).length
    const allSelected = display.length > 0 && selectedCount === display.length
    let emptyText = t('noReturns')
    if (filter === 'pending') emptyText = t('noPendingReturns')
    if (filter === 'handled') emptyText = t('noProcessedReturns')
    if (kw && !display.length) emptyText = t('noMatchReturns')
    this.setData({ display, emptyText, selectedCount, allSelected })
  },

  onKeyword(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
    this.apply()
  },
  onSearch() {
    this.apply()
  },
  onClearKeyword() {
    this.setData({ keyword: '' })
    this.apply()
  },
  onFilter(e: WechatMiniprogram.TouchEvent) {
    const k = String(e.currentTarget.dataset.k || 'all') as Filter
    this.setData({ filter: k })
    this.apply()
  },
  onRefresh() {
    void this.load()
  },
  onPullRefresh() {
    this.setData({ refreshing: true })
    void this.load()
  },

  onAdd() {
    if (this.data.selectMode) return
    wx.navigateTo({ url: '/pages/return-edit/return-edit' })
  },

  onEnterSelect() {
    if (!this.data.display.length) {
      wx.showToast({ title: '暂无记录可选择', icon: 'none' })
      return
    }
    this._selected = {}
    this.setData({ selectMode: true, selectedCount: 0, allSelected: false })
    this.apply()
  },

  onExitSelect() {
    this._selected = {}
    this.setData({ selectMode: false, selectedCount: 0, allSelected: false })
    this.apply()
  },

  onToggleSelectAll() {
    const list = this.data.display || []
    if (!list.length) return
    if (this.data.allSelected) {
      this._selected = {}
    } else {
      const next: Record<string, boolean> = {}
      list.forEach((p) => {
        if (p.cloudUid) next[p.cloudUid] = true
      })
      this._selected = next
    }
    this.apply()
  },

  onMoreMenu() {
    wx.showActionSheet({
      itemList: ['选择删除', '按时间删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onEnterSelect()
        } else if (res.tapIndex === 1) {
          void this.deleteByDateRange()
        }
      },
    })
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const uid = String(e.currentTarget.dataset.uid || '')
    if (!uid) return
    if (this.data.selectMode) {
      if (this._selected[uid]) delete this._selected[uid]
      else this._selected[uid] = true
      if (!Object.keys(this._selected).length) {
        this.setData({ selectMode: false })
      }
      this.apply()
      return
    }
    wx.navigateTo({
      url: `/pages/return-edit/return-edit?uid=${encodeURIComponent(uid)}`,
    })
  },

  onLongPress(e: WechatMiniprogram.TouchEvent) {
    const uid = String(e.currentTarget.dataset.uid || '')
    if (!uid) return
    if (!this.data.selectMode) {
      this._selected = { [uid]: true }
      this.setData({ selectMode: true })
      this.apply()
      return
    }
    if (this._selected[uid]) delete this._selected[uid]
    else this._selected[uid] = true
    if (!Object.keys(this._selected).length) {
      this.setData({ selectMode: false })
    }
    this.apply()
  },

  onRowMore(e: WechatMiniprogram.TouchEvent) {
    const uid = String(e.currentTarget.dataset.uid || '')
    if (!uid) return
    wx.showActionSheet({
      itemList: ['删除'],
      itemColor: '#e53935',
      success: (res) => {
        if (res.tapIndex !== 0) return
        void this.deleteOne(uid)
      },
    })
  },

  async deleteOne(uid: string) {
    const pkg = this._all.find((x) => x.cloudUid === uid)
    if (!pkg) return
    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除退包登记？',
        content: `删除后将进入回收站，可在「我的 → 回收站」中恢复或永久删除。\n\n单号：${pkg.trackingNo || ''}`,
        confirmColor: '#e53935',
        success: (r) => resolve(!!r.confirm),
      })
    })
    if (!ok) return
    const del = await softDeleteReturnPackage(pkg)
    if (!del.ok) {
      wx.showToast({ title: del.error || '删除失败', icon: 'none' })
      return
    }
    this._all = this._all.filter((x) => x.cloudUid !== uid)
    delete this._selected[uid]
    this.apply()
    wx.showToast({ title: '已移入回收站', icon: 'success' })
  },

  async onDeleteSelected() {
    const uids = Object.keys(this._selected)
    if (!uids.length) return
    const n = uids.length
    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除所选退包？',
        content: `将 ${n} 条退包登记移入回收站，可在「我的 → 回收站」中恢复或永久删除。`,
        confirmColor: '#e53935',
        success: (r) => resolve(!!r.confirm),
      })
    })
    if (!ok) return
    let count = 0
    for (const uid of uids) {
      const pkg = this._all.find((x) => x.cloudUid === uid)
      if (!pkg) continue
      const del = await softDeleteReturnPackage(pkg)
      if (del.ok) {
        count += 1
        this._all = this._all.filter((x) => x.cloudUid !== uid)
      }
    }
    this._selected = {}
    this.setData({ selectMode: false, selectedCount: 0, allSelected: false })
    this.apply()
    wx.showToast({
      title: count > 0 ? `已移入回收站 ${count} 条` : '删除失败',
      icon: count > 0 ? 'success' : 'none',
    })
  },

  async deleteByDateRange() {
    const today = new Date()
    const endDefault = fmtDate(today)
    const startDefault = fmtDate(new Date(today.getTime() - 29 * 86400000))

    const from = await new Promise<string | null>((resolve) => {
      // 用 picker 风格：先选开始日
      wx.showModal({
        title: '按时间删除 · 开始日期',
        editable: true,
        placeholderText: startDefault,
        content: `请输入开始日期（YYYY-MM-DD）\n默认：${startDefault}`,
        success: (r) => {
          if (!r.confirm) {
            resolve(null)
            return
          }
          const v = String((r as any).content || startDefault).trim()
          resolve(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : startDefault)
        },
      })
    })
    if (!from) return

    const to = await new Promise<string | null>((resolve) => {
      wx.showModal({
        title: '按时间删除 · 结束日期',
        editable: true,
        placeholderText: endDefault,
        content: `请输入结束日期（YYYY-MM-DD）\n默认：${endDefault}`,
        success: (r) => {
          if (!r.confirm) {
            resolve(null)
            return
          }
          const v = String((r as any).content || endDefault).trim()
          resolve(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : endDefault)
        },
      })
    })
    if (!to) return

    const fromMs = new Date(`${from}T00:00:00`).getTime()
    const toMs = new Date(`${to}T23:59:59`).getTime()
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
      wx.showToast({ title: '日期无效', icon: 'none' })
      return
    }

    const filter = this.data.filter
    const filterLabel =
      filter === 'pending' ? '（仅待处理）' : filter === 'handled' ? '（仅已处理）' : ''

    let candidates = this._all.filter((p) => {
      const t = p.createdAt ? new Date(p.createdAt).getTime() : 0
      if (!t || t < fromMs || t > toMs) return false
      if (filter === 'pending' && p.isHandled) return false
      if (filter === 'handled' && !p.isHandled) return false
      return true
    })

    if (!candidates.length) {
      wx.showToast({ title: '该时间段内没有可删除的退包登记', icon: 'none' })
      return
    }

    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '按时间删除退包？',
        content: `${from} 至 ${to}${filterLabel}\n\n共 ${candidates.length} 条将移入回收站，可在「我的 → 回收站」中恢复或永久删除。`,
        confirmColor: '#e53935',
        success: (r) => resolve(!!r.confirm),
      })
    })
    if (!ok) return

    let deleted = 0
    for (const pkg of candidates) {
      const del = await softDeleteReturnPackage(pkg)
      if (del.ok) {
        deleted += 1
        this._all = this._all.filter((x) => x.cloudUid !== pkg.cloudUid)
      }
    }
    this._selected = {}
    this.setData({ selectMode: false })
    this.apply()
    wx.showToast({
      title: deleted > 0 ? `已移入回收站 ${deleted} 条` : '删除失败',
      icon: deleted > 0 ? 'success' : 'none',
    })
  },
})
