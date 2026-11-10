import { pclFromRgba } from '../utils/page-pcl'

/**
 * 同一 Wi-Fi 下的打印机。热敏机走 9100 指令，激光机发现走 631，打印改发 9100 的一页 PCL。
 * 只连 10 / 172.16-31 / 192.168，不走公网。
 * 微信每 5 分钟最多新建 20 个 TCPSocket，禁止连接 1024 以下端口。
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/api/network/tcp/wx.createTCPSocket.html
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/mDNS.html
 */

const HOSTS_KEY = 'tuk_lan_hosts'
const RAW_PORT = 9100
const PAGE_PORT = 631
const SCAN_HOSTS = 6

type TcpSocket = {
  connect: (options: { address: string; port: number; timeout?: number }) => void
  write: (data: string | ArrayBuffer) => void
  close: () => void
  onConnect: (cb: () => void) => void
  onError: (cb: (err: { errMsg?: string; errCode?: number }) => void) => void
  onClose: (cb: () => void) => void
  onMessage?: (cb: (res: { message: ArrayBuffer }) => void) => void
  bindWifi?: (options: { BSSID: string }) => void
  onBindWifi?: (cb: () => void) => void
  offError?: (cb: (err: { errMsg?: string }) => void) => void
}

let socket: TcpSocket | null = null
let liveHost = ''
let livePort = RAW_PORT

export type LanFoundPrinter = {
  host: string
  port: number
  name: string
}

export function lanEndpointFromId(id?: string | null): { host: string; port: number } | null {
  if (!isLanPrinterId(id)) return null
  const rest = String(id).slice(4).trim()
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(rest)
  if (!m || !isRfc1918(m[1])) return null
  const port = m[2] ? Number(m[2]) : RAW_PORT
  if (port !== RAW_PORT && port !== PAGE_PORT) return null
  return { host: m[1], port }
}

export function isRfc1918(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || '').trim())
  if (!m) return false
  const p = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false
  if (p[0] === 10) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  return false
}

export function isLanPrinterId(id?: string | null): boolean {
  return !!id && id.indexOf('tcp:') === 0
}

export function lanHostFromId(id?: string | null): string | null {
  return lanEndpointFromId(id)?.host || null
}

export function lanPrinterId(host: string, port = RAW_PORT): string {
  const ip = host.trim()
  return port === RAW_PORT ? `tcp:${ip}` : `tcp:${ip}:${port}`
}

export function isLanAlive(host?: string): boolean {
  if (!liveHost) return false
  if (host && host !== liveHost) return false
  if (livePort === PAGE_PORT) return true
  return !!socket
}

export function listLanHosts(): string[] {
  try {
    const raw = wx.getStorageSync(HOSTS_KEY)
    const list = Array.isArray(raw) ? raw : []
    return list.map((item) => String(item || '').trim()).filter(isRfc1918)
  } catch (_) {
    return []
  }
}

export function rememberLanHost(host: string) {
  const ip = host.trim()
  if (!isRfc1918(ip)) return
  const cur = listLanHosts().filter((item) => item !== ip)
  cur.unshift(ip)
  try {
    wx.setStorageSync(HOSTS_KEY, cur.slice(0, 8))
  } catch (_) {}
}

function createSocket(): TcpSocket {
  const api = wx as unknown as { createTCPSocket?: () => TcpSocket }
  if (typeof api.createTCPSocket !== 'function') {
    throw new Error('当前微信版本不支持局域网打印，请升级微信')
  }
  const tcp = api.createTCPSocket()
  if (!tcp || typeof tcp.onConnect !== 'function') {
    throw new Error('当前微信打不开局域网连接，请升级微信后重试')
  }
  return tcp
}

function needBindWifi(): boolean {
  try {
    const platform = String(wx.getSystemInfoSync().platform || '')
    return platform === 'android' || platform === 'ohos' || platform === 'harmony'
  } catch (_) {
    return false
  }
}

let bssidCache = ''
let bssidAt = 0

