import { fetchSupplyFill, photoSupplyFill, submitSupplyFill } from '../../services/supply'

const DEFAULT_SIZES = ['M', 'L', 'XL', '2XL']

function pieceText(value: number) {
  if (Math.abs(value - Math.round(value)) < 0.001) return String(Math.round(value))
  return String(Math.round(value * 1000) / 1000)
}

function sizeQtySum(rows: Array<{ ratio: string }>) {
  return rows.reduce((sum, row) => {
    const n = Number(row.ratio)
    return sum + (n > 0 ? n : 0)
  }, 0)
}

function buildRows(preset: string[], lines: Array<{ size?: string; qty?: number }>) {
  const base = (preset.length ? preset : DEFAULT_SIZES).slice()
  const qty: Record<string, string> = {}
  const extra: string[] = []
  lines.forEach((line) => {
    const size = String(line.size || '').trim()
    if (!size) return
    qty[size] = Number(line.qty) > 0 ? pieceText(Number(line.qty)) : ''
    if (base.indexOf(size) < 0) extra.push(size)
  })
  return base.concat(extra).map((size) => ({ size, ratio: qty[size] || '' }))
}

Page({
  _snap: '',
  data: {
    token: '',
    productCode: '',
    sizeRows: DEFAULT_SIZES.map((size) => ({ size, ratio: '' })),
    totalQty: '',
    sizeRatioText: '',
    ready: false,
  },

  onLoad(query: Record<string, string>) {
    if (query.token) {
      this.setData({ token: query.token })
      void this.load()
    }
  },

  onToken(e: WechatMiniprogram.Input) { this.setData({ token: e.detail.value }) },

  paint(sizeRows: Array<{ size: string; ratio: string }>) {
    const total = sizeQtySum(sizeRows)
    this.setData({
      sizeRows,
      sizeRatioText: total > 0 ? `尺码合计 ${pieceText(total)} 件` : '',
    })
  },

  onTotal(e: WechatMiniprogram.Input) { this.setData({ totalQty: e.detail.value }) },

  onSize(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRows = this.data.sizeRows.map((row) => ({ ...row }))
    if (!sizeRows[index]) return
    sizeRows[index].size = e.detail.value
    this.paint(sizeRows)
  },

  onQty(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRows = this.data.sizeRows.map((row) => ({ ...row }))
    if (!sizeRows[index]) return
    sizeRows[index].ratio = e.detail.value
    this.paint(sizeRows)
  },

  onAdd() {
    this.paint(this.data.sizeRows.concat([{ size: '', ratio: '' }]))
  },

  onRemove(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const sizeRows = this.data.sizeRows.filter((_, at) => at !== index)
    this.paint(sizeRows.length ? sizeRows : [{ size: '', ratio: '' }])
  },

  async load() {
    const token = this.data.token.trim()
    if (!token) return
    const r = await fetchSupplyFill(token)
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '链接无效', icon: 'none' })
      return
    }
    const sizeRows = buildRows(
      (r.data.sizes || []) as string[],
      (r.data.lines || []) as Array<{ size?: string; qty?: number }>,
    )
    const total = sizeQtySum(sizeRows)
    this._snap = JSON.stringify({
      total,
      rows: sizeRows.map((row) => [row.size.trim(), Number(row.ratio) || 0]),
    })
    this.setData({
      ready: true,
      productCode: String(r.data.productCode || ''),
      sizeRows,
      totalQty: total > 0 ? pieceText(total) : '',
      sizeRatioText: total > 0 ? `尺码合计 ${pieceText(total)} 件` : '',
    })
  },

  async onSubmit() {
    if (!this.data.ready) {
      wx.showToast({ title: '正在加载', icon: 'none' })
      return
    }
    if (this.data.sizeRows.some((row) => Number(row.ratio) > 0 && !String(row.size || '').trim())) {
      wx.showToast({ title: '请填写尺码', icon: 'none' })
      return
    }
    const stated = Number(this.data.totalQty) || 0
    if (!(stated > 0)) {
      wx.showToast({ title: '请填写裁剪总数', icon: 'none' })
      return
    }
    const lines = this.data.sizeRows.map((row) => ({
      productCode: this.data.productCode,
      size: String(row.size || '').trim(),
      qty: Number(row.ratio) || 0,
    })).filter((line) => line.size && line.qty > 0)
    const summed = lines.reduce((sum, line) => sum + line.qty, 0)
    if (!lines.length) {
      wx.showToast({ title: '请填写各尺码件数', icon: 'none' })
      return
    }
    if (Math.abs(summed - stated) > 0.001) {
      wx.showToast({ title: `尺码合计 ${pieceText(summed)} 件，要等于裁剪总数`, icon: 'none' })
      return
    }
    const now = JSON.stringify({
      total: stated,
      rows: this.data.sizeRows.map((row) => [row.size.trim(), Number(row.ratio) || 0]),
    })
    if (now === this._snap) {
      wx.showToast({ title: '未修改，不用保存', icon: 'none' })
      return
    }
    const r = await submitSupplyFill(this.data.token.trim(), lines)
    if (!r.ok) {
      wx.showToast({ title: r.message || '提交失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已写入，厂里提供', icon: 'none' })
    this._snap = now
  },

  onPhoto() {
    const token = this.data.token.trim()
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        wx.getFileSystemManager().readFile({
          filePath: path,
          encoding: 'base64',
          success: async (file) => {
            const saved = await photoSupplyFill(token, String(file.data || ''))
            wx.showToast({ title: saved.ok ? '照片已上传' : (saved.message || '上传失败'), icon: 'none' })
          },
        })
      },
    })
  },
})
