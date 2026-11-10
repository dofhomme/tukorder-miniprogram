import {
  PRINT_TEMPLATE_OPTIONS,
  canEditPrintTemplate,
  clearQr,
  defaultPrintTemplate,
  isPlaceholderShopTitle,
  resolveMerchantTitle,
  hasAlipayQr,
  hasFriendQr,
  hasWechatQr,
  isTableLayoutId,
  LAYOUT_COLUMN_FIELDS,
  loadPrintTemplate,
  maxColumnsForPaper,
  newCustomTemplateId,
  pullPrintTemplateFromCloud,
  resolvePrintLayout,
  savePrintTemplate,
  saveFriendQrFromPayload,
  saveQrFromPayload,
  clampColumnFlex,
  withActiveBlocks,
  withQrBlockPatch,
  withActiveColumns,
  type LayoutBlockKey,
  type LayoutBlocks,
  type LayoutColumn,
  type PrintTemplate,
  type PrintTemplateTypeId,
} from '../../services/print-template'
import {
  FONT_FACE_OPTIONS,
  flushPushPrintSettings,
  loadPrintSettings,
  receiptFontStack,
  savePrintSettings,
} from '../../services/print-settings'
import type { FontFaceId, FontScaleId } from '../../services/print-settings'
import { getPaperWidthMm } from '../../services/bluetooth'
import { buildReceiptRenderModel, getReceiptTemplateDef, receiptPrintFlags, type ReceiptRenderModel } from '../../services/receipt-layout'
import { extraReceiptQr } from '../../services/receipt-qr'
import { fetchShop, peekCachedShop, uploadShop } from '../../services/team'
import { stageReceiptPreview, takeReceiptPreview } from '../../services/receipt-preview-bridge'
import { bindPageI18n, i18nState, t as tr, uiTemplateHint, uiTemplateLabel, uiTemplateScene } from '../../services/i18n'
import { receiptFontScale } from '../../utils/receipt-render'
import { arrivalQrCaption } from '../../utils/return-receipt'
import { requireCloudSync } from '../../services/account-gate'
import { isCloudSyncAllowed } from '../../services/subscription'
import { assertMediaCheckAsync } from '../../services/sec-check'
import { existingShopLogoPath, logoPayloadOk, writeShopLogoFile } from '../../utils/logo-file'
import { fetchNewArrivalLink } from '../../services/lookup'
import { isGuest, isLoggedIn } from '../../services/session'
import { assertMsgSecCheck } from '../../services/sec-check'
import { validateForChannel } from '../../utils/payment-qr'

type DemoItem = {
  code: string
  unit: string
  qty: string
  price: string
  amount: string
}

function localizedTplOptions() {
  return PRINT_TEMPLATE_OPTIONS.map((o) => ({
    ...o,
    label: uiTemplateLabel(o.id),
    scene: uiTemplateScene(o.id),
    hint: uiTemplateHint(o.id),
  }))
}

function nowLabel() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const SIZE_ROWS: Array<{ id: FontScaleId; size: number }> = [
  { id: 'small', size: 22 },
  { id: 'standard', size: 28 },
  { id: 'large', size: 34 },
  { id: 'xlarge', size: 42 },
]

const EDITABLE_BLOCKS = new Set<string>()

const HIDDEN_BLOCK_ROWS = new Set([
  'lookup',
  'title',
  'headerArrival',
  'subtitle',
  'address',
  'shopTel',
  'arrears',
  'customer',
  'phone',
  'date',
  'printedAt',
  'barcode',
  'payQr',
  'footerArrival',
  'footer',
  'lineNo',
  'table',
])

const COL_LABEL: Record<string, string> = {
  code: '货号',
  name: '名称',
  spec: '颜色尺码',
  color: '颜色',
  size: '尺码',
  unit: '单位',
  qtyLabel: '数量',
  priceLabel: '单价',
  subLabel: '金额',
}

let staffToastShown = false
let colDrag: { from: number; y: number; over: number; row: number } | null = null
let payHintAtOpen = ''

function colRowPx() {
  const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
  return (144 * (info.windowWidth || 375)) / 750
}

function reorderedColumns(columns: LayoutColumn[], from: number, over: number) {
  if (from === over || from < 0 || over < 0 || over >= columns.length) return columns
  const next = columns.slice()
  const [item] = next.splice(from, 1)
  next.splice(over, 0, item)
  return next
}

function colShiftsFor(len: number, from: number, over: number, row: number) {
  const out = new Array<number>(len).fill(0)
  if (from < 0 || over < 0 || from === over) return out
  if (over > from) {
    for (let i = from + 1; i <= over; i++) out[i] = -row
  } else {
    for (let i = over; i < from; i++) out[i] = row
  }
  return out
}

function spareColumns(cols: Array<{ field: string }>) {
  return LAYOUT_COLUMN_FIELDS.filter((field) => !cols.some((col) => col.field === field)).map((field) => ({
    field,
    label: COL_LABEL[field] || field,
  }))
}

const BLOCK_ROWS: Array<{ key: LayoutBlockKey | 'table'; labelKey: string; removable: boolean }> = [
  { key: 'lookup', labelKey: 'blkLookup', removable: true },
  { key: 'title', labelKey: 'blkTitle', removable: true },
  { key: 'headerArrival', labelKey: 'blkArrival', removable: true },
  { key: 'subtitle', labelKey: 'blkSubtitle', removable: true },
  { key: 'lineNo', labelKey: 'blkLineNo', removable: true },
  { key: 'table', labelKey: 'blkTable', removable: false },
  { key: 'address', labelKey: 'blkAddress', removable: true },
  { key: 'shopTel', labelKey: 'blkShopTel', removable: true },
  { key: 'arrears', labelKey: 'blkArrears', removable: true },
  { key: 'customer', labelKey: 'blkCustomer', removable: true },
  { key: 'phone', labelKey: 'blkPhone', removable: true },
  { key: 'date', labelKey: 'blkDate', removable: true },
  { key: 'printedAt', labelKey: 'blkPrintedAt', removable: true },
  { key: 'barcode', labelKey: 'blkBarcode', removable: true },
  { key: 'payQr', labelKey: 'blkPay', removable: true },
  { key: 'footerArrival', labelKey: 'blkFootArrival', removable: true },
  { key: 'footer', labelKey: 'blkFooter', removable: true },
]

function readLogoBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (res) => resolve(String(res.data || '')),
      fail: reject,
    })
  })
}