/** 安卓开着流量时，TCP 会走移动网络。先拿到当前 Wi-Fi 的 BSSID 再绑定。 */
function ensureBssid(): Promise<string> {
  if (bssidCache && Date.now() - bssidAt < 60000) return Promise.resolve(bssidCache)
  if (!needBindWifi()) return Promise.resolve('')
  return new Promise((resolve) => {
    const w = wx as unknown as {
      startWifi?: (opts: { complete?: () => void }) => void
      getConnectedWifi?: (opts: {
        partialInfo?: boolean
        success?: (res: { wifi?: { BSSID?: string } }) => void
        fail?: () => void
      }) => void
    }
    const finish = (value: string) => {
      if (value) {
        bssidCache = value
        bssidAt = Date.now()
      }
      resolve(value)
    }
    if (typeof w.startWifi !== 'function' || typeof w.getConnectedWifi !== 'function') {
      finish('')
      return
    }
    w.startWifi({
      complete: () => {
        w.getConnectedWifi?.({
          partialInfo: true,
          success: (res) => finish(String(res?.wifi?.BSSID || '')),
          fail: () => finish(''),
        })
      },
    })
  })
}

function explainConnectFail(err: { errMsg?: string } | undefined, bssid: string): Error {
  const raw = String(err?.errMsg || '')
  if (/timeout|time out|timed out/i.test(raw)) {
    if (needBindWifi() && !bssid) {
      return new Error('连接超时。请打开手机定位，或先关掉流量，再连接同一 Wi-Fi 下的打印机')
    }
    return new Error('连接超时。请确认打印机已开机，并和手机连着同一个 Wi-Fi')
  }
  return new Error('连接失败')
}

function armConnect(
  tcp: TcpSocket,
  host: string,
  port: number,
  timeoutSec: number,
  bssid: string,
  onStart?: () => void,
  onFail?: (err: unknown) => void,
) {
  let started = false
  const go = () => {
    if (started) return
    started = true
    if (onStart) onStart()
    try {
      tcp.connect({ address: host, port, timeout: timeoutSec })
    } catch (e) {
      if (onFail) onFail(e)
    }
  }
  // 安卓必须等 onBindWifi 后再 connect。提前连会走手机流量，局域网地址一直超时。
  // 文档：https://developers.weixin.qq.com/miniprogram/dev/api/network/tcp/TCPSocket.bindWifi.html
  if (!bssid || typeof tcp.bindWifi !== 'function' || typeof tcp.onBindWifi !== 'function') {
    go()
    return
  }
  let bound = false
  try {
    tcp.onBindWifi(() => {
      bound = true
      go()
    })
    tcp.bindWifi({ BSSID: bssid })
    setTimeout(() => {
      if (!bound) go()
    }, 1500)
  } catch (_) {
    go()
  }
}

export function closeLan() {
  const current = socket
  socket = null
  liveHost = ''
  livePort = RAW_PORT
  if (!current) return
  try {
    current.close()
  } catch (_) {}
}

export function connectLan(host: string, port = RAW_PORT): Promise<void> {
  const ip = host.trim()
  if (!isRfc1918(ip)) {
    return Promise.reject(new Error('仅支持局域网地址（192.168 / 10 / 172.16-31）'))
  }
  if (isLanAlive(ip)) return Promise.resolve()
  closeLan()
  return ensureBssid().then(
    (bssid) =>
      new Promise<void>((resolve, reject) => {
    let tcp: TcpSocket
    try {
      tcp = createSocket()
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法创建局域网连接'))
      return
    }
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) {
        bssidCache = ''
        bssidAt = 0
        try {
          tcp.close()
        } catch (_) {}
        if (socket === tcp) {
          socket = null
          liveHost = ''
        }
        reject(err)
        return
      }
      if (port === PAGE_PORT) {
        try {
          tcp.close()
        } catch (_) {}
        socket = null
      } else {
        socket = tcp
      }
      liveHost = ip
      livePort = port
      resolve()
    }
    let linking = false
    tcp.onConnect(() => finish())
    tcp.onError((err) => {
      if (!linking) return
      finish(explainConnectFail(err, bssid))
    })
    tcp.onClose(() => {
      if (socket === tcp) {
        socket = null
        liveHost = ''
      }
      if (!settled && linking) finish(new Error('打印机无响应'))
    })
    try {
      armConnect(
        tcp,
        ip,
        port,
        8,
        bssid,
        () => {
          linking = true
        },
        () => finish(new Error('连接失败')),
      )
    } catch (e) {
      finish(e instanceof Error ? e : new Error('连接失败'))
    }
      }),
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function writeLan(data: Uint8Array): Promise<void> {
  if (livePort === PAGE_PORT) throw new Error('这台激光打印机请从票据预览打印')
  const current = socket
  if (!current || !liveHost) throw new Error('局域网打印机未连接')
  const size = 8192
  for (let i = 0; i < data.byteLength; i += size) {
    if (!socket) throw new Error('局域网连接已断开')
    const part = data.subarray(i, Math.min(i + size, data.byteLength))
    const copy = new Uint8Array(part.byteLength)
    copy.set(part)
    current.write(copy.buffer)
    if (i + size < data.byteLength) await sleep(20)
  }
}

