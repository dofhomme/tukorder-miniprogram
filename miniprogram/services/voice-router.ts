/** 开单台本地指令路由：可从一句话里抽出多条动作，剩下的给货号/客户解析。 */

import { matchVoiceLexicon, voiceLexiconHas, voiceLexiconItems } from './voice-lexicon'

export type VoiceOpenPage =
  | 'stock'
  | 'printSettings'
  | 'printer'
  | 'printTemplate'
  | 'analytics'
  | 'returns'
  | 'customers'
  | 'customerNew'
  | 'customerPrices'
  | 'recycle'
  | 'team'
  | 'teamData'
  | 'cloudPrinter'
  | 'subscription'
  | 'shop'
  | 'tracking'
  | 'orderLookup'
  | 'statementLookup'
  | 'agentApply'
  | 'category'
  | 'supplyStyles'
  | 'supplyFabric'
  | 'supplyTrim'
  | 'supplyFactory'
  | 'supplySupplier'
  | 'supplyCost'
  | 'supplyAgents'
  | 'supplySales'
  | 'supplyMap'

export type VoiceSearchTarget = 'products' | 'orders' | 'customers' | 'returns'

export type VoiceDeskAction =
  | { type: 'clearAll' }
  | { type: 'clearRow'; row: number }
  | { type: 'deleteRow'; row: number }
  | { type: 'print' }
  | { type: 'returnPrint' }
  | { type: 'returnMode' }
  | { type: 'saleMode' }
  | { type: 'save' }
  | { type: 'saveAs' }
  | { type: 'stockIn' }
  | { type: 'stockOut' }
  | { type: 'restore' }
  | { type: 'setPaid'; on: boolean }
  | { type: 'setPicked'; on: boolean }
  | { type: 'setShipped'; on: boolean }
  | { type: 'openDeliver' }
  | { type: 'changeLastQty'; qty: number }
  | { type: 'dropLast' }
  | { type: 'navigate'; tab: 'home' | 'products' | 'orders' | 'supply' | 'mine' }
  | { type: 'openPage'; page: VoiceOpenPage; code?: string; from?: string; to?: string }
  | { type: 'search'; target: VoiceSearchTarget; query: string }
  | { type: 'lastOrder'; customer?: string }
  | { type: 'setCustomer'; name: string }
  | { type: 'setDate'; date: string }
  | { type: 'openStatement'; customer: string; from: string; to: string }
  | { type: 'openProduct' }
  | { type: 'fillProduct'; code: string; price?: number; retail?: number; save: boolean }
  | { type: 'saveProduct' }
  | { type: 'addStock'; code: string; qty: number }
  | { type: 'importData' }
  | { type: 'exportData' }
  | { type: 'addCategory'; name: string }
  | { type: 'openHelp'; lesson?: string; page?: string }

const CN_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function cnToInt(raw: string): number {
  const s = String(raw || '').trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s.slice(1)] || 0)
  const tens = s.match(/^([一二三四五六七八九两])十([一二三四五六七八九])?$/)
  if (tens) return (CN_DIGIT[tens[1]] || 0) * 10 + (CN_DIGIT[tens[2]] || 0)
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s]
  return 0
}

const NAME_MARK = '[,，、.。;；:：!！?？…~～（）()【】\\[\\]]'
const NAME_CHAR = `(?:(?!货号|颜色|尺码)(?:[^\\d,，、.。;；:：!！?？…~～（）()【】\\[\\]件个条双套份手]|[0-9]))`
const CUST_NAME_RE = `((?:${NAME_MARK}*${NAME_CHAR}){2,6}?${NAME_MARK}*|(?:${NAME_MARK}*${NAME_CHAR}${NAME_MARK}*))(?:一下|吧|啊|呀|的)*(?=(?:[零〇一二三四五六七八九十两]{2,})|(?:[零〇一二三四五六七八九十两]+[件个条双套份手])|(?:[零〇一二三四五六七八九十两]+月)|(?:\\d{2,})|(?:\\d+[件个条双套份手])|[件个条双套份手]|然后|并且|$|打印|保存|清空|货号|颜色|尺码)`
const CUST_NAME_STOP = /^(列表|打印|保存|清空|清除|删除|数据|全部|订单|账单|商品|开单|统计|对账|库存|客户|一下|时间|日期|今天|昨天|明天|前天|后天)$/

/** 语音标点不进客户名和货号。间隔号和货号里的连字符保留。 */
export function stripSpokenMarks(raw: string): string {
  return String(raw || '').replace(/[,，、.。;；:：!！?？…~～（）()【】\[\]“”‘’"']/g, '')
}

function cleanCustName(raw: string): string {
  const s = stripSpokenMarks(String(raw || ''))
    .replace(/然后|并且|再|一下|吧|呀|啊/g, '')
    .replace(/的$/g, '')
    .trim()
  if (!s || CUST_NAME_STOP.test(s)) return ''
  return s
}

/** 客户、用户、代理只是称呼，客户栏里只留姓名。 */
export function spokenPersonName(raw: string): string {
  const stripped = cleanCustName(raw).replace(/^(?:客户|用户|代理)+/, '')
  return cleanCustName(stripped)
}

const LLM_NOT_CUSTOMER = new Set([
  '白色', '黑色', '红色', '蓝色', '灰色', '绿色', '黄色', '粉色', '紫色', '棕色', '花色',
  '杏色', '卡其', '米色', '藏青', '咖啡', '均码', '大码', '中码', '小码', '加大', '特大', '加大码',
])

/** 模型拆出的客户名。颜色、件数和货号不算姓名。 */
export function llmSpokenCustomer(raw: string): string {
  const name = spokenPersonName(raw)
  if (name.length < 2) return ''
  if (LLM_NOT_CUSTOMER.has(name)) return ''
  if (/[0-9A-Za-z件个条双套份手]/.test(name)) return ''
  if (/^[零〇一二三四五六七八九十两]+$/.test(name)) return ''
  return name
}

function setCustomerAct(raw: string): VoiceDeskAction | null {
  const name = spokenPersonName(raw)
  if (!name || /^[0-9零〇一二三四五六七八九十两]+$/.test(name)) return null
  return { type: 'setCustomer', name }
}

const CUSTOMER_CUE =
  /(?:选择客户|选中客户|选客户|添加客户|增加客户|新增客户|新建客户|选择用户|选用户|添加用户|增加用户|选择代理|选中代理|选代理|客户|用户|代理)[\u4e00-\u9fa5·]{1,12}/

/** 这句话里明确说了客户、用户或代理，后面才有客户名。 */
export function utteranceNamesCustomer(text: string): boolean {
  return CUSTOMER_CUE.test(String(text || '').replace(/\s+/g, ''))
}

/** 整句只剩一个姓名时，直接选进客户栏，不必再送去理解。 */
export function bareSpokenCustomer(text: string): string {
  const s = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[。，、,.!！？?]/g, '')
    .replace(/^(?:请|帮我|给我|麻烦|那个|直接)+/, '')
    .replace(/(?:吧|啊|呀|一下)+$/g, '')
  if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(s)) return ''
  if (COMMAND_HINT.test(s) || /[件个条双套份]/.test(s)) return ''
  if (/[0-9零〇一二三四五六七八九十两]{2,}/.test(s) || /[0-9零〇一二三四五六七八九十两]手/.test(s)) return ''
  return spokenPersonName(s)
}

