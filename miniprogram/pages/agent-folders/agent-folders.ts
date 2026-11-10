import {
  createAgentShare,
  deleteAgentFolder,
  fetchAgentFolders,
  upsertAgentFolder,
  type AgentFolder,
  type AgentFolderItem,
} from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId } from '../../services/workspace'
import { assertMsgSecCheck } from '../../services/sec-check'

Page({
  data: {
    loading: true,
    folders: [] as AgentFolder[],
    folder: null as AgentFolder | null,
    items: [] as AgentFolderItem[],
    creating: false,
    newTitle: '',
    ...i18nState(),
  },

  _id: 0,

  applyLocale() {
    bindPageI18n(this, 'lookFolder')
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyLocale()
    this._id = Number(query?.id || 0) || 0
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
  },

  ownerId() {
    return peekAgentOwnerId() || undefined
  },

  async refresh() {
    this.setData({ loading: true })
    const r = await fetchAgentFolders(this.ownerId(), this._id || undefined)
    if (!r.ok) {
      this.setData({ loading: false })
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    const folders = r.data?.folders || []
    const folder = this._id ? r.data?.folder || folders.find((f) => f.id === this._id) || null : null
    if (folder) {
      wx.setNavigationBarTitle({ title: folder.title || t('lookFolder') })
    }
    this.setData({
      loading: false,
      folders,
      folder: folder || null,
      items: folder?.items || [],
    })
  },

  onOpenFolder(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    if (!id) return
    wx.navigateTo({ url: `/pages/agent-folders/agent-folders?id=${id}` })
  },

  onStartCreate() {
    this.setData({ creating: true, newTitle: '' })
  },

  onCancelCreate() {
    this.setData({ creating: false, newTitle: '' })
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ newTitle: e.detail.value })
  },

  async onCreate() {
    const title = String(this.data.newTitle || '').trim()
    if (!title) {
      wx.showToast({ title: t('folderTitle'), icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([title]))) return
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await upsertAgentFolder({ ownerUserId: this.ownerId(), title })
    wx.hideLoading()
    if (!r.ok || !r.data?.folder?.id) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this.setData({ creating: false, newTitle: '' })
    wx.navigateTo({ url: `/pages/agent-folders/agent-folders?id=${r.data.folder.id}` })
  },

  async onShareFolder() {
    const id = this.data.folder?.id
    if (!id) return
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await createAgentShare('', this.ownerId(), id)
    wx.hideLoading()
    if (!r.ok || !r.data?.token) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/agent-share/agent-share?t=${encodeURIComponent(r.data.token)}`,
    })
  },

  onFolderToCart() {
    const items = this.data.items || []
    if (!items.length) {
      wx.showToast({ title: t('folderEmpty'), icon: 'none' })
      return
    }
    try {
      wx.setStorageSync(
        'tuk_agent_folder_cart',
        items.map((x) => ({
          code: x.code,
          color: x.color || '',
          size: x.size || '',
        })),
      )
      if (this.data.folder?.kind === 'wish') {
        wx.setStorageSync('tuk_agent_open_ship', 1)
      }
    } catch (_) {}
    wx.switchTab({ url: '/pages/products/products' })
  },

  async onRemoveItem(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const folder = this.data.folder
    if (!folder?.id || !code) return
    const items = (folder.items || []).filter((x) => x.code !== code)
    const r = await upsertAgentFolder({
      ownerUserId: this.ownerId(),
      id: folder.id,
      title: folder.title,
      items,
      kind: folder.kind,
    })
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    void this.refresh()
  },

  async onDeleteFolder() {
    const folder = this.data.folder
    if (!folder?.id || folder.kind === 'wish') return
    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: t('deleteFolder'),
        content: folder.title,
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!ok) return
    const r = await deleteAgentFolder(folder.id, this.ownerId())
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    wx.navigateBack()
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  noop() {},
})