function localIp(): Promise<string> {
  return new Promise((resolve, reject) => {
    const api = wx as unknown as {
      getLocalIPAddress?: (opts: {
        success?: (res: { localip?: string }) => void
        fail?: (err: { errMsg?: string }) => void
      }) => void
    }
    if (typeof api.getLocalIPAddress !== 'function') {
      reject(new Error('请升级微信后再扫描'))
      return
    }
    api.getLocalIPAddress({
      success: (res) => resolve(String(res?.localip || '').trim()),
      fail: (err) => reject(new Error(err?.errMsg || '读不到本机 IP，请确认已连接 Wi-Fi')),
    })
  })
}

type UdpSocket = {
  bind: (port?: number) => number
  send: (opts: { address: string; port: number; message: string | ArrayBuffer; setBroadcast?: boolean }) => void
  close: () => void
  onMessage: (cb: (res: { message: ArrayBuffer; remoteInfo?: { address?: string } }) => void) => void
}

function bytesToText(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return s
}

type UdpHit = { host: string; name: string }

function snmpName(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf)
  let best = ''
  let cur = ''
  for (let i = 0; i < u.length; i++) {
    const c = u[i]
    if (c >= 32 && c <= 126) cur += String.fromCharCode(c)
    else {
      if (cur.length > best.length) best = cur
      cur = ''
    }
  }
  if (cur.length > best.length) best = cur
  const name = best.trim()
  if (name.length < 4 || name.toLowerCase() === 'public') return ''
  return name.slice(0, 32)
}

/** 热敏模块用 48899，激光机用 SNMP 161。都不占 TCP 连接次数。 */
function udpDiscover(prefix: string, self: string): Promise<UdpHit[]> {
  return new Promise((resolve) => {
    const api = wx as unknown as { createUDPSocket?: () => UdpSocket }
    if (typeof api.createUDPSocket !== 'function') {
      resolve([])
      return
    }
    let udp: UdpSocket
    try {
      udp = api.createUDPSocket()
      if (!udp || typeof udp.bind !== 'function') {
        resolve([])
        return
      }
      udp.bind()
    } catch (_) {
      resolve([])
      return
    }
    const found = new Map<string, string>()
    const note = (host: string, name: string) => {
      if (!isRfc1918(host) || host === self) return
      const prev = found.get(host) || ''
      if (name.length > prev.length) found.set(host, name)
      else if (!found.has(host)) found.set(host, prev)
    }
    const snmp = new Uint8Array([
      0x30, 0x29, 0x02, 0x01, 0x00, 0x04, 0x06, 0x70, 0x75, 0x62, 0x6c, 0x69, 0x63, 0xa0, 0x1c, 0x02, 0x04,
      0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0e, 0x30, 0x0c, 0x06, 0x08, 0x2b,
      0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00, 0x05, 0x00,
    ]).buffer
    udp.onMessage((res) => {
      const remote = String(res?.remoteInfo?.address || '').trim()
      const raw = res?.message
      const head = raw ? new Uint8Array(raw)[0] : 0
      if (head === 0x30) {
        note(remote, raw ? snmpName(raw) : '')
        return
      }
      let text = ''
      try {
        text = raw ? bytesToText(raw) : ''
      } catch (_) {}
      const trusted = /HF/i.test(text) || text.indexOf(',') >= 0
      if (!trusted) return
      note(remote, '')
      const ips = text.match(/\d{1,3}(?:\.\d{1,3}){3}/g) || []
      ips.forEach((hit) => note(hit, ''))
    })
    const thermal = 'HF-A11ASSISTHREAD'
    const send = (address: string, port: number, message: string | ArrayBuffer, broadcast = false) => {
      try {
        udp.send({ address, port, message, setBroadcast: broadcast })
      } catch (_) {}
    }
    send('255.255.255.255', 48899, thermal, true)
    send(`${prefix}.255`, 48899, thermal, true)
    send('255.255.255.255', 161, snmp, true)
    send(`${prefix}.255`, 161, snmp, true)
    let n = 1
    const timer = setInterval(() => {
      for (let k = 0; k < 30 && n <= 254; k++, n++) {
        const host = `${prefix}.${n}`
        if (host === self) continue
        send(host, 48899, thermal)
        send(host, 161, snmp)
      }
      if (n > 254) clearInterval(timer)
    }, 40)
    setTimeout(() => {
      clearInterval(timer)
      try {
        udp.close()
      } catch (_) {}
      resolve(Array.from(found.entries()).map(([host, name]) => ({ host, name })))
    }, 2800)
  })
}

