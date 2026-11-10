import {
  loginWithWechat,
  sendMpBindSms,
  resolveMpPhone,
  bindMpPhoneAndLogin,
  clearMpTicket,
  takeTrialWelcomeDays,
  enterGuestSession,
  enterBrowseOnlyGuest,
  getMpTicket,
  getImageOkToken,
  parseScanTicket,
  previewScanLogin,
  confirmScanLogin,
} from '../../services/auth'
import { clearSession, getGuestSession, getSession, isGuest, isLoggedIn } from '../../services/session'
import { startSessionGuard } from '../../services/session-guard'
import { ensureStorageHeadroom, purgeHeavyLocalStorage } from '../../services/cache'
import { promptCloudSyncAfterLogin } from '../../services/guest-migrate'
import { hydrateAfterLogin } from '../../services/local-reset'
import { isCloudSyncAllowed } from '../../services/subscription'
import { isAgentAccount } from '../../services/team'
import { localVersionLabel } from '../../services/app-version'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import {
  applyAgentShop,
  isOwnAgentInvite,
  parseAgentOwnerQuery,
  promptOwnAgentInvite,
  claimMerchantOpenInvite,
  consumeAgentCustomerInvite,
  consumeStaffInvite,
  previewAgentCustomerInvite,
  consumeStallInvite,
  extractInviteToken,
  fetchAgentMe,
  isMerchantOpenToken,
  merchantOpenShareTitle,
} from '../../services/lookup'
import { setWorkspacePreference, isMerchantSession } from '../../services/workspace'
import { t } from '../../services/i18n'

const LOGOUT_NOTICE_KEY = 'tuk_logout_notice'

