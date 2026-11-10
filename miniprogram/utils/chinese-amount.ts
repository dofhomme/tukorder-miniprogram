/** 金额转中文大写（收款收据 / 横向表格用） */
const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const BIG_UNITS = ['', '万', '亿']

function groupPart(n: number): string {
  if (n === 0) return ''
  const s = String(n).padStart(4, '0')
  let out = ''
  for (let i = 0; i < 4; i++) {
    const d = Number(s[i])
    if (d === 0) {
      if (out && !out.endsWith('零')) out += '零'
    } else {
      out += DIGITS[d] + UNITS[3 - i]
    }
  }
  return out.replace(/零+$/, '')
}

function integerPart(n: number): string {
  if (n === 0) return DIGITS[0]
  const s = String(n)
  const groups: string[] = []
  for (let i = s.length; i > 0; i -= 4) {
    groups.unshift(s.slice(Math.max(0, i - 4), i))
  }
  let out = ''
  for (let g = 0; g < groups.length; g++) {
    const part = Number(groups[g])
    if (part === 0) continue
    out += groupPart(part) + BIG_UNITS[groups.length - 1 - g]
  }
  return out.replace(/零+/g, '零').replace(/零$/, '')
}

export function chineseAmountUpper(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '零元整'
  const negative = amount < 0
  const value = Math.abs(amount)
  const yuan = Math.floor(value)
  const jiao = Math.round((value - yuan) * 10)
  const fen = Math.round((value - yuan) * 100) % 10

  let out = negative ? '负' : ''
  if (yuan > 0) out += `${integerPart(yuan)}元`
  else out += '零元'

  if (jiao === 0 && fen === 0) out += '整'
  else {
    if (jiao > 0) out += `${DIGITS[jiao]}角`
    if (fen > 0) out += `${DIGITS[fen]}分`
    else if (jiao > 0) out += '整'
  }
  return out
}
