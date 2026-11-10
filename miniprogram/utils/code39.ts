/** Code39 窄宽条。商品货号用得到的字符；含中文或其它符号时返回空，不画假条码。 */
const CODE39: Record<string, string> = {
  '*': 'nwnnwnwnn',
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
}

/** true 为黑条。字符之间夹一条窄空。 */
export function code39Modules(raw: string): boolean[] | null {
  const text = String(raw || '').trim().toUpperCase()
  if (!text || text.length > 24) return null
  const chars = ['*', ...text.split(''), '*']
  const mods: boolean[] = []
  for (let i = 0; i < chars.length; i++) {
    const pattern = CODE39[chars[i]]
    if (!pattern) return null
    let bar = true
    for (let k = 0; k < pattern.length; k++) {
      const width = pattern[k] === 'w' ? 3 : 1
      for (let n = 0; n < width; n++) mods.push(bar)
      bar = !bar
    }
    if (i < chars.length - 1) mods.push(false)
  }
  return mods
}
