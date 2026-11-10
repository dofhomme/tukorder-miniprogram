import { openGuestBind } from '../../services/account-gate'
import { ensureQrImageSync } from '../../utils/arrival-qr'
import { fontIdOf, receiptFaceClass, receiptFontStack } from '../../services/print-settings'
import {
  collectReceiptQrTargets,
  scanReceiptQrs,
} from '../../utils/qr-actions'

Component({
  properties: {
    model: {
      type: Object,
      value: {},
    },
    /** 字号倍率：small=0.83 standard=1 large=1.17 xlarge=1.42 */
    fontScale: {
      type: Number,
      value: 1,
    },
    fontFamily: {
      type: String,
      value: '',
    },
    /** 打印模版页：二维码框可移除、可加回 */
    qrEdit: {
      type: Boolean,
      value: false,
    },
    /** 已开通云同步。未开通时副标题和地址只留加号 */
    paid: {
      type: Boolean,
      value: false,
    },
    /** 自定义模板才能改列宽、删列、加列 */
    colEdit: {
      type: Boolean,
      value: false,
    },
    spareFields: {
      type: Array,
      value: [],
    },
    /** 内置表格模板：点这里去另存为后再改列 */
    colHint: {
      type: Boolean,
      value: false,
    },
  },
  observers: {
    fontFamily() {
      void this.refreshFace()
    },
    fontScale(v: number) {
      const s = Number(v)
      let scaleClass = 'fs-std'
      if (s > 0 && s <= 0.9) scaleClass = 'fs-sm'
      else if (s >= 1.25) scaleClass = 'fs-xl'
      else if (s >= 1.08) scaleClass = 'fs-lg'
      this.setData({ scaleClass })
    },
    'model, qrEdit': function () {
      this.paintQrSlots()
    },
  },
  data: {
    scaleClass: 'fs-std',
    faceClass: 'face-hei',
    colDragFrom: -1,
    colHold: -1,
    colDragDx: 0,
    colShifts: [] as number[],
    headWithQr: false,
    showHeadLeft: false,
    showHeadRight: false,
    leftBox: false,
    rightBox: false,
    leftAdd: false,
    rightAdd: false,
    leftHint: '',
    rightHint: '',
    leftSrc: '',
    rightSrc: '',
    leftUrl: '',
    rightUrl: '',
    leftKind: '',
    rightKind: '',
    leftGuest: false,
    colAddOn: false,
    rightGuest: false,
    footSlots: [] as Array<Record<string, string | boolean>>,
    infoRows: [] as Array<Record<string, string | boolean>>,
    barcodeRows: [] as Array<{ key: string; text: string; src: string }>,
  },
  lifetimes: {
    attached() {
      void this.refreshFace()
      this.paintQrSlots()
    },
  },
  methods: {
    refreshFace() {
      const id = fontIdOf(String(this.data.fontFamily || receiptFontStack()))
      this.setData({ faceClass: receiptFaceClass(id) })
    },
    paintQrSlots() {
      const model = (this.data.model || {}) as Record<string, any>
      const qrEdit = !!this.data.qrEdit
      const isReturn = !!model.isReturn
      const keepSlot = (kind: string) =>
        !qrEdit && !!model.guestBindPrompt && (kind === 'lookup' || kind === 'arrival') ? '' : kind
      const left = keepSlot(slotOf(model.slotLeft, !isReturn && model.showLookupQr ? 'lookup' : isReturn && model.showLookupQr ? 'lookup' : ''))
      const right = keepSlot(slotOf(model.slotRight, !isReturn && model.showHeaderNewArrivalQr ? 'arrival' : ''))
      const foot = keepSlot(slotOf(model.slotFoot, model.showReturnQr ? 'arrival' : ''))
      const leftVis = visual(left, model)
      const rightVis = visual(right, model)
      const showHeadLeft = !isReturn && (!!left || qrEdit)
      const showHeadRight = !isReturn && (!!right || qrEdit)
      const footSlots: Array<Record<string, string | boolean>> = []
      const pushFoot = (slot: string, kind: string, allowAdd: boolean) => {
        if (kind) {
          const vis = visual(kind, model)
          footSlots.push({
            slot,
            box: true,
            add: false,
            kind: vis.kind,
            hint: vis.hint,
            src: vis.src,
            url: vis.url,
          })
        } else if (allowAdd) {
          footSlots.push({ slot, box: false, add: true, kind: '', hint: '', src: '', url: '' })
        }
      }
      if (isReturn) {
        pushFoot('left', left, qrEdit)
        if (right) pushFoot('right', right, false)
        pushFoot('foot', foot, qrEdit)
      } else if (foot || qrEdit) {
        pushFoot('foot', foot, qrEdit)
      }
      this.setData({
        headWithQr: showHeadLeft || showHeadRight,
        showHeadLeft,
        showHeadRight,
        leftBox: !!left,
        rightBox: !!right,
        leftAdd: qrEdit && !isReturn && !left,
        rightAdd: qrEdit && !isReturn && !right,
        leftHint: leftVis.hint,
        rightHint: rightVis.hint,
        leftSrc: leftVis.src,
        rightSrc: rightVis.src,
        leftUrl: leftVis.url,
        rightUrl: rightVis.url,
        leftKind: leftVis.kind,
        rightKind: rightVis.kind,
        leftGuest: leftVis.guest,
        rightGuest: rightVis.guest,
        footSlots,
        infoRows: infoRowsOf(model, qrEdit),
        barcodeRows: barcodeRowsOf(model),
      })
    },
    onScanPageQrs() {
      scanReceiptQrs(collectReceiptQrTargets(this.data.model || {}))
    },
    onGuestBind() {
      openGuestBind()
    },
    onQrRemove(e: WechatMiniprogram.TouchEvent) {
      const slot = String(e.currentTarget.dataset.slot || '')
      if (!slot) return
      this.triggerEvent('qrremove', { slot })
    },
    onQrAdd(e: WechatMiniprogram.TouchEvent) {
      const slot = String(e.currentTarget.dataset.slot || '')
      if (!slot) return
      this.triggerEvent('qradd', { slot })
    },
    onInfoRemove(e: WechatMiniprogram.TouchEvent) {
      const key = String(e.currentTarget.dataset.key || '')
      if (!key) return
      this.triggerEvent('inforemove', { key })
    },
    onInfoAdd(e: WechatMiniprogram.TouchEvent) {
      const key = String(e.currentTarget.dataset.key || '')
      if (!key) return
      this.triggerEvent('infoadd', { key })
    },
    onHeadEdit(e: WechatMiniprogram.TouchEvent) {
      const key = String(e.currentTarget.dataset.key || '')
      if (!key) return
      this.triggerEvent('headedit', { key })
    },
    onColXTouch() {},
    onColPenStart() {
      ;(this as { _penEdit?: boolean })._penEdit = true
      ;(this as { _colDrag?: unknown })._colDrag = null
    },
    onColPenMove() {},
    onColPenCancel() {
      ;(this as { _penEdit?: boolean })._penEdit = false
    },
    onColPenEnd(e: WechatMiniprogram.TouchEvent) {
      if (!(this as { _penEdit?: boolean })._penEdit) return
      ;(this as { _penEdit?: boolean })._penEdit = false
      ;(this as { _suppressColTap?: boolean })._suppressColTap = true
      ;(this as { _colDrag?: unknown })._colDrag = null
      this.setData({ colHold: -1, colDragFrom: -1, colDragDx: 0, colShifts: [] })
      const index = Number(e.currentTarget.dataset.index)
      if (!Number.isFinite(index)) return
      this.triggerEvent('coltap', { index })
    },
    onColTouchStart(e: WechatMiniprogram.TouchEvent) {
      if (!this.properties.colEdit && !this.data.colEdit) return
      const index = Number(e.currentTarget.dataset.index)
      const touch = e.touches && e.touches[0]
      if (!touch || !Number.isFinite(index)) return
      const drag = {
        index,
        x: touch.clientX,
        y: touch.clientY,
        dragging: false,
        over: index,
        width: 48,
        rects: [] as Array<{ left: number; width: number }>,
      }
      ;(this as { _colDrag?: typeof drag })._colDrag = drag
      this.setData({ colHold: index })
      this.createSelectorQuery()
        .selectAll('.rb-hcell')
        .boundingClientRect((rects) => {
          const current = (this as { _colDrag?: typeof drag })._colDrag
          if (!current || current !== drag || !rects) return
          const list = (Array.isArray(rects) ? rects : [rects]) as Array<{ left?: number; width?: number }>
          current.rects = list
            .filter((rect) => rect && Number(rect.width) > 0)
            .map((rect) => ({ left: Number(rect.left || 0), width: Number(rect.width || 0) }))
          const mine = current.rects[index]
          if (mine) current.width = mine.width
        })
        .exec()
    },
    onColTouchMove(e: WechatMiniprogram.TouchEvent) {
      const drag = (this as { _colDrag?: {
        index: number
        x: number
        y: number
        dragging: boolean
        over: number
        width: number
        rects: Array<{ left: number; width: number }>
      } })._colDrag
      const touch = e.touches && e.touches[0]
      if (!drag || !touch) return
      const dx = touch.clientX - drag.x
      const dy = touch.clientY - drag.y
      if (!drag.dragging) {
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return
        drag.dragging = true
        wx.vibrateShort({ type: 'light' })
      }
      const len = Array.isArray(this.data.model && this.data.model.columns) ? this.data.model.columns.length : 0
      let over = drag.index
      const finger = touch.clientX
      const rects = drag.rects
      if (rects.length) {
        over = rects.length - 1
        for (let i = 0; i < rects.length; i++) {
          if (finger < rects[i].left + rects[i].width) {
            over = i
            break
          }
        }
        if (finger < rects[0].left) over = 0
      } else {
        over = drag.index + Math.round(dx / (drag.width || 48))
      }
      if (over < 0) over = 0
      if (len && over > len - 1) over = len - 1
      drag.over = over
      const width = drag.width || 48
      const shifts: number[] = []
      for (let i = 0; i < len; i++) {
        if (i === drag.index) shifts.push(0)
        else if (drag.index < over && i > drag.index && i <= over) shifts.push(-width)
        else if (drag.index > over && i >= over && i < drag.index) shifts.push(width)
        else shifts.push(0)
      }
      this.setData({ colDragFrom: drag.index, colDragDx: dx, colShifts: shifts })
    },
    onColTouchEnd() {
      const drag = (this as { _colDrag?: { index: number; dragging: boolean; over: number } })._colDrag
      ;(this as { _colDrag?: unknown })._colDrag = null
      if (drag && drag.dragging) (this as { _suppressColTap?: boolean })._suppressColTap = true
      this.setData({ colDragFrom: -1, colHold: -1, colDragDx: 0, colShifts: [] })
      if (!drag || !drag.dragging || drag.over === drag.index) return
      this.triggerEvent('colmove', { from: drag.index, to: drag.over })
    },
    onColTap(e: WechatMiniprogram.TouchEvent) {
      if ((this as { _suppressColTap?: boolean })._suppressColTap) {
        ;(this as { _suppressColTap?: boolean })._suppressColTap = false
        return
      }
      const index = Number(e.currentTarget.dataset.index)
      if (!Number.isFinite(index)) return
      this.triggerEvent('coltap', { index })
    },
    onColDel(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index)
      if (!Number.isFinite(index)) return
      this.triggerEvent('coldel', { index })
    },
    onColAddTap() {
      const spare = this.data.spareFields || []
      if (!spare.length) {
        wx.showToast({ title: '没有可添加的列', icon: 'none' })
        return
      }
      this.setData({ colAddOn: !this.data.colAddOn })
    },
    onColPick(e: WechatMiniprogram.TouchEvent) {
      const field = String(e.currentTarget.dataset.field || '')
      if (!field) return
      this.setData({ colAddOn: false })
      this.triggerEvent('colpick', { field })
    },
    onColLocked() {
      this.triggerEvent('collocked')
    },
  },
})

