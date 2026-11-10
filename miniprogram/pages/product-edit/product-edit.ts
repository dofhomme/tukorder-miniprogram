import { requireCloudSync } from '../../services/account-gate'
import { stripSpokenMarks } from '../../services/voice-router'
import { extractHangtagImage } from '../../services/ai'
import { hangtagHasMatrix, parseHangtagText } from '../../services/hangtag'
import { isGuest, isLoggedIn } from '../../services/session'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import { softDeleteProduct } from '../../services/recycle-bin'
import { canEditCatalog, catalogEditDeniedText, fetchCatalog, fetchCategories, patchCatalog, peekCachedCatalog, peekCachedCategories, productImageUrls, productVideoUrl, uploadCategories, uploadProductImage, uploadProductVideo } from '../../services/team'
import type { Product } from '../../services/team'
import {
  DEFAULT_HAND_SIZES,
  defaultHandQty,
  displayStock,
  normalizeHand,
  copyLinkedProductAttrs,
  realignHand,
  resolveHand,
  rebuildSkuMatrix,
  type ProductSkuCell,
} from '../../services/product-sku'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { fetchSupplyFinalCosts, fetchSupplyStyles, saveSupplyStyleLinks, styleLinkCodes, styleLinkText } from '../../services/supply'

const COLOR_PRESETS = ['红', '黑', '白', '蓝', '黄', '绿', '灰', '粉']
const SIZE_PRESETS = ['S', 'M', 'L', 'XL', 'XXL', '均码']

type ProductImageItem = {
  key: string
  preview: string
  remote: string
  local: string
}

function remoteImageItems(urls?: string[] | null): ProductImageItem[] {
  return productImageUrls(urls).map((u) => ({
    key: u,
    preview: u,
    remote: u,
    local: '',
  }))
}

function hasCellStock(skus: ProductSkuCell[]): boolean {
  return skus.some((cell) => cell.stock != null && Number.isFinite(Number(cell.stock)))
}

