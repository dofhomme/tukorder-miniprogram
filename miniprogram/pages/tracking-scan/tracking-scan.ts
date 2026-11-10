import {
  courierColor,
  courierLabel,
  detectCourier,
} from '../../services/courier'
import { assertMsgSecCheck } from '../../services/sec-check'
import { bindPageI18n, i18nState } from '../../services/i18n'

type Row = {
  no: string
  courier: string
  color: string
  bg: string
  border: string
}

function toRow(no: string): Row {
  const kind = detectCourier(no)
  const color = courierColor(kind)
  return {
    no,
    courier: courierLabel(kind),
    color,
    bg: color === '#757575' ? 'rgba(117,117,117,0.12)' : color === '#2E7D32' ? 'rgba(46,125,50,0.12)' : 'rgba(21,101,192,0.12)',
    border: color === '#757575' ? 'rgba(117,117,117,0.35)' : color === '#2E7D32' ? 'rgba(46,125,50,0.35)' : 'rgba(21,101,192,0.35)',
  }
}

Page({
  data: {
    list: [] as Row[],
    showDlg: false,
    dlgValue: '',
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'trackingTitle')
  },

  _nos: [] as string[],
  _done: false,
  _channel: null as WechatMiniprogram.EventChannel | null,

  onShow() {
    this.applyLocale()
  },

  onLoad() {
    try {
      this._channel = this.getOpenerEventChannel()
      this._channel.on('init', (data: { nos?: string[] }) => {
        const nos = Array.isArray(data?.nos)
          ? data.nos.map((n) => String(n).trim()).filter(Boolean)
          : []
        this._nos = Array.from(new Set(nos))
        this.refresh()
      })
    } catch (e) {
      this._channel = null
    }
  },

  onUnload() {
    // 返回键放弃：不回调（对齐 App result == null）
    if (!this._done && this._channel) {
      try {
        this._channel.emit('cancel', {})
      } catch (e) {
        /* ignore */
      }
    }
  },

  noop() {},

  refresh() {
    this.setData({ list: this._nos.map(toRow) })
  },

  async addCode(raw: string) {
    const code = (raw || '').trim().replace(/\s+/g, '')
    if (!code) return
    if (this._nos.includes(code)) {
      wx.showToast({ title: '已添加过该单号', icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([code]))) return
    this._nos.push(code)
    this.refresh()
    const row = toRow(code)
    wx.showToast({ title: `已添加：${row.courier} ${code}`, icon: 'none' })
  },

  onManualAdd() {
    this.setData({ showDlg: true, dlgValue: '' })
  },

  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const code = String(res.result || '').trim()
        if (code) void this.addCode(code)
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '')
        if (/cancel/i.test(msg)) return
        // 开发者工具等环境可能无相机：回退手动录入
        this.setData({ showDlg: true, dlgValue: '' })
        wx.showToast({ title: '请手动输入运单号', icon: 'none' })
      },
    })
  },

  onDlgInput(e: WechatMiniprogram.Input) {
    this.setData({ dlgValue: e.detail.value })
  },
  onDlgCancel() {
    this.setData({ showDlg: false })
  },
  onDlgConfirm() {
    const v = (this.data.dlgValue || '').trim()
    this.setData({ showDlg: false })
    if (v) void this.addCode(v)
  },

  onRemove(e: WechatMiniprogram.TouchEvent) {
    const no = String(e.currentTarget.dataset.no || '')
    this._nos = this._nos.filter((n) => n !== no)
    this.refresh()
  },

  onCopy(e: WechatMiniprogram.TouchEvent) {
    const no = String(e.currentTarget.dataset.no || '')
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '已复制单号', icon: 'success' }),
    })
  },

  onDone() {
    this._done = true
    if (this._channel) {
      try {
        this._channel.emit('done', { nos: this._nos.slice() })
      } catch (e) {
        /* ignore */
      }
    }
    wx.navigateBack()
  },
})
