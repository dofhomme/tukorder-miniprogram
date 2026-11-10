import { ensureArrivalQrImage } from '../../utils/arrival-qr'
import { t } from '../../services/i18n'
import {
  absHttpUrl,
  openQrScan,
  recognizeQrInImage,
  saveQrImage,
  shareQrImage,
  type QrKind,
} from '../../utils/qr-actions'

Component({
  properties: {
    src: { type: String, value: '' },
    url: { type: String, value: '' },
    kind: { type: String, value: 'arrival' },
    mode: { type: String, value: 'aspectFit' },
  },
  data: {
    drawn: '',
  },
  observers: {
    'src, url'() {
      void this.redraw()
    },
  },
  lifetimes: {
    attached() {
      void this.redraw()
    },
  },
  methods: {
    async redraw() {
      const seq = ((this as any)._drawSeq = ((this as any)._drawSeq || 0) + 1)
      const src = String(this.data.src || '').trim()
      if (src) {
        if (seq === (this as any)._drawSeq) this.setData({ drawn: src })
        return
      }
      const url = absHttpUrl(String(this.data.url || ''))
      if (!url) {
        this.setData({ drawn: '' })
        return
      }
      try {
        const path = await ensureArrivalQrImage(url)
        if (seq !== (this as any)._drawSeq) return
        this.setData({ drawn: path })
      } catch (_) {
        if (seq === (this as any)._drawSeq) this.setData({ drawn: '' })
      }
    },
    onLongPress() {
      const src = String(this.data.drawn || this.data.src || '').trim()
      if (!src) return
      const kind = String(this.data.kind || 'arrival') as QrKind
      const url = String(this.data.url || '')
      wx.showActionSheet({
        itemList: [t('qrForward'), t('saveImage'), t('scanQr')],
        success: (res) => {
          if (res.tapIndex === 0) shareQrImage(src)
          else if (res.tapIndex === 1) saveQrImage(src)
          else if (res.tapIndex === 2) {
            if (kind === 'lookup' || kind === 'arrival') openQrScan(kind, url, src)
            else recognizeQrInImage(src)
          }
        },
      })
    },
  },
})