const CURRENT_CUSTOMER = '@current'

function isCurrentCustomerRef(raw: string): boolean {
  const s = String(raw || '').replace(/\s+/g, '').replace(/的$/, '')
  return (
    s === '当前客户' ||
    s === '这个客户' ||
    s === '现在的客户' ||
    s === '现在客户' ||
    s === '本单客户' ||
    s === '当前的客户' ||
    s === CURRENT_CUSTOMER
  )
}

function historyPriceAct(raw: string): VoiceDeskAction | null {
  if (isCurrentCustomerRef(raw)) return { type: 'openPage', page: 'customerPrices', code: CURRENT_CUSTOMER }
  const name = cleanCustName(raw).replace(/^(?:客户|用户|代理|选择|的)+/, '')
  if (isCurrentCustomerRef(name)) return { type: 'openPage', page: 'customerPrices', code: CURRENT_CUSTOMER }
  if (name.length < 2 || name.includes('历史')) return null
  return { type: 'openPage', page: 'customerPrices', code: name }
}

function returnModeAct(m: RegExpMatchArray): VoiceDeskAction | null {
  const at = m.index ?? 0
  const src = String(m.input || '')
  if (src.slice(Math.max(0, at - 1), at + 2) === '卡退单') return null
  return { type: 'returnMode' }
}