Page({
  data: {
    ...capsuleStyleDefaults(),
    loading: false,
    hint: '',
    logoutNotice: '',
    year: new Date().getFullYear(),
    versionLabel: localVersionLabel(),
    showBind: false,
    bindPhone: '',
    phoneLoading: false,
    phoneManual: false,
    smsCode: '',
    smsSending: false,
    smsCountdown: 0,
    mpTicket: '',
    wxAuthed: false,
    wxAvatar: '',
    wxNick: '',
    agreed: false,
    /** 微信侧是否仍需同步隐私授权 */
    needPrivacyAuth: false,
    loginMode: 'merchant' as 'merchant' | 'agent',
    inviteHero: '',
    showScanConfirm: false,
    scanBusy: false,
    scanTitle: '',
    scanDesc: '',
    scanDeviceLabel: '',
    scanPhoneMasked: '',
    scanError: '',
    captchaShow: false,
    captchaError: '',
    captchaSeq: 0,
  },

  _smsTimer: 0 as number,
  _pendingInvite: '' as string,
  _pendingStaff: '' as string,
  _pendingMerchant: '' as string,
  _pendingAgentBind: '' as string,
  _pendingAgentOwner: 0,
  /** 从游客「去绑定/去登录」进入：禁止立刻跳回首页 */
  _stayOnLogin: false as boolean,
  /** 登录后回到订阅开通或购买记录 */
  _returnPath: '' as string,
  _returnSupply: false,
  _pendingScanTicket: '' as string,
  _resolvePrivacyAuthorization: null as null | ((payload: {
    buttonId?: string
    event: 'agree' | 'disagree'
  }) => void),

  onLoad(query: Record<string, string | undefined>) {
    try {
      ensureStorageHeadroom(1024)
    } catch (_) {
      try {
        purgeHeavyLocalStorage()
      } catch (_) {}
    }
    try {
      const s = wx.getStorageSync('tuk_session')
      if (s && (!s.phone || !s.clientId || !s.userId)) {
        clearSession()
      }
      if (s && s.phone) {
        this.setData({ bindPhone: String(s.phone) })
      }
    } catch (e) {
      clearSession()
    }
    this.consumeLogoutNotice()
    this.refreshPrivacySetting()
    this.bindPrivacyNeedListener()

    const wantBind = String(query?.bind || '') === '1'
    const ret = String(query?.return || '')
    this._returnSupply = ret === 'supply'
    this._returnPath =
      ret === 'billing'
        ? '/pages/subscription/history'
        : ret === 'subscription' || ret === 'supply'
          ? '/pages/subscription/subscription'
          : ''
    const stay = String(query?.stay || '') === '1' || wantBind || !!this._returnPath
    this._stayOnLogin = stay

    const parsed = extractInviteToken(
      String(query?.invite || query?.token || query?.staffInvite || ''),
    )
    this._pendingInvite = String(parsed.invite || '').trim()
    this._pendingStaff = String(parsed.staffInvite || '').trim()
    this._pendingMerchant = String(parsed.merchantInvite || '').trim()
    this._pendingAgentBind = String(parsed.agentBind || '').trim()
    this._pendingAgentOwner = parseAgentOwnerQuery(query as Record<string, unknown>)
    if (!this._pendingMerchant) {
      const raw = String(query?.invite || query?.token || '').trim()
      if (isMerchantOpenToken(raw)) this._pendingMerchant = raw
    }
    if (this._pendingMerchant) {
      this._stayOnLogin = true
      this.setData({
        loginMode: 'merchant',
        inviteHero: merchantOpenShareTitle(String(query?.shop || '')),
      })
    }
    const wantAgent =
      !wantBind &&
      !this._pendingMerchant &&
      (String(query?.mode || '') === 'agent' ||
        this._pendingAgentOwner > 0 ||
        !!this._pendingInvite ||
        !!this._pendingStaff ||
        !!this._pendingAgentBind)
    if (wantAgent) {
      this._stayOnLogin = true
      this.setData({ loginMode: 'agent' })
      if (isOwnAgentInvite(this._pendingAgentOwner)) promptOwnAgentInvite()
      if (this._pendingInvite || this._pendingAgentBind) void this.loadInviteHero()
    }

    // 从游客门禁「去绑定」进入
    if (wantBind) {
      const ticket =
        getMpTicket().trim() ||
        String(getGuestSession()?.mpTicket || '').trim()
      if (ticket) {
        try {
          wx.setStorageSync('tuk_mp_bind_ticket', ticket)
        } catch (_) {}
        this.setData({
          showBind: true,
          mpTicket: ticket,
          hint: '绑定手机号后可云端开单与多端同步',
        })
      } else {
        this.setData({
          showBind: false,
          hint: '请先微信登录，再绑定手机号',
        })
      }
    }
    const scanTicket = parseScanTicket(
      String(query?.ticket || query?.t || query?.scene || ''),
    )
    if (scanTicket) {
      this._pendingScanTicket = scanTicket
      this._stayOnLogin = true
      this.setData({ loginMode: 'merchant' })
    }

    if (this._pendingScanTicket && isLoggedIn() && !isGuest() && getImageOkToken()) {
      void this.beginScanConfirm()
      return
    }
    if (this._pendingMerchant && isLoggedIn() && !isGuest()) {
      this.enterHome()
    }
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onUnload() {
    if (this._smsTimer) clearInterval(this._smsTimer)
    try {
      // @ts-ignore 低版本基础库可能无此 API
      if (typeof wx.offNeedPrivacyAuthorization === 'function') {
        wx.offNeedPrivacyAuthorization()
      }
    } catch (_) {}
  },

  /** 查询微信侧隐私授权状态（官方要求：同意后才可调用已声明隐私接口） */
  refreshPrivacySetting() {
    try {
      if (typeof wx.getPrivacySetting !== 'function') {
        this.setData({ needPrivacyAuth: false })
        return
      }
      wx.getPrivacySetting({
        success: (res) => {
          this.setData({
            needPrivacyAuth: !!res.needAuthorization,
          })
        },
        fail: () => {
          this.setData({ needPrivacyAuth: false })
        },
      })
    } catch (_) {
      this.setData({ needPrivacyAuth: false })
    }
  },

  bindPrivacyNeedListener() {
    try {
      if (typeof wx.onNeedPrivacyAuthorization !== 'function') return
      wx.onNeedPrivacyAuthorization((resolve) => {
        this._resolvePrivacyAuthorization = resolve
        this.setData({ needPrivacyAuth: true, agreed: false })
        wx.showToast({ title: '请先阅读并同意隐私协议', icon: 'none' })
      })
    } catch (_) {}
  },

  onShow() {
    try {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (_) {}
    this.consumeLogoutNotice()
    this.refreshPrivacySetting()
    // 游客去绑定/登录时必须停在本页；仅正式登录态才自动进首页
    if (this._stayOnLogin || this.data.showBind || this.data.showScanConfirm || this.data.loginMode === 'agent') return
    if (!isLoggedIn()) return
    setTimeout(() => {
      if (this._stayOnLogin || this.data.showBind || this.data.showScanConfirm || this.data.loginMode === 'agent' || !isLoggedIn()) return
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1] as { route?: string } | undefined
      if (!cur || cur.route !== 'pages/login/login') return
      wx.switchTab({ url: '/pages/home/home' })
    }, 80)
  },

  consumeLogoutNotice() {
    try {
      const msg = wx.getStorageSync(LOGOUT_NOTICE_KEY)
      if (msg) {
        wx.removeStorageSync(LOGOUT_NOTICE_KEY)
        this.setData({ logoutNotice: String(msg) })
      }
    } catch (_) {}
  },

  onToggleAgree() {
    // 仍需微信侧同步时，引导点官方同意按钮，不允许仅靠本地勾选“假同意”
    if (this.data.needPrivacyAuth && !this.data.agreed) {
      wx.showToast({ title: '请点击勾选以同步微信隐私授权', icon: 'none' })
      return
    }
    this.setData({ agreed: !this.data.agreed })
  },

  onAgreePrivacyAuthorization() {
    this.setData({ agreed: true, needPrivacyAuth: false })
    try {
      if (this._resolvePrivacyAuthorization) {
        this._resolvePrivacyAuthorization({
          buttonId: 'agree-privacy-btn',
          event: 'agree',
        })
        this._resolvePrivacyAuthorization = null
      }
    } catch (_) {}
    this.refreshPrivacySetting()
  },

  ensureAgreed(): boolean {
    if (!this.data.agreed) {
      if (this.data.needPrivacyAuth) {
        wx.showToast({ title: '请先勾选并同意隐私协议', icon: 'none' })
      } else {
        wx.showToast({ title: '请先阅读并勾选用户隐私与免责声明', icon: 'none' })
      }
      return false
    }
    return true
  },

  onBindPhone(e: WechatMiniprogram.Input) {
    this.setData({ bindPhone: e.detail.value })
  },

  async onWxPhone(e: { detail?: { code?: string; errMsg?: string } }) {
    if (this.data.phoneLoading || this.data.loading) return
    const detail = e.detail || {}
    const errMsg = String(detail.errMsg || '')
    if (!detail.code || errMsg.indexOf('ok') < 0) {
      if (/deny|cancel/i.test(errMsg)) {
        wx.showToast({ title: '未授权手机号', icon: 'none' })
        return
      }
      this.setData({ phoneManual: true, hint: '微信未返回手机号，请手动输入' })
      return
    }
    this.setData({ phoneLoading: true, hint: '' })
    const r = await resolveMpPhone(detail.code, this.data.mpTicket)
    if (!r.ok) {
      const manual = /手动输入/.test(r.error || '')
      this.setData({
        phoneLoading: false,
        phoneManual: manual,
        hint: r.error || '获取手机号失败',
      })
      wx.showToast({ title: (r.error || '获取手机号失败').slice(0, 20), icon: 'none' })
      return
    }
    this.setData({ phoneLoading: false, phoneManual: false, bindPhone: r.phone, hint: '' })
  },

  onSmsCode(e: WechatMiniprogram.Input) {
    this.setData({ smsCode: e.detail.value })
  },

  /** 暂不绑定 → 以微信游客进首页 */
  onCancelBind() {
    if (this._pendingScanTicket) {
      wx.showToast({ title: '确认设备登录需要绑定手机号', icon: 'none' })
      return
    }
    const ticket = String(this.data.mpTicket || getMpTicket() || '').trim()
    if (ticket) {
      enterGuestSession({
        mpTicket: ticket,
        nickname: this.data.wxNick,
        avatarUrl: this.data.wxAvatar,
      })
      this.setData({
        showBind: false,
        smsCode: '',
        hint: '',
        loading: false,
      })
      this.enterGuestHome()
      return
    }
    clearMpTicket()
    this.setData({
      showBind: false,
      smsCode: '',
      mpTicket: '',
      hint: '',
      loading: false,
    })
  },

  /** 先逛逛：未登录直接进开单表（不涉及隐私采集，无需勾选协议） */
  onBrowseOnly() {
    if (this._pendingScanTicket) {
      wx.showToast({ title: '请先完成设备登录确认', icon: 'none' })
      return
    }
    if (this.data.loginMode === 'agent') return
    enterBrowseOnlyGuest()
    this.enterGuestHome()
  },

  onSwitchMode(e: WechatMiniprogram.TouchEvent) {
    if (this.data.showBind || this.data.loading || this._pendingScanTicket) return
    const mode = String(e.currentTarget.dataset.mode || '')
    if (mode !== 'merchant' && mode !== 'agent') return
    if (mode === this.data.loginMode) return
    this.setData({ loginMode: mode, hint: '' })
  },

  wxProfile() {
    return {
      nickName: String(this.data.wxNick || '').trim(),
      avatarUrl: String(this.data.wxAvatar || '').trim(),
    }
  },

  enterHome() {
    const trialDays = takeTrialWelcomeDays()
    if (trialDays > 0) {
      wx.showModal({
        title: '注册成功',
        content: `已开通 ${trialDays} 天免费试用。到期后付费功能停止，数据保留。付费后可立即继续使用。`,
        showCancel: false,
        confirmText: '知道了',
        complete: () => this.enterHome(),
      })
      return
    }
    if (this._pendingAgentOwner && this.data.loginMode === 'agent') {
      if (isOwnAgentInvite(this._pendingAgentOwner)) {
        promptOwnAgentInvite()
        return
      }
      void this.submitOwnerAgentApply()
      return
    }
    if (this._pendingScanTicket) {
      void this.beginScanConfirm()
      return
    }
    setWorkspacePreference('merchant')
    startSessionGuard()
    const finish = async () => {
      const merchantInvite = this._pendingMerchant
      this._pendingMerchant = ''
      if (merchantInvite || isLoggedIn()) {
        try {
          const claimed = await claimMerchantOpenInvite(merchantInvite)
          if (claimed.granted && claimed.message) {
            wx.showToast({ title: claimed.message.slice(0, 20), icon: 'none', duration: 2400 })
          } else if (merchantInvite && claimed.already && claimed.message) {
            wx.showToast({ title: claimed.message.slice(0, 20), icon: 'none' })
          }
        } catch (_) {}
      }
      wx.showLoading({ title: '同步云端…', mask: true })
      const r = await hydrateAfterLogin()
      wx.hideLoading()
      const offerCloud =
        !this._returnPath &&
        isLoggedIn() &&
        !isGuest() &&
        !isAgentAccount() &&
        !isCloudSyncAllowed()
      if (offerCloud) {
        promptCloudSyncAfterLogin({
          onOpen: () => {
            wx.switchTab({
              url: '/pages/home/home',
              complete: () => {
                setTimeout(() => {
                  wx.navigateTo({ url: '/pages/subscription/subscription' })
                }, 80)
              },
            })
          },
          onLater: () => {
            wx.switchTab({ url: '/pages/home/home' })
          },
        })
        return
      }
      if (this._returnPath) {
        this.goBackToReturn()
      } else {
        wx.switchTab({ url: '/pages/home/home' })
      }
      if (!r.ok) {
        wx.showModal({
          title: '云端同步未完成',
          content:
            (r.syncMessage ? `${r.syncMessage}\n` : '') +
            (r.error || '请检查网络，稍后在「我的」点同步数据重试'),
          showCancel: false,
        })
        return
      }
      const msg = String(r.syncMessage || '登录成功').trim()
      if (msg.length > 20 || msg.includes('订单') || msg.includes('账单')) {
        wx.showModal({
          title: '云端已同步',
          content: msg,
          showCancel: false,
        })
      } else {
        wx.showToast({ title: msg.slice(0, 20), icon: 'none', duration: 2200 })
      }
    }
    setTimeout(() => {
      void finish()
    }, 30)
  },

  goBackToReturn() {
    if (this._returnSupply) {
      if (isCloudSyncAllowed()) {
        wx.switchTab({ url: '/pages/chain/chain' })
        return
      }
      wx.navigateBack({
        fail: () => wx.redirectTo({ url: '/pages/subscription/subscription?from=supply' }),
      })
      return
    }
    const target = this._returnPath || '/pages/subscription/subscription'
    const route = target.replace(/^\//, '')
    const pages = getCurrentPages()
    const has = pages.some((p) => String((p as { route?: string }).route || '') === route)
    if (has && pages.length > 1) {
      wx.navigateBack({
        fail: () => wx.redirectTo({ url: target }),
      })
      return
    }
    wx.redirectTo({ url: target })
  },

  enterGuestHome(toast?: string) {
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/home' })
      if (toast) {
        wx.showToast({ title: toast.slice(0, 20), icon: 'none' })
      }
    }, 30)
  },

  goAgentHome() {
    if (!isLoggedIn() && !isGuest()) {
      try {
        enterBrowseOnlyGuest()
      } catch (_) {}
    }
    setWorkspacePreference('agent')
    wx.reLaunch({
      url: '/pages/home/home?ws=agent',
      fail: () => wx.switchTab({ url: '/pages/home/home' }),
    })
  },

  async loadInviteHero() {
    if (this._pendingAgentBind) {
      const r = await previewAgentCustomerInvite(this._pendingAgentBind)
      const name = String(r.data?.customerName || '').trim()
      const shop = String(r.data?.shopName || '').trim() || '档口'
      this.setData({
        inviteHero: name ? `${shop}邀请你绑定客户「${name}」` : r.error || '邀请无效',
      })
      return
    }
    if (!this._pendingInvite) return
    this.setData({ inviteHero: '到代理广场申请加入档口' })
  },

  async consumePending() {
    if (this._pendingAgentBind) {
      const r = await consumeAgentCustomerInvite(this._pendingAgentBind)
      if (r.bound) {
        this._pendingAgentBind = ''
        this.goAgentHome()
        return true
      }
      this.setData({ loading: false, hint: r.error || '' })
      return false
    }
    const staff = this._pendingStaff
    const stall = this._pendingInvite
    this._pendingInvite = ''
    this._pendingStaff = ''
    if (staff) {
      const r = await consumeStaffInvite(staff)
      if (r.bound) {
        this.goAgentHome()
        return true
      }
      this.setData({ hint: r.error || t('agentEntryNotBound') })
      return false
    }
    if (stall) {
      await consumeStallInvite(stall)
      this.goAgentHome()
      return true
    }
    return false
  },

  askInvite() {
    wx.showModal({
      title: t('agentEntryInviteAsk'),
      editable: true,
      placeholderText: t('agentEntryInvitePh'),
      confirmText: t('confirm'),
      cancelText: t('cancel'),
      success: (r) => {
        if (!r.confirm) return
        const parsed = extractInviteToken(String(r.content || '').trim())
        if (parsed.agentBind) {
          this._pendingAgentBind = parsed.agentBind
          this._pendingInvite = ''
          this._pendingStaff = ''
          void this.runBind()
          return
        }
        const stall = parsed.invite || ''
        const staff = parsed.staffInvite || ''
        if (!stall && !staff) {
          wx.showToast({ title: t('agentEntryInvitePh'), icon: 'none' })
          return
        }
        this._pendingInvite = stall
        this._pendingStaff = staff
        void this.runBind()
      },
    })
  },

  async runBind() {
    if (this.data.loading) return
    if (await this.blockMerchantWechat()) return
    this.setData({ loading: true, hint: '' })
    try {
      const ok = await this.consumePending()
      if (!ok) this.setData({ loading: false })
    } catch (e) {
      this.setData({
        loading: false,
        hint: e instanceof Error ? e.message : t('loadFailed'),
      })
    }
  },

  showMerchantBlocked() {
    this.setData({ loading: false, hint: '' })
    wx.showModal({
      title: t('agentMerchantBlockedTitle'),
      content: t('agentMerchantBlocked'),
      showCancel: false,
      confirmText: t('gotIt'),
    })
  },

  /** 已是档口开单微信则不能再绑代理；未绑定才走邀请码。 */
  async blockMerchantWechat(): Promise<boolean> {
    if (isMerchantSession()) {
      this.showMerchantBlocked()
      return true
    }
    try {
      const r = await loginWithWechat(this.wxProfile())
      if (r.ok) {
        this.showMerchantBlocked()
        return true
      }
    } catch (_) {}
    return false
  },

  async submitOwnerAgentApply() {
    const ownerUserId = this._pendingAgentOwner
    if (!ownerUserId) {
      this.setData({ loading: false })
      return
    }
    const session = getSession()
    const displayName =
      String(this.data.wxNick || session?.team?.displayName || session?.phone || '').trim() || '代理'
    const phone = String(session?.phone || '').trim()
    const r = await applyAgentShop({ ownerUserId, displayName, phone })
    const tip = (r.ok ? r.message : r.error) || (r.ok ? '已提交申请' : '申请失败')
    this.setData({ loading: false, hint: r.ok ? '' : tip })
    if (r.ok || /已提交|已是该档口/.test(tip)) {
      wx.showToast({ title: tip.slice(0, 20), icon: 'none' })
      this.goAgentHome()
    }
  },

  async onAgentLogin() {
    if (this.data.loading) return
    if (!this.ensureAgreed()) return
    this.setData({ loading: true, hint: '' })
    try {
      if (
        this._pendingAgentOwner &&
        !this._pendingAgentBind &&
        !this._pendingInvite &&
        !this._pendingStaff
      ) {
        if (isOwnAgentInvite(this._pendingAgentOwner)) {
          this.setData({ loading: false })
          promptOwnAgentInvite()
          return
        }
        if (await this.blockMerchantWechat()) return
        await this.submitOwnerAgentApply()
        return
      }
      const me = await fetchAgentMe()
      if (me.ok && me.data?.bound) {
        this.goAgentHome()
        return
      }
      if (await this.blockMerchantWechat()) return
      if (this._pendingInvite || this._pendingStaff || this._pendingAgentBind) {
        const ok = await this.consumePending()
        if (!ok) this.setData({ loading: false })
        return
      }
      this.setData({ loading: false })
      this.askInvite()
    } catch (e) {
      this.setData({
        loading: false,
        hint: e instanceof Error ? e.message : t('loadFailed'),
      })
    }
  },

  onWechatLogin() {
    if (this.data.loading) return
    if (!this.ensureAgreed()) return
    this.setData({
      loading: true,
      hint: '正在微信登录…',
      logoutNotice: '',
    })
    void this.finishWechatLogin()
  },

  async finishWechatLogin() {
    try {
      const r = await loginWithWechat(this.wxProfile())
      if (r.ok) {
        this.setData({ hint: '', loading: false })
        this.enterHome()
        return
      }
      if ('needBind' in r && r.needBind) {
        enterGuestSession({
          mpTicket: r.mpTicket,
          nickname: this.data.wxNick,
          avatarUrl: this.data.wxAvatar,
        })
        this._stayOnLogin = true
        this.setData({
          loading: false,
          showBind: true,
          mpTicket: r.mpTicket,
          wxAuthed: true,
          hint: '',
        })
        return
      }
      this.setData({ loading: false, hint: r.error || '微信登录失败' })
      wx.showToast({ title: (r.error || '微信登录失败').slice(0, 20), icon: 'none' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '微信登录失败'
      this.setData({ loading: false, hint: msg })
      wx.showToast({ title: msg.slice(0, 20), icon: 'none' })
    }
  },

  startSmsCountdown(sec = 60) {
    if (this._smsTimer) clearInterval(this._smsTimer)
    this.setData({ smsCountdown: sec })
    this._smsTimer = setInterval(() => {
      const n = this.data.smsCountdown - 1
      if (n <= 0) {
        clearInterval(this._smsTimer)
        this._smsTimer = 0
        this.setData({ smsCountdown: 0 })
        return
      }
      this.setData({ smsCountdown: n })
    }, 1000) as unknown as number
  },

  captchaErrorText(msg: string) {
    return /点击|人机验证|按提示|按顺序|重新获取|已失效|验证失败次数/.test(msg)
  },

  async onSendSms() {
    if (this.data.smsSending || this.data.smsCountdown > 0 || this.data.captchaShow) return
    const phone = String(this.data.bindPhone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入11位手机号', icon: 'none' })
      return
    }
    this.setData({ captchaShow: true, captchaError: '', hint: '' })
  },

  onCaptchaCancel() {
    this.setData({ captchaShow: false, captchaError: '', smsSending: false })
  },

  async onCaptchaPass(e: WechatMiniprogram.TouchEvent) {
    const detail = (e.detail || {}) as {
      challengeId?: string
      points?: { x: number; y: number; t: number }[]
    }
    const phone = String(this.data.bindPhone || '').trim()
    this.setData({ smsSending: true, hint: '' })
    const r = await sendMpBindSms(phone, this.data.mpTicket, {
      challengeId: detail.challengeId,
      points: detail.points,
    })
    this.setData({ smsSending: false })
    if (!r.ok) {
      const msg = r.error || '发送失败'
      if (this.captchaErrorText(msg)) {
        this.setData({ captchaError: msg, captchaSeq: Date.now() })
        return
      }
      this.setData({ captchaShow: false, captchaError: '', hint: msg })
      wx.showToast({ title: msg.slice(0, 20), icon: 'none' })
      return
    }
    this.setData({ captchaShow: false, captchaError: '' })
    this.startSmsCountdown(60)
    wx.showToast({ title: '验证码已发送', icon: 'none' })
  },

  async onBindSubmit() {
    if (this.data.loading) return
    // 微信一键登录时已勾选隐私，绑定手机号不再重复确认
    const phone = String(this.data.bindPhone || '').trim()
    const smsCode = String(this.data.smsCode || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入11位手机号', icon: 'none' })
      return
    }
    if (!smsCode || smsCode.length < 4) {
      wx.showToast({ title: '请输入短信验证码', icon: 'none' })
      return
    }
    this.setData({ loading: true, hint: '正在绑定并登录…' })
    const r = await bindMpPhoneAndLogin(
      phone,
      smsCode,
      this.data.mpTicket,
      this.wxProfile(),
    )
    this.setData({ loading: false })
    if (!r.ok) {
      this.setData({ hint: r.error || '绑定失败' })
      wx.showToast({ title: (r.error || '绑定失败').slice(0, 20), icon: 'none' })
      return
    }
    this.setData({ hint: '', showBind: false })
    this.enterHome()
  },

  async beginScanConfirm() {
    const ticket = this._pendingScanTicket
    if (!ticket) return
    this._stayOnLogin = true
    if (!isLoggedIn() || isGuest() || !getImageOkToken()) {
      this.setData({
        hint: '请先微信登录并绑定手机号，再确认这台设备',
        showScanConfirm: false,
      })
      return
    }
    this.setData({
      showScanConfirm: true,
      scanBusy: true,
      scanError: '',
      scanTitle: '确认登录？',
      scanDesc: '确认后，对应设备将使用当前账号登录。',
      scanDeviceLabel: '设备登录',
      scanPhoneMasked: '',
    })
    const r = await previewScanLogin(ticket)
    if (!r.ok) {
      this.setData({
        scanBusy: false,
        scanError: r.error || '登录码无效或已过期',
        scanTitle: '无法确认',
        scanDesc: r.httpStatus === 410 ? '请回到 App 或电脑刷新登录码后再试。' : '请重新发起微信登录。',
      })
      return
    }
    const label = r.deviceLabel || '设备'
    this.setData({
      scanBusy: false,
      scanDeviceLabel: label,
      scanTitle: `确认登录${label}？`,
      scanDesc: `确认后，${label}将使用当前账号登录。`,
      scanPhoneMasked: r.phoneMasked || '',
    })
  },

  async onConfirmScanLogin() {
    if (this.data.scanBusy) return
    const ticket = this._pendingScanTicket
    if (!ticket) return
    this.setData({ scanBusy: true, scanError: '' })
    const r = await confirmScanLogin(ticket)
    if (!r.ok) {
      this.setData({
        scanBusy: false,
        scanError: r.error || '确认失败',
      })
      wx.showToast({ title: (r.error || '确认失败').slice(0, 20), icon: 'none' })
      return
    }
    this._pendingScanTicket = ''
    this.setData({
      scanBusy: false,
      showScanConfirm: false,
      scanTitle: '已确认',
      scanDesc: r.message || '设备即将登录',
    })
    wx.showToast({ title: '已确认登录', icon: 'success', duration: 800 })
    if (typeof wx.exitMiniProgram === 'function') {
      wx.exitMiniProgram({
        fail: () => {
          wx.showToast({ title: '请返回 App 或电脑', icon: 'none' })
        },
      })
      return
    }
    wx.showToast({ title: '请返回 App 或电脑', icon: 'none' })
  },

  noop() {},

  onCancelScanLogin() {
    this._pendingScanTicket = ''
    this._stayOnLogin = false
    this.setData({
      showScanConfirm: false,
      scanBusy: false,
      scanError: '',
    })
  },

  onOpenLegal(e: WechatMiniprogram.TouchEvent) {
    const type = String(e.currentTarget.dataset.type || 'privacy')
    wx.navigateTo({
      url: `/pages/legal/legal?type=${encodeURIComponent(type)}`,
    })
  },

  onShareAppMessage() {
    return { title: t('brand'), path: '/pages/login/login' }
  },

  onShareTimeline() {
    return { title: t('brand') }
  },
})