type MdnsHit = { host: string; port: number; name: string }

function stopMdns(): Promise<void> {
  return new Promise((resolve) => {
    const api = wx as unknown as {
      stopLocalServiceDiscovery?: (opts: { complete?: () => void }) => void
    }
    if (typeof api.stopLocalServiceDiscovery !== 'function') {
      resolve()
      return
    }
    api.stopLocalServiceDiscovery({ complete: () => resolve() })
  })
}

/** 安卓和鸿蒙可搜 mDNS。iOS 微信 7.0.18 起这个接口不可用，失败就交给 SNMP。 */
function mdnsOnce(serviceType: string): Promise<MdnsHit[] | null> {
  return new Promise((resolve) => {
    const api = wx as unknown as {
      startLocalServiceDiscovery?: (opts: {
        serviceType: string
        success?: () => void
        fail?: () => void
      }) => void
      onLocalServiceFound?: (cb: (res: { ip?: string; port?: number; serviceName?: string }) => void) => void
      offLocalServiceFound?: (cb: (res: { ip?: string; port?: number; serviceName?: string }) => void) => void
    }
    if (typeof api.startLocalServiceDiscovery !== 'function') {
      resolve(null)
      return
    }
    const found: MdnsHit[] = []
    const onFound = (res: { ip?: string; port?: number; serviceName?: string }) => {
      const host = String(res?.ip || '').trim()
      if (!isRfc1918(host)) return
      found.push({
        host,
        port: Number(res?.port || 0) || 0,
        name: String(res?.serviceName || '').trim(),
      })
    }
    if (typeof api.onLocalServiceFound === 'function') api.onLocalServiceFound(onFound)
    let done = false
    const finish = (failed: boolean) => {
      if (done) return
      done = true
      try {
        api.offLocalServiceFound?.(onFound)
      } catch (_) {}
      void stopMdns().then(() => resolve(failed ? null : found))
    }
    api.startLocalServiceDiscovery({
      serviceType,
      fail: () => finish(true),
    })
    setTimeout(() => finish(false), 1400)
  })
}

async function mdnsDiscover(): Promise<MdnsHit[]> {
  const types = ['_ipp._tcp.', '_pdl-datastream._tcp.', '_printer._tcp.']
  const all: MdnsHit[] = []
  for (let i = 0; i < types.length; i++) {
    const batch = await mdnsOnce(types[i])
    if (batch === null) break
    all.push(...batch)
  }
  return all
}

function probe(host: string, port: number, bssid: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let tcp: TcpSocket
    try {
      tcp = createSocket()
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法创建局域网连接'))
      return
    }
    let settled = false
    let linking = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      try {
        tcp.close()
      } catch (_) {}
      resolve(ok)
    }
    try {
      tcp.onConnect(() => done(true))
      tcp.onError(() => {
        if (linking) done(false)
      })
      tcp.onClose(() => {
        if (linking) done(false)
      })
      armConnect(
        tcp,
        host,
        port,
        2,
        bssid,
        () => {
          linking = true
        },
        () => done(false),
      )
      setTimeout(() => done(false), 5000)
    } catch (_) {
      done(false)
    }
  })
}

function hostOrder(self: number): number[] {
  const order: number[] = []
  const push = (n: number) => {
    if (n < 1 || n > 254 || n === self || order.indexOf(n) >= 0) return
    order.push(n)
  }
  listLanHosts().forEach((host) => push(Number(host.split('.')[3])))
  push(1)
  for (let d = 1; d <= 4; d++) {
    push(self - d)
    push(self + d)
  }
  ;[100, 101, 102, 103, 104, 108, 88, 200, 254, 2, 10, 20, 50, 110, 150, 168].forEach(push)
  return order.slice(0, SCAN_HOSTS)
}

function printerRank(name: string): number {
  if (/print|laser|ipp|lenovo|hp|canon|epson|brother|lexmark|联想|至像|志像|激光|打印机/i.test(name)) return 2
  return name ? 1 : 0
}

