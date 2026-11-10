import { request } from '../../services/api'
import {
  PRINT_PLATFORM_GROUPS,
  parseChannelPace,
  type PrintChannel,
} from '../../services/print-runtime-policy'
import { getSession, isLoggedIn } from '../../services/session'

function adminHeaders(): Record<string, string> {
  const phone = (getSession()?.phone || '').trim()
  return phone ? { 'X-Admin-Phone': phone } : {}
}

type PlatformView = {
  id: string
  label: string
  hint: string
  chunkBytes: number
  intervalMs: number
  chunkMin: number
  chunkMax: number
  intervalMin: number
  intervalMax: number
  channels: PrintChannel[]
}

Page({
  data: {
    defaultOutput: 'raster',
    platforms: [] as PlatformView[],
    telemetry: [] as Array<Record<string, string>>,
    policy: {} as any,
  },

  onShow() {
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!getSession()?.isAdmin) {
      wx.showToast({ title: '需要管理员账号', icon: 'none' })
      wx.navigateBack()
      return
    }
    void this.load()
  },

  _platformsFromPolicy(policy: any): PlatformView[] {
    const ch = (policy && policy.channels) || {}
    return PRINT_PLATFORM_GROUPS.map((g) => {
      const src = ch[g.previewChannel] || ch[g.channels[0]] || {}
      const pace = parseChannelPace(g.previewChannel, src)
      return {
        id: g.id,
        label: g.label,
        hint: g.hint,
        chunkBytes: pace.chunkBytes,
        intervalMs: pace.intervalMs,
        chunkMin: g.chunkMin,
        chunkMax: g.chunkMax,
        intervalMin: g.intervalMin,
        intervalMax: g.intervalMax,
        channels: g.channels.slice(),
      }
    })
  },

  async load() {
    wx.showNavigationBarLoading()
    const p = await request<any>({
      path: '/api/v1/app/admin/print-policy',
      headers: adminHeaders(),
    })
    const t = await request<{ items?: Array<Record<string, any>> }>({
      path: '/api/v1/app/admin/print-telemetry?days=7',
      headers: adminHeaders(),
    })
    wx.hideNavigationBarLoading()
    if (!p.ok) {
      wx.showToast({ title: p.message || '加载失败', icon: 'none' })
      return
    }
    const policy = p.data || {}
    this.setData({
      policy,
      defaultOutput: policy.defaultOutput === 'text' ? 'text' : 'raster',
      platforms: this._platformsFromPolicy(policy),
      telemetry: ((t.data && t.data.items) || []).map((row) => ({
        ...row,
        rate: `${(((Number(row.failRate) || 0) * 100).toFixed(1))}%`,
        label: String(row.label || row.channel || ''),
        platform: String(row.platform || ''),
        failed: String(row.failed ?? 0),
        total: String(row.total ?? 0),
        channel: String(row.channel || idFallback(row)),
      })),
    })
  },

  onPickOutput() {
    wx.showActionSheet({
      itemList: ['位图', '文本指令'],
      success: (res) => {
        this.setData({
          defaultOutput: res.tapIndex === 0 ? 'raster' : 'text',
        })
      },
    })
  },

  onPace(e: WechatMiniprogram.SliderChange) {
    const id = String(e.currentTarget.dataset.id || '')
    const key = String(e.currentTarget.dataset.key || 'chunkBytes')
    const val = Number(e.detail.value)
    const platforms = this.data.platforms.map((c) => {
      if (c.id !== id) return c
      return { ...c, [key]: val } as PlatformView
    })
    this.setData({ platforms })
  },

  async onSave() {
    const channels: Record<string, { chunkBytes: number; intervalMs: number }> = {
      ...((this.data.policy && this.data.policy.channels) || {}),
    }
    for (const p of this.data.platforms) {
      for (const id of p.channels) {
        channels[id] = { chunkBytes: p.chunkBytes, intervalMs: p.intervalMs }
      }
    }
    const body = {
      ...(this.data.policy || {}),
      defaultOutput: this.data.defaultOutput === 'text' ? 'text' : 'raster',
      channels,
    }
    wx.showLoading({ title: '保存中', mask: true })
    const r = await request<any>({
      path: '/api/v1/app/admin/print-policy',
      method: 'PUT',
      data: body,
      headers: adminHeaders(),
    })
    wx.hideLoading()
    wx.showToast({
      title: r.ok ? '已保存，下次打印生效' : r.message || '失败',
      icon: r.ok ? 'success' : 'none',
    })
    if (r.ok && r.data) {
      this.setData({
        policy: r.data,
        defaultOutput: r.data.defaultOutput === 'text' ? 'text' : 'raster',
        platforms: this._platformsFromPolicy(r.data),
      })
    }
  },
})

function idFallback(row: Record<string, any>) {
  return String(row.channel || row.platform || Math.random())
}
