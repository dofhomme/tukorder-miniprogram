import { fetchAgentShare, type AgentFolderItem } from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

Page({
  data: {
    loading: true,
    error: '',
    shopName: '',
    code: '',
    name: '',
    coverUrl: '',
    gallery: [] as string[],
    priceLabel: '',
    askAgent: true,
    stockLabel: '',
    colors: [] as string[],
    sizes: [] as string[],
    token: '',
    isFolder: false,
    isNewArrival: false,
    folderTitle: '',
    folderItems: [] as AgentFolderItem[],
    videoUrl: '',
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'lookbook')
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyLocale()
    const token = String(query?.t || query?.token || '').trim()
    this.setData({ token })
    void this.refresh(token)
  },

  onShow() {
    this.applyLocale()
  },

  async refresh(token: string) {
    if (!token) {
      this.setData({ loading: false, error: t('shareExpired') })
      return
    }
    this.setData({ loading: true, error: '' })
    const r = await fetchAgentShare(token)
    if (!r.ok || !r.data) {
      this.setData({ loading: false, error: r.error || t('shareExpired') })
      return
    }
    const d = r.data
    if (d.folder) {
      const items = d.items || []
      this.setData({
        loading: false,
        isFolder: true,
        isNewArrival: !!d.newArrival,
        shopName: d.shopName || '',
        folderTitle: d.title || (d.newArrival ? t('stallNewLook') : t('lookFolder')),
        folderItems: items,
        coverUrl: items[0]?.coverUrl || '',
        code: '',
        videoUrl: '',
      })
      wx.setNavigationBarTitle({
        title: d.newArrival ? t('stallNewLook') : d.title || t('lookFolder'),
      })
      return
    }
    const retail = Number(d.suggestedRetailPrice || 0)
    const ask = d.askAgent !== false && !(retail > 0)
    const stock = d.stockLevel === 'out' ? t('lookStockOut') : d.stockLevel === 'low' ? t('lookStockLow') : t('lookStockIn')
    const gallery = (d.galleryUrls && d.galleryUrls.length ? d.galleryUrls : d.coverUrl ? [d.coverUrl] : []).filter(Boolean)
    this.setData({
      loading: false,
      shopName: d.shopName || '',
      code: d.code || '',
      name: d.name || '',
      coverUrl: d.coverUrl || gallery[0] || '',
      gallery,
      askAgent: ask,
      priceLabel: retail > 0 ? retail.toFixed(2) : '',
      stockLabel: stock,
      colors: d.colors || [],
      sizes: d.sizes || [],
      videoUrl: String(d.videoUrl || ''),
    })
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isFolder) {
      const urls = this.data.folderItems.map((x) => String(x.coverUrl || '')).filter(Boolean)
      const current = String(e.currentTarget.dataset.url || urls[0] || '')
      if (!urls.length) return
      wx.previewImage({ current: current || urls[0], urls })
      return
    }
    const current = String(e.currentTarget.dataset.url || this.data.coverUrl)
    const urls = this.data.gallery.length ? this.data.gallery : current ? [current] : []
    if (!urls.length) return
    wx.previewImage({ current: current || urls[0], urls })
  },

  onPlayVideo() {
    const url = String(this.data.videoUrl || '')
    if (!url) return
    wx.previewMedia({
      sources: [{ url, type: 'video', poster: this.data.coverUrl || '' }],
    })
  },

  onShareAppMessage() {
    const title = this.data.isNewArrival
      ? [this.data.shopName, t('stallNewLook')].filter(Boolean).join(' · ')
      : this.data.isFolder
      ? [this.data.shopName, this.data.folderTitle].filter(Boolean).join(' · ') || t('lookFolder')
      : [this.data.shopName, this.data.code].filter(Boolean).join(' · ') || t('lookbook')
    return {
      title,
      path: `pages/agent-share/agent-share?t=${encodeURIComponent(this.data.token)}`,
      imageUrl: this.data.coverUrl || '',
    }
  },
})
