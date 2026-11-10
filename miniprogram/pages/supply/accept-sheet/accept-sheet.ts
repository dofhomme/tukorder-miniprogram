import { acceptSupplyDoc } from '../../../services/supply'
import { isSkuProduct } from '../../../services/product-sku'
import { fetchCatalog, peekCachedCatalog, type Product } from '../../../services/team'

type Cell = { key: string; color: string; size: string; qty: string; showColor: boolean }

function cellsOf(product: Product, qty: number): Cell[] {
  const colors = product.colors || []
  const sizes = product.sizes || []
  const only = colors.length === 1 && sizes.length === 1
  const cells: Cell[] = []
  colors.forEach((color) => {
    sizes.forEach((size, index) => {
      cells.push({
        key: `${color}\0${size}`,
        color,
        size,
        qty: only ? String(qty || '') : '',
        showColor: index === 0,
      })
    })
  })
  return cells
}

function filledOf(cells: Cell[]) {
  return cells.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
}

Component({
  properties: {
    docId: { type: Number, value: 0 },
    code: { type: String, value: '' },
    qty: { type: Number, value: 0 },
  },
  data: {
    open: false,
    busy: false,
    filled: 0,
    cells: [] as Cell[],
  },
  lifetimes: {
    attached() {
      void this.start()
    },
  },
  methods: {
    async productOf(code: string) {
      const cached = peekCachedCatalog().find((item) => item.code === code)
      if (cached) return cached
      const loaded = await fetchCatalog()
      return (loaded.products || []).find((item) => item.code === code) || null
    },

    async start() {
      const id = Number(this.data.docId) || 0
      const code = String(this.data.code || '').trim()
      const qty = Number(this.data.qty) || 0
      if (!id) {
        this.triggerEvent('close')
        return
      }
      const product = code ? await this.productOf(code) : null
      if (!isSkuProduct(product)) {
        const out = await acceptSupplyDoc(id)
        if (!out.ok) {
          this.triggerEvent('fail', { message: out.message || '验收失败' })
          return
        }
        this.triggerEvent('done')
        return
      }
      const cells = cellsOf(product as Product, qty)
      this.setData({ open: true, cells, filled: filledOf(cells) })
    },

    onQty(e: WechatMiniprogram.Input) {
      const key = String(e.currentTarget.dataset.key || '')
      const cells = this.data.cells.map((item) => (item.key === key ? { ...item, qty: e.detail.value } : item))
      this.setData({ cells, filled: filledOf(cells) })
    },

    onClose() {
      if (this.data.busy) return
      this.triggerEvent('close')
    },

    async onConfirm() {
      if (this.data.busy) return
      const qty = Number(this.data.qty) || 0
      const pieces = this.data.cells
        .map((item) => ({ color: item.color, size: item.size, qty: Number(item.qty) || 0 }))
        .filter((item) => item.qty > 0)
      const total = pieces.reduce((sum, item) => sum + item.qty, 0)
      if (total !== qty) {
        wx.showToast({ title: '颜色尺码件数要等于送货件数', icon: 'none' })
        return
      }
      this.setData({ busy: true })
      const out = await acceptSupplyDoc(Number(this.data.docId), pieces)
      this.setData({ busy: false })
      if (!out.ok) {
        wx.showToast({ title: out.message || '验收失败', icon: 'none' })
        return
      }
      this.triggerEvent('done')
    },
  },
})