function compressLogo(src: string, width: number): Promise<string> {
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

const DEMO_HEADER = '图可开单打印'
const DEMO_CUSTOMER = 'XXX经理'
const DEMO_PHONE = '188XXXXXXXX'
const DEMO_ORDER_NO = 'DEMO001'

type PreviewQrPatch = {
  lookupQr: string
  lookupQrUrl: string
  lookupQrHint: string
  headerNewArrivalQr: string
  headerNewArrivalUrl: string
  headerNewArrivalHint: string
  returnQr: string
  returnQrUrl: string
  returnQrHint: string
  guestBindPrompt: boolean
}

let previewQrPatch: PreviewQrPatch | null = null
let previewQrKey = ''
let previewQrSeq = 0

function overlayPreviewQr(model: ReceiptRenderModel): ReceiptRenderModel {
  const patch = previewQrPatch
  if (!patch) return model
  return {
    ...model,
    lookupQr: patch.guestBindPrompt ? '' : patch.lookupQr,
    lookupQrUrl: patch.guestBindPrompt ? '' : patch.lookupQrUrl,
    lookupQrHint: patch.lookupQrHint || model.lookupQrHint,
    headerNewArrivalQr: patch.guestBindPrompt ? '' : patch.headerNewArrivalQr,
    headerNewArrivalUrl: patch.headerNewArrivalUrl || model.headerNewArrivalUrl,
    headerNewArrivalHint: patch.headerNewArrivalHint || model.headerNewArrivalHint,
    returnQr: patch.guestBindPrompt ? '' : patch.returnQr || patch.headerNewArrivalQr,
    returnQrUrl: patch.returnQrUrl || model.returnQrUrl,
    returnQrHint: patch.returnQrHint || model.returnQrHint,
    guestBindPrompt: patch.guestBindPrompt,
  }
}

function schedulePreviewQrs(page: WechatMiniprogram.Page.Instance<any, any>, t: PrintTemplate) {
  const isReturn = page.data.docKind === 'return'
  const key = [
    isReturn ? 'return' : 'sale',
    isGuest() || !isLoggedIn() ? 'guest' : 'user',
    t.newArrivalQrUrl || '',
    t.newArrivalQrHintText || '',
    t.wechatQrPath || '',
    t.alipayQrPath || '',
    String(page.data.shopSubtitle || ''),
  ].join('\n')
  if (key === previewQrKey && previewQrPatch) return
  const seq = ++previewQrSeq
  void extraReceiptQr(t, DEMO_ORDER_NO, isReturn, { subtitle: page.data.shopSubtitle }).then((qr) => {
    if (seq !== previewQrSeq) return
    previewQrKey = key
    previewQrPatch = {
      lookupQr: qr.lookupQr || '',
      lookupQrUrl: qr.lookupQrUrl || '',
      lookupQrHint: qr.lookupQrHint || '',
      headerNewArrivalQr: qr.headerNewArrivalQr || '',
      headerNewArrivalUrl: qr.headerNewArrivalUrl || '',
      headerNewArrivalHint: qr.headerNewArrivalHint || '',
      returnQr: qr.returnQr || '',
      returnQrUrl: qr.returnQrUrl || '',
      returnQrHint: qr.returnQrHint || '',
      guestBindPrompt: !!qr.guestBindPrompt,
    }
    const current = page.data.receiptModel
    if (!current) return
    page.setData({
      receiptModel: overlayPreviewQr(current),
      wechatQr: hasWechatQr(t) ? t.wechatQrPath : '',
      alipayQr: hasAlipayQr(t) ? t.alipayQrPath : '',
    })
  }).catch(() => {})
}

/** 对齐 App ReceiptTemplatePreview.demoOrder */
function buildPreview(header: string) {
  const items: DemoItem[] = [
    { code: 'F001', unit: '件', qty: '2', price: '35.00', amount: '70.00' },
    { code: 'F002', unit: '件', qty: '3', price: '18.00', amount: '54.00' },
    { code: 'F003', unit: '件', qty: '5', price: '12.00', amount: '60.00' },
  ]
  return {
    header: header.trim() || DEMO_HEADER,
    customer: DEMO_CUSTOMER,
    phone: DEMO_PHONE,
    items,
    totalQty: '10',
    totalAmt: '184.00',
    settle: '184.00',
  }
}

function demoReceiptModel(
  t: PrintTemplate,
  preview: ReturnType<typeof buildPreview>,
  shopSubtitle = '',
  shopAddress = '',
  isReturn = false,
  shopPhone = '',
) {
  const layout = resolvePrintLayout(t, isReturn)
  const blocks = layout.blocks
  const templateId = layout.templateId
  const wxOn = hasWechatQr(t)
  const aliOn = hasAlipayQr(t)
  const sub = blocks.subtitle ? (shopSubtitle || '').trim() || '店铺副标题' : ''
  const address = (shopAddress || '').trim() || '示例路 88 号'
  const model = buildReceiptRenderModel({
    templateId,
    shopName: preview.header,
    isReturn,
    orderNo: 'DEMO001',
    dateStr: nowLabel(),
    customerName: preview.customer,
    customerPhone: preview.phone,
    handler: isReturn ? '店员' : '',
    items: preview.items.map((it, idx) => {
      const cloth = templateId === 'fashion'
        || templateId === 'vertical'
        || templateId === 'piece'
        || templateId === 'settle'
        || templateId === 'horizontal'
      const clothCode = ['4628', '4628', '5193'][idx] || it.code
      const clothSpec = ['黑 / M', '黑 / L', '白 / 均码'][idx] || ''
      return {
      productCode: cloth ? clothCode : it.code,
      productName: cloth ? clothCode : it.code,
      spec: cloth ? clothSpec : '',
      unit: '件',
      price: Number(it.price),
      quantity: Number(it.qty),
      subtotal: Number(it.amount),
      }
    }),
    totalQuantity: Number(preview.totalQty),
    totalAmount: Number(preview.settle),
    footer: t.footerText,
    layoutTemplate: t,
    showPayQr: !!blocks.payQr,
    showReturnQr: !!blocks.footerArrival,
    qrHint: t.paymentQrHintText,
    wechatQr: wxOn ? t.wechatQrPath : '',
    alipayQr: aliOn ? t.alipayQrPath : '',
    showLookupQr: !!blocks.lookup,
    lookupQrHint: '扫码查账',
    shopSubtitle: sub,
    shopAddress: address,
    shopPhone,
    returnQrHint: arrivalQrCaption(t.newArrivalQrHintText),
    showHeaderNewArrivalQr: !!blocks.headerArrival && !isReturn,
    headerNewArrivalHint: arrivalQrCaption(t.newArrivalQrHintText),
    headerNewArrivalUrl: t.newArrivalQrUrl,
    friendQr: hasFriendQr(t) ? t.friendQrPath : '',
    slotLeft: blocks.slotLeft,
    slotRight: blocks.slotRight,
    slotFoot: blocks.slotFoot,
    ...receiptPrintFlags(preview.customer, isReturn),
  })
  return overlayPreviewQr(model)
}

Page({
  data: {
    t: defaultPrintTemplate() as PrintTemplate,
    now: nowLabel(),
    wechatQr: '',
    alipayQr: '',
    syncing: false,
    guestLocal: false,
    previewOpen: true,
    docKind: 'sale' as 'sale' | 'return',
    pickerVisible: false,
    templateLabel: uiTemplateLabel('cashier'),
    pickTemplate: 'cashier' as PrintTemplateTypeId,
    pickCustomId: '',
    customRows: [] as PrintTemplate['customTemplates'],
    templateOptions: localizedTplOptions(),
    ...i18nState(),
    preview: buildPreview(''),
    shopSubtitle: '',
    shopAddress: '',
    shopPhone: '',
    canEdit: false,
    paid: false,
    canCopy: false,
    fontFaceId: 'hei' as FontFaceId,
    fontFamily: receiptFontStack('hei'),
    fontRows: FONT_FACE_OPTIONS,
    fontVisible: false,
    fontScaleId: 'standard' as FontScaleId,
    sizeRows: SIZE_ROWS,
    sizeVisible: false,
    colFlexVisible: false,
    colFlexIndex: -1,
    colFlexValue: 1,
    colFlexLabel: '',
    nameVisible: false,
    nameDraft: '',
    activeName: '',
    blockRows: [] as Array<{ key: string; label: string; removable: boolean; custom: boolean; editable: boolean; on: boolean }>,
    editKind: '',
    editText: '',
    colDraft: [] as LayoutColumn[],
    dragIndex: -1,
    dragShift: 0,
    colShifts: [] as number[],
    colOver: false,
    spareFields: [] as Array<{ field: string; label: string }>,
    fontScale: receiptFontScale(),
    receiptModel: buildReceiptRenderModel({
      templateId: 'cashier',
      shopName: DEMO_HEADER,
      isReturn: false,
      orderNo: 'DEMO001',
      dateStr: nowLabel(),
      customerName: DEMO_CUSTOMER,
      customerPhone: DEMO_PHONE,
      handler: '',
      items: [
        { productCode: 'F001', productName: 'F001', spec: '', unit: '件', price: 35, quantity: 2, subtotal: 70 },
        { productCode: 'F002', productName: 'F002', spec: '', unit: '件', price: 18, quantity: 3, subtotal: 54 },
        { productCode: 'F003', productName: 'F003', spec: '', unit: '件', price: 12, quantity: 5, subtotal: 60 },
      ],
      totalQuantity: 10,
      totalAmount: 184,
      footer: '注意：不影响二次销售可退可换\n免费服装打印软件 ImageOk.cn',
      showPayQr: true,
      showReturnQr: false,
      qrHint: '扫以下二维码可直接支付',
      ...receiptPrintFlags(DEMO_CUSTOMER),
    }),
  },

  applyLocale() {
    bindPageI18n(this, 'printTemplate')
    this.setData({
      templateLabel: uiTemplateLabel(this.data.t.template),
      templateOptions: localizedTplOptions(),
    })
  },

  async onShow() {
    this.applyLocale()
    this.setData({
      fontScale: receiptFontScale(),
      guestLocal: isGuest() || !isLoggedIn(),
    })
    // 游客只读本机，不拉云端；首次进入把默认文案写入本机，避免表单空白
    if (!canEditPrintTemplate() && !staffToastShown) {
      staffToastShown = true
      wx.showToast({ title: '仅商家可设置打印模版', icon: 'none' })
    }
    if (isGuest() || !isLoggedIn()) {
      const t = loadPrintTemplate()
      savePrintTemplate(t)
    }
    await this.reload(!(isGuest() || !isLoggedIn()))
  },

  onHide() {
    void flushPushPrintSettings()
  },

  onUnload() {
    void flushPushPrintSettings()
  },

  async reload(pullCloud: boolean) {
    let t = loadPrintTemplate()
    let shopName = ''
    try {
      const shop = await fetchShop()
      shopName = String(shop.shop?.shopName || '').trim()
      if (shop.shop) {
        this.setData({
          shopSubtitle: String(shop.shop.subtitle || ''),
          shopAddress: String(shop.shop.address || ''),
          shopPhone: String(shop.shop.phone || ''),
        })
      }
    } catch (_) {}
    if (pullCloud) {
      this.setData({ syncing: true })
      const r = await pullPrintTemplateFromCloud()
      this.setData({ syncing: false })
      if (r.ok && r.applied) t = r.template
      else t = loadPrintTemplate()
    }
    this._shopName = shopName
    if (isLoggedIn() && !isGuest()) {
      t = await this.withMerchantHomeUrl(t)
    }
    this.applyState(t)
  },

  async withMerchantHomeUrl(t: PrintTemplate) {
    if (!isLoggedIn() || isGuest()) return t
    const link = await fetchNewArrivalLink()
    if (link.ok && link.url) return { ...t, newArrivalQrUrl: link.url }
    return t
  },

  merchantTitleOf(t: PrintTemplate) {
    return resolveMerchantTitle(this._shopName || '', t.headerTitle)
  },

  applyState(t: PrintTemplate) {
    const merchantTitle = this.merchantTitleOf(t)
    const preview = buildPreview(merchantTitle)
    const wxPath = hasWechatQr(t) ? t.wechatQrPath : ''
    const aliPath = hasAlipayQr(t) ? t.alipayQrPath : ''
    const editingReturn = this.data.docKind === 'return'
    const layout = resolvePrintLayout(t, editingReturn)
    const canEdit = canEditPrintTemplate()
    const custom = t.customTemplates.find((item) => item.id === layout.customId)
    const blockRows = BLOCK_ROWS.filter((row) => !HIDDEN_BLOCK_ROWS.has(row.key)).map((row) => {
      const label = tr(row.labelKey)
      if (row.key === 'table') {
        return { key: 'table', label, removable: false, custom: !!custom, editable: false, on: true }
      }
      return {
        key: row.key,
        label,
        removable: row.removable,
        custom: false,
        editable: EDITABLE_BLOCKS.has(row.key),
        on: !!layout.blocks[row.key],
      }
    })
    const settings = loadPrintSettings()
    const customRows = t.customTemplates.filter((item) => item.doc === (editingReturn ? 'return' : 'sale'))
    this.setData(
      {
        t,
        merchantTitle,
        customRows,
        canEdit,
        paid: isCloudSyncAllowed(),
        colEdit: canEdit && !!layout.customId && isTableLayoutId(layout.templateId),
        colHint: canEdit && !layout.customId && isTableLayoutId(layout.templateId),
        spareFields: spareColumns((layout.columns || getReceiptTemplateDef(layout.templateId).columns).map((col) => ({ field: col.field }))),
        canCopy: canEdit && isTableLayoutId(layout.templateId) && customRows.length < 8,
        fontFaceId: settings.printFontFace,
        fontFamily: receiptFontStack(settings.printFontFace),
        fontScaleId: settings.printFontScale,
        fontScale: receiptFontScale(),
        activeName: custom ? custom.name : uiTemplateLabel(layout.templateId),
        pickTemplate: layout.templateId,
        pickCustomId: layout.customId,
        blockRows,
        now: nowLabel(),
        wechatQr: '',
        alipayQr: '',
        templateLabel: uiTemplateLabel(t.template),
        preview,
        receiptModel: demoReceiptModel(t, preview, this.data.shopSubtitle, this.data.shopAddress, editingReturn, this.data.shopPhone),
      },
      () => {
        if (wxPath || aliPath) {
          this.setData({ wechatQr: wxPath, alipayQr: aliPath })
        }
        schedulePreviewQrs(this, t)
      },
    )
  },

  noop() {},

  onDocKind(e: WechatMiniprogram.TouchEvent) {
    const kind = e.currentTarget.dataset.kind === 'return' ? 'return' : 'sale'
    if (kind === this.data.docKind) return
    this.setData({ docKind: kind }, () => this.applyState(this.data.t))
  },

  onTogglePreview() {
    this.setData({ previewOpen: !this.data.previewOpen })
  },

  onOpenPicker() {
    this.setData({ pickerVisible: true })
  },

  onClosePicker() {
    this.setData({ pickerVisible: false })
  },

  onPickTemplate(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEdit) return
    const editingReturn = this.data.docKind === 'return'
    const customId = String(e.currentTarget.dataset.custom || '')
    if (customId) {
      const found = this.data.t.customTemplates.find((item) => item.id === customId)
      if (!found) return
      const next = editingReturn
        ? { ...this.data.t, returnTemplate: found.basedOn, returnActiveCustomId: found.id }
        : { ...this.data.t, template: found.basedOn, activeCustomId: found.id }
      this.applyState(savePrintTemplate(next))
      this.setData({ pickerVisible: false })
      return
    }
    const id = String(e.currentTarget.dataset.id || '') as PrintTemplateTypeId
    if (!id) return
    const next = editingReturn
      ? { ...this.data.t, returnTemplate: id, returnActiveCustomId: '' }
      : { ...this.data.t, template: id, activeCustomId: '' }
    this.applyState(savePrintTemplate(next))
    this.setData({ pickerVisible: false })
  },

  onDeleteCustom(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEdit) return
    const id = String(e.currentTarget.dataset.custom || '')
    const found = this.data.t.customTemplates.find((item) => item.id === id)
    if (!found) return
    wx.showModal({
      title: '删除模板',
      content: `删除「${found.name}」后不可恢复`,
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) return
        const t = this.data.t
        const wasActive = t.activeCustomId === id
        const wasReturn = t.returnActiveCustomId === id
        const returnLayoutBlocks = { ...(t.returnLayoutBlocks || {}) }
        delete returnLayoutBlocks[id]
        this.applyState(savePrintTemplate({
          ...t,
          customTemplates: t.customTemplates.filter((item) => item.id !== id),
          activeCustomId: wasActive ? '' : t.activeCustomId,
          template: wasActive ? found.basedOn : t.template,
          returnActiveCustomId: wasReturn ? '' : t.returnActiveCustomId,
          returnTemplate: wasReturn ? found.basedOn : t.returnTemplate,
          returnLayoutBlocks,
        }))
      },
    })
  },

  onPickSize() {
    if (!this.data.canEdit) return
    this.setData({ sizeVisible: true })
  },

  onCloseSize() {
    this.setData({ sizeVisible: false })
  },

  onChooseSize(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEdit) return
    const id = String(e.currentTarget.dataset.id || '') as FontScaleId
    if (id !== 'small' && id !== 'standard' && id !== 'large' && id !== 'xlarge') return
    savePrintSettings({ ...loadPrintSettings(), printFontScale: id })
    this.setData({ sizeVisible: false })
    this.applyState(this.data.t)
  },

  onPickFont() {
    if (!this.data.canEdit) return
    this.setData({ fontVisible: true })
  },

  onCloseFont() {
    this.setData({ fontVisible: false })
  },

  onChooseFont(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEdit) return
    const id = String(e.currentTarget.dataset.id || '') as FontFaceId
    if (id !== 'hei' && id !== 'song' && id !== 'kai' && id !== 'fang') return
    savePrintSettings({ ...loadPrintSettings(), printFontFace: id })
    this.setData({ fontVisible: false })
    this.applyState(this.data.t)
  },

  onCopyCustom() {
    if (!this.data.canCopy) return
    this.setData({ nameVisible: true, nameDraft: '' })
  },

  onCloseName() {
    this.setData({ nameVisible: false })
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ nameDraft: e.detail.value })
  },

  async onConfirmSaveName() {
    if (!this.data.canCopy) return
    const name = String(this.data.nameDraft || '').trim().slice(0, 12)
    if (!name) {
      wx.showToast({ title: tr('tplNameEmpty'), icon: 'none' })
      return
    }
    const t = this.data.t
    const editingReturn = this.data.docKind === 'return'
    const doc: 'sale' | 'return' = editingReturn ? 'return' : 'sale'
    if (t.customTemplates.some((item) => item.doc === doc && item.name === name)) {
      wx.showToast({ title: tr('tplNameUsed'), icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([name]))) return
    const layout = resolvePrintLayout(t, editingReturn)
    const baseId = isTableLayoutId(layout.templateId) ? layout.templateId : 'cashier'
    const columnSource = layout.columns || getReceiptTemplateDef(baseId).columns
    const columns: LayoutColumn[] = columnSource.map((col) => ({
      field: col.field as LayoutColumn['field'],
      label: String(col.label || '').slice(0, 8) || '列',
      flex: clampColumnFlex(Number(col.flex)),
    }))
    const id = newCustomTemplateId()
    const srcKey = layout.customId || baseId
    const returnLayoutBlocks = { ...(t.returnLayoutBlocks || {}) }
    if (returnLayoutBlocks[srcKey]) returnLayoutBlocks[id] = { ...returnLayoutBlocks[srcKey] }
    const blockSource = t.customTemplates.find((item) => item.id === layout.customId && item.doc === doc)
    const ownBlocks = blockSource
      ? blockSource.blocks
      : editingReturn
        ? layout.blocks
        : resolvePrintLayout({ ...t, template: baseId, activeCustomId: '' }).blocks
    if (editingReturn) returnLayoutBlocks[id] = { ...layout.blocks }
    const kept = t.customTemplates.filter((item) => item.doc !== doc)
    const mine = t.customTemplates.filter((item) => item.doc === doc)
    const next = savePrintTemplate({
      ...t,
      ...(editingReturn
        ? { returnTemplate: baseId, returnActiveCustomId: id }
        : { template: baseId, activeCustomId: id }),
      returnLayoutBlocks,
      customTemplates: [
        ...kept,
        ...mine,
        { id, name, basedOn: baseId, columns, blocks: { ...ownBlocks }, doc },
      ],
    })
    this.setData({ nameVisible: false, nameDraft: '' })
    this.applyState(next)
  },

  writeBlocks(patch: Partial<LayoutBlocks>) {
    const t = this.data.t
    const editingReturn = this.data.docKind === 'return'
    const blocks = withQrBlockPatch(resolvePrintLayout(t, editingReturn).blocks, patch)
    this.applyState(savePrintTemplate(withActiveBlocks(t, blocks, editingReturn)))
  },

  writeSlot(slot: 'left' | 'right' | 'foot', kind: '' | 'lookup' | 'arrival' | 'friend') {
    const fresh = loadPrintTemplate()
    const editingReturn = this.data.docKind === 'return'
    const patch: Partial<LayoutBlocks> = {}
    if (slot === 'left') patch.slotLeft = kind
    else if (slot === 'right') patch.slotRight = kind
    else patch.slotFoot = kind
    const blocks = withQrBlockPatch(resolvePrintLayout(fresh, editingReturn).blocks, patch)
    this.applyState(savePrintTemplate(withActiveBlocks(fresh, blocks, editingReturn)))
  },

  bindFriendQr(slot: 'left' | 'right') {
    wx.showActionSheet({
      itemList: ['扫描微信二维码', '从相册选择微信二维码'],
      success: (res) => {
        wx.scanCode({
          onlyFromCamera: res.tapIndex === 0,
          scanType: ['qrCode'],
          success: (scan) => {
            const saved = saveFriendQrFromPayload(String(scan.result || ''))
            if (!saved) {
              wx.showToast({ title: '未识别到二维码', icon: 'none' })
              return
            }
            this.writeSlot(slot, 'friend')
            void flushPushPrintSettings()
            wx.showToast({ title: '已添加微信好友二维码', icon: 'none' })
          },
          fail: (e) => {
            const msg = String((e as { errMsg?: string })?.errMsg || '')
            if (/cancel/i.test(msg)) return
            wx.showToast({ title: '未识别到二维码', icon: 'none' })
          },
        })
      },
    })
  },

  placeFriendQr(slot: 'left' | 'right') {
    if (!hasFriendQr(loadPrintTemplate())) {
      this.bindFriendQr(slot)
      return
    }
    wx.showActionSheet({
      itemList: ['使用当前微信二维码', '重新绑定'],
      success: (res) => {
        if (res.tapIndex === 0) this.writeSlot(slot, 'friend')
        else this.bindFriendQr(slot)
      },
    })
  },

  onLogoToggle(on: boolean) {
    if (!this.data.canEdit) return
    if (!requireCloudSync('logo')) return
    if (on && !existingShopLogoPath() && !logoPayloadOk(String(peekCachedShop()?.logoBase64 || ''))) {
      this.pickPrintLogo()
      return
    }
    const t = loadPrintTemplate()
    this.applyState(savePrintTemplate({ ...t, printLogo: on }))
  },

  pickPrintLogo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        const path = file?.tempFilePath || ''
        if (!path) return
        if (Number(file?.size || 0) > 2 * 1024 * 1024) {
          wx.showToast({ title: '图片不能超过 2MB', icon: 'none' })
          return
        }
        setTimeout(() => {
          void this.ingestPrintLogo(path)
        }, 80)
      },
      fail: (err) => {
        if (String((err as { errMsg?: string })?.errMsg || '').includes('cancel')) return
        wx.showToast({ title: '选图失败', icon: 'none' })
      },
    })
  },

  async ingestPrintLogo(tempPath: string) {
    wx.showLoading({ title: '处理图片…', mask: true })
    try {
      let thumb = await compressLogo(tempPath, 384)
      let b64 = await readLogoBase64(thumb)
      if (b64.length > 280000) {
        thumb = await compressLogo(thumb, 256)
        b64 = await readLogoBase64(thumb)
      }
      if (!b64) {
        wx.hideLoading()
        wx.showToast({ title: 'Logo 读取失败', icon: 'none' })
        return
      }
      wx.hideLoading()
      if (!(await assertMediaCheckAsync({ imageBase64: b64, mediaType: 2 }))) return
      const local = writeShopLogoFile(b64)
      if (!local) {
        wx.showToast({ title: 'Logo 保存失败', icon: 'none' })
        return
      }
      const shop = peekCachedShop()
      const t = loadPrintTemplate()
      const uploaded = await uploadShop({
        shopName: (shop?.shopName || t.headerTitle || '图可开单打印').trim() || '图可开单打印',
        subtitle: shop?.subtitle || '',
        address: shop?.address || '',
        phone: shop?.phone || '',
        footer: shop?.footer || t.footerText || '',
        logoBase64: b64,
      })
      if (!uploaded.ok) {
        wx.showToast({ title: uploaded.error || 'Logo 同步失败', icon: 'none' })
      }
      this.applyState(savePrintTemplate({ ...loadPrintTemplate(), printLogo: true }))
    } catch (_) {
      wx.hideLoading()
      wx.showToast({ title: 'Logo 保存失败，请重试', icon: 'none' })
    }
  },

  onInfoRemove(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canEdit) return
    const key = String((e.detail && e.detail.key) || '') as LayoutBlockKey
    if (key === 'logo') {
      this.onLogoToggle(false)
      return
    }
    if (key === 'subtitle' || key === 'address' || key === 'shopTel') {
      if (!requireCloudSync('head')) return
      this.writeBlocks({ [key]: false })
      return
    }
    if (key !== 'arrears' && key !== 'customer' && key !== 'phone' && key !== 'date' && key !== 'printedAt' && key !== 'footer' && key !== 'barcode' && key !== 'lineNo') return
    this.writeBlocks({ [key]: false })
  },

  onInfoAdd(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canEdit) return
    const key = String((e.detail && e.detail.key) || '') as LayoutBlockKey
    if (key === 'logo') {
      this.onLogoToggle(true)
      return
    }
    if (key === 'title') {
      this.writeBlocks({ title: true })
      return
    }
    if (key === 'subtitle' || key === 'address' || key === 'shopTel') {
      if (!requireCloudSync('head')) return
      this.writeBlocks({ [key]: true })
      const empty =
        key === 'subtitle'
          ? !String(this.data.shopSubtitle || '').trim()
          : key === 'shopTel'
            ? !String(this.data.shopPhone || '').trim()
            : !String(this.data.shopAddress || '').trim()
      if (empty) this.openHeadEditor(key)
      return
    }
    if (key !== 'arrears' && key !== 'customer' && key !== 'phone' && key !== 'date' && key !== 'printedAt' && key !== 'footer' && key !== 'barcode' && key !== 'lineNo') return
    this.writeBlocks({ [key]: true })
  },

  onHeadEdit(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canEdit) return
    const key = String((e.detail && e.detail.key) || '')
    if (key === 'payQr') {
      payHintAtOpen = this.data.t.paymentQrHintText || ''
      this.setData({ editKind: 'pay' })
      return
    }
    if (key !== 'title' && key !== 'subtitle' && key !== 'address' && key !== 'shopTel' && key !== 'footer') return
    if ((key === 'subtitle' || key === 'address' || key === 'shopTel') && !requireCloudSync('head')) return
    this.openHeadEditor(key)
  },

  openHeadEditor(key: string) {
    const t = this.data.t
    if (key === 'title') this.setData({ editKind: 'title', editText: this.merchantTitleOf(t) })
    else if (key === 'subtitle') this.setData({ editKind: 'subtitle', editText: this.data.shopSubtitle })
    else if (key === 'address') this.setData({ editKind: 'address', editText: this.data.shopAddress })
    else if (key === 'shopTel') this.setData({ editKind: 'shopTel', editText: this.data.shopPhone })
    else if (key === 'footer') this.setData({ editKind: 'footer', editText: t.footerText })
  },

  onQrRemove(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canEdit) return
    const slot = String((e.detail && e.detail.slot) || '')
    if (slot === 'pay') {
      this.writeBlocks({ payQr: false })
      return
    }
    if (slot !== 'left' && slot !== 'right' && slot !== 'foot') return
    this.writeSlot(slot, '')
  },

  onQrAdd(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canEdit) return
    const slot = String((e.detail && e.detail.slot) || '')
    if (slot === 'pay') {
      this.writeBlocks({ payQr: true })
      return
    }
    if (slot !== 'left' && slot !== 'right' && slot !== 'foot') return
    const header = slot === 'left' || slot === 'right'
    wx.showActionSheet({
      itemList: header ? ['扫码查账', '查看新款', '添加微信好友'] : ['扫码查账', '查看新款'],
      success: (res) => {
        if (res.tapIndex === 0) this.writeSlot(slot, 'lookup')
        else if (res.tapIndex === 1) this.writeSlot(slot, 'arrival')
        else if (header && res.tapIndex === 2) this.placeFriendQr(slot)
      },
    })
  },

  onToggleBlock(e: WechatMiniprogram.SwitchChange) {
    if (!this.data.canEdit) return
    const key = String(e.currentTarget.dataset.key || '') as LayoutBlockKey
    if (!key || key === ('table' as LayoutBlockKey)) return
    if ((key === 'subtitle' || key === 'address' || key === 'shopTel') && !requireCloudSync('head')) {
      this.applyState(this.data.t)
      return
    }
    this.writeBlocks({ [key]: !!e.detail.value })
  },

  onEditBlock(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEdit) return
    const key = String(e.currentTarget.dataset.key || '')
    const t = this.data.t
    if (key === 'table') {
      const layout = resolvePrintLayout(t, this.data.docKind === 'return')
      if (!layout.customId || !layout.columns) {
        wx.showToast({ title: tr('colsLocked'), icon: 'none' })
        return
      }
      const colDraft = layout.columns.map((col) => ({ ...col }))
      colDrag = null
      this.setData({
        editKind: 'columns',
        colDraft,
        dragIndex: -1,
        dragShift: 0,
        colShifts: [],
        colOver: colDraft.length > maxColumnsForPaper(getPaperWidthMm()),
        spareFields: spareColumns(colDraft),
      })
      return
    }
    if (key === 'title') {
      this.openHeadEditor(key)
      return
    }
    if (key === 'subtitle') {
      if (!requireCloudSync('head')) return
      this.openHeadEditor(key)
      return
    }
    if (key === 'footer') {
      this.openHeadEditor(key)
      return
    }
    if (key === 'payQr') {
      payHintAtOpen = t.paymentQrHintText || ''
      this.setData({ editKind: 'pay' })
    }
  },

  onEditInput(e: WechatMiniprogram.Input) {
    this.setData({ editText: e.detail.value })
  },

  async onCloseEdit() {
    const closingColumns = this.data.editKind === 'columns'
    if (this.data.editKind === 'pay') {
      const hint = this.data.t.paymentQrHintText || ''
      if (hint !== payHintAtOpen) {
        if (!(await assertMsgSecCheck([hint]))) return
        this.applyState(savePrintTemplate(this.data.t))
      }
    }
    colDrag = null
    this.setData({ editKind: '', dragIndex: -1, dragShift: 0, colShifts: [] })
    if (closingColumns) this.applyState(this.data.t)
  },

  async onApplyEdit() {
    const kind = this.data.editKind
    const text = this.data.editText
    if (kind === 'title' || kind === 'subtitle' || kind === 'address' || kind === 'shopTel' || kind === 'footer' || kind === 'arrival') {
      if (!(await assertMsgSecCheck([text]))) return
    }
    let t = { ...this.data.t }
    if (kind === 'title') {
      const shop = String(this._shopName || '').trim()
      const next = text.trim()
      t.headerTitle = !next || next === shop || isPlaceholderShopTitle(next) ? '' : next
      this.applyState(savePrintTemplate(t))
    } else if (kind === 'footer') {
      t.footerText = text.slice(0, 300)
      this.applyState(savePrintTemplate(t))
    } else if (kind === 'arrival') {
      t.newArrivalQrHintText = text
      this.applyState(savePrintTemplate(t))
    } else if (kind === 'subtitle') {
      const shop = peekCachedShop()
      const saved = await uploadShop({
        shopName: shop?.shopName || t.headerTitle || '图可开单打印',
        subtitle: text,
        address: shop?.address || this.data.shopAddress || '',
        phone: shop?.phone || '',
        footer: shop?.footer || '',
      })
      if (!saved.ok) {
        wx.showToast({ title: ('error' in saved && saved.error) || '保存失败', icon: 'none' })
        return
      }
      this.setData({ shopSubtitle: text })
      this.applyState(t)
    } else if (kind === 'address') {
      const shop = peekCachedShop()
      const saved = await uploadShop({
        shopName: shop?.shopName || t.headerTitle || '图可开单打印',
        subtitle: shop?.subtitle || this.data.shopSubtitle || '',
        address: text,
        phone: shop?.phone || '',
        footer: shop?.footer || '',
      })
      if (!saved.ok) {
        wx.showToast({ title: ('error' in saved && saved.error) || '保存失败', icon: 'none' })
        return
      }
      this.setData({ shopAddress: text })
      this.applyState(t)
    } else if (kind === 'shopTel') {
      const shop = peekCachedShop()
      const saved = await uploadShop({
        shopName: shop?.shopName || t.headerTitle || '图可开单打印',
        subtitle: shop?.subtitle || this.data.shopSubtitle || '',
        address: shop?.address || this.data.shopAddress || '',
        phone: text.trim(),
        footer: shop?.footer || '',
      })
      if (!saved.ok) {
        wx.showToast({ title: ('error' in saved && saved.error) || '保存失败', icon: 'none' })
        return
      }
      this.setData({ shopPhone: text.trim() })
      this.applyState(t)
    }
    this.setData({ editKind: '' })
  },

  previewColumns(columns: LayoutColumn[]) {
    const t = this.data.t
    const editingReturn = this.data.docKind === 'return'
    const customId = resolvePrintLayout(t, editingReturn).customId
    if (!customId) return
    const draft: PrintTemplate = {
      ...t,
      customTemplates: t.customTemplates.map((item) =>
        item.id === customId ? { ...item, columns: columns.map((col) => ({ ...col })) } : item,
      ),
    }
    this.setData({
      receiptModel: demoReceiptModel(
        draft,
        this.data.preview,
        this.data.shopSubtitle,
        this.data.shopAddress,
        this.data.docKind === 'return',
        this.data.shopPhone,
      ),
    })
  },

  onColLabel(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const colDraft = this.data.colDraft.map((col, i) => (i === index ? { ...col, label: e.detail.value } : col))
    this.setData({ colDraft })
    this.previewColumns(colDraft)
  },

  onColFlexSlide(e: WechatMiniprogram.SliderChange) {
    const index = Number(e.currentTarget.dataset.index)
    const flex = clampColumnFlex(Number(e.detail.value) / 100)
    const current = this.data.colDraft[index]
    if (!current || current.flex === flex) return
    const colDraft = this.data.colDraft.map((col, i) => (i === index ? { ...col, flex } : col))
    if (e.type === 'change') this.setData({ colDraft })
    this.previewColumns(colDraft)
  },

  onColDragStart(e: WechatMiniprogram.TouchEvent) {
    const from = Number(e.currentTarget.dataset.index)
    const touch = e.touches && e.touches[0]
    if (!touch || from < 0) return
    colDrag = { from, y: touch.clientY, over: from, row: colRowPx() }
    this.setData({ dragIndex: from, dragShift: 0, colShifts: colShiftsFor(this.data.colDraft.length, from, from, colDrag.row) })
  },

  onColDragMove(e: WechatMiniprogram.TouchEvent) {
    const drag = colDrag
    const touch = e.touches && e.touches[0]
    if (!drag || !touch) return
    const dy = touch.clientY - drag.y
    const len = this.data.colDraft.length
    let over = drag.from + Math.round(dy / drag.row)
    if (over < 0) over = 0
    if (over > len - 1) over = len - 1
    const moved = over !== drag.over
    drag.over = over
    this.setData({
      dragShift: dy,
      colShifts: colShiftsFor(len, drag.from, over, drag.row),
    })
    if (moved) this.previewColumns(reorderedColumns(this.data.colDraft, drag.from, over))
  },

  onColDragEnd() {
    const drag = colDrag
    colDrag = null
    const colDraft = this.data.colDraft.slice()
    if (drag && drag.over !== drag.from && drag.over >= 0 && drag.over < colDraft.length) {
      const [item] = colDraft.splice(drag.from, 1)
      colDraft.splice(drag.over, 0, item)
    }
    this.setData({ colDraft, dragIndex: -1, dragShift: 0, colShifts: [] })
    this.previewColumns(colDraft)
  },

  onColRemove(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const colDraft = this.data.colDraft.filter((_, i) => i !== index)
    this.setData({
      colDraft,
      colOver: colDraft.length > maxColumnsForPaper(getPaperWidthMm()),
      spareFields: spareColumns(colDraft),
    })
    this.previewColumns(colDraft)
  },

  onColAdd(e: WechatMiniprogram.TouchEvent) {
    const field = String(e.currentTarget.dataset.field || '') as LayoutColumn['field']
    if (!field || this.data.colDraft.some((col) => col.field === field)) return
    const labels: Record<string, string> = {
      code: '货号',
      name: '名称',
      spec: '颜色尺码',
      color: '颜色',
      size: '尺码',
      unit: '单位',
      qtyLabel: '数量',
      priceLabel: '单价',
      subLabel: '金额',
    }
    const colDraft = this.data.colDraft.concat([{ field, label: labels[field] || field, flex: 1 }])
    this.setData({
      colDraft,
      colOver: colDraft.length > maxColumnsForPaper(getPaperWidthMm()),
      spareFields: spareColumns(colDraft),
    })
    this.previewColumns(colDraft)
  },

  activeColumns(): LayoutColumn[] | null {
    const layout = resolvePrintLayout(this.data.t, this.data.docKind === 'return')
    if (!layout.customId || !layout.columns) return null
    return layout.columns.map((col) => ({ ...col }))
  },

  commitColumns(columns: LayoutColumn[]) {
    const clean = columns
      .map((col) => ({ ...col, label: String(col.label || '').trim().slice(0, 8) }))
      .filter((col) => col.label)
    if (!clean.length || clean.length > maxColumnsForPaper(getPaperWidthMm())) {
      wx.showToast({ title: tr('colLimit'), icon: 'none' })
      return
    }
    const next = withActiveColumns(this.data.t, clean, this.data.docKind === 'return')
    if (!next) return
    this.applyState(savePrintTemplate(next))
  },

  onPreviewColMove(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.colEdit) return
    const from = Number(e.detail && e.detail.from)
    const to = Number(e.detail && e.detail.to)
    const cols = this.activeColumns()
    if (!cols || !cols[from] || to < 0 || to >= cols.length || from === to) return
    const next = cols.slice()
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    this.commitColumns(next)
  },

  onPreviewCol(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.colEdit) return
    const index = Number(e.detail && e.detail.index)
    const cols = this.activeColumns()
    const col = cols && cols[index]
    if (!col) return
    const flex = Number(col.flex)
    this.setData({
      colFlexVisible: true,
      colFlexIndex: index,
      colFlexLabel: col.label,
      colFlexValue: Math.round(clampColumnFlex(flex) * 100),
    })
  },

  onCloseColFlex() {
    this.setData({ colFlexVisible: false, colFlexIndex: -1 })
  },

  onPreviewFlexSlide(e: WechatMiniprogram.SliderChange) {
    const index = this.data.colFlexIndex
    const cols = this.activeColumns()
    if (!cols || !cols[index]) return
    const flex = clampColumnFlex(Number(e.detail.value) / 100)
    if (cols[index].flex === flex && e.type !== 'change') return
    const next = cols.map((col, i) => (i === index ? { ...col, flex } : col))
    if (e.type === 'change') {
      this.setData({ colFlexValue: Math.round(flex * 100) })
      this.commitColumns(next)
      return
    }
    this.previewColumns(next)
  },

  onColFlexRemove() {
    const index = this.data.colFlexIndex
    const cols = this.activeColumns()
    if (!cols || !cols[index]) return
    if (cols.length <= 1) {
      wx.showToast({ title: '至少保留一列', icon: 'none' })
      return
    }
    this.commitColumns(cols.filter((_, i) => i !== index))
    this.onCloseColFlex()
  },

  onPreviewColDel(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.colEdit) return
    const index = Number(e.detail && e.detail.index)
    const cols = this.activeColumns()
    if (!cols || !cols[index]) return
    if (cols.length <= 1) {
      wx.showToast({ title: '至少保留一列', icon: 'none' })
      return
    }
    this.commitColumns(cols.filter((_, i) => i !== index))
  },

  onPreviewColAdd(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.colEdit) return
    const field = String((e.detail && e.detail.field) || '') as LayoutColumn['field']
    const cols = this.activeColumns()
    if (!cols || !field || cols.some((col) => col.field === field)) return
    if (cols.length >= maxColumnsForPaper(getPaperWidthMm())) {
      wx.showToast({ title: tr('colLimit'), icon: 'none' })
      return
    }
    const label = COL_LABEL[field] || field
    this.commitColumns(cols.concat([{ field, label, flex: 1 }]))
  },

  onColLocked() {
    if (!this.data.canEdit) return
    if (this.data.canCopy) {
      this.onCopyCustom()
      return
    }
    wx.showToast({ title: tr('colsLocked'), icon: 'none' })
  },

  onSaveColumns() {
    const colDraft = this.data.colDraft
      .map((col) => ({ ...col, label: String(col.label || '').trim().slice(0, 8) }))
      .filter((col) => col.label)
    if (!colDraft.length || colDraft.length > maxColumnsForPaper(getPaperWidthMm())) {
      wx.showToast({ title: tr('colLimit'), icon: 'none' })
      return
    }
    const next = withActiveColumns(this.data.t, colDraft, this.data.docKind === 'return')
    if (!next) return
    this.applyState(savePrintTemplate(next))
    this.setData({ editKind: '' })
  },

  onResetTime() {
    this.setData({ now: nowLabel() })
  },

  onHeader(e: WechatMiniprogram.Input) {
    const headerTitle = e.detail.value
    this.setData({
      't.headerTitle': headerTitle,
      preview: buildPreview(headerTitle),
    })
  },

  onFooter(e: WechatMiniprogram.Input) {
    const t = { ...this.data.t, footerText: e.detail.value }
    this.setData({
      t,
      receiptModel: demoReceiptModel(t, this.data.preview, this.data.shopSubtitle, this.data.shopAddress, this.data.docKind === 'return', this.data.shopPhone),
    })
  },

  onQrHint(e: WechatMiniprogram.Input) {
    this.setData({ 't.paymentQrHintText': e.detail.value })
  },

  onQrSwitch(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 't.printPaymentQr': !!e.detail.value })
  },

  onNewArrivalSwitch(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 't.printNewArrivalQr': !!e.detail.value })
  },

  onHeaderLookupSwitch(e: WechatMiniprogram.SwitchChange) {
    const t = { ...this.data.t, printHeaderLookupQr: !!e.detail.value }
    this.setData({
      t,
      receiptModel: demoReceiptModel(t, this.data.preview, this.data.shopSubtitle, this.data.shopAddress, this.data.docKind === 'return', this.data.shopPhone),
    })
  },

  onHeaderArrivalSwitch(e: WechatMiniprogram.SwitchChange) {
    const t = { ...this.data.t, printHeaderNewArrivalQr: !!e.detail.value }
    this.setData({
      t,
      receiptModel: demoReceiptModel(t, this.data.preview, this.data.shopSubtitle, this.data.shopAddress, this.data.docKind === 'return', this.data.shopPhone),
    })
  },

  onSubtitleSwitch(e: WechatMiniprogram.SwitchChange) {
    const t = { ...this.data.t, printSubtitle: !!e.detail.value }
    this.setData({
      t,
      receiptModel: demoReceiptModel(t, this.data.preview, this.data.shopSubtitle, this.data.shopAddress, this.data.docKind === 'return', this.data.shopPhone),
    })
  },

  onNewArrivalHint(e: WechatMiniprogram.Input) {
    this.setData({ 't.newArrivalQrHintText': e.detail.value })
  },

  onPickQr(e: WechatMiniprogram.TouchEvent) {
    if (!canEditPrintTemplate()) {
      wx.showToast({ title: '收款二维码由商家配置，同步后自动生效', icon: 'none' })
      return
    }
    const kind = String(e.currentTarget.dataset.kind || '') as 'wechat' | 'alipay'
    if (kind !== 'wechat' && kind !== 'alipay') return
    const wechat = kind === 'wechat'
    wx.showActionSheet({
      itemList: [
        wechat ? '扫描微信收款码' : '扫描支付宝收款码',
        '从相册选择收款码图片',
      ],
      success: (res) => {
        if (res.tapIndex === 0) this.scanPaymentQr(kind)
        else this.pickPaymentQrImage(kind)
      },
    })
  },

  scanPaymentQr(kind: 'wechat' | 'alipay') {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: (res) => {
        void this.bindFromPayload(kind, String(res.result || ''), 'scan')
      },
      fail: (e) => {
        const msg = String((e as { errMsg?: string })?.errMsg || '')
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '扫描失败', icon: 'none' })
      },
    })
  },

  pickPaymentQrImage(kind: 'wechat' | 'alipay') {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        void this.bindFromPayload(kind, String(res.result || ''), 'gallery')
      },
      fail: (e) => {
        const msg = String((e as { errMsg?: string })?.errMsg || '')
        if (/cancel/i.test(msg)) return
        wx.showToast({ title: '未识别到收款码', icon: 'none' })
      },
    })
  },

  async bindFromPayload(
    kind: 'wechat' | 'alipay',
    raw: string,
    source: 'scan' | 'gallery',
  ) {
    const wechat = kind === 'wechat'
    const err = validateForChannel(raw, wechat)
    if (err) {
      wx.showToast({ title: err, icon: 'none', duration: 2500 })
      return
    }
    const saved = saveQrFromPayload(kind, raw)
    if (!saved) {
      wx.showToast({ title: '生成收款二维码失败', icon: 'none' })
      return
    }
    this.applyState(loadPrintTemplate())
    void flushPushPrintSettings()
    const name = wechat ? '微信' : '支付宝'
    const local = isGuest() || !isLoggedIn()
    wx.showToast({
      title: local
        ? `已识别并生成${name}收款码`
        : source === 'scan'
          ? `已绑定${name}收款码，正在同步到云端…`
          : `已识别并生成${name}收款码，正在同步到云端…`,
      icon: 'none',
      duration: 2200,
    })
  },

  onClearQr(e: WechatMiniprogram.TouchEvent) {
    const kind = String(e.currentTarget.dataset.kind || '') as 'wechat' | 'alipay'
    if (kind !== 'wechat' && kind !== 'alipay') return
    wx.showModal({
      title: '清除收款码',
      content: kind === 'wechat' ? '清除微信收款码？' : '清除支付宝收款码？',
      success: (res) => {
        if (!res.confirm) return
        const cleared = clearQr(kind)
        const t = { ...this.data.t, wechatQrPath: cleared.wechatQrPath, alipayQrPath: cleared.alipayQrPath }
        if (kind === 'wechat') t.wechatQrPath = ''
        else t.alipayQrPath = ''
        savePrintTemplate(t)
        this.applyState(t)
      },
    })
  },

  async onSyncCloud() {
    if (this.data.syncing) return
    if (isGuest() || !isLoggedIn()) {
      wx.showToast({ title: '游客仅本机，无需同步云端', icon: 'none' })
      return
    }
    this.setData({ syncing: true })
    const r = await pullPrintTemplateFromCloud({ force: true })
    this.setData({ syncing: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '同步失败', icon: 'none' })
      return
    }
    this.applyState(await this.withMerchantHomeUrl(r.template))
    wx.showToast({
      title: r.applied ? '已同步云端收款码' : '云端暂无新配置',
      icon: 'none',
    })
  },

  async onSave() {
    const t = await this.withMerchantHomeUrl(this.data.t)
    const names = t.customTemplates.map((item) => item.name)
    const labels = t.customTemplates.reduce<string[]>((all, item) => all.concat(item.columns.map((col) => col.label)), [])
    if (
      !(await assertMsgSecCheck([
        t.headerTitle,
        t.footerText,
        t.paymentQrHintText,
        t.newArrivalQrHintText,
        ...names,
        ...labels,
      ]))
    ) {
      return
    }
    savePrintTemplate(t)
    await flushPushPrintSettings()
    wx.showToast({
      title: isGuest() || !isLoggedIn() ? '已保存到本机' : '已保存',
      icon: 'success',
    })
  },

  onPreviewPrint() {
    const editingReturn = this.data.docKind === 'return'
    const t = this.data.t
    const saved = savePrintTemplate(t)
    this.applyState(saved)
    const preview = buildPreview(saved.headerTitle)
    const templateId = resolvePrintLayout(saved, editingReturn).templateId
    const cloth =
      templateId === 'fashion' ||
      templateId === 'vertical' ||
      templateId === 'piece' ||
      templateId === 'settle' ||
      templateId === 'horizontal'
    const items = preview.items.map((it, idx) => ({
      productCode: cloth ? ['4628', '4628', '5193'][idx] || it.code : it.code,
      productName: cloth ? ['4628', '4628', '5193'][idx] || it.code : it.code,
      spec: cloth ? ['黑 / M', '黑 / L', '白 / 均码'][idx] || '' : '',
      unit: '件',
      price: Number(it.price),
      quantity: Number(it.qty),
      subtotal: Number(it.amount),
      countInStats: true,
    }))
    const cached = peekCachedShop()
    const draft = {
      asReturn: editingReturn,
      templateSample: true,
      orderNo: 'DEMO001',
      dateStr: nowLabel(),
      customerName: preview.customer,
      customerPhone: preview.phone,
      remark: '',
      items,
      totalAmount: Number(preview.settle),
      totalQuantity: Number(preview.totalQty),
      shop: cached || {
        shopName: saved.headerTitle,
        address: this.data.shopAddress,
        phone: this.data.shopPhone,
        subtitle: this.data.shopSubtitle,
        footer: saved.footerText,
      },
    }
    stageReceiptPreview({ reprintOnly: true, draft })
    wx.navigateTo({
      url: '/pages/receipt-preview/receipt-preview',
      success: (res) => {
        res.eventChannel.emit('init', { reprintOnly: true, draft })
      },
      fail: () => {
        takeReceiptPreview()
        wx.showToast({ title: '打开预览失败', icon: 'none' })
      },
    })
  },
})