function barcodeRowsOf(model: Record<string, any>) {
  if (model.showBarcode === false) return []
  const items = Array.isArray(model.items) ? model.items : []
  const rows: Array<{ key: string; text: string; src: string }> = []
  items.forEach((item: Record<string, any>, index: number) => {
    const text = String(item.barcodeText || '').trim()
    if (!text) return
    const src = ensureQrImageSync(text)
    if (!src) return
    const spec = item.hasSpec ? String(item.spec || '').trim() : ''
    rows.push({
      key: String(item.key || index),
      text: spec ? `${text} ${spec}` : text,
      src,
    })
  })
  return rows
}

function infoRowsOf(model: Record<string, any>, qrEdit: boolean) {
  const customerLabel = model.layoutKind === 'delivery' ? '收货人' : '客户'
  const arrearsOn = model.arrearsOn != null ? !!model.arrearsOn : !!model.showArrears
  const specs = [
    {
      key: 'arrears',
      label: '欠款',
      on: arrearsOn,
      value: model.customerArrearsLabel ? `¥${model.customerArrearsLabel}` : '',
    },
    { key: 'customer', label: customerLabel, on: model.showCustomer !== false, value: String(model.customerName || '') },
    { key: 'phone', label: '电话', on: model.showPhone !== false, value: String(model.customerPhone || '') },
    { key: 'date', label: '日期', on: model.showDate !== false, value: String(model.dateStr || '') },
    {
      key: 'printedAt',
      label: '打印时间',
      on: model.showPrintedAt != null ? !!model.showPrintedAt : !!model.printTimeLabel,
      value: String(model.printTimeLabel || ''),
    },
    {
      key: 'lineNo',
      label: '序列号',
      on: model.showLineNumber !== false,
      value: '',
      editOnly: true,
    },
  ]
  const rows: Array<Record<string, string | boolean>> = []
  for (const row of specs) {
    if (row.on) {
      if (!qrEdit && (!row.value || row.editOnly)) continue
      rows.push({
        key: row.key,
        label: row.label,
        value: row.editOnly ? '' : row.value || (row.key === 'arrears' ? '¥0.00' : '—'),
        on: true,
        add: false,
      })
    } else if (qrEdit) {
      rows.push({ key: row.key, label: row.label, value: '', on: false, add: true })
    }
  }
  return rows
}

function slotOf(value: unknown, fallback: string): string {
  if (value === 'lookup' || value === 'arrival' || value === 'friend' || value === '') return value
  return fallback
}

function visual(kind: string, model: Record<string, any>) {
  if (kind === 'lookup') {
    const guest = !!model.guestBindPrompt
    return {
      kind,
      hint: guest ? '登录设置' : String(model.lookupQrHint || '扫码查账'),
      src: guest ? '' : String(model.lookupQr || ''),
      url: String(model.lookupQrUrl || ''),
      guest,
    }
  }
  if (kind === 'arrival') {
    const guest = !!model.guestBindPrompt
    return {
      kind,
      hint: guest ? '登录设置' : String(model.headerNewArrivalHint || model.returnQrHint || '查看新款'),
      src: guest ? '' : String(model.headerNewArrivalQr || model.returnQr || ''),
      url: String(model.headerNewArrivalUrl || ''),
      guest,
    }
  }
  if (kind === 'friend') {
    return {
      kind,
      hint: '添加微信',
      src: String(model.friendQr || ''),
      url: '',
      guest: false,
    }
  }
  return { kind: '', hint: '', src: '', url: '', guest: false }
}
