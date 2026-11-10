/** 对账单布局：与订单小票共用打印模版配置 */
import type { StmtPreviewPayload } from '../../services/analytics'
import {
  hasAlipayQr,
  hasWechatQr,
  type PrintTemplate,
  type PrintTemplateTypeId,
} from '../../services/print-template'
import { getReceiptTemplateDef, normalizeFooterText } from '../../services/receipt-layout'
import { printFontCanvasScale } from '../../services/print-settings'
import { RECEIPT_QR_BLOCK_H_PAY } from '../../utils/return-receipt'

export interface StatementOrderRow {
  createdAt: string
  orderNo: string
  orderNoLabel: string
  amountLabel: string
  qtyLabel: string
  statusLabel: string
  statusClass: string
  isReturn: boolean
}

export interface StatementRenderModel {
  templateId: PrintTemplateTypeId
  templateLabel: string
  plainTable: boolean
  rightAlignHeader: boolean
  shopName: string
  subtitle: string
  unpaidOnly: boolean
  customerName: string
  customerPhone: string
  rangeLabel: string
  printTime: string
  orders: StatementOrderRow[]
  totals: StmtPreviewPayload['totals']
  footer: string
  showPayQr: boolean
  qrHint: string
  wechatQr: string
  alipayQr: string
}

export function buildStatementRenderModel(
  payload: StmtPreviewPayload,
  tpl: PrintTemplate,
): StatementRenderModel {
  const def = getReceiptTemplateDef(tpl.template)
  const orders = payload.orders.map((o) => ({
    createdAt: o.createdAt || '',
    orderNo: o.orderNo || '',
    orderNoLabel: o.orderNoLabel || o.orderNo || '',
    amountLabel: o.amountLabel,
    qtyLabel: o.qtyLabel,
    statusLabel: o.statusLabel,
    statusClass: o.statusClass,
    isReturn: !!o.isReturn,
  }))
  const showPayQr =
    !!tpl.printPaymentQr && (hasWechatQr(tpl) || hasAlipayQr(tpl))
  return {
    templateId: def.id,
    templateLabel: def.label,
    plainTable: def.kind === 'cashier' || def.kind === 'compact' || def.kind === 'minimal',
    rightAlignHeader: def.kind === 'horizontal',
    shopName:
      (tpl.headerTitle || payload.shopName || '').trim() || '图可开单',
    subtitle: payload.unpaidOnly ? '客户对账单 · 未付款' : '客户对账单',
    unpaidOnly: payload.unpaidOnly,
    customerName: payload.customerName || '',
    customerPhone: payload.customerPhone || '',
    rangeLabel: payload.rangeLabel || '',
    printTime: payload.printTime || '',
    orders,
    totals: {
      ...payload.totals,
      receivableLabel:
        payload.totals.receivableLabel || payload.totals.unpaidLabel,
    },
    footer: normalizeFooterText(tpl.footerText || ''),
    showPayQr,
    qrHint: (tpl.paymentQrHintText || '扫以下二维码可直接支付').trim(),
    wechatQr: showPayQr && hasWechatQr(tpl) ? tpl.wechatQrPath : '',
    alipayQr: showPayQr && hasAlipayQr(tpl) ? tpl.alipayQrPath : '',
  }
}

export function estimateStatementCanvasHeight(
  _templateId: PrintTemplateTypeId,
  orderCount: number,
  hasPhone: boolean,
  hasFooter: boolean,
  hasPayQr = false,
): number {
  const fs = (n: number) => Math.round(n * printFontCanvasScale())
  const infoLines = 3 + (hasPhone ? 1 : 0)
  return (
    fs(20) +
    fs(36) +
    fs(30) +
    infoLines * fs(24) +
    fs(6) +
    fs(18) +
    fs(28) +
    orderCount * (fs(22) + fs(26)) +
    fs(22) +
    fs(26) * 4 +
    fs(32) +
    (hasPayQr ? RECEIPT_QR_BLOCK_H_PAY : 0) +
    (hasFooter ? fs(50) : 0) +
    32
  )
}
