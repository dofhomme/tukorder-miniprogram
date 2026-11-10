import { fetchImageOkNickname, saveImageOkNickname, sanitizeAccountNickname } from '../../services/auth'
import { getSession, isLoggedIn } from '../../services/session'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import {
  fetchShop,
  isOwner,
  peekCachedShop,
  uploadShop,
} from '../../services/team'
import { fetchAgentShopSetting, saveAgentShopSetting } from '../../services/lookup'
import { requestBindSubscribe } from '../../services/subscribe'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { loadPrintSettings, savePrintSettings } from '../../services/print-settings'
import { loadPrintTemplate, savePrintTemplate } from '../../services/print-template'
import { writeShopLogoFile } from '../../utils/logo-file'

function writeLogoFile(b64: string): string | null {
  return writeShopLogoFile(b64) || null
}

function readFileBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (res) => resolve(String(res.data || '')),
      fail: reject,
    })
  })
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024

function compressThumb(src: string, width: number): Promise<string> {
  return new Promise((resolve) => {
    if (!wx.compressImage) {
      resolve(src)
      return
    }
    wx.compressImage({
      src,
      quality: 70,
      compressedWidth: width,
      success: (r) => resolve(r.tempFilePath || src),
      fail: () => resolve(src),
    })
  })
}