function printerLabel(name: string, port: number): string {
  const text = name.trim()
  if (text) return text
  return port === PAGE_PORT ? '网络打印机' : '网口打印机'
}

async function confirmPrinter(
  host: string,
  name: string,
  bssid: string,
): Promise<LanFoundPrinter | null> {
  if (await probe(host, PAGE_PORT, bssid)) {
    return { host, port: PAGE_PORT, name: printerLabel(name, PAGE_PORT) }
  }
  if (await probe(host, RAW_PORT, bssid)) {
    return { host, port: RAW_PORT, name: printerLabel(name, RAW_PORT) }
  }
  return null
}

/** 先用 mDNS 和 SNMP 找激光机、热敏机，再确认 631 或 9100。微信每次最多新建 20 个 TCP 连接。 */
export async function scanLan(): Promise<LanFoundPrinter[]> {
  const ip = await localIp()
  if (!isRfc1918(ip)) throw new Error('请把手机连上打印机所在的 Wi-Fi')
  const parts = ip.split('.')
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
  const selfN = Number(parts[3])
  const bssid = await ensureBssid()
  const named = new Map<string, string>()
  const remember = (host: string, name: string) => {
    if (!isRfc1918(host) || host === ip) return
    const prev = named.get(host) || ''
    if (name.length > prev.length) named.set(host, name)
    else if (!named.has(host)) named.set(host, prev)
  }
  const [udpHits, mdnsHits] = await Promise.all([
    udpDiscover(prefix, ip),
    mdnsDiscover(),
  ])
  udpHits.forEach((hit) => remember(hit.host, hit.name))
  mdnsHits.forEach((hit) => remember(hit.host, hit.name))
  const targets = named.size
    ? Array.from(named.entries())
        .sort((a, b) => printerRank(b[1]) - printerRank(a[1]))
        .map((item) => item[0])
        .slice(0, 8)
    : hostOrder(selfN).map((n) => `${prefix}.${n}`)
  const found: LanFoundPrinter[] = []
  await Promise.all(
    targets.map(async (host) => {
      const hit = await confirmPrinter(host, named.get(host) || '', bssid)
      if (hit) found.push(hit)
    }),
  )
  found.forEach((item) => rememberLanHost(item.host))
  return found
}

function utf8Bytes(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

function ippAttr(tag: number, name: string, value: string): number[] {
  const nb = utf8Bytes(name)
  const vb = utf8Bytes(value)
  return [tag, (nb.length >> 8) & 255, nb.length & 255, ...nb, (vb.length >> 8) & 255, vb.length & 255, ...vb]
}

function ippInt(tag: number, name: string, value: number): number[] {
  const nb = utf8Bytes(name)
  return [
    tag,
    (nb.length >> 8) & 255,
    nb.length & 255,
    ...nb,
    0x00,
    0x04,
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (let i = 0; i < parts.length; i++) n += parts[i].length
  const out = new Uint8Array(n)
  let o = 0
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], o)
    o += parts[i].length
  }
  return out
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255
  return out
}

