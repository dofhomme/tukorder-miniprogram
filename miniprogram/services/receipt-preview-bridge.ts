/** 打开票据预览前先放下草稿。事件通道偶尔晚于页面 onLoad，避免一直停在加载。 */
let pending: {
  draft: unknown
  reprintOnly?: boolean
} | null = null

export function stageReceiptPreview(payload: {
  draft: unknown
  reprintOnly?: boolean
}) {
  pending = payload
}

export function takeReceiptPreview() {
  const cur = pending
  pending = null
  return cur
}
