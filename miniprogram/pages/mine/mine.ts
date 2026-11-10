import { exitAgentToLogin, logout } from '../../services/auth'
import {
  getSession,
  isLoggedIn,
  canBrowseApp,
  isGuest,
  getGuestSession,
  clearSession,
  clearGuestSession,
} from '../../services/session'
import { requireCloudAccount, requireCloudSync } from '../../services/account-gate'
import { CacheKeys, cacheGet, clearTeamDataCaches } from '../../services/cache'
import { stopSessionGuard } from '../../services/session-guard'
import {
  fetchShop,
  isOwner,
  peekCachedShop,
} from '../../services/team'
import { resetAndSyncFromCloud } from '../../services/local-reset'
import {
  formatExpireLabel,
  getEntitlement,
  isCloudSyncAllowed,
  refreshEntitlement,
  clearEntitlementCache,
} from '../../services/subscription'
import {
  hasPendingLocalUpload,
} from '../../services/guest-migrate'
import { applyMpUpdate, checkMpUpdate, localVersionLabel } from '../../services/app-version'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { getTabItems, i18nState, setLocale, t, tabIndexFor, type Locale } from '../../services/i18n'
import { tutorialsEnabled } from '../../services/tutorials'
import { submitFeedback } from '../../services/feedback'
import { agentInviteShareTitle, fetchAgentMe, MERCHANT_OPEN_SHARE_IMAGE, merchantInviteStatsHint, merchantOpenShareMessage, mintMerchantOpenInvite, peekAgentBound, type AgentBinding } from '../../services/lookup'
import { requestAgentApplyNoticeSubscribe, requestExpireRenewSubscribe } from '../../services/subscribe'
import {
  applyWorkspaceAndRelaunch,
  canSwitchWorkspace,
  isAgentWorkspace,
  openAgentProfileGate,
  peekAgentProfileOk,
  saveAgentOwnerId,
  tabBarTheme,
} from '../../services/workspace'
import { writeShopLogoFile } from '../../utils/logo-file'

const MINE_REFRESH_MS = 5 * 60 * 1000
const ENTITLEMENT_FRESH_MS = 60 * 1000
let _dualRoleProbedAt = 0
let _dualRoleProbedFor = ''

