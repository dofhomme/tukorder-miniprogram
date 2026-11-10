import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { isGuest, isLoggedIn } from '../../services/session'
import { assertMsgSecCheck } from '../../services/sec-check'
import { softDeleteCategoryLocal } from '../../services/recycle-bin'
import { canEditCatalog, catalogEditDeniedText, fetchCatalog, fetchCategories, patchCatalog, peekCachedCatalog, peekCachedCategories, uploadCategories } from '../../services/team'
import type { Category, Product } from '../../services/team'

type Row = { key: string; name: string; id?: number }

const ROW_PX = 52

Page({
  data: {
    loading: true,
    busy: false,
    loadError: '',
    list: [] as Row[],
    dragIndex: -1,
    showNameDlg: false,
    nameDlgTitle: t('addCategory'),
    nameDlgValue: '',
    nameDlgMode: 'add' as 'add' | 'edit',
    editIndex: -1,
    showDelDlg: false,
    delName: '',
    delCount: 0,
    delIndex: -1,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'catManage')
    this.setData({
      nameDlgTitle: this.data.nameDlgMode === 'edit' ? t('editCategory') : t('addCategory'),
    })
  },

  _dragFrom: -1,
  _lastY: 0,
  _dirty: false,
  _orderChanged: false,

  onLoad() {
    if (!canEditCatalog()) {
      wx.showToast({ title: catalogEditDeniedText(), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
      return
    }
    this.applyLocale()
    void this.reload()
  },

  onShow() {
    this.applyLocale()
  },

  noop() {},

  async reload() {
    this.setData({ loading: true, loadError: '' })
    try {
      const list = await this.loadMerged()
      this.setData({ list, loading: false, loadError: '' })
    } catch (e) {
      this.setData({
        loading: false,
        loadError: e instanceof Error ? e.message : '加载失败',
      })
    }
  },

  onReload() {
    void this.reload()
  },

  /** 云端分类 + 商品里已有分类（对齐 App ensureImportedFromProducts） */
  async loadMerged(): Promise<Row[]> {
    const guest = isGuest() || !isLoggedIn()
    const catalog = peekCachedCatalog()

    let fromStored: Array<{ name: string; id?: number; sortOrder: number }> = []
    if (guest) {
      fromStored = peekCachedCategories()
        .map((c, i) => ({
          name: (c.name || '').trim(),
          id: c.id,
          sortOrder: c.sortOrder ?? i,
        }))
        .filter((c) => c.name)
    } else {
      const catRes = await fetchCategories()
      if (!catRes.ok && !catalog.length && !peekCachedCategories().length) {
        throw new Error(catRes.error || '加载失败')
      }
      fromStored = (catRes.categories || peekCachedCategories())
        .map((c, i) => ({
          name: (c.name || '').trim(),
          id: c.id,
          sortOrder: c.sortOrder ?? i,
        }))
        .filter((c) => c.name)
    }
    fromStored.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'),
    )

    const seen = new Set(fromStored.map((c) => c.name))
    const fromProducts: string[] = []
    for (const p of catalog) {
      const n = (p.category || '').trim()
      if (n && !seen.has(n)) {
        seen.add(n)
        fromProducts.push(n)
      }
    }
    fromProducts.sort((a, b) => a.localeCompare(b, 'zh'))

    const rows: Row[] = [
      ...fromStored.map((c, i) => ({
        key: c.id != null ? `id-${c.id}` : `n-${c.name}-${i}`,
        name: c.name,
        id: c.id,
      })),
      ...fromProducts.map((name, i) => ({
        key: `p-${name}-${i}`,
        name,
      })),
    ]
    return rows
  },

  syncToast(action: string) {
    if (isGuest() || !isLoggedIn()) return `${action}（本机）`
    return `${action}，正在同步云端`
  },

  async persist(list: Row[], opts?: { rename?: { from: string; to: string } }) {
    if (!(await assertMsgSecCheck(list.map((r) => r.name)))) {
      return { ok: false as const, error: '内容含违规信息，请修改后再试' }
    }
    const categories: Category[] = list.map((r, i) => ({
      name: r.name,
      sortOrder: i,
      id: r.id,
    }))

    if (opts?.rename) {
      const { from, to } = opts.rename
      let products = peekCachedCatalog()
      if (!products.length && isLoggedIn() && !isGuest()) {
        const r = await fetchCatalog()
        products = r.products || []
      }
      const patched: Product[] = products
        .filter((p) => (p.category || '').trim() === from)
        .map((p) => ({ ...p, category: to }))
      if (patched.length) {
        const pr = await patchCatalog(patched)
        if (!pr.ok) return { ok: false as const, error: pr.error || '更新商品分类失败' }
      }
    }

    const ur = await uploadCategories(categories)
    if (!ur.ok) return { ok: false as const, error: ur.error || '同步失败' }
    this._dirty = true
    return { ok: true as const }
  },

  onAdd() {
    if (this.data.busy) return
    this.setData({
      showNameDlg: true,
      nameDlgTitle: t('addCategory'),
      nameDlgValue: '',
      nameDlgMode: 'add',
      editIndex: -1,
    })
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.list[index]
    if (!item) return
    this.setData({
      showNameDlg: true,
      nameDlgTitle: t('editCategory'),
      nameDlgValue: item.name,
      nameDlgMode: 'edit',
      editIndex: index,
    })
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ nameDlgValue: e.detail.value })
  },
  onNameCancel() {
    this.setData({ showNameDlg: false })
  },

  async onNameConfirm() {
    const name = (this.data.nameDlgValue || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    const mode = this.data.nameDlgMode
    const list = this.data.list.slice()
    const exists = list.some(
      (r, i) => r.name === name && (mode !== 'edit' || i !== this.data.editIndex),
    )
    if (exists) {
      wx.showToast({ title: '分类名已存在', icon: 'none' })
      return
    }

    this.setData({ showNameDlg: false, busy: true })
    if (mode === 'add') {
      list.push({ key: `new-${Date.now()}`, name })
      const r = await this.persist(list)
      this.setData({ busy: false })
      if (!r.ok) {
        wx.showToast({ title: r.error || '失败', icon: 'none' })
        return
      }
      this.setData({ list })
      wx.showToast({ title: this.syncToast('已添加'), icon: 'none' })
      return
    }

    const idx = this.data.editIndex
    const old = list[idx]
    if (!old || old.name === name) {
      this.setData({ busy: false })
      return
    }
    const from = old.name
    list[idx] = { ...old, name, key: old.id != null ? old.key : `n-${name}` }
    const r = await this.persist(list, { rename: { from, to: name } })
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '失败', icon: 'none' })
      await this.reload()
      return
    }
    this.setData({ list })
    wx.showToast({ title: this.syncToast('已保存'), icon: 'none' })
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.list[index]
    if (!item) return
    const products = peekCachedCatalog()
    const count = products.filter((p) => (p.category || '').trim() === item.name).length
    this.setData({
      showDelDlg: true,
      delName: item.name,
      delCount: count,
      delIndex: index,
    })
  },

  onDelCancel() {
    this.setData({ showDelDlg: false })
  },

  async onDelConfirm() {
    const idx = this.data.delIndex
    const list = this.data.list.slice()
    if (idx < 0 || idx >= list.length) {
      this.setData({ showDelDlg: false })
      return
    }
    const removed = list[idx]
    softDeleteCategoryLocal({ name: removed.name, id: removed.id, sortOrder: idx })
    list.splice(idx, 1)
    this.setData({ showDelDlg: false, busy: true, list })
    const r = await this.persist(list)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '失败', icon: 'none' })
      await this.reload()
      return
    }
    wx.showToast({ title: this.syncToast('已移入回收站'), icon: 'none' })
  },

  onDragStart(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const t = e.touches[0]
    this._dragFrom = index
    this._lastY = t ? t.clientY : 0
    this._orderChanged = false
    this.setData({ dragIndex: index })
  },

  onDragMove(e: WechatMiniprogram.TouchEvent) {
    if (this._dragFrom < 0 || this.data.busy) return
    const t = e.touches[0]
    if (!t) return
    const dy = t.clientY - this._lastY
    if (Math.abs(dy) < ROW_PX * 0.55) return

    const list = this.data.list.slice()
    const from = this._dragFrom
    const to = dy > 0 ? from + 1 : from - 1
    if (to < 0 || to >= list.length) return

    const item = list.splice(from, 1)[0]
    list.splice(to, 0, item)
    this._dragFrom = to
    this._lastY = t.clientY
    this._orderChanged = true
    this.setData({ list, dragIndex: to })
  },

  async onDragEnd() {
    if (this._dragFrom < 0) return
    this._dragFrom = -1
    this.setData({ dragIndex: -1 })
    if (!this._orderChanged || this.data.busy) {
      this._orderChanged = false
      return
    }
    this._orderChanged = false
    this.setData({ busy: true })
    const r = await this.persist(this.data.list)
    this.setData({ busy: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '排序保存失败', icon: 'none' })
      await this.reload()
      return
    }
    wx.showToast({ title: this.syncToast('已调整顺序'), icon: 'none' })
  },
})
