import { assertMediaCheckAsync } from '../../services/sec-check'
import { uploadProductImage } from '../../services/team'
import {
  acceptSupplyDoc,
  addSupplyDocFile,
  deleteSupplyDoc,
  deleteSupplyDocFile,
  createSupplyBatch,
  createSupplyDoc,
  createSupplyPayment,
  createSupplyStatement,
  fetchSupplyDoc,
  fetchSupplyMaterials,
  newSupplyUid,
  submitSupplyDoc,
  type SupplyMaterial,
} from '../../services/supply'

const NEED_BATCH = ['issue', 'cut', 'delivery', 'po', 'leftover']
const NEED_MATERIAL = ['fabric_in', 'trim_in', 'issue', 'leftover']
const STATUS: Record<string, string> = {
  pending: '待验收',
  accepted: '已验收',
  posted: '已入账',
}

function docFilled(d: {
  productCode?: string
  meters?: string
  qty?: string
  bolts?: string
  unitPrice?: string
  size?: string
  logisticsNo?: string
  logisticsName?: string
}) {
  return !!(
    String(d.productCode || '').trim()
    || Number(d.meters) > 0
    || Number(d.qty) > 0
    || Number(d.bolts) > 0
    || Number(d.unitPrice) > 0
    || String(d.size || '').trim()
    || String(d.logisticsNo || '').trim()
    || String(d.logisticsName || '').trim()
  )
}

