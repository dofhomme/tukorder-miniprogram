import {
  hasAlipayQr,
  hasFriendQr,
  hasWechatQr,
  resolvePrintLayout,
  type PrintTemplate,
} from './print-template'
import { resolveLookupQr, type LookupQr } from './lookup'
import { isGuest, isLoggedIn } from './session'
import { arrivalQrCaption, resolveNewArrivalQr, resolveNewArrivalQrWithImage } from '../utils/return-receipt'
import { ensureQrImageSync } from '../utils/arrival-qr'

export type ReceiptQrFields = LookupQr & {
  showPayQr: boolean
  showReturnQr: boolean
  qrHint: string
  wechatQr: string
  alipayQr: string
  returnQr: string
  returnQrHint: string
  returnQrUrl: string
  shopSubtitle: string
  showHeaderNewArrivalQr: boolean
  headerNewArrivalQr: string
  headerNewArrivalHint: string
  headerNewArrivalUrl: string
  friendQr: string
  slotLeft: '' | 'lookup' | 'arrival' | 'friend'
  slotRight: '' | 'lookup' | 'arrival' | 'friend'
  slotFoot: '' | 'lookup' | 'arrival' | 'friend'
  /** 游客没有档口账号，票头左右改成可点的绑定入口 */
  guestBindPrompt: boolean
}

export function resolveShopSubtitle(
  shop?: { subtitle?: string | null } | null,
  tpl?: PrintTemplate | null,
): string {
  if (tpl && tpl.printSubtitle === false) return ''
  return String(shop?.subtitle || '').trim()
}

function subtitleFor(shop: { subtitle?: string | null } | null | undefined, blocksSubtitle: boolean): string {
  if (!blocksSubtitle) return ''
  return String(shop?.subtitle || '').trim()
}

function guestBindReceiptQr(
  tpl: PrintTemplate,
  isReturn: boolean,
  shop?: { subtitle?: string | null } | null,
): ReceiptQrFields {
  const blocks = resolvePrintLayout(tpl, isReturn).blocks
  const showPayQr = !!blocks.payQr
  const showLookup = !!blocks.lookup && !isReturn
  const showHeaderArrival = !!blocks.headerArrival && !isReturn
  return {
    showPayQr,
    wechatQr: showPayQr && hasWechatQr(tpl) ? tpl.wechatQrPath : '',
    alipayQr: showPayQr && hasAlipayQr(tpl) ? tpl.alipayQrPath : '',
    showReturnQr: false,
    returnQr: '',
    returnQrHint: '',
    returnQrUrl: '',
    qrHint: (tpl.paymentQrHintText || '扫以下二维码可直接支付').trim(),
    showLookupQr: showLookup,
    lookupQr: '',
    lookupQrHint: showLookup ? '登录设置' : '',
    lookupQrUrl: '',
    shopSubtitle: subtitleFor(shop, blocks.subtitle),
    showHeaderNewArrivalQr: showHeaderArrival,
    headerNewArrivalQr: '',
    headerNewArrivalHint: showHeaderArrival ? '登录设置' : '',
    headerNewArrivalUrl: '',
    friendQr:
      (blocks.slotLeft === 'friend' || blocks.slotRight === 'friend' || blocks.slotFoot === 'friend') &&
      hasFriendQr(tpl)
        ? tpl.friendQrPath
        : '',
    slotLeft: blocks.slotLeft,
    slotRight: blocks.slotRight,
    slotFoot: blocks.slotFoot,
    guestBindPrompt: showLookup || showHeaderArrival,
  }
}

