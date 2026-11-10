import {
  fetchSupplyMaterials,
  newSupplyUid,
  saveSupplyMaterial,
  type SupplyMaterial,
} from '../../../services/supply'

Component({
  properties: {
    materialId: { type: Number, value: 0 },
    kind: { type: String, value: 'fabric' },
  },
  data: {
    id: 0,
    uid: '',
    name: '',
    color: '',
    spec: '',
    unit: '米',
    refPrice: '',
    specLabel: '门幅',
    busy: false,
  },
  lifetimes: {
    attached() {
      this._snap = ''
      const kind = this.data.kind === 'trim' ? 'trim' : 'fabric'
      const id = Number(this.data.materialId || 0)
      this.setData({
        id,
        kind,
        uid: newSupplyUid(),
        unit: kind === 'fabric' ? '米' : '个',
        specLabel: kind === 'fabric' ? '门幅' : '规格',
      })
      if (id) void this.load(id, kind)
    },
  },
  methods: {
    async load(id: number, kind: string) {
      const r = await fetchSupplyMaterials(kind)
      const item = (r.data?.items || []).find((m: SupplyMaterial) => m.id === id)
      if (!item) return
      const name = item.name
      const color = item.color || ''
      const spec = item.spec || ''
      const unit = item.unit || this.data.unit
      const refPrice = String(item.refPrice || '')
      this._snap = JSON.stringify({
        name: name.trim(),
        color: color.trim(),
        spec: spec.trim(),
        unit: unit.trim() || (kind === 'fabric' ? '米' : '个'),
        refPrice: Number(refPrice) || 0,
      })
      this.setData({
        uid: item.uid,
        name,
        color,
        spec,
        unit,
        refPrice,
      })
    },
    onName(e: WechatMiniprogram.Input) { this.setData({ name: e.detail.value }) },
    onColor(e: WechatMiniprogram.Input) { this.setData({ color: e.detail.value }) },
    onSpec(e: WechatMiniprogram.Input) { this.setData({ spec: e.detail.value }) },
    onUnit(e: WechatMiniprogram.Input) { this.setData({ unit: e.detail.value }) },
    onPrice(e: WechatMiniprogram.Input) { this.setData({ refPrice: e.detail.value }) },
    async onSave() {
      if (this.data.busy) return
      if (!this.data.name.trim()) {
        wx.showToast({ title: '请填写名称', icon: 'none' })
        return
      }
      const body = {
        name: this.data.name.trim(),
        color: this.data.color.trim(),
        spec: this.data.spec.trim(),
        unit: this.data.unit.trim() || (this.data.kind === 'fabric' ? '米' : '个'),
        refPrice: Number(this.data.refPrice) || 0,
      }
      if (this.data.id && !this._snap) {
        wx.showToast({ title: '正在加载', icon: 'none' })
        return
      }
      if (this.data.id && JSON.stringify(body) === this._snap) {
        wx.showToast({ title: '未修改，不用保存', icon: 'none' })
        return
      }
      this.setData({ busy: true })
      const r = await saveSupplyMaterial({
        id: this.data.id || undefined,
        uid: this.data.uid,
        kind: this.data.kind,
        ...body,
      })
      this.setData({ busy: false })
      if (!r.ok) {
        wx.showToast({ title: r.message || '保存失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'none' })
      this.triggerEvent('saved')
    },
  },
})
