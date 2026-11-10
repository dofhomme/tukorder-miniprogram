import { request } from '../../services/api'
import { getSession, isLoggedIn } from '../../services/session'

type VoiceChoice = 'free' | 'paid' | 'plugin'

function adminHeaders(): Record<string, string> {
  const phone = (getSession()?.phone || '').trim()
  return phone ? { 'X-Admin-Phone': phone } : {}
}

function asMp(value: string | undefined): VoiceChoice {
  return value === 'free' || value === 'paid' || value === 'plugin' ? value : 'plugin'
}

function asApp(value: string | undefined): 'free' | 'paid' {
  return value === 'paid' ? 'paid' : 'free'
}

function asSkuLlm(value: boolean | number | string | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

Page({
  data: {
    mp: 'plugin' as VoiceChoice,
    app: 'free' as 'free' | 'paid',
    skuLlm: false,
    hotword: true,
    train: true,
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

  async load() {
    const res = await request<{
      mp?: string
      app?: string
      mode?: string
      skuLlm?: boolean
      hotword?: boolean
      train?: boolean
    }>({
      path: '/api/v1/app/admin/voice-mode',
      headers: adminHeaders(),
    })
    if (!res.ok) {
      wx.showToast({ title: res.message || '加载失败', icon: 'none' })
      return
    }
    const data = res.data || {}
    const mp = data.mp ? asMp(data.mp) : data.mode === 'api' ? 'free' : 'plugin'
    this.setData({
      mp,
      app: asApp(data.app),
      skuLlm: asSkuLlm(data.skuLlm),
      hotword: data.hotword == null ? true : asSkuLlm(data.hotword),
      train: data.train == null ? true : asSkuLlm(data.train),
    })
  },

  applySaved(data: { mp?: string; app?: string; skuLlm?: boolean; hotword?: boolean; train?: boolean } | null) {
    this.setData({
      mp: asMp(data && data.mp),
      app: asApp(data && data.app),
      skuLlm: asSkuLlm(data && data.skuLlm),
      hotword: data && data.hotword == null ? this.data.hotword : asSkuLlm(data && data.hotword),
      train: data && data.train == null ? this.data.train : asSkuLlm(data && data.train),
    })
  },

  async onPick(e: WechatMiniprogram.TouchEvent) {
    const group = e.currentTarget.dataset.group === 'app' ? 'app' : 'mp'
    const picked = String(e.currentTarget.dataset.mode || '')
    const mp = group === 'mp' ? asMp(picked) : this.data.mp
    const app = group === 'app' ? asApp(picked) : this.data.app
    if (mp === this.data.mp && app === this.data.app) return
    wx.showLoading({ title: '保存中', mask: true })
    const res = await request<{ mp?: string; app?: string }>({
      path: '/api/v1/app/admin/voice-mode',
      method: 'PUT',
      data: { mp, app },
      headers: adminHeaders(),
    })
    wx.hideLoading()
    if (!res.ok) {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' })
      return
    }
    this.applySaved(res.data || null)
    wx.showToast({ title: '已保存', icon: 'none' })
  },

  async onToggle(e: WechatMiniprogram.TouchEvent) {
    const flag = String(e.currentTarget.dataset.flag || '')
    if (flag !== 'skuLlm' && flag !== 'hotword' && flag !== 'train') return
    const next = !this.data[flag]
    wx.showLoading({ title: '保存中', mask: true })
    const res = await request<{
      mp?: string
      app?: string
      skuLlm?: boolean
      hotword?: boolean
      train?: boolean
    }>({
      path: '/api/v1/app/admin/voice-mode',
      method: 'PUT',
      data: {
        mp: this.data.mp,
        app: this.data.app,
        skuLlm: flag === 'skuLlm' ? next : this.data.skuLlm,
        hotword: flag === 'hotword' ? next : this.data.hotword,
        train: flag === 'train' ? next : this.data.train,
      },
      headers: adminHeaders(),
    })
    wx.hideLoading()
    if (!res.ok) {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' })
      return
    }
    this.applySaved(res.data || null)
    const titles: Record<string, [string, string]> = {
      skuLlm: ['已改为直接走大模型', '已改回本地切开'],
      hotword: ['已打开热词', '已关闭热词'],
      train: ['已打开自主训练', '已关闭自主训练'],
    }
    const pair = titles[flag]
    wx.showToast({ title: next ? pair[0] : pair[1], icon: 'none' })
  },
})
