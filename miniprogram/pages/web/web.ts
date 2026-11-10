const ALLOWED = /^https:\/\/([\w-]+\.)?imageok\.cn(\/|$)/i

Page({
  data: {
    url: 'https://imageok.cn',
  },

  onLoad(query: Record<string, string | undefined>) {
    const raw = decodeURIComponent(String(query.url || 'https://imageok.cn'))
    const title = decodeURIComponent(String(query.title || '图可官网'))
    const url = ALLOWED.test(raw) ? raw : 'https://imageok.cn'
    this.setData({ url })
    wx.setNavigationBarTitle({ title })
  },
})
