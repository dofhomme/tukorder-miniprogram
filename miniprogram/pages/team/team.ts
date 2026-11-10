import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { getSession, isLoggedIn, setSession } from '../../services/session'
import { requireCloudSync } from '../../services/account-gate'
import { checkMemberPhone, confirmMemberInvite, fetchCatalog, fetchCategories, fetchCustomers, fetchMembers, fetchShop, inviteMemberSms, isOwner, registerMember, removeMember, renameMember, saveEntitlementSeats } from '../../services/team'
import { setSupplyStaff } from '../../services/supply'
import type { TeamMember } from '../../services/team'
import { refreshEntitlement } from '../../services/subscription'

type MemberRow = TeamMember & { joinedLabel: string }

function formatJoined(raw?: string | null): string {
  if (!raw) return '—'
  const s = String(raw).replace('T', ' ').slice(0, 16)
  return s || '—'
}

function firstChar(name: string): string {
  const n = (name || '').trim()
  return n ? n[0] : '?'
}

Page({
  data: {
    loading: true,
    busy: false,
    isOwner: false,
    isAdmin: false,
    displayLabel: '',
    avatarChar: '?',
    roleBadge: t('roleMember'),
    ownerShop: '',
    ownerPhone: '',
    members: [] as MemberRow[],
    seatLimit: 0,
    seatUsed: 0,
    seatHint: '',
    myName: '',
    showInvite: false,
    inviteStep: 'phone',
    inviteHint: t('inviteHintDefault'),
    phone: '',
    password: '',
    smsCode: '',
    displayName: '',
    detail: null as MemberRow | null,
    captchaShow: false,
    captchaError: '',
    captchaSeq: 0,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'teamTitle')
    this.setData({
      inviteHint: t('inviteHintDefault'),
    })
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!requireCloudSync('team')) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) })
      return
    }
    void this.reload()
  },

  noop() {},

  async reload() {
    this.setData({ loading: true })
    const s = getSession()
    const owner = isOwner()
    const isAdmin = !!s?.isAdmin
    const display =
      String(s?.team?.displayName || '').trim() ||
      (s?.phone && s.phone.length >= 4 ? s.phone.slice(-4) : s?.phone || '我')
    let roleBadge = t('roleMember')
    if (owner && isAdmin) roleBadge = t('roleMerchantAdmin')
    else if (owner) roleBadge = t('roleMerchant')
    else if (isAdmin) roleBadge = t('roleAdmin')

    let members: MemberRow[] = []
    let seatLimit = 0
    if (owner) {
      const ent = await refreshEntitlement({ force: true })
      if (ent.status === 'active' && ent.grantSource !== 'shop_seat') {
        seatLimit = Number(ent.seatLimit || 0)
      }
      const r = await fetchMembers()
      if (r.ok) {
        members = r.members.map((m) => ({
          ...m,
          joinedLabel: formatJoined(m.joinedAt),
        }))
        if (r.seatLimit) seatLimit = r.seatLimit
      } else {
        wx.showToast({ title: r.error || '加载失败', icon: 'none' })
      }
    }
    const seatUsed = members.filter((m) => m.seatGranted).length

    this.setData({
      loading: false,
      isOwner: owner,
      isAdmin,
      displayLabel: display,
      avatarChar: firstChar(display),
      roleBadge,
      ownerShop: String(s?.team?.ownerShopName || s?.team?.shopName || ''),
      ownerPhone: String(s?.team?.ownerPhone || ''),
      members,
      seatLimit,
      seatUsed,
      seatHint: t('seatUsedHint')
        .replace('{m}', String(seatUsed))
        .replace('{n}', String(seatLimit)),
      myName: String(s?.team?.displayName || ''),
    })
  },

  async onToggleSeat(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.isOwner || this.data.busy) return
    const userId = Number(e.currentTarget.dataset.userid)
    if (!userId) return
    const members = this.data.members as MemberRow[]
    const cur = members.find((m) => m.userId === userId)
    if (!cur) return
    const nextGranted = !cur.seatGranted
    const used = members.filter((m) => m.seatGranted).length
    const limit = Number(this.data.seatLimit || 0)
    if (nextGranted && used >= limit) {
      wx.showToast({
        title: t('seatFull').replace('{n}', String(limit)),
        icon: 'none',
      })
      return
    }
    const ids = members
      .filter((m) => (m.userId === userId ? nextGranted : !!m.seatGranted))
      .map((m) => m.userId)
    this.setData({ busy: true })
    const r = await saveEntitlementSeats(ids)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    void this.reload()
  },

  onTeamData() {
    wx.navigateTo({ url: '/pages/team-data/team-data' })
  },

  onInvite() {
    if (!this.data.isOwner || this.data.busy) return
    this.setData({
      showInvite: true,
      inviteStep: 'phone',
      inviteHint: '先检测手机号：未注册可设密创建；已注册需对方短信验证后加入。',
      phone: '',
      password: '',
      smsCode: '',
      displayName: '',
      detail: null,
    })
  },

  onCloseInvite() {
    if (this.data.busy) return
    this.setData({ showInvite: false })
  },

  onPhone(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value })
  },
  onPassword(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value })
  },
  onSmsCode(e: WechatMiniprogram.Input) {
    this.setData({ smsCode: e.detail.value })
  },
  onBackToPhone() {
    if (this.data.busy) return
    this.setData({
      inviteStep: 'phone',
      inviteHint: '先检测手机号：未注册可设密创建；已注册需对方短信验证后加入。',
      password: '',
      smsCode: '',
    })
  },
  onName(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value })
  },
  onMyName(e: WechatMiniprogram.Input) {
    this.setData({ myName: e.detail.value })
  },

  async onCheckPhone() {
    if (this.data.busy) return
    const phone = (this.data.phone || '').trim()
    if (!phone) {
      wx.showToast({ title: '请填写成员手机号', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await checkMemberPhone(phone)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '检测失败', icon: 'none' })
      return
    }
    if (r.status === 'blocked') {
      wx.showToast({ title: r.error || '该账号不能添加为员工', icon: 'none' })
      return
    }
    this.setData({
      inviteStep: r.status === 'need_sms' ? 'sms' : 'new',
      inviteHint:
        r.error ||
        (r.status === 'need_sms'
          ? '该号已注册，发送验证码经对方确认后加入本店。'
          : '该号未注册，请设置初始密码。'),
    })
  },

  captchaErrorText(msg: string) {
    return /点击|人机验证|按提示|按顺序|重新获取|已失效|验证失败次数/.test(msg)
  },

  async onSendSms() {
    if (this.data.busy || this.data.captchaShow) return
    const phone = (this.data.phone || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入11位手机号', icon: 'none' })
      return
    }
    this.setData({ captchaShow: true, captchaError: '' })
  },

  onCaptchaCancel() {
    this.setData({ captchaShow: false, captchaError: '', busy: false })
  },

  async onCaptchaPass() {
    const phone = (this.data.phone || '').trim()
    this.setData({ busy: true })
    const r = await inviteMemberSms(phone)
    this.setData({ busy: false })
    if (!r.ok) {
      const msg = r.error || '发送失败'
      if (this.captchaErrorText(msg)) {
        this.setData({ captchaError: msg, captchaSeq: Date.now() })
        return
      }
      this.setData({ captchaShow: false, captchaError: '' })
      wx.showToast({ title: msg.slice(0, 20), icon: 'none' })
      return
    }
    this.setData({ captchaShow: false, captchaError: '' })
    wx.showToast({ title: '验证码已发送', icon: 'none' })
  },

  async onConfirmInvite() {
    if (this.data.busy) return
    const phone = (this.data.phone || '').trim()
    const smsCode = (this.data.smsCode || '').trim()
    const displayName = (this.data.displayName || '').trim()
    if (!smsCode) {
      wx.showToast({ title: '请输入验证码', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await confirmMemberInvite(phone, smsCode, displayName || phone)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '验证失败', icon: 'none' })
      return
    }
    this.setData({ showInvite: false })
    wx.showToast({ title: '已加入本店员工', icon: 'none' })
    void this.reload()
  },

  async onCreate() {
    if (this.data.busy) return
    const phone = (this.data.phone || '').trim()
    const password = this.data.password || ''
    const displayName = (this.data.displayName || '').trim()
    if (!phone) {
      wx.showToast({ title: '请填写成员手机号', icon: 'none' })
      return
    }
    if (password.length < 6) {
      wx.showToast({ title: '密码至少 6 位', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    const r = await registerMember(phone, password, displayName || phone)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '失败', icon: 'none' })
      return
    }
    if (r.status === 'need_sms') {
      this.setData({
        inviteStep: 'sms',
        inviteHint: '该号已注册，请发送验证码经对方确认。',
      })
      return
    }
    this.setData({ showInvite: false })
    wx.showToast({ title: '成员已加入团队', icon: 'none' })
    void this.reload()
  },

  onMemberTap(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const m = this.data.members.find((x) => x.id === id)
    if (!m) return
    this.setData({ detail: m, showInvite: false })
  },

  onCloseDetail() {
    this.setData({ detail: null })
  },

  async onSupply(e: WechatMiniprogram.SwitchChange) {
    const detail = this.data.detail
    if (!detail || this.data.busy) return
    const enabled = !!e.detail.value
    this.setData({ busy: true })
    const r = await setSupplyStaff(detail.id, enabled)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || '设置失败', icon: 'none' })
      this.setData({ detail: { ...detail, supplyEnabled: !enabled } })
      return
    }
    const members = this.data.members.map((m) =>
      m.id === detail.id ? { ...m, supplyEnabled: enabled } : m,
    )
    this.setData({ members, detail: { ...detail, supplyEnabled: enabled } })
  },

  onRemove(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const name = String(e.currentTarget.dataset.name || '')
    this.setData({ detail: null, showInvite: false })
    wx.showModal({
      title: '移出团队',
      content: `确定解除「${name}」的员工关系吗？对方 ImageOK 账号会保留，只是不再属于本店。`,
      confirmText: '确定',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ busy: true })
        const r = await removeMember(id)
        this.setData({ busy: false })
        if (!r.ok) {
          wx.showToast({ title: r.error || '失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已移出团队', icon: 'none' })
        void this.reload()
      },
    })
  },

  async onRename() {
    const name = (this.data.myName || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写显示名', icon: 'none' })
      return
    }
    const r = await renameMember(name)
    if (!r.ok) {
      wx.showToast({ title: r.error || '失败', icon: 'none' })
      return
    }
    const s = getSession()
    if (s) {
      setSession({
        ...s,
        team: { ...(s.team || {}), displayName: name },
      })
    }
    wx.showToast({ title: '名称已更新', icon: 'success' })
    void this.reload()
  },

  async onSyncBoss() {
    if (this.data.busy || this.data.isOwner) return
    this.setData({ busy: true })
    wx.showLoading({ title: '同步中…', mask: true })
    const [shop, cat, cats, cust] = await Promise.all([
      fetchShop(),
      fetchCatalog(),
      fetchCategories(),
      fetchCustomers(),
    ])
    wx.hideLoading()
    this.setData({ busy: false })
    const ok = shop.ok && cat.ok
    wx.showToast({
      title: ok ? '已同步商家数据' : cat.error || shop.error || cats.error || cust.error || '同步失败',
      icon: ok ? 'success' : 'none',
    })
  },
})