Page({
  data: {
    id: 0,
    partyId: 0,
    role: '',
    docType: '',
    needBatch: false,
    batchMode: 'cmt',
    needMaterial: false,
    materials: [] as Array<{ id: number; label: string }>,
    materialIndex: 0,
    materialId: 0,
    productCode: '',
    meters: '',
    qty: '',
    unitPrice: '',
    size: '',
    logisticsNo: '',
    logisticsName: '',
    status: '',
    statusText: '',
    docNo: '',
    amount: 0,
    bolts: '',
    issuedAt: '',
    files: 0,
    fileList: [] as Array<{ id: number; url: string }>,
    statement: null as { id: number; statementNo: string; unpaid: number } | null,
    payAmount: '',
    busy: false,
  },

  onLoad(query: Record<string, string>) {
    const docType = query.docType || ''
    this.setData({
      id: Number(query.id || 0),
      partyId: Number(query.partyId || 0),
      role: query.role || '',
      docType,
      needBatch: NEED_BATCH.indexOf(docType) >= 0,
      needMaterial: NEED_MATERIAL.indexOf(docType) >= 0,
    })
    if (query.id) void this.reload(Number(query.id))
    else if (NEED_MATERIAL.indexOf(docType) >= 0) void this.loadMaterials(docType)
  },

  async loadMaterials(docType: string) {
    const kind = docType === 'fabric_in' ? 'fabric' : docType === 'trim_in' ? 'trim' : ''
    const r = await fetchSupplyMaterials(kind || undefined)
    const materials = (r.data?.items || []).map((item: SupplyMaterial) => ({
      id: item.id,
      label: `${item.name}${item.color ? ' ' + item.color : ''}`,
    }))
    this.setData({
      materials,
      materialId: materials[0] ? materials[0].id : 0,
    })
  },

  onMaterial(e: WechatMiniprogram.PickerChange) {
    const materialIndex = Number(e.detail.value)
    const row = this.data.materials[materialIndex]
    this.setData({ materialIndex, materialId: row ? row.id : 0 })
  },

  onMode(e: WechatMiniprogram.TouchEvent) {
    this.setData({ batchMode: String(e.currentTarget.dataset.mode || 'cmt') })
  },
  onCode(e: WechatMiniprogram.Input) { this.setData({ productCode: e.detail.value }) },
  onMeters(e: WechatMiniprogram.Input) { this.setData({ meters: e.detail.value }) },
  onQty(e: WechatMiniprogram.Input) { this.setData({ qty: e.detail.value }) },
  onPrice(e: WechatMiniprogram.Input) { this.setData({ unitPrice: e.detail.value }) },
  onSize(e: WechatMiniprogram.Input) { this.setData({ size: e.detail.value }) },
  onLogistics(e: WechatMiniprogram.Input) { this.setData({ logisticsNo: e.detail.value }) },
  onPayAmount(e: WechatMiniprogram.Input) { this.setData({ payAmount: e.detail.value }) },

  async reload(id: number) {
    const r = await fetchSupplyDoc(id)
    const doc = r.data
    if (!doc) return
    const statement = doc.statement as { id: number; statementNo: string; unpaid: number } | undefined
    this.setData({
      id,
      partyId: Number(doc.partyId || 0),
      role: String(doc.role || ''),
      docType: String(doc.docType || ''),
      status: String(doc.status || ''),
      statusText: STATUS[String(doc.status || '')] || '',
      docNo: String(doc.docNo || ''),
      amount: Number(doc.amount || 0),
      issuedAt: String(doc.issuedAt || ''),
      logisticsName: String(doc.logisticsName || ''),
      logisticsNo: String(doc.logisticsNo || ''),
      bolts: Array.isArray(doc.lines) && doc.lines[0] && Number(doc.lines[0].bolts) ? String(doc.lines[0].bolts) : '',
      files: Array.isArray(doc.files) ? doc.files.length : 0,
      fileList: Array.isArray(doc.files) ? doc.files as Array<{ id: number; url: string }> : [],
      statement: statement || null,
    })
  },

  async onSave() {
    if (this.data.busy || this.data.id) return
    if (!docFilled(this.data)) {
      wx.showToast({ title: '未填写，不用保存', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    let batchId: number | undefined
    if (this.data.needBatch) {
      const mode = this.data.role === 'supplier' ? 'buy' : this.data.batchMode
      const batch = await createSupplyBatch({
        mode,
        partyId: this.data.partyId,
        productCode: this.data.productCode.trim(),
      })
      if (!batch.ok || !batch.data) {
        this.setData({ busy: false })
        wx.showToast({ title: batch.message || '批次失败', icon: 'none' })
        return
      }
      batchId = batch.data.id
    }
    const useMeters = this.data.docType === 'fabric_in' || this.data.docType === 'issue' || this.data.docType === 'leftover'
    const measure = Number(useMeters ? this.data.meters : this.data.qty) || 0
    const price = Number(this.data.unitPrice) || 0
    const created = await createSupplyDoc({
      uid: newSupplyUid(),
      docType: this.data.docType,
      role: this.data.role,
      partyId: this.data.partyId,
      batchId,
      logisticsNo: this.data.logisticsNo,
      lines: [{
        materialId: this.data.materialId || undefined,
        productCode: this.data.productCode.trim(),
        size: this.data.size.trim(),
        meters: Number(this.data.meters) || 0,
        qty: Number(this.data.qty) || 0,
        unitPrice: price,
        amount: Math.round(measure * price * 100) / 100,
      }],
    })
    this.setData({ busy: false })
    if (!created.ok || !created.data) {
      wx.showToast({ title: created.message || '保存失败', icon: 'none' })
      return
    }
    void this.reload(Number(created.data.id))
  },

  onPhoto() {
    if (!this.data.id) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        if (!(await assertMediaCheckAsync({ filePath: path, mediaType: 2, scene: 1 }))) return
        const up = await uploadProductImage(path)
        if (!up.ok || !up.url) {
          wx.showToast({ title: up.error || '上传失败', icon: 'none' })
          return
        }
        const saved = await addSupplyDocFile(this.data.id, up.url)
        if (!saved.ok) {
          wx.showToast({ title: saved.message || '保存照片失败', icon: 'none' })
          return
        }
        void this.reload(this.data.id)
      },
    })
  },

  async onSubmit() {
    const r = await submitSupplyDoc(this.data.id)
    if (!r.ok) {
      wx.showToast({ title: r.message || '提交失败', icon: 'none' })
      return
    }
    void this.reload(this.data.id)
  },

  async onAccept() {
    const r = await acceptSupplyDoc(this.data.id)
    if (!r.ok) {
      wx.showToast({ title: r.message || '验收失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已验收', icon: 'none' })
    void this.reload(this.data.id)
  },

  async onStatement() {
    const r = await createSupplyStatement({
      partyId: this.data.partyId,
      role: this.data.role,
      docIds: [this.data.id],
    })
    if (!r.ok) {
      wx.showToast({ title: r.message || '对账失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已放入对账单', icon: 'none' })
    void this.reload(this.data.id)
  },

  async onPay() {
    const statement = this.data.statement
    if (!statement) {
      wx.showToast({ title: '先生成对账单', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res) => {
        const path = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!path) return
        if (!(await assertMediaCheckAsync({ filePath: path, mediaType: 2, scene: 1 }))) return
        const up = await uploadProductImage(path)
        if (!up.ok || !up.url) {
          wx.showToast({ title: up.error || '上传失败', icon: 'none' })
          return
        }
        const paid = await createSupplyPayment({
          uid: newSupplyUid(),
          statementId: statement.id,
          amount: Number(this.data.payAmount) || Number(statement.unpaid) || 0,
          url: up.url,
        })
        if (!paid.ok) {
          wx.showToast({ title: paid.message || '付款失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已登记付款', icon: 'none' })
        void this.reload(this.data.id)
      },
    })
  },

  onPreview(e: WechatMiniprogram.TouchEvent) {
    const url = String(e.currentTarget.dataset.url || '')
    const urls = (this.data.fileList || []).map((item) => item.url).filter(Boolean)
    if (!url) return
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  onDeleteFile(e: WechatMiniprogram.TouchEvent) {
    const fileId = Number(e.currentTarget.dataset.id)
    if (!fileId) return
    wx.showModal({
      title: '删除照片',
      content: '照片会从服务器上一并删除',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteSupplyDocFile(this.data.id, fileId)
        if (!r.ok) {
          wx.showToast({ title: r.message || '删除失败', icon: 'none' })
          return
        }
        void this.reload(this.data.id)
      },
    })
  },

  onDelete() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除单据',
      content: '这张单据和它的照片都会删掉',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteSupplyDoc(this.data.id)
        if (!r.ok) {
          wx.showToast({ title: r.message || '删除失败', icon: 'none' })
          return
        }
        wx.navigateBack()
      },
    })
  },
})