function indexOfBytes(buf: Uint8Array, needle: number[]): number {
  for (let i = 0; i + needle.length <= buf.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

function ippStatus(body: Uint8Array): number {
  if (body.length < 4 || body[0] !== 1) return -1
  return (body[2] << 8) | body[3]
}

function ippHead(op: number, attrs: number[]): Uint8Array {
  return new Uint8Array([0x01, 0x01, (op >> 8) & 255, op & 255, 0x00, 0x00, 0x00, 0x01, ...attrs, 0x03])
}

function operationAttrs(printerUri: string, extra: number[] = []): number[] {
  return [
    0x01,
    ...ippAttr(0x47, 'attributes-charset', 'utf-8'),
    ...ippAttr(0x48, 'attributes-natural-language', 'zh-cn'),
    ...ippAttr(0x42, 'requesting-user-name', 'tukorder'),
    ...ippAttr(0x45, 'printer-uri', printerUri),
    ...extra,
  ]
}

/** 直接写 631 端口，避免请求层把页面数据改坏。查属性不会出纸。 */
function tcpIpp(host: string, path: string, body: Uint8Array, bssid: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let tcp: TcpSocket
    try {
      tcp = createSocket()
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法创建局域网连接'))
      return
    }
    const chunks: Uint8Array[] = []
    let settled = false
    const finish = (err?: Error, payload?: Uint8Array) => {
      if (settled) return
      settled = true
      try {
        tcp.close()
      } catch (_) {}
      if (err) reject(err)
      else resolve(payload || new Uint8Array(0))
    }
    if (typeof tcp.onMessage === 'function') {
      tcp.onMessage((res) => {
        if (res?.message) chunks.push(new Uint8Array(res.message))
      })
    }
    let writing = true
    tcp.onError((err) => finish(new Error(err?.errMsg || '激光打印机无响应')))
    tcp.onClose(() => {
      if (!writing) finish(undefined, concatBytes(chunks))
    })
    tcp.onConnect(() => {
      void (async () => {
        try {
          const head = asciiBytes(
            `POST ${path} HTTP/1.1\r\nHost: ${host}:${PAGE_PORT}\r\nContent-Type: application/ipp\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
          )
          const packet = concatBytes([head, body])
          const size = 8192
          for (let i = 0; i < packet.length; i += size) {
            const part = packet.subarray(i, Math.min(i + size, packet.length))
            const copy = new Uint8Array(part.length)
            copy.set(part)
            tcp.write(copy.buffer)
            if (i + size < packet.length) await sleep(12)
          }
          writing = false
          setTimeout(() => finish(undefined, concatBytes(chunks)), 6000)
        } catch (e) {
          writing = false
          finish(e instanceof Error ? e : new Error('发送打印页失败'))
        }
      })()
    })
    try {
      armConnect(tcp, host, PAGE_PORT, 4, bssid, () => {}, (e) =>
        finish(e instanceof Error ? e : new Error('激光打印机无响应')),
      )
    } catch (e) {
      finish(e instanceof Error ? e : new Error('激光打印机无响应'))
    }
    setTimeout(() => {
      writing = false
      finish(undefined, concatBytes(chunks))
    }, 25000)
  })
}

function httpIppBody(raw: Uint8Array): { http: number; ipp: Uint8Array } {
  const split = indexOfBytes(raw, [13, 10, 13, 10])
  if (split < 0) return { http: 0, ipp: raw }
  let status = 0
  const header = String.fromCharCode.apply(null, Array.from(raw.subarray(0, Math.min(split, 180))))
  const m = /HTTP\/\d\.\d\s+(\d+)/.exec(header)
  if (m) status = Number(m[1])
  return { http: status, ipp: raw.subarray(split + 4) }
}

/** 把预览转成一页 PCL，只发到 9100。不再向 631 塞图片，那种格式会连吐空白纸。 */
function sendRawPage(host: string, body: Uint8Array, bssid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let tcp: TcpSocket
    try {
      tcp = createSocket()
    } catch (e) {
      reject(e instanceof Error ? e : new Error('无法创建局域网连接'))
      return
    }
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      try {
        tcp.close()
      } catch (_) {}
      if (err) reject(err)
      else resolve()
    }
    tcp.onError((err) => finish(explainConnectFail(err, bssid)))
    tcp.onConnect(() => {
      void (async () => {
        try {
          const size = 8192
          for (let i = 0; i < body.length; i += size) {
            const part = body.subarray(i, Math.min(i + size, body.length))
            const copy = new Uint8Array(part.length)
            copy.set(part)
            tcp.write(copy.buffer)
            if (i + size < body.length) await sleep(8)
          }
          await sleep(300)
          finish()
        } catch (e) {
          finish(e instanceof Error ? e : new Error('发送打印页失败'))
        }
      })()
    })
    try {
      armConnect(tcp, host, RAW_PORT, 6, bssid, () => {}, (e) =>
        finish(e instanceof Error ? e : new Error('页面口没有打开，已取消，没有出纸')),
      )
    } catch (e) {
      finish(e instanceof Error ? e : new Error('页面口没有打开，已取消，没有出纸'))
    }
    setTimeout(() => finish(new Error('发送超时，已停止，避免继续出纸')), 20000)
  })
}

/** 激光机只打一页，内容就是当前模板预览。 */
export async function printLanPage(
  host: string,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<void> {
  const ip = host.trim()
  if (!isRfc1918(ip)) throw new Error('仅支持局域网地址（192.168 / 10 / 172.16-31）')
  if (!rgba || width < 2 || height < 2 || rgba.length < width * height * 4) {
    throw new Error('预览图没有生成')
  }
  const page = pclFromRgba(rgba, width, height)
  const bssid = await ensureBssid()
  await sendRawPage(ip, page, bssid)
}