/** 模板样张不签发查账码、不拉云端，避免假单号把预览卡在加载。 */
function localSampleReceiptQr(
  tpl: PrintTemplate,
  isReturn: boolean,
  shop?: { subtitle?: string | null } | null,
): ReceiptQrFields {
  const blocks = resolvePrintLayout(tpl, isReturn).blocks
  const showPayQr = !!blocks.payQr
  const arrival = resolveNewArrivalQr(tpl)
  const arrivalPath = arrival.visible && arrival.encodeUrl ? ensureQrImageSync(arrival.encodeUrl) : ''
  const showLookup = !!blocks.lookup && !isReturn
  const lookupPath = showLookup ? ensureQrImageSync('https://api.imageok.cn/r/sample') : ''
  const showHeaderArrival = !isReturn && !!blocks.headerArrival && arrival.visible
  const headerHint = arrivalQrCaption(tpl.newArrivalQrHintText)
  const returnHint = (arrival.hint || '').trim() || headerHint
  return {
    showPayQr,
    wechatQr: showPayQr && hasWechatQr(tpl) ? tpl.wechatQrPath : '',
    alipayQr: showPayQr && hasAlipayQr(tpl) ? tpl.alipayQrPath : '',
    showReturnQr: isReturn && !!blocks.footerArrival && arrival.visible,
    returnQr: arrivalPath,
    returnQrHint: returnHint,
    returnQrUrl: arrival.encodeUrl || '',
    qrHint: (tpl.paymentQrHintText || '扫以下二维码可直接支付').trim(),
    showLookupQr: showLookup,
    lookupQr: lookupPath,
    lookupQrHint: showLookup ? '扫码查账' : '',
    lookupQrUrl: showLookup ? 'api.imageok.cn/r/sample' : '',
    shopSubtitle: subtitleFor(shop, blocks.subtitle),
    showHeaderNewArrivalQr: showHeaderArrival,
    headerNewArrivalQr: showHeaderArrival ? arrivalPath : '',
    headerNewArrivalHint: showHeaderArrival ? headerHint : '',
    headerNewArrivalUrl: arrival.encodeUrl || '',
    friendQr:
      (blocks.slotLeft === 'friend' || blocks.slotRight === 'friend' || blocks.slotFoot === 'friend') &&
      hasFriendQr(tpl)
        ? tpl.friendQrPath
        : '',
    slotLeft: blocks.slotLeft,
    slotRight: blocks.slotRight,
    slotFoot: blocks.slotFoot,
    guestBindPrompt: false,
  }
}

export async function extraReceiptQr(
  tpl: PrintTemplate,
  orderNo: string,
  isReturn: boolean,
  shop?: { subtitle?: string | null } | null,
  opts?: { localOnly?: boolean },
): Promise<ReceiptQrFields> {
  if (opts?.localOnly) return localSampleReceiptQr(tpl, isReturn, shop)
  if (!isLoggedIn() || isGuest()) return guestBindReceiptQr(tpl, isReturn, shop)
  const blocks = resolvePrintLayout(tpl, isReturn).blocks
  const showPayQr = !!blocks.payQr
  const newArrival = await resolveNewArrivalQrWithImage(tpl)
  const lookup = await resolveLookupQr(orderNo)
  const showLookup = !!blocks.lookup
  const showHeaderArrival = !isReturn && !!blocks.headerArrival && newArrival.visible
  const headerHint = arrivalQrCaption(tpl.newArrivalQrHintText)
  const returnHint = (newArrival.hint || '').trim() || headerHint
  return {
    showPayQr,
    wechatQr: showPayQr && hasWechatQr(tpl) ? tpl.wechatQrPath : '',
    alipayQr: showPayQr && hasAlipayQr(tpl) ? tpl.alipayQrPath : '',
    showReturnQr: isReturn && !!blocks.footerArrival && newArrival.visible,
    returnQr: newArrival.qrPath,
    returnQrHint: returnHint,
    returnQrUrl: newArrival.encodeUrl || '',
    qrHint: (tpl.paymentQrHintText || '扫以下二维码可直接支付').trim(),
    showLookupQr: showLookup,
    lookupQr: showLookup ? lookup.lookupQr : '',
    lookupQrHint: showLookup ? lookup.lookupQrHint || '扫码查账' : '',
    lookupQrUrl: showLookup ? lookup.lookupQrUrl : '',
    shopSubtitle: subtitleFor(shop, blocks.subtitle),
    showHeaderNewArrivalQr: showHeaderArrival,
    headerNewArrivalQr: showHeaderArrival ? newArrival.qrPath : '',
    headerNewArrivalHint: showHeaderArrival ? headerHint : '',
    headerNewArrivalUrl: newArrival.encodeUrl || '',
    friendQr:
      (blocks.slotLeft === 'friend' || blocks.slotRight === 'friend' || blocks.slotFoot === 'friend') &&
      hasFriendQr(tpl)
        ? tpl.friendQrPath
        : '',
    slotLeft: blocks.slotLeft,
    slotRight: blocks.slotRight,
    slotFoot: blocks.slotFoot,
    guestBindPrompt: false,
  }
}