Page({
  data: {
    loading: true,
    saving: false,
    readOnly: false,
    syncHint: '',
    shopName: '',
    nickname: '',
    subtitle: '',
    address: '',
    phone: '',
    logoPath: '',
    acceptAgentOrders: true,
    productNameSuggestions: true,
    askReturnReason: false,
    showHomeQr: false,
    printLogo: true,
    showHomeShopName: true,
    showSubtitle: true,
    showSheetIndex: true,
    headerTextSize: 'md' as 'sm' | 'md' | 'lg',
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, this.data.readOnly ? 'shopEditReadonly' : 'shopEditTitle')
  },

  _footer: '' as string,
  /** 新选图片的 base64；未改则为 null */
  _newLogoB64: null as string | null,
  _clearLogo: false,
  _hadLogo: false,

  onLoad() {
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const canEdit = isOwner()
    const prefs = loadPrintSettings()
    const tpl = loadPrintTemplate()
    this.setData({
      nickname: sanitizeAccountNickname(String(getSession()?.team?.displayName || '')),
      readOnly: !canEdit,
      productNameSuggestions: prefs.productNameSuggestions,
      askReturnReason: prefs.askReturnReason,
      showHomeQr: tpl.showHomeQr === true,
      printLogo: tpl.printLogo !== false,
      showHomeShopName: tpl.showHomeShopName !== false,
      showSubtitle: tpl.printSubtitle !== false,
      showSheetIndex: tpl.showSheetIndex !== false,
      headerTextSize: tpl.headerTextSize === 'sm' || tpl.headerTextSize === 'lg' ? tpl.headerTextSize : 'md',
    })
    this.applyLocale()
    void this.load({ pullCloud: true })
  },

  onShow() {
    this.applyLocale()
    const prefs = loadPrintSettings()
    const tpl = loadPrintTemplate()
    this.setData({
      productNameSuggestions: prefs.productNameSuggestions,
      askReturnReason: prefs.askReturnReason,
      showHomeQr: tpl.showHomeQr === true,
      printLogo: tpl.printLogo !== false,
      showHomeShopName: tpl.showHomeShopName !== false,
      showSubtitle: tpl.printSubtitle !== false,
      showSheetIndex: tpl.showSheetIndex !== false,
      headerTextSize: tpl.headerTextSize === 'sm' || tpl.headerTextSize === 'lg' ? tpl.headerTextSize : 'md',
    })
  },

  onToggleHomeQr(e: WechatMiniprogram.SwitchChange) {
    this.patchTemplate({ showHomeQr: !!e.detail.value })
  },

  onTogglePrintLogo(e: WechatMiniprogram.SwitchChange) {
    this.patchTemplate({ printLogo: !!e.detail.value })
  },

  onToggleHomeShop(e: WechatMiniprogram.SwitchChange) {
    this.patchTemplate({ showHomeShopName: !!e.detail.value })
  },

  onToggleSubtitle(e: WechatMiniprogram.SwitchChange) {
    this.patchTemplate({ printSubtitle: !!e.detail.value })
  },

  onToggleSheetIndex(e: WechatMiniprogram.SwitchChange) {
    this.patchTemplate({ showSheetIndex: !!e.detail.value })
  },

  onHeaderSize(e: WechatMiniprogram.TouchEvent) {
    if (this.data.readOnly) return
    const size = String(e.currentTarget.dataset.size || '')
    if (size !== 'sm' && size !== 'md' && size !== 'lg') return
    if (size === this.data.headerTextSize) return
    this.patchTemplate({ headerTextSize: size })
  },

  patchTemplate(patch: {
    showHomeQr?: boolean
    printLogo?: boolean
    showHomeShopName?: boolean
    printSubtitle?: boolean
    showSheetIndex?: boolean
    headerTextSize?: 'sm' | 'md' | 'lg'
  }) {
    const cur = loadPrintTemplate()
    savePrintTemplate({ ...cur, ...patch })
    this.setData({
      showHomeQr: patch.showHomeQr ?? this.data.showHomeQr,
      printLogo: patch.printLogo ?? this.data.printLogo,
      showHomeShopName: patch.showHomeShopName ?? this.data.showHomeShopName,
      showSubtitle: patch.printSubtitle ?? this.data.showSubtitle,
      showSheetIndex: patch.showSheetIndex ?? this.data.showSheetIndex,
      headerTextSize: patch.headerTextSize ?? this.data.headerTextSize,
    })
  },

  onToggleSuggest(e: WechatMiniprogram.SwitchChange) {
    const on = !!e.detail.value
    const cur = loadPrintSettings()
    savePrintSettings({ ...cur, productNameSuggestions: on })
    this.setData({ productNameSuggestions: on })
  },

  onToggleReturnReason(e: WechatMiniprogram.SwitchChange) {
    const on = !!e.detail.value
    const cur = loadPrintSettings()
    savePrintSettings({ ...cur, askReturnReason: on })
    this.setData({ askReturnReason: on })
  },

  applyShop(shop: {
    shopName?: string
    subtitle?: string | null
    address?: string | null
    phone?: string | null
    footer?: string | null
    hasLogo?: boolean
    logoBase64?: string | null
  } | null) {
    if (!shop) return
    this._footer = shop.footer || ''
    this._hadLogo = !!shop.hasLogo || !!shop.logoBase64
    this._newLogoB64 = null
    this._clearLogo = false
    let logoPath = ''
    if (shop.logoBase64) {
      logoPath = writeLogoFile(shop.logoBase64) || ''
    }
    this.setData({
      shopName: shop.shopName || '',
      subtitle: shop.subtitle || '',
      address: shop.address || '',
      phone: (shop.phone || '').trim() || String(getSession()?.phone || '').trim(),
      logoPath,
    })
  },

  async load(_opts?: { pullCloud?: boolean }) {
    this.setData({ loading: true, syncHint: '' })
    const cached = peekCachedShop()
    if (cached && this.data.loading) {
      this.applyShop(cached)
    }

    const r = await fetchShop()
    const ag = await fetchAgentShopSetting()
    if (!r.ok || !r.shop) {
      this.setData({
        loading: false,
        syncHint: r.fromCache
          ? ''
          : `云端同步失败：${r.error || '未知错误'}，已显示本地数据`,
        acceptAgentOrders: ag.ok ? ag.acceptAgentOrders : this.data.acceptAgentOrders,
      })
      if (cached) this.applyShop(cached)
      void this.refreshNickname()
      return
    }
    this.applyShop(r.shop)
    this.setData({
      loading: false,
      syncHint: '',
      acceptAgentOrders: ag.ok ? ag.acceptAgentOrders : this.data.acceptAgentOrders,
    })
    void this.refreshNickname()
  },

  async refreshNickname() {
    const r = await fetchImageOkNickname()
    if (!r.ok || r.nickname == null) return
    this.setData({ nickname: r.nickname })
  },

  async onPullDownRefresh() {
    if (this.data.saving) {
      wx.stopPullDownRefresh()
      return
    }
    try {
      const r = await fetchShop()
      if (!r.ok || !r.shop) {
        this.setData({
          syncHint: `云端同步失败：${r.error || '未知错误'}，已显示本地数据`,
        })
        return
      }
      this.applyShop(r.shop)
      const ag = await fetchAgentShopSetting()
      this.setData({
        loading: false,
        syncHint: '',
        acceptAgentOrders: ag.ok ? ag.acceptAgentOrders : this.data.acceptAgentOrders,
      })
      void this.refreshNickname()
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  onName(e: WechatMiniprogram.Input) {
    this.setData({ shopName: e.detail.value })
  },
  onNickname(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value })
  },
  onSubtitle(e: WechatMiniprogram.Input) {
    this.setData({ subtitle: e.detail.value })
  },
  onAddress(e: WechatMiniprogram.Input) {
    this.setData({ address: e.detail.value })
  },
  onPhone(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },

  onToggleAgent(e: WechatMiniprogram.SwitchChange) {
    if (this.data.readOnly) return
    this.setData({ acceptAgentOrders: !!e.detail.value })
  },

  onClearLogo() {
    if (this.data.readOnly) return
    this._clearLogo = true
    this._newLogoB64 = null
    this.setData({ logoPath: '' })
  },

  onPickLogo() {
    if (this.data.readOnly) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        const path = file?.tempFilePath || ''
        if (!path) return
        const size = Number(file?.size || 0)
        if (size > MAX_LOGO_BYTES) {
          wx.showToast({ title: '图片不能超过 2MB', icon: 'none' })
          return
        }
        // Windows 选图窗口关闭时会晚一步 routeDone，立刻改页面会被丢掉。
        setTimeout(() => {
          void this.ingestLogo(path)
        }, 80)
      },
      fail: (err) => {
        if (String(err?.errMsg || '').includes('cancel')) return
        wx.showToast({ title: '选图失败', icon: 'none' })
      },
    })
  },

  async ingestLogo(tempPath: string) {
    wx.showLoading({ title: '处理图片…', mask: true })
    try {
      let thumb = await compressThumb(tempPath, 384)
      let b64 = await readFileBase64(thumb)
      if (b64.length > 280000) {
        thumb = await compressThumb(thumb, 256)
        b64 = await readFileBase64(thumb)
      }
      if (!b64) {
        wx.showToast({ title: 'Logo 读取失败', icon: 'none' })
        return
      }
      wx.hideLoading()
      if (!(await assertMediaCheckAsync({ imageBase64: b64, mediaType: 2 }))) return
      wx.showLoading({ title: '处理图片…', mask: true })
      const local = writeLogoFile(b64) || thumb
      this._newLogoB64 = b64
      this._clearLogo = false
      this.setData({ logoPath: local })
    } catch (_) {
      wx.showToast({ title: 'Logo 保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async onSave() {
    if (this.data.readOnly || this.data.saving || !isOwner()) {
      if (!isOwner()) wx.showToast({ title: '仅商家可修改店铺设置', icon: 'none' })
      return
    }
    void requestBindSubscribe()
    const shopName = (this.data.shopName || '').trim()
    if (!shopName) {
      wx.showToast({ title: '店铺名不能为空', icon: 'none' })
      return
    }
    // 官方 security.msgSecCheck：scene=1 资料（店铺名/副标题/地址等）
    // https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html
    const nickname = sanitizeAccountNickname(this.data.nickname || '')
    if (
      !(await assertMsgSecCheck(
        [shopName, nickname, this.data.subtitle, this.data.address, this.data.phone, this._footer],
        1,
      ))
    ) {
      return
    }
    this.setData({ saving: true, nickname })
    const nickRes = await saveImageOkNickname(nickname)
    if (!nickRes.ok) {
      this.setData({ saving: false })
      wx.showToast({ title: nickRes.error || '昵称同步官网失败', icon: 'none' })
      return
    }
    const payload: Parameters<typeof uploadShop>[0] = {
      shopName,
      subtitle: (this.data.subtitle || '').trim(),
      address: (this.data.address || '').trim(),
      phone: (this.data.phone || '').trim(),
      footer: this._footer,
    }
    if (this._clearLogo) {
      payload.clearLogo = true
    } else if (this._newLogoB64) {
      payload.logoBase64 = this._newLogoB64
    }
    const r = await uploadShop(payload)
    if (r.ok) {
      const ag = await saveAgentShopSetting(!!this.data.acceptAgentOrders)
      if (!ag.ok) {
        this.setData({ saving: false })
        wx.showToast({ title: ag.error || '代理查账开关保存失败', icon: 'none' })
        return
      }
    }
    this.setData({ saving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    this._newLogoB64 = null
    this._clearLogo = false
    this._hadLogo = !!this.data.logoPath
    wx.showToast({
      title: isOwner() ? '已保存，正在同步到云端…' : '已保存',
      icon: 'none',
    })
    setTimeout(() => wx.navigateBack(), 200)
  },
})