function lumpStock(origin: number | null | undefined, typed: string): number | null {
  if (origin != null && Number.isFinite(Number(origin))) return Number(origin)
  const raw = String(typed || '').trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function localImageItem(filePath: string): ProductImageItem {
  return {
    key: filePath,
    preview: filePath,
    remote: '',
    local: filePath,
  }
}

Page({
  data: {
    isEdit: false,
    editCode: '',
    code: '',
    name: '',
    price: '',
    suggestedRetail: '',
    unit: t('unitPiece'),
    category: '',
    categoryLabel: t('pickCategory'),
    categories: [] as string[],
    cost: '',
    stock: '',
    barcode: '',
    countInStats: true,
    hasSku: false,
    colors: [] as string[],
    sizes: [] as string[],
    hand: [] as number[],
    handRows: [] as Array<{ size: string; qty: string }>,
    colorDraft: '',
    sizeDraft: '',
    colorPresets: COLOR_PRESETS,
    sizePresets: SIZE_PRESETS,
    skuRows: [] as Array<{ color: string; cells: Array<ProductSkuCell & { key: string; stockText: string }> }>,
    skuSizes: [] as string[],
    skuSumLabel: t('skuUncountedShort'),
    stockPool: '',
    saving: false,
    showCatDlg: false,
    catDlgTitle: t('addCategory'),
    catDlgValue: '',
    imageUrls: [] as string[],
    images: [] as ProductImageItem[],
    videoUrl: '',
    videoLocal: '',
    videoThumb: '',
    coverDhash: '',
    isNewArrival: false,
    canUploadImage: false,
    canLink: false,
    linkSource: '',
    links: [] as string[],
    linkText: '',
    linkSide: '',
    linkOn: false,
    linkQuery: '',
    linkShown: [] as Array<{ code: string; on: boolean }>,
    linkMore: false,
    uploadingImage: false,
    checkingImage: false,
    uploadingVideo: false,
    checkingVideo: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, this.data.isEdit ? 'productEdit' : 'addProductNav')
    const cat = (this.data.category || '').trim()
    this.setData({
      categoryLabel: cat || t('pickCategory'),
      skuSumLabel:
        this.data.hasSku && this.data.skuSumLabel && this.data.skuSumLabel !== '未盘'
          ? this.data.skuSumLabel
          : this.data.hasSku
            ? t('skuUncountedShort')
            : this.data.skuSumLabel,
      catDlgTitle: t('addCategory'),
    })
  },

  onLoad(q: Record<string, string | undefined>) {
    if (!canEditCatalog()) {
      wx.showToast({ title: catalogEditDeniedText(), icon: 'none' })
      setTimeout(() => wx.navigateBack(), 400)
      return
    }
    this._picked = new Set<string>()
    this._catalog = [] as string[]
    this._linkDirty = false
    this._linksLoaded = true
    this._linkError = ''
    const code = decodeURIComponent(q.code || '')
    const canLink = isLoggedIn() && !isGuest()
    if (code) {
      this._linksLoaded = !canLink
      this.setData({ isEdit: true, editCode: code })
      void this.load(code)
    } else {
      const voiceCode = stripSpokenMarks(decodeURIComponent(q.voiceCode || '')).trim()
      if (voiceCode) {
        this.setData({
          code: voiceCode,
          name: voiceCode,
          price: q.voicePrice || '',
          suggestedRetail: q.voiceRetail || '',
        })
      }
    }
    this.applyLocale()
    void this.loadCategories()
    this.setData({
      canUploadImage: canLink,
      canLink,
    })
  },

  onShow() {
    this.applyLocale()
    // 从分类管理返回时刷新列表
    if (this.data.categories.length || this.data.isEdit) {
      void this.loadCategories()
    }
  },

  noop() {},

  async loadCategories() {
    const guest = isGuest() || !isLoggedIn()
    let fromStored: string[] = []
    if (guest) {
      fromStored = peekCachedCategories()
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c) => (c.name || '').trim())
        .filter(Boolean)
    } else {
      const r = await fetchCategories()
      fromStored = (r.categories || [])
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c) => (c.name || '').trim())
        .filter(Boolean)
    }

    const products = peekCachedCatalog()
    const fromProducts = Array.from(
      new Set(products.map((p) => (p.category || '').trim()).filter(Boolean)),
    )

    const seen = new Set(fromStored)
    const cats = [...fromStored]
    for (const n of fromProducts.sort((a, b) => a.localeCompare(b, 'zh'))) {
      if (!seen.has(n)) {
        seen.add(n)
        cats.push(n)
      }
    }

    const current = (this.data.category || '').trim()
    if (current && !seen.has(current)) {
      cats.push(current)
    }

    this.setData({ categories: cats })
  },

  async load(code: string) {
    let products = peekCachedCatalog()
    if (!products.length && isLoggedIn() && !isGuest()) {
      const r = await fetchCatalog()
      products = r.products || []
    }
    const p = products.find((x) => x.code === code)
    if (!p) {
      wx.showToast({ title: '未找到该货号', icon: 'none' })
      return
    }
    this.applyProduct(p)
    if (isLoggedIn() && !isGuest()) {
      void this.loadLinks(code)
      void this.loadFinalCost(code)
    }
  },

  async loadFinalCost(code: string) {
    const r = await fetchSupplyFinalCosts()
    if (!r.ok || !r.data) return
    const hit = (r.data.items || []).find((item) => String(item.productCode || '').trim() === code)
    if (!hit || hit.unitCost == null || !Number.isFinite(Number(hit.unitCost))) return
    const unit = Math.round(Number(hit.unitCost) * 10000) / 10000
    this.setData({ cost: String(unit) })
  },

  async loadLinks(code: string) {
    const r = await fetchSupplyStyles(code)
    if (!r.ok) {
      this._linksLoaded = false
      this._linkError = r.message || t('linkLoadFail')
      return
    }
    this._linkError = ''
    if (!r.data || !r.data.item) {
      this._picked = new Set<string>()
      this._linksLoaded = true
      return
    }
    const item = r.data.item
    const anchor = item.linkSource || code
    this._picked = new Set((item.links || []).filter((itemCode) => itemCode && itemCode !== anchor))
    this._linkDirty = false
    this._linksLoaded = true
    this.setData({
      linkSource: item.linkSource || '',
      links: item.links || [],
      linkText: styleLinkText(item),
      linkSide: styleLinkCodes(item),
    })
  },

  showLinks(count: number) {
    const query = (this.data.linkQuery || '').trim().toLowerCase()
    const all = (this._catalog || []).filter((itemCode: string) => !query || itemCode.toLowerCase().indexOf(query) >= 0)
    this.setData({
      linkShown: all.slice(0, count).map((itemCode: string) => ({
        code: itemCode,
        on: !!(this._picked && this._picked.has(itemCode)),
      })),
      linkMore: all.length > count,
    })
  },

  async onOpenLink() {
    const self = (this.data.code || '').trim()
    if (!self) {
      wx.showToast({ title: '请先填写货号', icon: 'none' })
      return
    }
    if (this.data.isEdit && !this._linksLoaded) {
      wx.showToast({ title: this._linkError || t('linkLoading'), icon: 'none' })
      if (!this._linkError) void this.loadLinks(this.data.editCode || self)
      return
    }
    let products = peekCachedCatalog()
    if (!products.length && isLoggedIn() && !isGuest()) {
      const r = await fetchCatalog()
      products = r.products || []
    }
    const anchor = (this.data.linkSource || '').trim() || self
    const codes = Array.from(
      new Set(
        products
          .map((item) => (item.code || '').trim())
          .filter((itemCode) => itemCode && itemCode !== '(无货号)' && itemCode !== anchor),
      ),
    ).sort((a, b) => a.localeCompare(b, 'zh'))
    this._catalog = codes
    if (!this._picked) this._picked = new Set<string>()
    this.data.linkQuery = self
    this.setData({ linkOn: true, linkQuery: self })
    this.showLinks(10)
  },

  onLinkQuery(e: WechatMiniprogram.Input) {
    this.setData({ linkQuery: e.detail.value })
    this.showLinks(10)
  },

  onLinkMore() {
    if (!this.data.linkMore) return
    this.showLinks(this.data.linkShown.length + 10)
  },

  onToggleLink(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    if (!code || !this._picked) return
    if (this._picked.has(code)) this._picked.delete(code)
    else this._picked.add(code)
    this.showLinks(Math.max(this.data.linkShown.length, 10))
  },

  onCloseLink() {
    const self = (this.data.code || '').trim()
    const anchor = (this.data.linkSource || '').trim() || self
    this._picked = new Set((this.data.links || []).filter((itemCode: string) => itemCode && itemCode !== anchor))
    this.setData({ linkOn: false })
  },

  async onConfirmLink() {
    const self = (this.data.code || '').trim()
    if (!self) {
      wx.showToast({ title: '请先填写货号', icon: 'none' })
      return
    }
    const codes = this._picked ? Array.from(this._picked) : []
    const ready = this.data.isEdit && self === this.data.editCode
    if (!ready) {
      this._linkDirty = true
      this.setData({
        linkOn: false,
        links: codes,
        linkText: styleLinkText({
          productCode: self,
          linkSource: this.data.linkSource || '',
          links: codes,
        }),
        linkSide: styleLinkCodes({
          productCode: self,
          linkSource: this.data.linkSource || '',
          links: codes,
        }),
      })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    const r = await saveSupplyStyleLinks(self, codes)
    this.setData({ saving: false })
    if (!r.ok) {
      wx.showToast({ title: r.message || t('linkFail'), icon: 'none' })
      return
    }
    const item = r.data && r.data.item
    const nextSource = (item && item.linkSource) || ''
    const nextLinks = (item && item.links) || []
    const anchor = nextSource || self
    this._picked = new Set(nextLinks.filter((itemCode) => itemCode && itemCode !== anchor))
    this._linkDirty = false
    this.setData({
      linkOn: false,
      linkSource: nextSource,
      links: nextLinks,
      linkText: styleLinkText(item || { productCode: self, links: codes }),
      linkSide: styleLinkCodes(item || { productCode: self, linkSource: nextSource, links: nextLinks.length ? nextLinks : codes }),
    })
    wx.showToast({ title: t('linkedOk'), icon: 'none' })
  },

  applyProduct(p: Product) {
    const cat = (p.category || '').trim()
    this.setData({
      code: p.code || '',
      name: (p.name || '').trim(),
      price: p.price != null ? String(p.price) : '',
      unit: p.unit || t('unitPiece'),
      category: cat,
      categoryLabel: cat || t('pickCategory'),
      cost: p.cost != null ? String(p.cost) : '',
      stock: p.stock != null ? String(p.stock) : '',
      barcode: p.barcode || '',
      countInStats: p.countInStats !== false,
      hasSku: !!p.hasSku,
      imageUrls: productImageUrls(p.imageUrls),
      images: remoteImageItems(p.imageUrls),
      videoUrl: productVideoUrl(p.videoUrl),
      videoLocal: '',
      videoThumb: productVideoUrl(p.videoUrl) ? productImageUrls(p.imageUrls)[0] || '' : '',
      coverDhash: String(p.coverDhash || ''),
      isNewArrival: !!p.isNewArrival,
      suggestedRetail:
        p.suggestedRetailPrice != null && Number(p.suggestedRetailPrice) > 0
          ? String(p.suggestedRetailPrice)
          : '',
    })
    this._originSkus = (p.skus || []).map((cell) => ({ ...cell }))
    this._originStock = p.stock == null ? null : Number(p.stock)
    this.setSkuState(p.colors || [], p.sizes || [], p.skus || [], resolveHand(p.sizes || [], p.hand))
  },

  onHangtag() {
    if (!requireCloudSync('ai')) return
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        void this.pickHangtag(res.tapIndex === 0 ? 'camera' : 'album')
      },
    })
  },

  async pickHangtag(source: 'camera' | 'album') {
    const path = await new Promise<string>((resolve, reject) => {
      const done = (file: string) => resolve(file)
      const fail = (err: unknown) => reject(err)
      if (typeof wx.chooseMedia === 'function') {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: [source],
          sizeType: ['original'],
          success: (r) => done(r.tempFiles?.[0]?.tempFilePath || ''),
          fail,
        })
        return
      }
      wx.chooseImage({
        count: 1,
        sizeType: ['original'],
        sourceType: [source],
        success: (r) => done(r.tempFilePaths?.[0] || ''),
        fail,
      })
    }).catch(() => '')
    if (!path) return
    const compressed = await new Promise<string>((resolve) => {
      wx.compressImage({
        src: path,
        quality: 80,
        compressedWidth: 1600,
        success: (r) => resolve(r.tempFilePath || path),
        fail: () => resolve(path),
      })
    })
    const b64 = await new Promise<string>((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: compressed,
        encoding: 'base64',
        success: (r) => resolve(String(r.data || '')),
        fail: reject,
      })
    }).catch(() => '')
    if (!b64) {
      wx.showToast({ title: '读取图片失败', icon: 'none' })
      return
    }
    if (!(await assertMediaCheckAsync({ imageBase64: b64, mediaType: 2 }))) return
    wx.showLoading({ title: '识别吊牌', mask: true })
    let toast = ''
    try {
      const r = await extractHangtagImage(b64)
      if (!r.ok) {
        toast = r.error || '识别失败'
        return
      }
      const draft = parseHangtagText(r.ocrText)
      if (!draft.code && !draft.price && !hangtagHasMatrix(draft)) {
        toast = '没认出货号或颜色，请拍近景'
        return
      }
      const bits = [draft.code, draft.price, ...draft.colors, ...draft.sizes].filter(Boolean)
      if (bits.length && !(await assertMsgSecCheck(bits))) return
      const patch: Record<string, string> = {}
      if (draft.code) {
        patch.code = draft.code
        if (!String(this.data.name || '').trim()) patch.name = draft.code
      }
      if (draft.price) patch.price = draft.price
      if (draft.retail) patch.suggestedRetail = draft.retail
      if (Object.keys(patch).length) this.setData(patch)
      if (hangtagHasMatrix(draft)) {
        this.setSkuState(draft.colors, draft.sizes, [], draft.hand)
      }
      toast = '已填入，请核对后保存'
    } finally {
      wx.hideLoading()
    }
    if (toast) wx.showToast({ title: toast, icon: 'none' })
  },

  setSkuState(
    colors: string[],
    sizes: string[],
    prev: ProductSkuCell[] = this.flattenSkus(),
    handIn?: number[],
  ) {
    const cappedColors = colors.slice(0, 12)
    const cappedSizes = sizes.slice(0, 8)
    const prevSizes = this.data.sizes || []
    const hand = normalizeHand(
      cappedSizes,
      handIn ||
        (prevSizes.join('\0') === cappedSizes.join('\0')
          ? this.data.hand
          : realignHand(prevSizes, this.data.hand, cappedSizes)),
    )
    const skus = rebuildSkuMatrix(cappedColors, cappedSizes, prev)
    const sum = displayStock({
      code: '',
      name: '',
      price: 0,
      hasSku: true,
      colors: cappedColors,
      sizes: cappedSizes,
      skus,
      stock: null,
    })
    const pool = sum == null ? lumpStock(this._originStock, this.data.stock) : null
    this.setData({
      colors: cappedColors,
      sizes: cappedSizes,
      hand,
      handRows: cappedSizes.map((size, index) => ({ size, qty: String(hand[index] || 0) })),
      skuSizes: cappedSizes,
      skuRows: cappedColors.map((color) => ({
        color,
        cells: cappedSizes.map((size) => {
          const cell = skus.find((x) => x.color === color && x.size === size)
          const stock = cell?.stock
          return {
            color,
            size,
            stock: stock == null ? null : Number(stock),
            barcode: cell?.barcode || null,
            key: `${color}-${size}`,
            stockText: stock == null ? '' : String(stock),
          }
        }),
      })),
      skuSumLabel: sum == null ? t('skuUncountedShort') : String(sum),
      stockPool: pool == null ? '' : String(pool),
    })
  },

  flattenSkus(): ProductSkuCell[] {
    const out: ProductSkuCell[] = []
    for (const row of this.data.skuRows || []) {
      for (const cell of row.cells || []) {
        const raw = String(cell.stockText || '').trim()
        out.push({
          color: cell.color,
          size: cell.size,
          stock: raw === '' ? null : Number(raw),
        })
      }
    }
    return out
  },

  onToggleSku(e: WechatMiniprogram.SwitchChange) {
    const on = !!e.detail.value
    if (!on && this.data.hasSku && (this.data.colors.length || this.data.sizes.length)) {
      wx.showModal({
        title: '关闭颜色尺码？',
        content: '关闭后按货号记一笔库存，矩阵不再扣减。',
        confirmText: '关闭',
        cancelText: '取消',
        success: (r) => {
          if (!r.confirm) {
            this.setData({ hasSku: true })
            return
          }
          this.setData({ hasSku: false })
        },
      })
      return
    }
    this.setData({ hasSku: on })
    if (on && !this.data.colors.length && !this.data.sizes.length) {
      this.setSkuState(['红', '黑'], DEFAULT_HAND_SIZES.slice(), [], DEFAULT_HAND_SIZES.map(defaultHandQty))
    }
  },

  onColorDraft(e: WechatMiniprogram.Input) {
    this.setData({ colorDraft: e.detail.value })
  },
  onSizeDraft(e: WechatMiniprogram.Input) {
    this.setData({ sizeDraft: e.detail.value })
  },

  addTag(kind: 'color' | 'size', raw: string) {
    const name = raw.trim()
    if (!name) return
    const list = (kind === 'color' ? this.data.colors : this.data.sizes).slice()
    if (list.includes(name)) {
      wx.showToast({ title: '已有这项', icon: 'none' })
      return
    }
    const cap = kind === 'color' ? 12 : 8
    if (list.length >= cap) {
      wx.showToast({ title: kind === 'color' ? '颜色最多 12 个' : '尺码最多 8 个', icon: 'none' })
      return
    }
    list.push(name)
    if (kind === 'color') {
      this.setData({ colorDraft: '' })
      this.setSkuState(list, this.data.sizes)
    } else {
      this.setData({ sizeDraft: '' })
      this.setSkuState(this.data.colors, list)
    }
  },

  onAddColor() {
    this.addTag('color', this.data.colorDraft)
  },
  onAddSize() {
    this.addTag('size', this.data.sizeDraft)
  },
  onPresetColor(e: WechatMiniprogram.TouchEvent) {
    this.addTag('color', String(e.currentTarget.dataset.name || ''))
  },
  onPresetSize(e: WechatMiniprogram.TouchEvent) {
    this.addTag('size', String(e.currentTarget.dataset.name || ''))
  },
  onRemoveColor(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '')
    this.setSkuState(this.data.colors.filter((x) => x !== name), this.data.sizes)
  },
  onRemoveSize(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '')
    this.setSkuState(this.data.colors, this.data.sizes.filter((x) => x !== name))
  },
  onResetHand() {
    const sizes = this.data.sizes || []
    const hand = sizes.map((size) => defaultHandQty(size))
    this.setData({
      hand,
      handRows: sizes.map((size, index) => ({ size, qty: String(hand[index] || 0) })),
    })
  },
  onHandInput(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const hand = (this.data.hand || []).slice()
    const value = Math.round(Number(e.detail.value))
    hand[index] = Number.isFinite(value) ? Math.max(0, Math.min(20, value)) : 0
    this.setData({
      hand,
      handRows: (this.data.sizes || []).map((size, i) => ({
        size,
        qty: String(i === index ? hand[index] : hand[i] || 0),
      })),
    })
  },
  onSkuFocus(e: WechatMiniprogram.TouchEvent) {
    const color = String(e.currentTarget.dataset.color || '')
    const size = String(e.currentTarget.dataset.size || '')
    this._skuFocus = `${color}\0${size}`
  },

  onSkuBlur() {
    this._skuFocus = ''
  },

  onSkuStock(e: WechatMiniprogram.Input) {
    const color = String(e.currentTarget.dataset.color || '')
    const size = String(e.currentTarget.dataset.size || '')
    if (this._skuFocus !== `${color}\0${size}`) return
    const rows = this.data.skuRows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) =>
        cell.color === color && cell.size === size
          ? { ...cell, stockText: e.detail.value }
          : cell,
      ),
    }))
    const skus: ProductSkuCell[] = []
    for (const row of rows) {
      for (const cell of row.cells) {
        const raw = String(cell.stockText || '').trim()
        skus.push({
          color: cell.color,
          size: cell.size,
          stock: raw === '' ? null : Number(raw),
        })
      }
    }
    const sum = displayStock({
      code: '',
      name: '',
      price: 0,
      hasSku: true,
      colors: this.data.colors,
      sizes: this.data.sizes,
      skus,
      stock: null,
    })
    const pool = sum == null ? lumpStock(this._originStock, this.data.stock) : null
    this.setData({
      skuRows: rows,
      skuSumLabel: sum == null ? t('skuUncountedShort') : String(sum),
      stockPool: pool == null ? '' : String(pool),
    })
  },

  onCode(e: WechatMiniprogram.Input) {
    this.setData({ code: stripSpokenMarks(e.detail.value) })
  },
  onName(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value })
  },
  onPrice(e: WechatMiniprogram.Input) {
    this.setData({ price: e.detail.value })
  },
  onRetail(e: WechatMiniprogram.Input) {
    this.setData({ suggestedRetail: e.detail.value })
  },
  onUnit(e: WechatMiniprogram.Input) {
    this.setData({ unit: e.detail.value })
  },
  onCost(e: WechatMiniprogram.Input) {
    this.setData({ cost: e.detail.value })
  },
  onStock(e: WechatMiniprogram.Input) {
    this.setData({ stock: e.detail.value })
  },
  onBarcode(e: WechatMiniprogram.Input) {
    this.setData({ barcode: e.detail.value })
  },
  onToggleArrival(e: WechatMiniprogram.SwitchChange) {
    this.setData({ isNewArrival: !!e.detail.value })
  },

  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const current = String(e.currentTarget.dataset.url || '')
    const urls = (this.data.images || []).map((x) => x.preview).filter(Boolean)
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  onRemoveImage(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || e.currentTarget.dataset.url || '')
    this.setData({
      images: (this.data.images || []).filter((x) => x.key !== key),
    })
  },

  async onAddImage() {
    if (!this.data.canUploadImage) {
      wx.showToast({ title: '登录并开通云同步后才能传图', icon: 'none' })
      return
    }
    const remain = Math.max(0, 9 - (this.data.images || []).length)
    if (!remain) {
      wx.showToast({ title: '每款最多 9 张', icon: 'none' })
      return
    }
    const choose = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult | null>((resolve) => {
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: resolve,
        fail: () => resolve(null),
      })
    })
    const files = choose?.tempFiles || []
    if (!files.length) return
    this.setData({ checkingImage: true })
    const images = (this.data.images || []).slice()
    let lastErr = ''
    for (const f of files) {
      if (images.length >= 9) break
      if ((f.size || 0) > 5 * 1024 * 1024) {
        lastErr = '单张不能超过 5MB'
        continue
      }
      if (!(await assertMediaCheckAsync({ filePath: f.tempFilePath, mediaType: 2 }))) {
        lastErr = lastErr || '媒体检测未通过'
        continue
      }
      images.push(localImageItem(f.tempFilePath))
    }
    this.setData({ images, checkingImage: false })
    if (lastErr) {
      wx.showToast({ title: lastErr, icon: 'none' })
    }
  },

  async persistPendingImages(): Promise<{ ok: boolean; urls: string[]; dhash: string; error: string }> {
    const items = this.data.images || []
    const urls: string[] = []
    let dhash = String(this.data.coverDhash || '')
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i]
      if (it.remote) {
        urls.push(it.remote)
        continue
      }
      if (!it.local) continue
      const up = await uploadProductImage(it.local)
      if (!up.ok) {
        return { ok: false, urls, dhash, error: up.error || '上传失败' }
      }
      urls.push(up.url)
      if (i === 0 && up.dhash) dhash = up.dhash
    }
    if (!urls.length) dhash = ''
    return { ok: true, urls, dhash, error: '' }
  },

  async persistPendingVideo(): Promise<{ ok: boolean; url: string; error: string }> {
    const local = String(this.data.videoLocal || '')
    if (local) {
      const up = await uploadProductVideo(local)
      if (!up.ok) {
        return { ok: false, url: '', error: up.error || '视频上传失败' }
      }
      return { ok: true, url: up.url, error: '' }
    }
    return { ok: true, url: productVideoUrl(this.data.videoUrl), error: '' }
  },

  async onAddVideo() {
    if (!this.data.canUploadImage) {
      wx.showToast({ title: '登录并开通云同步后才能传视频', icon: 'none' })
      return
    }
    const choose = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult | null>((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['video'],
        sourceType: ['album', 'camera'],
        maxDuration: 15,
        camera: 'back',
        success: resolve,
        fail: () => resolve(null),
      })
    })
    const f = choose?.tempFiles?.[0]
    if (!f) return
    if ((f.duration || 0) > 15.5) {
      wx.showToast({ title: '视频不能超过 15 秒', icon: 'none' })
      return
    }
    if ((f.size || 0) > 12 * 1024 * 1024) {
      wx.showToast({ title: '视频不能超过 12MB', icon: 'none' })
      return
    }
    const thumb = String(f.thumbTempFilePath || '')
    this.setData({ checkingVideo: true })
    const okThumb = thumb
      ? await assertMediaCheckAsync({ filePath: thumb, mediaType: 2 })
      : true
    this.setData({ checkingVideo: false })
    if (!okThumb) {
      wx.showToast({ title: '媒体检测未通过', icon: 'none' })
      return
    }
    this.setData({
      videoLocal: f.tempFilePath,
      videoThumb: thumb || f.tempFilePath,
      videoUrl: '',
    })
  },

  onRemoveVideo() {
    this.setData({ videoUrl: '', videoLocal: '', videoThumb: '' })
  },

  onPreviewVideo() {
    const url = String(this.data.videoLocal || this.data.videoUrl || '')
    if (!url) return
    wx.previewMedia({
      sources: [{ url, type: 'video', poster: this.data.videoThumb || '' }],
    })
  },

  onManageCategory() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' })
  },

  onPickCategory() {
    const cats = this.data.categories || []
    const custom = t('customCategory')
    const manage = t('manageCategory')
    const clear = t('clearCategory')
    const items = [...cats, custom, manage, clear]
    const show = (offset: number) => {
      const chunk = items.slice(offset, offset + 5)
      const hasMore = offset + 5 < items.length
      const list = hasMore ? [...chunk, t('more')] : chunk
      wx.showActionSheet({
        itemList: list,
        success: (res) => {
          if (hasMore && res.tapIndex === chunk.length) {
            show(offset + 5)
            return
          }
          const name = chunk[res.tapIndex]
          if (!name) return
          if (name === clear) {
            this.setData({ category: '', categoryLabel: t('pickCategory') })
            return
          }
          if (name === manage) {
            this.onManageCategory()
            return
          }
          if (name === custom) {
            this.setData({
              showCatDlg: true,
              catDlgTitle: t('customCategory'),
              catDlgValue: '',
            })
            return
          }
          this.setData({ category: name, categoryLabel: name })
        },
      })
    }
    show(0)
  },

  onCatDlgInput(e: WechatMiniprogram.Input) {
    this.setData({ catDlgValue: e.detail.value })
  },
  onCatDlgCancel() {
    this.setData({ showCatDlg: false })
  },

  async onCatDlgConfirm() {
    const custom = (this.data.catDlgValue || '').trim()
    if (!custom) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    const cats = this.data.categories || []
    if (cats.includes(custom)) {
      this.setData({
        showCatDlg: false,
        category: custom,
        categoryLabel: custom,
      })
      return
    }

    this.setData({ showCatDlg: false, saving: true })
    const next = [...cats, custom]
    const ur = await uploadCategories(next.map((name, i) => ({ name, sortOrder: i })))
    this.setData({ saving: false })
    if (!ur.ok) {
      wx.showToast({ title: ur.error || '添加失败', icon: 'none' })
      return
    }
    this.setData({
      categories: next,
      category: custom,
      categoryLabel: custom,
    })
    wx.showToast({
      title: isGuest() || !isLoggedIn() ? '已添加分类' : '已添加，正在同步云端',
      icon: 'none',
    })
  },

  onScanBarcode() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const code = String(res.result || '').trim().replace(/\s+/g, '')
        if (!code) return
        this.setData({ barcode: code })
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '')
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '请手动输入条码', icon: 'none' })
      },
    })
  },

  async onSave() {
    const code = (this.data.code || '').trim()
    if (!code) {
      wx.showToast({ title: '请输入货号', icon: 'none' })
      return
    }
    const name = (this.data.name || '').trim() || code
    const priceRaw = (this.data.price || '').trim()
    if (!priceRaw || Number.isNaN(Number(priceRaw))) {
      wx.showToast({ title: '请输入有效售价', icon: 'none' })
      return
    }
    const unit = (this.data.unit || '').trim() || '件'
    const costRaw = (this.data.cost || '').trim()
    const stockRaw = (this.data.stock || '').trim()
    const barcode = (this.data.barcode || '').trim()
    const category = (this.data.category || '').trim()
    const hasSku = !!this.data.hasSku && this.data.colors.length > 0 && this.data.sizes.length > 0
    let skus = hasSku ? this.flattenSkus() : []
    if (hasSku && !hasCellStock(skus)) {
      const restored = rebuildSkuMatrix(this.data.colors, this.data.sizes, this._originSkus || [])
      if (hasCellStock(restored)) skus = restored
    }
    const pool = lumpStock(this._originStock, stockRaw)
    if (
      !(await       assertMsgSecCheck([
        code,
        name,
        unit,
        barcode,
        category,
        ...(hasSku ? [...this.data.colors, ...this.data.sizes] : []),
      ]))
    ) {
      return
    }
    const product: Product = {
      code,
      name,
      price: Number(priceRaw) || 0,
      unit,
      cost: costRaw === '' ? null : Number(costRaw),
      stock: hasSku
        ? hasCellStock(skus)
          ? displayStock({
              code,
              name: code,
              price: 0,
              hasSku: true,
              colors: this.data.colors,
              sizes: this.data.sizes,
              skus,
              stock: null,
            })
          : pool
        : stockRaw === ''
          ? null
          : Number(stockRaw),
      category: category || null,
      barcode: barcode || null,
      countInStats: this.data.countInStats !== false,
      hasSku,
      colors: hasSku ? this.data.colors : [],
      sizes: hasSku ? this.data.sizes : [],
      hand: hasSku ? normalizeHand(this.data.sizes, this.data.hand) : [],
      skus,
      imageUrls: [] as string[],
      videoUrl: '',
      isNewArrival: !!this.data.isNewArrival,
      suggestedRetailPrice: (() => {
        const n = Number((this.data.suggestedRetail || '').trim())
        return Number.isFinite(n) && n > 0 ? n : null
      })(),
    }

    this.setData({ saving: true, uploadingImage: true })
    const uploaded = await this.persistPendingImages()
    if (!uploaded.ok) {
      this.setData({ saving: false, uploadingImage: false })
      wx.showToast({ title: uploaded.error || '图片上传失败', icon: 'none' })
      return
    }
    product.imageUrls = uploaded.urls
    if (uploaded.dhash) product.coverDhash = uploaded.dhash
    else if (!uploaded.urls.length) product.coverDhash = ''
    else delete product.coverDhash
    this.setData({ uploadingImage: false, uploadingVideo: true })
    const video = await this.persistPendingVideo()
    if (!video.ok) {
      this.setData({ saving: false, uploadingVideo: false })
      wx.showToast({ title: video.error || '视频上传失败', icon: 'none' })
      return
    }
    product.videoUrl = video.url
    this.setData({
      imageUrls: uploaded.urls,
      images: remoteImageItems(uploaded.urls),
      videoUrl: video.url,
      videoLocal: '',
      videoThumb: '',
      coverDhash: uploaded.dhash,
    })
    const oldCode = this.data.editCode
    const deleteCodes =
      this.data.isEdit && oldCode && oldCode !== code ? [oldCode] : []
    const r = await patchCatalog([product], deleteCodes)
    if (r.ok) await this.syncLinkedProducts(product)
    this.setData({ saving: false, uploadingImage: false, uploadingVideo: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    const renaming = !!(this.data.isEdit && oldCode && oldCode !== code)
    const shouldLink =
      this.data.canLink && (this._linkDirty || (renaming && this._picked && this._picked.size > 0))
    if (shouldLink) {
      let codes = this._picked ? Array.from(this._picked) : []
      if (renaming) codes = codes.filter((itemCode) => itemCode !== oldCode && itemCode !== code)
      const linked = await saveSupplyStyleLinks(code, codes)
      if (!linked.ok) {
        wx.showToast({ title: linked.message || t('savedLinkFail'), icon: 'none' })
        return
      }
    }
    wx.navigateBack()
    wx.showToast({
      title: this.data.isEdit
        ? '已保存'
        : isGuest() || !isLoggedIn()
          ? '已添加到本机'
          : '已添加商品',
      icon: 'success',
    })
  },

  async syncLinkedProducts(product: Product) {
    const self = String(product.code || '').trim()
    const related = Array.from(new Set(
      [...(this.data.links || []), this.data.linkSource || '']
        .map((code) => String(code || '').trim())
        .filter((code) => code && code !== self),
    ))
    if (!related.length) return
    const catalog = peekCachedCatalog()
    const changed: Product[] = []
    for (const code of related) {
      const prev = catalog.find((item) => item.code === code)
      if (!prev) continue
      const next = copyLinkedProductAttrs(prev, product)
      if (JSON.stringify(prev) === JSON.stringify(next)) continue
      changed.push(next)
    }
    if (!changed.length) return
    const out = await patchCatalog(changed, [])
    if (!out.ok) wx.showToast({ title: out.error || '关联货号没一起改上', icon: 'none' })
  },

  onDelete() {
    if (!this.data.isEdit || !this.data.editCode) return
    const code = this.data.editCode
    wx.showModal({
      title: '删除商品',
      content: `确定删除「${code}」？将移入回收站，可在「我的 → 回收站」恢复或永久删除。`,
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const catalog = peekCachedCatalog()
        const product =
          catalog.find((p) => p.code === code) ||
          ({
            code,
            name: code,
            price: Number(this.data.price) || 0,
            unit: this.data.unit || '件',
            category: this.data.category || null,
            cost: this.data.cost ? Number(this.data.cost) : null,
            stock: this.data.stock !== '' ? Number(this.data.stock) : null,
            barcode: this.data.barcode || null,
            countInStats: this.data.countInStats !== false,
          } as Product)
        this.setData({ saving: true })
        const r = await softDeleteProduct(product)
        this.setData({ saving: false })
        if (!r.ok) {
          wx.showToast({ title: r.error || '删除失败', icon: 'none' })
          return
        }
        wx.navigateBack()
        wx.showToast({ title: '已移入回收站', icon: 'success' })
      },
    })
  },
})