Page({
  data: {
    ...capsuleStyleDefaults(),
    ...i18nState(),
    phone: '',
    roleLabel: '',
    shopName: t('brand'),
    logoPath: '',
    canManageTeam: false,
    showTeam: false,
    canManageReturnPackage: false,
    canPurgeDirty: false,
    loggingOut: false,
    isAdmin: false,
    showSupDlg: false,
    supText: '',
    supLen: 0,
    supSaving: false,
    showClrDlg: false,
    showFollow: false,
    clrBusy: false,
    guestMode: false,
    guestNick: '',
    cloudSyncActive: false,
    cloudSyncLabel: '',
    pendingUpload: false,
    /** 仅已绑微信的代理可见，游客/商家都不显示 */
    showAgentBills: false,
    agentMode: false,
    showRoleSwitch: false,
    agentCanSwitch: false,
    tutorialsOn: true,
    agentCanManageShops: false,
    agentBindings: [] as AgentBinding[],
    agentIsAdmin: false,
    staffInviteToken: '',
    merchantInviteToken: '',
    inviteStatsHint: '',
    inviteSheet: false,
    versionLabel: localVersionLabel(),
  },

  _agentBindings: [] as AgentBinding[],
  _inviteStatsTried: false,
  _logoB64: '',

  onLoad() {},

  onReady() {
    applyCapsuleStyle(this)
  },

  applyLocale() {
    this.setData({
      ...i18nState(),
      shopName: this.data.guestMode ? t('brand') : this.data.shopName || t('brand'),
      cloudSyncLabel: this.data.guestMode
        ? this.data.cloudSyncLabel
        : isCloudSyncAllowed()
          ? formatExpireLabel(getEntitlement())
          : t('cloudClosed'),
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems() })
    }
  },

  onShow() {
    this.setData({ ...i18nState(), versionLabel: localVersionLabel() })
    try {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] })
    } catch (_) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: tabIndexFor('mine'),
        hidden: false,
        list: getTabItems(),
        theme: tabBarTheme(),
      })
    }
    if (isAgentWorkspace()) {
      if (!peekAgentProfileOk()) {
        openAgentProfileGate()
        return
      }
      const g = getGuestSession()
      const logged = isLoggedIn() && !isGuest()
      this.setData({
        agentMode: true,
        guestMode: !logged,
        guestNick: (g?.nickname || '').trim() || t('agentBadge'),
        canManageTeam: false,
        showTeam: false,
        canManageReturnPackage: false,
        canPurgeDirty: false,
        isAdmin: false,
        cloudSyncActive: false,
        pendingUpload: false,
        showAgentBills: true,
        showRoleSwitch: canSwitchWorkspace(),
        phone: '',
      })
      void this.refreshAgentEntry()
      return
    }
    if (isGuest() || !isLoggedIn()) {
      const g = getGuestSession()
      this.setData({
        guestMode: true,
        guestNick: (g?.nickname || '').trim() || (g?.browseOnly ? t('guestBrowse') : t('guestWechat')),
        phone: '',
        roleLabel: g?.browseOnly ? t('notLoggedIn') : t('noPhoneBound'),
        shopName: t('brand'),
        logoPath: '',
        canManageTeam: false,
        showTeam: false,
        canManageReturnPackage: false,
        canPurgeDirty: false,
        isAdmin: false,
        cloudSyncActive: false,
        cloudSyncLabel: '',
        pendingUpload: false,
        showAgentBills: peekAgentBound(),
        agentMode: peekAgentBound(),
        showRoleSwitch: false,
      })
      void this.refreshAgentEntry()
      return
    }
    this.setData({
      guestMode: false,
      showAgentBills: false,
      agentMode: false,
      showRoleSwitch: canSwitchWorkspace(),
    })
    // 先定身份，再读角色。自己绑的号会从「无店铺店员」改成店主。
    isOwner()
    const s = getSession()
    const role = String(s?.team?.role || '')
    const joined = role === 'member' && Number(s?.team?.ownerUserId || 0) > 0
    // 与 App 一致：有 displayName 才显示，否则不回退成「商家/店员」
    const display = String(s?.team?.displayName || '').trim()
    const teamShop = String(s?.team?.ownerShopName || s?.team?.shopName || '')
    const pending = hasPendingLocalUpload()
    this.setData({
      phone: s?.phone || '',
      roleLabel: display,
      shopName: teamShop || t('brand'),
      canManageTeam: role === 'owner',
      showTeam: role === 'owner' || joined,
      // 退包、清理：店主。已入职店员不可以。
      canManageReturnPackage: role === 'owner',
      canPurgeDirty: role === 'owner',
      isAdmin: !!s?.isAdmin,
      pendingUpload: pending,
      tutorialsOn: tutorialsEnabled(),
      cloudSyncActive: isCloudSyncAllowed(),
      cloudSyncLabel: isCloudSyncAllowed()
        ? formatExpireLabel(getEntitlement())
        : t('cloudClosed'),
    })
    const entAge = Date.now() - (getEntitlement().fetchedAt || 0)
    void refreshEntitlement({ force: entAge > ENTITLEMENT_FRESH_MS }).then((e) => {
      const active = isCloudSyncAllowed()
      this.setData({
        cloudSyncActive: active,
        cloudSyncLabel: active ? formatExpireLabel(e) : t('cloudClosed'),
        pendingUpload: hasPendingLocalUpload(),
      })
      if (active) void this.loadShop()
      void this.probeDualRole()
    })
    void this.ensureMerchantInviteToken()
  },

  async probeDualRole() {
    if (isAgentWorkspace()) return
    if (isGuest() || !isLoggedIn()) {
      this.setData({ showRoleSwitch: false })
      return
    }
    const who = String(getSession()?.phone || '')
    if (who === _dualRoleProbedFor && Date.now() - _dualRoleProbedAt < MINE_REFRESH_MS) return
    _dualRoleProbedAt = Date.now()
    _dualRoleProbedFor = who
    await fetchAgentMe()
    this.setData({ showRoleSwitch: canSwitchWorkspace() })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
  },

  onSwitchWorkspace() {
    if (this.data.agentMode) applyWorkspaceAndRelaunch('merchant')
    else applyWorkspaceAndRelaunch('agent')
  },

  async refreshAgentEntry() {
    if (!isAgentWorkspace() && !(isGuest() || !isLoggedIn())) {
      this.setData({
        showAgentBills: false,
        agentMode: false,
        agentCanSwitch: false,
        agentCanManageShops: false,
        agentBindings: [],
      })
      this._agentBindings = []
      return
    }
    const me = await fetchAgentMe(undefined, { home: true })
    const bound = !!(me.ok && me.data?.bound)
    const cur = me.data?.current
    const bindings = (me.ok && me.data?.bindings) || []
    this._agentBindings = bindings
    if (cur?.ownerUserId) saveAgentOwnerId(cur.ownerUserId)
    this.setData({
      showAgentBills: bound,
      agentMode: isAgentWorkspace() || bound,
      showRoleSwitch: canSwitchWorkspace(),
      agentCanSwitch: bindings.length > 1,
      agentCanManageShops: bindings.length > 0,
      agentBindings: bindings,
      agentIsAdmin: String(cur?.role || 'admin') !== 'staff',
      phone: bound ? String(cur?.phone || '').trim() : this.data.phone,
      guestNick: bound
        ? (cur?.customerName || '代理').trim()
        : this.data.guestNick,
      roleLabel: bound
        ? `代理${cur?.shopName ? ' · ' + cur.shopName : ''}`
        : this.data.roleLabel,
      shopName: bound ? (cur?.shopName || this.data.shopName) : this.data.shopName,
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
    if (bound || (isLoggedIn() && !isGuest() && !isAgentWorkspace())) {
      void this.ensureMerchantInviteToken()
    }
  },

  async ensureMerchantInviteToken() {
    if (this.data.merchantInviteToken) {
      if (!this.data.inviteStatsHint && !this._inviteStatsTried) {
        this._inviteStatsTried = true
        const minted = await mintMerchantOpenInvite()
        if (minted.ok && minted.stats) {
          this.setData({ inviteStatsHint: merchantInviteStatsHint(minted.stats) })
        }
      }
      return
    }
    const minted = await mintMerchantOpenInvite()
    if (minted.ok && minted.token) {
      this.setData({
        merchantInviteToken: minted.token,
        inviteStatsHint: merchantInviteStatsHint(minted.stats),
      })
    }
  },

  onInviteHub() {
    this.setData({ inviteSheet: true })
  },

  onInviteSheetClose() {
    this.setData({ inviteSheet: false })
  },

  onInviteRules() {
    this.setData({ inviteSheet: false })
    wx.navigateTo({ url: '/pages/legal/legal?type=invite' })
  },

  onAgentSwitchShop() {
    const list = this._agentBindings.length ? this._agentBindings : this.data.agentBindings
    if (list.length < 2) {
      wx.showToast({ title: '当前只绑定了一个档口', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: list.map((b) => `${b.shopName || '档口'} · ${b.customerName}`),
      success: (r) => {
        const pick = list[r.tapIndex]
        if (!pick) return
        saveAgentOwnerId(pick.ownerUserId)
        this.setData({
          shopName: pick.shopName || this.data.shopName,
          guestNick: (pick.customerName || '代理').trim(),
          roleLabel: `代理${pick.shopName ? ' · ' + pick.shopName : ''}`,
        })
        wx.showToast({ title: '已切换到 ' + (pick.shopName || pick.customerName), icon: 'none' })
        wx.switchTab({ url: '/pages/home/home' })
      },
    })
  },

  onGuestBind() {
    requireCloudAccount('generic')
  },

  async goSubscription() {
    if (!requireCloudAccount('sync')) return
    try {
      await requestExpireRenewSubscribe()
    } catch (_) {}
    wx.navigateTo({
      url: `/pages/subscription/subscription${hasPendingLocalUpload() ? '?from=upload' : ''}`,
    })
  },

  async loadShop() {
    if (!isLoggedIn() || isGuest()) return
    const paint = (shop: { shopName?: string; logoBase64?: string | null } | null) => {
      if (!shop) return
      const b64 = shop.logoBase64 || ''
      let logoPath = this.data.logoPath
      if (b64 !== this._logoB64 || !logoPath) {
        logoPath = b64 ? writeShopLogoFile(b64) : ''
        this._logoB64 = b64
      }
      this.setData({
        shopName: shop.shopName || this.data.shopName || t('brand'),
        logoPath,
      })
    }
    paint(peekCachedShop())
    if (cacheGet(CacheKeys.shop, MINE_REFRESH_MS)) return
    const r = await fetchShop()
    if (!r.ok || !r.shop) return
    paint(r.shop)
  },

  onTutorials() {
    wx.navigateTo({ url: '/pages/tutorials/tutorials' })
  },

  go(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    // 本机能力：打印设置 / 回收站 / 打印机，游客可进
    const guestLocalPaths = [
      '/pages/print-settings/print-settings',
      '/pages/recycle-bin/recycle-bin',
      '/pages/printer/printer',
      '/pages/print-template/print-template',
      '/pages/analytics/analytics',
      '/pages/customers/customers',
      '/pages/agent-bills/agent-bills',
      '/pages/agent-profile/agent-profile',
      '/pages/agent-shops/agent-shops',
      '/pages/order-lookup/order-lookup',
      '/pages/web/web',
      '/pages/tutorials/tutorials',
    ]
    if (guestLocalPaths.some((p) => url.startsWith(p))) {
      wx.navigateTo({ url })
      return
    }
    const needSync =
      url.includes('/team-data') ||
      url.includes('/cloud-printer') ||
      url.includes('/returns') ||
      url.includes('/stock') ||
      url.includes('/admin-')
    if (needSync) {
      if (!requireCloudSync('sync')) return
      wx.navigateTo({ url })
      return
    }
    if (!requireCloudAccount('generic')) return
    if (url.includes('/agent-applies')) void requestAgentApplyNoticeSubscribe()
    wx.navigateTo({ url })
  },

  onOpenLegal(e: WechatMiniprogram.TouchEvent) {
    const type = String(e.currentTarget.dataset.type || 'privacy')
    wx.navigateTo({
      url: `/pages/legal/legal?type=${encodeURIComponent(type)}`,
    })
  },

  goShop() {
    if (this.data.agentMode) return
    // 已绑手机即可进店铺资料。云同步未开通时本机保存，不再弹「重新绑定手机号」。
    if (!isLoggedIn()) {
      if (!requireCloudAccount('generic')) return
    }
    wx.navigateTo({ url: '/pages/shop-edit/shop-edit' })
  },

  goTeam() {
    if (!requireCloudSync('team')) return
    wx.navigateTo({ url: '/pages/team/team' })
  },

  onPrintSettings() {
    wx.navigateTo({ url: '/pages/print-settings/print-settings' })
  },

  noop() {},

  onFollow() {
    this.setData({ showFollow: true })
  },

  onFollowClose() {
    this.setData({ showFollow: false })
  },

  onCopySupportWechat() {
    wx.setClipboardData({ data: 'imageok-cn' })
  },

  onSupport() {
    this.setData({
      showSupDlg: true,
      supText: '',
      supLen: 0,
      supSaving: false,
    })
  },

  onSupCancel() {
    if (this.data.supSaving) return
    this.setData({ showSupDlg: false })
  },

  onSupInput(e: WechatMiniprogram.Input) {
    const v = e.detail.value || ''
    this.setData({
      supText: v,
      supLen: v.length,
    })
  },

  async onSupSubmit() {
    if (this.data.supSaving) return
    this.setData({ supSaving: true })
    const agent = !!this.data.agentMode || isAgentWorkspace()
    const r = await submitFeedback(this.data.supText, {
      role: agent ? 'agent' : 'merchant',
      shopName: this.data.shopName,
      nickname: agent
        ? this.data.guestNick || this.data.roleLabel
        : getSession()?.team?.displayName || this.data.guestNick || this.data.roleLabel,
    })
    this.setData({ supSaving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '提交失败', icon: 'none' })
      return
    }
    this.setData({ showSupDlg: false, supText: '', supLen: 0 })
    wx.showToast({ title: '留言已提交，我们会尽快处理', icon: 'none', duration: 2500 })
  },

  onClearCache() {
    this.setData({ showClrDlg: true, clrBusy: false })
  },

  onClrCancel() {
    if (this.data.clrBusy) return
    this.setData({ showClrDlg: false })
  },

  async onClrConfirm() {
    if (this.data.clrBusy) return
    this.setData({ showClrDlg: false, clrBusy: true })
    const guest = !!this.data.guestMode || isGuest()
    wx.showLoading({
      title: guest ? '正在清除本机缓存…' : '正在清除并同步云端数据…',
      mask: true,
    })
    const result = await resetAndSyncFromCloud()
    wx.hideLoading()
    this.setData({ clrBusy: false })
    if (!guest) void this.loadShop()
    if (result.ok) {
      wx.showToast({
        title: result.syncMessage || (guest ? '本机缓存已清除' : '清除完成'),
        icon: 'none',
        duration: 2800,
      })
    } else {
      wx.showToast({
        title: `本地已清除；云端同步失败：${result.error || '请检查网络后在「同步数据」重试'}`,
        icon: 'none',
        duration: 3200,
      })
    }
  },

  onPickLanguage() {
    if (!this.data.agentMode && (this.data.guestMode || isGuest() || !isLoggedIn())) return
    wx.showActionSheet({
      itemList: [t('langZh'), t('langUg')],
      success: (res) => {
        const next: Locale = res.tapIndex === 1 ? 'ug' : 'zh'
        setLocale(next)
      },
    })
  },

  onLogout() {
    if (this.data.loggingOut) return
    const fromAgent = !!this.data.agentMode || isAgentWorkspace()
    if (fromAgent) {
      wx.showModal({
        title: t('logoutAgent'),
        content: t('logoutAskAgent'),
        confirmText: t('exit'),
        cancelText: t('cancel'),
        confirmColor: '#e53935',
        success: (res) => {
          if (!res.confirm) return
          this.setData({ loggingOut: true })
          try {
            exitAgentToLogin()
          } finally {
            this.setData({ loggingOut: false })
          }
        },
      })
      return
    }
    const guest = !!this.data.guestMode
    wx.showModal({
      title: guest ? t('logoutGuest') : t('logout'),
      content: guest ? t('logoutAskGuest') : t('logoutAskUser'),
      confirmText: t('exit'),
      cancelText: t('cancel'),
      confirmColor: '#e53935',
      success: (res) => {
        if (!res.confirm) return
        this.setData({ loggingOut: true })
        try {
          stopSessionGuard()
        } catch (_) {}
        try {
          logout()
        } catch (_) {}
        try {
          clearSession()
        } catch (_) {}
        try {
          clearGuestSession()
        } catch (_) {}
        try {
          clearTeamDataCaches()
        } catch (_) {}
        try {
          clearEntitlementCache()
        } catch (_) {}
        // 商家退出后回到商家登录页，提示请商家登录
        wx.reLaunch({
          url: '/pages/login/login?mode=merchant&stay=1',
          complete: () => {
            this.setData({ loggingOut: false })
          },
        })
      },
    })
  },

  async onCheckUpdate() {
    wx.showLoading({ title: '检查更新', mask: true })
    const r = await checkMpUpdate()
    wx.hideLoading()
    if (r.ready) {
      wx.showModal({
        title: '版本更新',
        content: '新版本已准备好，更新后立即生效。',
        confirmText: '立即更新',
        success(res) {
          if (res.confirm) applyMpUpdate()
        },
      })
      return
    }
    wx.showToast({
      title: r.error || '已是最新版本',
      icon: 'none',
    })
  },

  onShareAppMessage(e: WechatMiniprogram.ShareAppMessageOption) {
    if (this.data.inviteSheet) this.setData({ inviteSheet: false })
    const kind = String((e.target && (e.target as { dataset?: { kind?: string } }).dataset?.kind) || '')
    if (kind === 'staff' && this.data.staffInviteToken && this.data.agentIsAdmin) {
      return {
        title: t('shareStaffTitle'),
        path: `/pages/agent-entry/agent-entry?staffInvite=${encodeURIComponent(this.data.staffInviteToken)}`,
      }
    }
    if (kind === 'inviteAgent' && !this.data.agentMode) {
      return {
        title: agentInviteShareTitle(this.data.shopName),
        path: '/pages/login/login?mode=agent',
        imageUrl: MERCHANT_OPEN_SHARE_IMAGE,
      }
    }
    const name = this.data.agentMode
      ? String(this.data.guestNick || this._agentBindings[0]?.customerName || '').trim()
      : String(this.data.shopName || '').trim()
    return merchantOpenShareMessage(this.data.merchantInviteToken, name)
  },
})