function printAct(m: RegExpMatchArray): VoiceDeskAction | null {
  const src = String(m.input || '')
  if (src.includes('退单')) return null
  return { type: 'print' }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function daySpan(delta: number) {
  const d = new Date()
  d.setDate(d.getDate() + delta)
  const t = ymd(d)
  return { from: t, to: t }
}

function monthSpan() {
  const now = new Date()
  return {
    from: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`,
    to: ymd(now),
  }
}

function recentDaysSpan(days: number) {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  start.setDate(start.getDate() - (days - 1))
  return { from: ymd(start), to: ymd(end) }
}

/** 几号：还没到的日子算上个月。 */
function dayOfMonthSpan(day: number) {
  if (day < 1 || day > 31) return null
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth()
  if (day > new Date(year, month + 1, 0).getDate() || day > now.getDate()) {
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
  }
  if (day > new Date(year, month + 1, 0).getDate()) return null
  const t = `${year}-${pad2(month + 1)}-${pad2(day)}`
  return { from: t, to: t }
}

const BILL_DATE_RE =
  /(?:请|帮我|给我|麻烦)?(?:选择时间|选择日期|开单日期|改成日期|更改日期|修改日期|日期改为|时间改为|日期|时间)?(?:大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天|(?:(?:\d{4}|[零〇一二三四五六七八九]{4}|\d{2}|[零〇一二三四五六七八九]{2})年)?(?:\d{1,2}|十[一二]?|[一二三四五六七八九两])月(?:三十[一]?|二十[一二三四五六七八九]?|十[一二三四五六七八九]?|\d{1,2}|[一二三四五六七八九两])[日号]|\d{4}[./-]\d{1,2}[./-]\d{1,2}|(?:三十[一]?|二十[一二三四五六七八九]?|十[一二三四五六七八九]?|\d{1,2}|[一二三四五六七八九两])[日号])/

function isSpokenDateRange(text: string): boolean {
  return /[到至~]/.test(text) && /月|日|号|今天|昨天|明天|前天|后天/.test(text)
}

function cnYear(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (!/^[零〇一二三四五六七八九]+$/.test(raw)) return 0
  const n = Number(
    raw
      .split('')
      .map((ch) => (CN_DIGIT[ch] == null ? '' : String(CN_DIGIT[ch])))
      .join(''),
  )
  return Number.isFinite(n) ? n : 0
}

function validYmd(y: number, m: number, d: number): string {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return ''
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return ''
  return ymd(dt)
}

function billDateFromPiece(raw: string): string {
  const s = String(raw || '').replace(
    /^(?:请|帮我|给我|麻烦)?(?:选择时间|选择日期|开单日期|改成日期|更改日期|修改日期|日期改为|时间改为|日期|时间)/,
    '',
  )
  const rel: Record<string, number> = {
    大前天: -3,
    前天: -2,
    昨天: -1,
    昨日: -1,
    今天: 0,
    今日: 0,
    明天: 1,
    明日: 1,
    后天: 2,
    大后天: 3,
  }
  if (rel[s] != null) return daySpan(rel[s]).from
  const iso = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)
  if (iso) return validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const hit = s.match(
    /^(?:((?:\d{4}|[零〇一二三四五六七八九]{4}|\d{2}|[零〇一二三四五六七八九]{2}))年)?(?:((?:\d{1,2}|十[一二]?|[一二三四五六七八九两]))月)?((?:三十[一]?|二十[一二三四五六七八九]?|十[一二三四五六七八九]?|\d{1,2}|[一二三四五六七八九两]))[日号]$/,
  )
  if (!hit) return ''
  const now = new Date()
  let year = now.getFullYear()
  if (hit[1]) {
    const y = cnYear(hit[1])
    if (!y) return ''
    year = y < 100 ? 2000 + y : y
  }
  if (hit[2]) return validYmd(year, cnToInt(hit[2]), cnToInt(hit[3] || ''))
  const span = dayOfMonthSpan(cnToInt(hit[3] || ''))
  return span ? span.from : ''
}

/** 话里的一个具体日期，写成 YYYY-MM-DD。范围不起开单日期。 */
export function spokenBillDate(text: string): string {
  const s = String(text || '').replace(/\s+/g, '')
  if (!s || isSpokenDateRange(s)) return ''
  const m = s.match(BILL_DATE_RE)
  if (!m) return ''
  return billDateFromPiece(m[0])
}

function setDateAct(raw: string, source: string): VoiceDeskAction | null {
  if (isSpokenDateRange(source)) return null
  const date = billDateFromPiece(raw)
  return date ? { type: 'setDate', date } : null
}

function spokenCode(raw: string) {
  const map: Record<string, string> = {
    零: '0',
    〇: '0',
    一: '1',
    幺: '1',
    二: '2',
    两: '2',
    三: '3',
    四: '4',
    五: '5',
    六: '6',
    七: '7',
    八: '8',
    九: '9',
  }
  const s = String(raw || '')
  if (/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(s)) return s
  if (!/^[零〇一二三四五六七八九幺两]{2,10}$/.test(s)) return ''
  return s
    .split('')
    .map((ch) => map[ch] || '')
    .join('')
}

function parseProductPhrase(text: string): VoiceDeskAction | null {
  const found = String(text || '').match(
    /货号([A-Za-z0-9][A-Za-z0-9-]{0,19}|[零〇一二三四五六七八九幺两]{2,10}?)(?=零售价|建议价|批发价|售价|价格|库存|直接|保存|$)/,
  )
  const code = spokenCode(found?.[1] || '')
  if (!code) return null
  let price: number | undefined
  let retail: number | undefined
  const re = /(零售价|建议价|批发价|售价|价格)(\d+(?:\.\d+)?)/g
  let hit: RegExpExecArray | null
  while ((hit = re.exec(text))) {
    const n = Number(hit[2])
    if (!Number.isFinite(n)) continue
    if (hit[1] === '零售价' || hit[1] === '建议价') retail = n
    else price = n
  }
  return {
    type: 'fillProduct',
    code,
    price,
    retail,
    save: /直接保存商品|保存商品|保存产品|直接保存/.test(text),
  }
}

function statementAct(m: RegExpMatchArray): VoiceDeskAction | null {
  const customer = cleanCustName(m[1] || '').replace(/今天|昨天|这个月|本月/g, '')
  if (!customer) return null
  const when = m[2] || ''
  let span = monthSpan()
  if (when === '今天') span = daySpan(0)
  else if (when === '昨天') span = daySpan(-1)
  else if (when === '这个月' || when === '本月') span = monthSpan()
  else if (m[3]) {
    const hit = dayOfMonthSpan(cnToInt(m[3]))
    if (!hit) return null
    span = hit
  }
  return { type: 'openStatement', customer, from: span.from, to: span.to }
}

function stockAct(m: RegExpMatchArray): VoiceDeskAction | null {
  const code = spokenCode(m[1] || m[3] || m[5] || '')
  const qty = cnToInt(m[2] || m[4] || m[6] || '')
  if (!code || qty <= 0) return null
  return { type: 'addStock', code, qty }
}

type VoiceProductDraft = { code: string; price?: number; retail?: number }
let productDraft: VoiceProductDraft | null = null

export function rememberVoiceProduct(draft: VoiceProductDraft) {
  productDraft = { code: draft.code, price: draft.price, retail: draft.retail }
}

export function peekVoiceProduct() {
  return productDraft
}

export function clearVoiceProduct() {
  productDraft = null
}

type Rule = {
  re: RegExp
  act: (m: RegExpMatchArray) => VoiceDeskAction | null
}

const CODE =
  '[A-Za-z0-9][A-Za-z0-9-]{0,19}|(?:[零〇一二三四五六七八九幺两]{2,10}?(?=零售价|建议价|批发价|售价|价格|库存|直接|保存|$))'
const QTY = '\\d+|[一二两三四五六七八九十百零〇]+'

const HELP_TOPICS: Array<{ re: RegExp; lesson?: string; page?: string }> = [
  { re: /语音|按住说话/, lesson: 'bill-voice' },
  { re: /云同步|订阅/, page: 'subscription' },
  { re: /店铺设置|店铺资料|店名/, page: 'shop' },
  { re: /快递|物流单/, page: 'tracking' },
  { re: /回收站/, page: 'recycle' },
  { re: /云打印/, page: 'cloudPrinter' },
  { re: /团队数据|员工数据|员工业绩/, page: 'teamData' },
  { re: /团队/, page: 'team' },
  { re: /退包/, page: 'returns' },
  { re: /退单|退货/, lesson: 'bill-return' },
  { re: /颜色|尺码/, lesson: 'goods-sku', page: 'products' },
  { re: /添加商品|增加商品|添加产品|新建商品|商品增加/, lesson: 'goods-edit', page: 'openProduct' },
  { re: /分类/, page: 'category' },
  { re: /导入|导出/, page: 'products' },
  { re: /库存/, page: 'stock' },
  { re: /收款|取货|收货|发货/, lesson: 'orders-ship', page: 'orders' },
  { re: /账单|订单|对账/, lesson: 'orders-day', page: 'orders' },
  { re: /蓝牙|连打印机|连接打印/, lesson: 'print-ble', page: 'printer' },
  { re: /打印设置|设置打印|小票|编号|欠款|模板/, lesson: 'print-flags', page: 'printSettings' },
  { re: /面料|辅料|验收/, lesson: 'supply-accept', page: 'supply' },
  { re: /成本/, lesson: 'supply-cost', page: 'supplyCost' },
  { re: /供应链/, page: 'supply' },
  { re: /客户/, page: 'customers' },
  { re: /统计/, page: 'analytics' },
  { re: /商品|货号/, lesson: 'goods-edit', page: 'products' },
  { re: /开单|打印/, lesson: 'bill-print' },
]

function helpAct(text: string): VoiceDeskAction | null {
  if (PRINT_TEMPLATE_VOICE.test(text)) return { type: 'openPage', page: 'printTemplate' }
  if (PRINT_SETUP_VOICE.test(text)) return { type: 'openPage', page: 'printSettings' }
  if (/对账单|添加货号|增加货号|货号库存|导入数据|导出数据|保存商品|添加客户|增加客户|创建客户|创建用户|增加用户|编辑客户|编辑用户|修改客户|修改用户|历史价格/.test(text)) {
    return null
  }
  const setting = /设置/.test(text) && !/操作|教程/.test(text)
  for (const topic of HELP_TOPICS) {
    if (!topic.re.test(text)) continue
    if (setting && topic.page) return { type: 'openHelp', page: topic.page }
    if (topic.lesson) return { type: 'openHelp', lesson: topic.lesson }
    if (topic.page) return { type: 'openHelp', page: topic.page }
  }
  if (!/教程|帮助|(?:怎么|如何|怎样)(?:设置|操作|使用|用)/.test(text)) return null
  return { type: 'openHelp' }
}

/** 收款码和改模板都在打印模板页里，说这些就直接打开那一页。 */
const PRINT_TEMPLATE_VOICE =
  /打印模板设置|调节打印模板|调整打印模板|修改打印模板|编辑打印模板|小票模板|票据模板|打印模板|支付设置|设置支付|支付宝设置|设置支付宝|支付宝收款码|支付宝收款|支付宝二维码|支付宝支付|微信二维码设置|设置微信二维码|微信收款二维码|微信收款码|微信二维码|收款二维码设置|收款码设置|收款二维码|调节模板|调整模板|修改模板|编辑模板|更换模板|换模板|设置模板|模板设置/

/** 连不上、打印不了都去打印设置，那一页上有蓝牙和 Wi-Fi 打印机。 */
const PRINT_SETUP_VOICE =
  /打印不了|打不出来|打不了|打不出|无法打印|不能打印|打印失败|打印机连不上|连不上打印机|打印机链接|打印机连接|链接打印机|连接打印机|链接蓝牙|连接蓝牙|连上蓝牙|蓝牙打印机|打开打印机|wifi打印机|WiFi打印机|WIFI打印机|无线打印机|局域网打印|网口打印|连蓝牙|蓝牙/

/** 能对上功能名就直接打开。长的、具体的放前面。 */
const FEATURES: Array<{ re: RegExp; page?: VoiceOpenPage; tab?: 'home' | 'products' | 'orders' | 'supply' | 'mine' }> = [
  { re: /供应链款式|打开款式|看款式|款式列表/, page: 'supplyStyles' },
  { re: /面料商|发面料|打开面料|供应链面料/, page: 'supplyFabric' },
  { re: /辅料商|发辅料|打开辅料|供应链辅料/, page: 'supplyTrim' },
  { re: /加工厂|打开工厂|供应链工厂/, page: 'supplyFactory' },
  { re: /供应商欠款|供应商列表|打开供应商|供应链供应商/, page: 'supplySupplier' },
  { re: /成衣成本|打开成本|看成本|算成本|款式成本|供应链成本/, page: 'supplyCost' },
  { re: /代理欠款|供应链代理|打开代理|看代理/, page: 'supplyAgents' },
  { re: /销售统计|货号销售|打开销售统计|供应链销售/, page: 'supplySales' },
  { re: /供应链地图|欠款地图/, page: 'supplyMap' },
  { re: /云同步开通|开通云同步|云同步|订阅管理/, page: 'subscription' },
  { re: /店铺设置|店铺资料|修改店名|店铺信息/, page: 'shop' },
  { re: /团队数据|员工数据|员工业绩/, page: 'teamData' },
  { re: /扫快递|快递单号|物流单号|查快递/, page: 'tracking' },
  { re: PRINT_TEMPLATE_VOICE, page: 'printTemplate' },
  { re: /对账单查询/, page: 'statementLookup' },
  { re: /订单查询|查单号/, page: 'orderLookup' },
  { re: /代理广场|代理申请|申请代理/, page: 'agentApply' },
  { re: /回收站/, page: 'recycle' },
  { re: /云打印|云打印机/, page: 'cloudPrinter' },
  { re: /库存流水|库存记录|打开库存/, page: 'stock' },
  { re: /退货包裹|退包登记|打开退包/, page: 'returns' },
  { re: /团队管理|打开团队|团队成员/, page: 'team' },
  { re: /打印设置|打开打印设置/, page: 'printSettings' },
  { re: PRINT_SETUP_VOICE, page: 'printSettings' },
  { re: /销量统计|打开统计|看统计|打开对账/, page: 'analytics' },
  { re: /客户列表|我的客户|打开客户|编辑客户|编辑用户|修改客户|修改用户|客户管理|用户管理/, page: 'customers' },
  { re: /分类管理|打开分类/, page: 'category' },
  { re: /打开我的商品|我的商品|商品列表|打开商品/, tab: 'products' },
  { re: /订单列表|账单列表|打开订单|打开账单/, tab: 'orders' },
  { re: /打开供应链|进入供应链/, tab: 'supply' },
  { re: /去我的页|打开我的/, tab: 'mine' },
  { re: /回到开单|打开开单页|去开单/, tab: 'home' },
]

const FEATURE_RE = new RegExp(FEATURES.map((item) => item.re.source).join('|'))

function featureAct(hit: string): VoiceDeskAction | null {
  for (const item of FEATURES) {
    if (!item.re.test(hit)) continue
    if (item.tab) return { type: 'navigate', tab: item.tab }
    if (item.page) return { type: 'openPage', page: item.page }
  }
  return null
}

const RULES: Rule[] = [
  {
    re: /^(?=.*(?:怎么|如何|怎样|教程|帮助)).+$/,
    act: (m) => helpAct(m[0] || ''),
  },
  {
    re: new RegExp(
      `(?:打开|查看|看一下|查一下|看|查)([\\u4e00-\\u9fa5·]{1,12}?)(?:的)?(?:(今天|昨天|这个月|本月)|(\\d{1,2}|[一二两三四五六七八九十]+)号)?的?对账单`,
    ),
    act: statementAct,
  },
  {
    re: /我要添加产品|我要添加商品|我要新增产品|我要新建商品|添加产品|新增产品|新建产品|添加商品|新增商品|新建商品/,
    act: () => ({ type: 'openProduct' }),
  },
  {
    re: new RegExp(
      `(?:添加|新增|新建|增加)货号(?:${CODE})(?:(?:价格|批发价|售价|零售价|建议价)+\\d+(?:\\.\\d+)?)*(?:直接保存商品|保存商品|保存产品|直接保存)?`,
    ),
    act: (m) => parseProductPhrase(m[0] || ''),
  },
  {
    re: /直接保存商品|保存商品|保存产品/,
    act: () => ({ type: 'saveProduct' }),
  },
  {
    re: new RegExp(
      `(?:增加|加)货号(${CODE})的?库存(${QTY})|(?:增加|加)(${CODE})货号的?库存(${QTY})|货号(${CODE})的?库存(?:增加|加)(${QTY})`,
    ),
    act: stockAct,
  },
  {
    re: /导入数据|导入商品|导入表格|导入货品/,
    act: () => ({ type: 'importData' }),
  },
  {
    re: /导出数据|导出商品|导出表格|导出货品/,
    act: () => ({ type: 'exportData' }),
  },
  {
    re: /(?:增加|添加|新建|新增)分类([\u4e00-\u9fa5A-Za-z0-9]{0,12}?)(?=然后|并且|导入|导出|保存|打印|打开|$)/,
    act: (m) => ({ type: 'addCategory', name: cleanCustName(m[1] || '') }),
  },
  {
    re: /(?:请|帮我|给我|麻烦)?(?:查看|打开|看一下|看看|看|调出|查)?(?:当前客户|这个客户|现在的客户|现在客户|本单客户|当前的客户)的?历史价格/,
    act: () => ({ type: 'openPage', page: 'customerPrices', code: CURRENT_CUSTOMER }),
  },
  {
    re: /(?:请|帮我|给我|麻烦)?(?:查看|打开|看一下|看看|看|调出|查)?(?:客户|用户|代理|选择代理)?([\u4e00-\u9fa5·]{2,12})的?历史价格/,
    act: (m) => historyPriceAct(m[1] || ''),
  },
  {
    re: /(?:创建(?:一个|一下)?(?:用户|客户)|(?:增加|新增|新建|添加)(?:一个|一下)?用户)[\u4e00-\u9fa5·]{0,12}|(?:增加|新增|新建|添加)(?:一个|一下)?客户(?![\u4e00-\u9fa5·])/,
    act: () => ({ type: 'openPage', page: 'customerNew' }),
  },
  {
    re: /(?:编辑|修改)(?:一个|一下)?(?:用户|客户)|客户管理|用户管理|管理客户|管理用户/,
    act: () => ({ type: 'openPage', page: 'customers' }),
  },
  {
    re: /(?:增加客户|新增客户|新建客户|添加客户)([\u4e00-\u9fa5·]{2,12}?)(?:直接添加客户|并选中|直接选中|并选择)*(?=然后|并且|打印|保存|清空|导入|导出|打开|$)/,
    act: (m) => setCustomerAct(m[1] || ''),
  },
  {
    re: FEATURE_RE,
    act: (m) => featureAct(m[0] || ''),
  },
  {
    re: /(?:请|帮我|给我|麻烦)?(?:开退单|打印退单|(?:进入|选择|切换到?|打开)?退单模式|退单(?!打印))/,
    act: returnModeAct,
  },
  {
    re: /(?:请|帮我|给我|麻烦)?开销售单/,
    act: () => ({ type: 'saleMode' }),
  },
  {
    re: /退单.{0,16}打印|打印.{0,16}退单/,
    act: () => ({ type: 'returnPrint' }),
  },
  {
    re: /清空全部|清除全部|全部清空|全部清除|清除全部内容|清空所有|清除所有|全部删掉|删除全部|删掉全部|全部删除|删除数据|清空本子|清除本子|清掉全部|清掉所有/,
    act: () => ({ type: 'clearAll' }),
  },
  {
    re: /(?:删除|删掉).{0,6}第(\d+|[一二两三四五六七八九十]+)行|第(\d+|[一二两三四五六七八九十]+)行.{0,6}(?:删除|删掉)/,
    act: (m) => {
      const row = cnToInt(m[1] || m[2] || '')
      return row >= 1 ? { type: 'deleteRow', row } : null
    },
  },
  {
    re: /(?:清空|清除|清掉).{0,6}第(\d+|[一二两三四五六七八九十]+)行|第(\d+|[一二两三四五六七八九十]+)行.{0,6}(?:清空|清除|清掉)/,
    act: (m) => {
      const row = cnToInt(m[1] || m[2] || '')
      return row >= 1 ? { type: 'clearRow', row } : null
    },
  },
  { re: /清空一下|清除一下|清掉一下|删除一下/, act: () => ({ type: 'clearAll' }) },
  { re: /清空|清除|清掉|删除|删掉/, act: () => ({ type: 'clearAll' }) },
  {
    re: /不要了|删掉刚才|取消刚才|刚才的不要/,
    act: () => ({ type: 'dropLast' }),
  },
  {
    re: /改成([0-9]+|[一二两三四五六七八九十]+)件/,
    act: (m) => {
      const qty = cnToInt(m[1] || '')
      return qty > 0 ? { type: 'changeLastQty', qty } : null
    },
  },
  { re: /另存为?新单|另存/, act: () => ({ type: 'saveAs' }) },
  { re: /保存单据|保存本子|保存(?:订单|账单)|保存/, act: () => ({ type: 'save' }) },
  { re: /入库/, act: () => ({ type: 'stockIn' }) },
  { re: /出库/, act: () => ({ type: 'stockOut' }) },
  { re: /恢复刚才|恢复本子|恢复/, act: () => ({ type: 'restore' }) },
  { re: /取消收款|改未付|标未付|未收款/, act: () => ({ type: 'setPaid', on: false }) },
  { re: /已收款|已经收款|收款了|标已付|已付款/, act: () => ({ type: 'setPaid', on: true }) },
  { re: /取消取货|未取货/, act: () => ({ type: 'setPicked', on: false }) },
  { re: /已取货|取货了|已拿货|拿货了/, act: () => ({ type: 'setPicked', on: true }) },
  { re: /已发货|已出货|发货了|出货了/, act: () => ({ type: 'setShipped', on: true }) },
  { re: /已交货|交货了|已送达|拍照交货/, act: () => ({ type: 'openDeliver' }) },
  {
    re: /(.{1,12}?)的(?:上一单|最近一单|老规矩)/,
    act: (m) => {
      const customer = String(m[1] || '').replace(/然后|并且|再/g, '').trim()
      return customer ? { type: 'lastOrder', customer } : { type: 'lastOrder' }
    },
  },
  { re: /老规矩|再开一张|上一单|最近一单/, act: () => ({ type: 'lastOrder' }) },
  {
    re: BILL_DATE_RE,
    act: (m) => setDateAct(m[0] || '', String(m.input || '')),
  },
  {
    re: new RegExp(`(?:请|帮我|给我|麻烦)?(?:选择代理|选中代理|选代理|代理)${CUST_NAME_RE}`),
    act: (m) => setCustomerAct(m[1] || ''),
  },
  {
    re: new RegExp(`添加客户${CUST_NAME_RE}`),
    act: (m) => setCustomerAct(m[1] || ''),
  },
  {
    re: new RegExp(`选择客户${CUST_NAME_RE}`),
    act: (m) => setCustomerAct(m[1] || ''),
  },
  {
    re: new RegExp(`(?:请|帮我|给我|麻烦)?(?:选择客户|选中客户|选客户|客户|选择用户|选用户|用户)${CUST_NAME_RE}`),
    act: (m) => setCustomerAct(m[1] || ''),
  },
  {
    re: /找货号(.+?)(?=然后|并且|$)|搜(?:索)?(?:商品|货号)(.+?)(?=然后|并且|$)|查(?:一下)?货号(.+?)(?=然后|并且|$)/,
    act: (m) => {
      const query = stripSpokenMarks(String(m[1] || m[2] || m[3] || '')).trim()
      return query ? { type: 'search', target: 'products', query } : null
    },
  },
  {
    re: /(?:看|查|找)(.{1,12}?)的?(?:订单|账单)/,
    act: (m) => {
      const query = String(m[1] || '').trim()
      if (!query || /^(看|查|找|我的|一下)$/.test(query)) return { type: 'navigate', tab: 'orders' }
      return { type: 'search', target: 'orders', query }
    },
  },
  {
    re: /找客户(.{1,12}?)(?=然后|并且|$)|搜(?:索)?客户(.{1,12}?)(?=然后|并且|$)|看客户(.{1,12}?)(?=然后|并且|$)/,
    act: (m) => {
      const query = stripSpokenMarks(String(m[1] || m[2] || m[3] || '')).trim()
      return query ? { type: 'search', target: 'customers', query } : { type: 'openPage', page: 'customers' }
    },
  },
  {
    re: /找退包(.{1,12}?)(?=然后|并且|$)|搜(?:索)?退包(.{1,12}?)(?=然后|并且|$)/,
    act: (m) => {
      const query = String(m[1] || m[2] || '').trim()
      return query ? { type: 'search', target: 'returns', query } : { type: 'openPage', page: 'returns' }
    },
  },
  { re: /打开客户|客户列表|我的客户/, act: () => ({ type: 'openPage', page: 'customers' }) },
  { re: /打开库存|库存流水|库存记录/, act: () => ({ type: 'openPage', page: 'stock' }) },
  { re: /打印设置|打开打印设置/, act: () => ({ type: 'openPage', page: 'printSettings' }) },
  { re: PRINT_SETUP_VOICE, act: () => ({ type: 'openPage', page: 'printSettings' }) },
  { re: /云打印|云打印机/, act: () => ({ type: 'openPage', page: 'cloudPrinter' }) },
  {
    re: /(?:请|帮我|给我|麻烦)?(?:查看|打开|看一下|看看|看|查|调出)?(?:(?:最近一个月|近一个月|最近一月)的?(?:账单|订单)?统计|(?:账单|订单)统计(?:最近一个月|近一个月))/,
    act: () => {
      const span = recentDaysSpan(30)
      return { type: 'openPage', page: 'analytics', from: span.from, to: span.to }
    },
  },
  { re: /打开对账|看统计|打开统计|销量统计/, act: () => ({ type: 'openPage', page: 'analytics' }) },
  { re: /退货包裹|打开退包|退包/, act: () => ({ type: 'openPage', page: 'returns' }) },
  { re: /回收站/, act: () => ({ type: 'openPage', page: 'recycle' }) },
  { re: /打开团队|团队成员/, act: () => ({ type: 'openPage', page: 'team' }) },
  {
    re: /(?:看|查|打开)([A-Za-z0-9][A-Za-z0-9-]{1,19})的?(?:成本|销售统计|销售)/,
    act: (m) => {
      const code = String(m[1] || '').trim()
      if (!code) return null
      const page = /成本/.test(m[0] || '') ? 'supplyCost' : 'supplySales'
      return { type: 'openPage', page, code }
    },
  },
  { re: /打开供应链款式|打开款式|看款式|款式列表|供应链款式/, act: () => ({ type: 'openPage', page: 'supplyStyles' }) },
  { re: /打开供应链面料|面料商|打开面料|发面料|供应链面料/, act: () => ({ type: 'openPage', page: 'supplyFabric' }) },
  { re: /打开供应链辅料|辅料商|打开辅料|发辅料|供应链辅料/, act: () => ({ type: 'openPage', page: 'supplyTrim' }) },
  { re: /打开供应链工厂|加工厂|打开工厂|供应链工厂/, act: () => ({ type: 'openPage', page: 'supplyFactory' }) },
  { re: /打开供应链供应商|打开供应商|看供应商|供应商欠款|供应商列表|供应商/, act: () => ({ type: 'openPage', page: 'supplySupplier' }) },
  { re: /打开供应链成本|成衣成本|打开成本|看成本|算成本|计算成本|款式成本/, act: () => ({ type: 'openPage', page: 'supplyCost' }) },
  { re: /打开供应链代理|打开代理|看代理|代理欠款|供应链代理/, act: () => ({ type: 'openPage', page: 'supplyAgents' }) },
  { re: /打开供应链销售|销售统计|看销售|货号销售|打开销售统计/, act: () => ({ type: 'openPage', page: 'supplySales' }) },
  { re: /打开我的商品|我的商品|看商品|打开商品/, act: () => ({ type: 'navigate', tab: 'products' }) },
  { re: /查看(?:订单|账单)|看(?:订单|账单)|打开(?:订单|账单)/, act: () => ({ type: 'navigate', tab: 'orders' }) },
  { re: /打开供应链|供应链/, act: () => ({ type: 'navigate', tab: 'supply' }) },
  { re: /打开我的$|去我的页/, act: () => ({ type: 'navigate', tab: 'mine' }) },
  {
    re: /请打印|打印一下|打印单子|单子打印|开单打印|货号打印|打印小票|打印票据|打印本子|打印(?:订单|账单)|然后打印|并且打印|再打印|出纸|打单|打印/,
    act: printAct,
  },
]

let _rulePhrases: string[] | null = null

/** 功能说法从现有规则和词表里取出，供本机模糊检索，不另写一套指令。 */
export function voiceFunctionPhrases(): string[] {
  if (!_rulePhrases) {
    const out = new Set<string>()
    for (const rule of RULES) {
      for (const part of rule.re.source.split('|')) {
        const phrase = part.replace(/\\/g, '')
        if (/^[\u4e00-\u9fa5A-Za-z0-9]{4,16}$/.test(phrase) && !phrase.includes('退单')) {
          out.add(phrase)
        }
      }
    }
    _rulePhrases = [...out]
  }
  const all = new Set(_rulePhrases)
  for (const item of voiceLexiconItems()) {
    if (item.phrase.length >= 4 && item.phrase.length <= 16) all.add(item.phrase)
  }
  return [...all]
}

export function extractDeskActions(text: string): { actions: VoiceDeskAction[]; leftover: string } {
  let s = String(text || '')
    .replace(/([0-9A-Za-z])[，,、\s]+(?=[0-9一二两三四五六七八九十])/g, '$1|')
    .replace(/\s+/g, '')
  const actions: VoiceDeskAction[] = []
  let guard = 0
  while (s && guard < 12) {
    guard += 1
    let best: { index: number; len: number; act: VoiceDeskAction } | null = null
    for (const rule of RULES) {
      const m = s.match(rule.re)
      if (!m || m.index == null) continue
      const act = rule.act(m)
      if (!act) continue
      const len = m[0].length
      if (
        !best ||
        m.index < best.index ||
        (m.index === best.index && len > best.len)
      ) {
        best = { index: m.index, len, act }
      }
    }
    const lex = matchVoiceLexicon(s)
    if (lex) {
      const act = parseLlmDeskActions([lex.action])[0]
      if (
        act &&
        (!best || lex.index < best.index || (lex.index === best.index && lex.len > best.len))
      ) {
        best = { index: lex.index, len: lex.len, act }
      }
    }
    if (!best) break
    actions.push(best.act)
    s = s.slice(0, best.index) + s.slice(best.index + best.len)
  }
  let leftover = s
    .replace(/然后|并且/g, '')
    .replace(/帮我|给我|我要|麻烦|谢谢|那个|请|直接/g, '')
    .replace(/[。，、,.!！？?\s]/g, '')
    .replace(/^(一下|吧|啊|呀)+|(一下|吧|啊|呀)+$/g, '')
  if (actions.length) {
    leftover = leftover.replace(/怎么|如何|怎样|打开|查看|看看|进入|去/g, '')
  }
  if (actions.some((a) => a.type === 'setDate')) {
    leftover = leftover.replace(/选择时间|选择日期|开单日期|改成日期|更改日期|修改日期|日期改为|时间改为|日期|时间/g, '')
  }
  if (!actions.some((a) => a.type === 'setDate')) {
    const date = spokenBillDate(text)
    if (date) actions.push({ type: 'setDate', date })
  }
  return { actions, leftover }
}

const COMMAND_HINT =
  /打印|保存|清空|清除|清掉|删除|删掉|客户|用户|货号|入库|出库|统计|对账|账单|订单|商品|产品|退单|退包|库存|收款|取货|拿货|发货|出货|交货|恢复|另存|供应链|款式|面料|辅料|工厂|供应商|代理|销售|成本|蓝牙|打印机|回收站|团队|开单|确认|取消|不要了|改成|老规矩|上一单|最近一单|云打印|搜索|查找|查询|创建|增加|编辑|修改|添加|选择|导入|导出|分类|批发价|零售价|建议价|怎么|如何|怎样|教程|帮助|云同步|订阅|店铺|快递|模板|支付|支付宝|二维码|地图|历史价格|今天|昨天|明天|日期|时间/

/** 这句话是否像开单指令、货号或已有客户。不像就不必再送去理解。 */
export function isSystemVoiceCommand(
  text: string,
  customers?: Array<{ name?: string | null }>,
): boolean {
  const raw = String(text || '').replace(/\s+/g, '')
  if (!raw) return false
  if (COMMAND_HINT.test(raw)) return true
  if (/[A-Za-z]{1,6}\d{2,}/i.test(raw) || /\d{3,}/.test(raw)) return true
  if (/[件个条双套份]/.test(raw) && /[0-9零〇一二三四五六七八九十两百]/.test(raw)) return true
  const names = (customers || [])
    .map((c) => String(c.name || '').trim())
    .filter((n) => n.length >= 2)
  if (names.some((n) => raw.includes(n))) return true
  return voiceLexiconHas(raw)
}

/** 本地已经认出货号或动作时，整句不再交给大模型。 */
export function voiceShouldAskModel(input: {
  hasItems: boolean
  strong: boolean
  hasActions: boolean
  systemCommand: boolean
}): boolean {
  if (input.hasItems || input.strong || input.hasActions) return false
  return input.systemCommand
}

const OPEN_PAGES: VoiceOpenPage[] = [
  'stock',
  'printSettings',
  'printer',
  'printTemplate',
  'analytics',
  'returns',
  'customers',
  'customerNew',
  'customerPrices',
  'recycle',
  'team',
  'teamData',
  'cloudPrinter',
  'subscription',
  'shop',
  'tracking',
  'orderLookup',
  'statementLookup',
  'agentApply',
  'category',
  'supplyStyles',
  'supplyFabric',
  'supplyTrim',
  'supplyFactory',
  'supplySupplier',
  'supplyCost',
  'supplyAgents',
  'supplySales',
  'supplyMap',
]
const NAV_TABS = ['home', 'products', 'orders', 'supply', 'mine'] as const
const SEARCH_TARGETS: VoiceSearchTarget[] = ['products', 'orders', 'customers', 'returns']

function llmOn(v: unknown, fallback = true): boolean {
  if (v === false || v === 0 || v === 'false' || v === '0') return false
  if (v === true || v === 1 || v === 'true' || v === '1') return true
  return fallback
}

export function isClearAllIntent(raw: string): boolean {
  const s = String(raw || '').trim()
  if (!s) return false
  const compact = s.replace(/\s+/g, '').toLowerCase()
  if (
    compact === 'clearall' ||
    compact === 'clear_all' ||
    compact === 'clear' ||
    compact === 'clearorder' ||
    compact === 'reset' ||
    compact === '清空' ||
    compact === '清空全部' ||
    compact === '清除' ||
    compact === '清掉' ||
    compact === '删除' ||
    compact === '删除全部' ||
    compact === '删除数据' ||
    compact === 'delete' ||
    compact === 'deleteall'
  ) {
    return true
  }
  return /清空|清除|清掉|删除|删掉/.test(s)
}

function llmActionType(row: unknown): string {
  if (typeof row === 'string' || typeof row === 'number') return String(row).trim()
  if (!row || typeof row !== 'object') return ''
  const o = row as Record<string, unknown>
  return String(o.type || o.action || o.command || '').trim()
}

/** 把大模型 JSON 里的 actions 收成开单台可执行指令，未知 type 丢弃。 */
export function parseLlmDeskActions(raw: unknown): VoiceDeskAction[] {
  const list = Array.isArray(raw) ? raw : raw != null && raw !== '' ? [raw] : []
  const out: VoiceDeskAction[] = []
  for (const row of list) {
    const type = llmActionType(row)
    if (isClearAllIntent(type) || type === 'clearAll') {
      out.push({ type: 'clearAll' })
      continue
    }
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const pageName = String(o.page || '')
    let day = pageName === 'customerPrices' ? '' : spokenBillDate(String(o.date || ''))
    if (!day && pageName !== 'customerPrices') {
      const from = String(o.from || '').trim()
      const to = String(o.to || from).trim()
      if (from && from === to) day = spokenBillDate(from)
    }
    if (day && !out.some((a) => a.type === 'setDate' && a.date === day)) {
      out.push({ type: 'setDate', date: day })
    }
    if (
      type === 'print' ||
      type === 'returnPrint' ||
      type === 'returnMode' ||
      type === 'saleMode' ||
      type === 'clearAll' ||
      type === 'save' ||
      type === 'saveAs' ||
      type === 'stockIn' ||
      type === 'stockOut' ||
      type === 'restore' ||
      type === 'openDeliver' ||
      type === 'dropLast'
    ) {
      out.push({ type })
      continue
    }
    if (type === 'lastOrder') {
      const customer = String(o.customer || o.customerName || '').trim()
      out.push(customer ? { type: 'lastOrder', customer } : { type: 'lastOrder' })
      continue
    }
    if (type === 'setDate' || type === '选择日期' || type === '选择时间' || type === '日期') {
      const date = spokenBillDate(String(o.date || o.name || o.from || ''))
      if (date && !out.some((a) => a.type === 'setDate' && a.date === date)) out.push({ type: 'setDate', date })
      continue
    }
    if (type === 'setCustomer' || type === 'addCustomer' || type === 'pickCustomer' || type === 'setAgent' || type === 'pickAgent' || type === '添加客户' || type === '选择客户' || type === '选择代理' || type === '添加' || type === '选择' || type === '客户' || type === '代理') {
      const name = spokenPersonName(String(o.name || o.customer || o.customerName || ''))
      if (name && !out.some((a) => a.type === 'setCustomer' && a.name === name)) out.push({ type: 'setCustomer', name })
      continue
    }
    if (type === 'setPaid' || type === 'setPicked' || type === 'setShipped') {
      out.push({ type, on: llmOn(o.on, true) })
      continue
    }
    if (type === 'changeLastQty') {
      const qty = Number(o.qty)
      if (qty > 0) out.push({ type, qty })
      continue
    }
    if (type === 'clearRow' || type === 'deleteRow') {
      const n = Number(o.row)
      if (n >= 1) out.push({ type, row: n })
      continue
    }
    if (type === 'navigate') {
      const tab = String(o.tab || o.page || '').trim()
      if ((NAV_TABS as readonly string[]).includes(tab)) {
        out.push({ type: 'navigate', tab: tab as (typeof NAV_TABS)[number] })
      }
      continue
    }
    if (type === 'openPage') {
      const page = String(o.page || '').trim() as VoiceOpenPage
      if (page === 'customerPrices') {
        const rawName = String(o.name || o.code || o.customer || o.customerName || '')
        const hit = historyPriceAct(rawName)
        if (hit) out.push(hit)
        continue
      }
      if (page === 'analytics') {
        const from = String(o.from || '').trim()
        const to = String(o.to || '').trim()
        const day = /^\d{4}-\d{2}-\d{2}$/
        out.push(
          day.test(from) && day.test(to)
            ? { type: 'openPage', page, from, to }
            : { type: 'openPage', page },
        )
        continue
      }
      if ((OPEN_PAGES as string[]).includes(page)) {
        const code = String(o.code || '').trim()
        out.push(code ? { type: 'openPage', page, code } : { type: 'openPage', page })
      }
      continue
    }
    if (type === 'search') {
      const target = String(o.target || '').trim() as VoiceSearchTarget
      const query = String(o.query || o.keyword || '').trim()
      if ((SEARCH_TARGETS as string[]).includes(target) && query) {
        out.push({ type: 'search', target, query })
      }
      continue
    }
    if (type === 'openStatement') {
      const customer = cleanCustName(String(o.customer || o.name || o.customerName || ''))
      const from = String(o.from || '').trim()
      const to = String(o.to || from).trim()
      if (customer && from && to) out.push({ type: 'openStatement', customer, from, to })
      continue
    }
    if (type === 'openProduct') {
      out.push({ type: 'openProduct' })
      continue
    }
    if (type === 'saveProduct') {
      out.push({ type: 'saveProduct' })
      continue
    }
    if (type === 'importData' || type === 'exportData') {
      out.push({ type })
      continue
    }
    if (type === 'fillProduct') {
      const code = spokenCode(String(o.code || ''))
      if (!code) continue
      const price = Number(o.price)
      const retail = Number(o.retail)
      out.push({
        type: 'fillProduct',
        code,
        price: Number.isFinite(price) ? price : undefined,
        retail: Number.isFinite(retail) ? retail : undefined,
        save: o.save === true || o.save === 1 || o.save === '1',
      })
      continue
    }
    if (type === 'addStock') {
      const code = spokenCode(String(o.code || ''))
      const qty = Number(o.qty)
      if (code && qty > 0) out.push({ type: 'addStock', code, qty })
      continue
    }
    if (type === 'addCategory') {
      out.push({ type: 'addCategory', name: cleanCustName(String(o.name || '')) })
      continue
    }
    if (type === 'openHelp') {
      const lesson = String(o.lesson || o.id || '').trim()
      const page = String(o.page || '').trim()
      out.push(lesson ? { type: 'openHelp', lesson } : page ? { type: 'openHelp', page } : { type: 'openHelp' })
    }
  }
  return out
}

/** 大模型整段 JSON：intent / actions / action 任一表示清空，都当成清空当前开单。 */
export function actionsFromLlmJson(input: {
  intent?: string
  actions?: unknown
  commands?: unknown
  action?: unknown
}): VoiceDeskAction[] {
  const raw = input.actions != null ? input.actions : input.commands != null ? input.commands : input.action
  const out = parseLlmDeskActions(raw)
  if (isClearAllIntent(String(input.intent || '')) && !out.some((a) => a.type === 'clearAll')) {
    out.unshift({ type: 'clearAll' })
  }
  return out
}
