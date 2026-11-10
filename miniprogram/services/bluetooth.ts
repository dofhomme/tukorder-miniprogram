/**
 * 手机 BLE 蓝牙热敏打印（与 App 同原理：连打印机 → 写 ESC/POS+GBK 字节流）
 *
 * 说明：微信小程序只开放 BLE，不开放经典蓝牙 SPP。
 * 多数便携热敏机同时带 BLE 口；若打印机仅有经典蓝牙，请用 App 或换双模机。
 */
import { buildReceiptEscPos, prepareGbk } from './escpos'
import { loadPrintTemplate } from './print-template'
import { receiptShopTitle } from './receipt-layout'
import { isGuest, isLoggedIn } from './session'
import {
  closeLan,
  connectLan,
  isLanAlive,
  isLanPrinterId,
  lanEndpointFromId,
  lanHostFromId,
  lanPrinterId,
  rememberLanHost,
  writeLan,
} from './lan-printer'
import { enqueuePrint, kernelWriteEscPos } from './print-kernel'
import { currentPrintPolicy, ensurePrintPolicy } from './print-runtime-policy'
import { BLE_PRINTER_SERVICE_UUIDS } from './thermal-device-profiles'
import {
  isPaperWidthMm,
  normalizePaperWidthMm,
  type PaperWidthMm,
} from './thermal-paper'
import type { CartItem, ShopInfo } from './team'

const STORAGE_KEY = 'tuk_ble_printer'
/** 安卓协商 MTU 后可用较大包；iOS 微信不支持 setBLEMTU，须按实际 MTU 切小包 */
const ANDROID_CHUNK = 1024
/** 小程序苹果 BLE：后台 150–250。微信不能 setBLEMTU，上限 250 */
const IOS_SAFE_CHUNK = 250

export type BlePrinterDevice = {
  deviceId: string
  name: string
  serviceId?: string
  characteristicId?: string
  paperWidthMm?: number
}

type WriteTarget = {
  serviceId: string
  characteristicId: string
  canWrite: boolean
  canWriteNr: boolean
}

type Connected = BlePrinterDevice & {
  connected: true
  writeChunkSize?: number
  preferWriteResponse?: boolean
  writeTargets?: WriteTarget[]
  writeType?: 'write' | 'writeNoResponse'
  /** 部分安卓/华为微信不认 writeType 字段，带上就 fail */
  omitWriteType?: boolean
}

let _connected: Connected | null = null
let _discovering = false
let _stateWatchBound = false
let _autoReconnectJob: Promise<{ connected: boolean; name: string }> | null = null
let _deviceFoundHandler:
  | ((res: WechatMiniprogram.OnBluetoothDeviceFoundCallbackResult) => void)
  | null = null
let _onDeviceFoundCb:
  | ((d: { deviceId: string; name: string; RSSI?: number }) => void)
  | null = null
let _iosCached: boolean | null = null

function clearDeviceFoundListener() {
  if (!_deviceFoundHandler) return
  try {
    wx.offBluetoothDeviceFound(_deviceFoundHandler)
  } catch (_) {
    /* ignore */
  }
  _deviceFoundHandler = null
  _onDeviceFoundCb = null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 微信 BLE 一包上限约 MTU-3；getBLEMTU 常误报 23，不能据此裁成 20。 */
const ANDROID_FALLBACK_CHUNK = 244
/** 本次连接协商到的 MTU；0 表示没协商到，按通道分包发，写失败再降 */
let _androidMtuLimit = 0
/** 某个分包值写失败后，只在「还是这个分包值」时沿用降速，改通道后重新按新值发 */
let _androidLimitedTo = 0
let _androidLimitedForChunk = 0

function androidWantedChunk(): number {
  try {
    const n = Number(currentPrintPolicy().channels.mpAndroidBle?.chunkBytes)
    if (Number.isFinite(n) && n >= 20) return Math.min(ANDROID_CHUNK, Math.round(n))
  } catch (_) {}
  return 150
}

/** 间隔用打印通道里的「小程序 Android BLE」，范围 0–3ms */
function androidPacketGapMs(): number {
  try {
    const v = Number(currentPrintPolicy().channels.mpAndroidBle?.intervalMs)
    if (Number.isFinite(v) && v >= 0) return Math.max(0, Math.min(3, Math.round(v)))
  } catch (_) {}
  return 0
}

function androidWriteCap(): number {
  const want = androidWantedChunk()
  if (_androidLimitedTo > 0 && _androidLimitedForChunk === want) {
    return Math.max(20, Math.min(want, _androidLimitedTo))
  }
  return want
}

function shrinkAndroidChunk(cur: number): number {
  _androidLimitedForChunk = androidWantedChunk()
  if (cur > 244) _androidLimitedTo = 244
  else if (cur > 180) _androidLimitedTo = 180
  else _androidLimitedTo = 20
  return _androidLimitedTo
}

function isBleSizeError(err: unknown) {
  const msg = String((err as any)?.message || (err as any)?.errMsg || err || '')
  return /mtu|length|size|超过|too long|invalid data|limit|最大|10008/i.test(msg)
}

async function negotiateAndroidWriteSize(deviceId: string): Promise<number> {
  const want = androidWantedChunk()
  let mtu = 0
  await new Promise<void>((resolve) => {
    wx.setBLEMTU({
      deviceId,
      mtu: 512,
      success: (res: any) => {
        const n = Number(res && res.mtu) || 0
        if (n > mtu) mtu = n
      },
      complete: (res: any) => {
        const n = Number(res && res.mtu) || 0
        if (n > mtu) mtu = n
        resolve()
      },
    } as any)
  })
  if (mtu < 50) {
    await sleep(60)
    await new Promise<void>((resolve) => {
      try {
        wx.getBLEMTU({
          deviceId,
          success: (res: any) => {
            const n = Number(res && res.mtu) || 0
            // 微信常误报 23，只有明显协商成功才信，绝不因此裁成 20
            if (n >= 50) mtu = n
            resolve()
          },
          fail: () => resolve(),
        } as any)
      } catch (_) {
        resolve()
      }
    })
  }
  if (mtu >= 50) {
    _androidMtuLimit = mtu
    _androidLimitedTo = 0
    _androidLimitedForChunk = 0
    return Math.max(20, Math.min(want, ANDROID_CHUNK, mtu - 3))
  }
  // 协商不到就按打印通道的分包发，超长写入时再降
  _androidMtuLimit = 0
  _androidLimitedTo = 0
  _androidLimitedForChunk = 0
  return want
}

/** 每次开打前拉最新通道，避免 20 秒缓存把刚保存的分包、间隔挡住。 */
async function refreshAndroidPrintPace(): Promise<void> {
  await ensurePrintPolicy(true)
  const want = androidWantedChunk()
  if (_androidLimitedForChunk !== want) {
    _androidLimitedTo = 0
    _androidLimitedForChunk = 0
  }
}

function isIosPlatform(): boolean {
  if (_iosCached != null) return _iosCached
  try {
    _iosCached = String(wx.getSystemInfoSync().platform || '').toLowerCase() === 'ios'
  } catch (_) {
    _iosCached = false
  }
  return _iosCached
}

/** iOS 微信对 subarray 的 buffer.slice 会写错长度，必须拷成独立 ArrayBuffer */
function toWriteBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength)
  copy.set(chunk)
  return copy.buffer
}

export function getSavedPrinter(): BlePrinterDevice | null {
  try {
    const v = wx.getStorageSync(STORAGE_KEY) as BlePrinterDevice
    if (v && v.deviceId) return v
  } catch (_) {}
  return null
}

export function savePrinter(dev: BlePrinterDevice) {
  wx.setStorageSync(STORAGE_KEY, {
    deviceId: dev.deviceId,
    name: dev.name || '蓝牙打印机',
    serviceId: dev.serviceId,
    characteristicId: dev.characteristicId,
    paperWidthMm: normalizePaperWidthMm(dev.paperWidthMm),
  })
}

export function clearSavedPrinter() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (_) {}
  _connected = null
}

export function getPaperWidthMm(): PaperWidthMm {
  const s = getSavedPrinter()
  const mm = s?.paperWidthMm
  return normalizePaperWidthMm(mm)
}

export function setPaperWidthMm(mm: PaperWidthMm) {
  const s = getSavedPrinter()
  if (s) {
    savePrinter({ ...s, paperWidthMm: mm })
  } else {
    // 尚未绑定也记住纸宽，连接后沿用
    try {
      wx.setStorageSync(STORAGE_KEY + '_paper', mm)
    } catch (_) {}
  }
  if (_connected) _connected.paperWidthMm = mm
}

export function peekPendingPaperWidth(): PaperWidthMm | null {
  try {
    const v = wx.getStorageSync(STORAGE_KEY + '_paper')
    if (isPaperWidthMm(v)) return v
  } catch (_) {}
  return null
}

export function isBleConnected(): boolean {
  return !!_connected?.connected
}

function bindConnectionWatch() {
  if (_stateWatchBound) return
  _stateWatchBound = true
  wx.onBLEConnectionStateChange((res) => {
    if (!res.connected && _connected && res.deviceId === _connected.deviceId) {
      _connected = null
    }
  })
}

function closeBleLink(deviceId: string): Promise<void> {
  return new Promise((resolve) => {
    wx.closeBLEConnection({
      deviceId,
      complete: () => resolve(),
    })
  })
}

function getLiveConnectionState(deviceId: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    try {
      wx.getBLEDeviceConnectionState({
        deviceId,
        success: (res) => resolve(!!(res as { connected?: boolean }).connected),
        fail: () => resolve(null),
      } as any)
    } catch (_) {
      resolve(null)
    }
  })
}

function listWechatConnected(): Promise<Array<{ deviceId: string; name?: string }>> {
  return new Promise((resolve) => {
    wx.getConnectedBluetoothDevices({
      services: BLE_PRINTER_SERVICE_UUIDS,
      success: (res) => resolve((res.devices || []) as Array<{ deviceId: string; name?: string }>),
      fail: () => resolve([]),
    })
  })
}

async function isDeviceLinked(deviceId: string, name?: string): Promise<boolean | null> {
  const state = await getLiveConnectionState(deviceId)
  if (state === true) return true
  const list = await listWechatConnected()
  if (list.some((d) => d.deviceId === deviceId || isSamePrinterName(d.name, name))) {
    return true
  }
  if (state === false) return false
  return null
}

/** 微信已连上，或本页会话还在，都算已连接（华为 getBLEDeviceConnectionState 经常误报未连接） */
export async function isBleLiveConnected(): Promise<boolean> {
  const saved = getSavedPrinter()
  const id = _connected?.deviceId || saved?.deviceId
  if (isLanPrinterId(id)) return isLanAlive(lanHostFromId(id) || '')
  if (!id) return false
  if (_connected?.connected && _connected.deviceId === id) {
    const linked = await isDeviceLinked(id, _connected.name || saved?.name)
    if (linked === false) return false
    return true
  }
  return (await isDeviceLinked(id, saved?.name)) === true
}

export function currentPrinter(): BlePrinterDevice | null {
  return _connected || getSavedPrinter()
}

function ensureBluetoothAuth(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (s) => {
        const granted = (s.authSetting as Record<string, boolean | undefined>)['scope.bluetooth']
        if (granted === true) {
          resolve({ ok: true })
          return
        }
        if (granted === false) {
          resolve({
            ok: false,
            error: isIosPlatform()
              ? '请到 设置→微信→蓝牙 允许使用，且不要在系统蓝牙里配对打印机'
              : '请到微信设置允许使用蓝牙',
          })
          return
        }
        // scope.bluetooth 不能写进 app.json permission；authorize 失败也不挡，交给 openBluetoothAdapter
        wx.authorize({
          scope: 'scope.bluetooth' as any,
          success: () => resolve({ ok: true }),
          fail: () => resolve({ ok: true }),
        })
      },
      fail: () => resolve({ ok: true }),
    })
  })
}

export async function openAdapter(): Promise<{ ok: boolean; error?: string }> {
  const auth = await ensureBluetoothAuth()
  if (!auth.ok) return auth
  return new Promise((resolve) => {
    wx.openBluetoothAdapter({
      success: () => resolve({ ok: true }),
      fail: (e) => {
        const msg = String((e && (e as any).errMsg) || e || '')
        const code = Number((e as any)?.errCode || 0)
        if (/already opened/i.test(msg) || /已打开/.test(msg)) {
          resolve({ ok: true })
          return
        }
        if (code === 10001 || /not available|not enabled|未打开|unavailable/i.test(msg)) {
          resolve({ ok: false, error: '请先打开手机蓝牙' })
          return
        }
        if (code === 103 || /auth|authorize|permission|denied/i.test(msg)) {
          resolve({
            ok: false,
            error: isIosPlatform()
              ? '请到 设置→微信→蓝牙 允许使用'
              : '请允许微信使用蓝牙',
          })
          return
        }
        resolve({ ok: false, error: msg || '打开蓝牙失败' })
      },
    })
  })
}

export function closeAdapter(): Promise<void> {
  return new Promise((resolve) => {
    stopDiscovery().finally(() => {
      wx.closeBluetoothAdapter({
        complete: () => resolve(),
      })
    })
  })
}

export function isSamePrinterName(a?: string, b?: string): boolean {
  const x = String(a || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  const y = String(b || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (!x || !y || x.length < 3 || y.length < 3) return false
  return x === y || x.includes(y) || y.includes(x)
}

function deviceLabel(d: { name?: string; localName?: string; deviceId: string }): string {
  const saved = getSavedPrinter()
  const raw = (d.name || d.localName || '').trim()
  if (saved && (d.deviceId === saved.deviceId || isSamePrinterName(raw, saved.name))) {
    return (saved.name || raw || d.deviceId.slice(-8)).trim()
  }
  return raw || d.deviceId.slice(-8)
}

function emitFound(
  onDevice: (d: { deviceId: string; name: string; RSSI?: number }) => void,
  d: { deviceId: string; name?: string; localName?: string; RSSI?: number },
) {
  if (!d.deviceId) return
  onDevice({
    deviceId: d.deviceId,
    name: deviceLabel(d),
    RSSI: d.RSSI,
  })
}

function dumpKnownDevices(
  onDevice: (d: { deviceId: string; name: string; RSSI?: number }) => void,
) {
  wx.getBluetoothDevices({
    success: (res) => {
      for (const d of res.devices || []) emitFound(onDevice, d)
    },
  })
  wx.getConnectedBluetoothDevices({
    services: BLE_PRINTER_SERVICE_UUIDS,
    success: (res) => {
      for (const d of res.devices || []) emitFound(onDevice, d as any)
    },
  })
}

export async function startDiscovery(
  onDevice: (d: { deviceId: string; name: string; RSSI?: number }) => void,
): Promise<{ ok: boolean; error?: string }> {
  const opened = await openAdapter()
  if (!opened.ok) return opened

  await stopDiscovery()
  _discovering = true
  _onDeviceFoundCb = onDevice
  _deviceFoundHandler = (res) => {
    const cb = _onDeviceFoundCb
    if (!cb) return
    for (const d of res.devices || []) emitFound(cb, d)
  }
  wx.onBluetoothDeviceFound(_deviceFoundHandler)

  return new Promise((resolve) => {
    wx.startBluetoothDevicesDiscovery({
      // iOS 首包常没名字，必须允许重复上报才能补上 B11
      allowDuplicatesKey: true,
      success: () => {
        dumpKnownDevices(onDevice)
        resolve({ ok: true })
      },
      fail: (e) => {
        _discovering = false
        resolve({ ok: false, error: (e as any).errMsg || '扫描失败' })
      },
    })
  })
}

export function stopDiscovery(): Promise<void> {
  return new Promise((resolve) => {
    clearDeviceFoundListener()
    if (!_discovering) {
      resolve()
      return
    }
    _discovering = false
    wx.stopBluetoothDevicesDiscovery({
      complete: () => resolve(),
    })
  })
}

function isWritable(c: WechatMiniprogram.BLECharacteristic): boolean {
  const p = (c.properties || {}) as unknown as Record<string, boolean | undefined>
  return !!(p.write || p.writeNoResponse || p.writeDefault)
}

function scoreWriteChar(c: WechatMiniprogram.BLECharacteristic): number {
  const p = (c.properties || {}) as unknown as Record<string, boolean | undefined>
  const uuid = String(c.uuid || '').toLowerCase()
  let score = 0
  if (p.write) score += 4
  if (p.writeNoResponse) score += 2
  if (p.write && p.writeNoResponse) score += 2
  // 仅 notify + writeNoResponse 常见是机→手机回传口，写入后只走纸不出字
  if (p.notify && !p.write && p.writeNoResponse) score -= 3
  const preferUuids = ['ffe1', 'ffe2', 'fff2', 'ff02', '8841', 'bef8d6c9', '2af1', 'ff01']
  if (preferUuids.some((u) => uuid.includes(u))) score += 6
  if (uuid.includes('1e4d')) score -= 4
  return score
}

async function listServices(deviceId: string): Promise<WechatMiniprogram.BLEService[]> {
  return new Promise((resolve) => {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => resolve(res.services || []),
      fail: () => resolve([]),
    })
  })
}

function toWriteTarget(serviceId: string, c: WechatMiniprogram.BLECharacteristic): WriteTarget {
  const p = (c.properties || {}) as unknown as Record<string, boolean | undefined>
  return {
    serviceId,
    characteristicId: c.uuid,
    canWrite: !!(p.write || p.writeDefault),
    canWriteNr: !!p.writeNoResponse,
  }
}

async function listCharacteristics(
  deviceId: string,
  serviceId: string,
): Promise<WechatMiniprogram.BLECharacteristic[]> {
  return new Promise((resolve) => {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => resolve(res.characteristics || []),
      fail: () => resolve([]),
    })
  })
}

async function enableNotifyOnService(deviceId: string, serviceId: string, chars: WechatMiniprogram.BLECharacteristic[]) {
  for (const c of chars) {
    const p = (c.properties || {}) as unknown as Record<string, boolean | undefined>
    if (!p.notify && !p.indicate) continue
    await new Promise<void>((resolve) => {
      wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId,
        characteristicId: c.uuid,
        state: true,
        complete: () => resolve(),
      })
    })
  }
}

async function discoverWriteTargets(
  deviceId: string,
  ios: boolean,
): Promise<WriteTarget[]> {
  let services = await listServices(deviceId)
  if (!services.length) {
    await sleep(400)
    services = await listServices(deviceId)
  }

  const preferred = [
    'eee0',
    'ff00',
    'ff10',
    'ffe0',
    'ffb0',
    '49535343',
    '18f0',
  ]

  const sorted = [...services].sort((a, b) => {
    const au = (a.uuid || '').toLowerCase()
    const bu = (b.uuid || '').toLowerCase()
    const as = preferred.findIndex((p) => au.includes(p))
    const bs = preferred.findIndex((p) => bu.includes(p))
    return (as < 0 ? 99 : as) - (bs < 0 ? 99 : bs)
  })

  const targets: WriteTarget[] = []
  for (const s of sorted) {
    if (!s.isPrimary && sorted.length > 1) continue
    const chars = await listCharacteristics(deviceId, s.uuid)
    if (ios) await enableNotifyOnService(deviceId, s.uuid, chars)
    const writable = chars.filter(isWritable)
    if (!writable.length) continue
    writable.sort((a, b) => scoreWriteChar(b) - scoreWriteChar(a))
    for (const c of writable) targets.push(toWriteTarget(s.uuid, c))
  }
  if (!ios) {
    targets.sort((a, b) => {
      const nr = Number(b.canWriteNr) - Number(a.canWriteNr)
      if (nr) return nr
      return Number(b.canWrite) - Number(a.canWrite)
    })
  }
  return targets
}

function createBleLink(deviceId: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.createBLEConnection({
      deviceId,
      timeout: 12000,
      success: () => resolve(true),
      fail: (e) => {
        const msg = String((e as any).errMsg || '')
        if (/already connect|connected/i.test(msg)) resolve(true)
        else resolve(false)
      },
    })
  })
}

export function isLanPagePrinter(): boolean {
  const id = _connected?.deviceId || getSavedPrinter()?.deviceId
  return lanEndpointFromId(id)?.port === 631
}

export async function connectLanPrinter(
  host: string,
  port = 9100,
  name = '',
): Promise<{ ok: boolean; error?: string; device?: BlePrinterDevice }> {
  const ip = String(host || '').trim()
  const prev = _connected
  if (prev && !isLanPrinterId(prev.deviceId)) {
    await closeBleLink(prev.deviceId)
    _connected = null
  }
  try {
    await connectLan(ip, port)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '连接失败' }
  }
  rememberLanHost(ip)
  const paper = getPaperWidthMm()
  const label = String(name || '').trim() || (port === 631 ? `激光 ${ip}` : `网口 ${ip}`)
  const dev: Connected = {
    deviceId: lanPrinterId(ip, port),
    name: label,
    paperWidthMm: paper,
    connected: true,
  }
  savePrinter(dev)
  _connected = dev
  return { ok: true, device: dev }
}

export async function connectPrinter(
  device: { deviceId: string; name?: string },
): Promise<{ ok: boolean; error?: string; device?: BlePrinterDevice }> {
  closeLan()
  bindConnectionWatch()
  await stopDiscovery()
  const opened = await openAdapter()
  if (!opened.ok) return opened

  const ios = isIosPlatform()
  const live = await isDeviceLinked(device.deviceId, device.name)
  // 苹果：残留连接先断开再连。安卓已连上则直接复用，避免华为每次打印都拆了重连
  if (ios) {
    await closeBleLink(device.deviceId)
    _connected = null
    await sleep(450)
  } else if (_connected && _connected.deviceId !== device.deviceId) {
    await closeBleLink(_connected.deviceId)
    _connected = null
    await sleep(200)
  } else if (live === true && _connected?.deviceId === device.deviceId && _connected.serviceId) {
    if (!ios && (!_connected.writeChunkSize || _connected.writeChunkSize < 180)) {
      _connected.writeChunkSize = await negotiateAndroidWriteSize(device.deviceId)
    }
    savePrinter(_connected)
    return { ok: true, device: _connected }
  }

  let linked = await createBleLink(device.deviceId)
  if (!linked) {
    await closeBleLink(device.deviceId)
    await sleep(300)
    linked = await createBleLink(device.deviceId)
  }
  if (!linked) return { ok: false, error: '连接打印机失败，请确认打印机开机且蓝牙灯在闪' }

  // iOS 服务枚举更慢；setBLEMTU 仅安卓有效，须在建连后、写之前
  await sleep(ios ? 800 : 80)

  const saved = getSavedPrinter()
  const targets = await discoverWriteTargets(device.deviceId, ios)
  if (!targets.length) {
    await disconnectPrinter()
    return { ok: false, error: '未找到可写打印特征，请确认是 BLE 热敏打印机' }
  }

  const androidChunk = ios ? ANDROID_FALLBACK_CHUNK : await negotiateAndroidWriteSize(device.deviceId)

  let pick = targets[0]
  if (!ios && saved && saved.deviceId === device.deviceId && saved.serviceId && saved.characteristicId) {
    const hit = targets.find(
      (t) => t.serviceId === saved.serviceId && t.characteristicId === saved.characteristicId,
    )
    const hasNr = targets.some((t) => t.canWriteNr)
    // 有无应答口时不要沿用上次只带应答的特征，否则每包等 ACK，打印会极慢
    if (hit && (!hasNr || hit.canWriteNr)) pick = hit
  }
  const serviceId = pick.serviceId
  const characteristicId = pick.characteristicId

  // 纸宽：沿用本机已存 58/80/110；否则 pending；再否则默认 80mm
  const pendingPaper = peekPendingPaperWidth()
  const savedMm =
    saved?.deviceId === device.deviceId ? saved.paperWidthMm : undefined
  const paperWidthMm: PaperWidthMm = isPaperWidthMm(savedMm)
    ? savedMm
    : pendingPaper || 80

  const info: Connected = {
    connected: true,
    deviceId: device.deviceId,
    name: device.name || '蓝牙打印机',
    serviceId,
    characteristicId,
    paperWidthMm,
    writeChunkSize: ios ? IOS_SAFE_CHUNK : androidChunk,
    preferWriteResponse: false,
    omitWriteType: !ios,
    writeTargets: ios
      ? targets
      : [pick, ...targets.filter((t) => t.serviceId !== pick.serviceId || t.characteristicId !== pick.characteristicId)].slice(0, 6),
  }
  _connected = info
  savePrinter(info)

  // 探针：仅 ESC @（1.0.141：失败不拆连接，避免刚连上就被误判）
  try {
    await writeBytesToCurrent(new Uint8Array([0x1b, 0x40]))
  } catch (_) {}

  return { ok: true, device: info }
}

async function scanMatchSaved(
  saved: BlePrinterDevice,
  ms: number,
): Promise<{ deviceId: string; name: string } | null> {
  let hit: { deviceId: string; name: string } | null = null
  const r = await startDiscovery((d) => {
    if (d.deviceId === saved.deviceId || isSamePrinterName(d.name, saved.name)) {
      hit = { deviceId: d.deviceId, name: saved.name || d.name }
    }
  })
  if (!r.ok) return null
  const until = Date.now() + ms
  while (!hit && Date.now() < until) await sleep(200)
  await stopDiscovery()
  return hit
}

/** 上次连成功的打印机：直接连，不弹确认。deviceId 变了（苹果常见）再按名字找 B11 */
export async function connectSavedPrinter(): Promise<{
  ok: boolean
  error?: string
  device?: BlePrinterDevice
}> {
  const saved = getSavedPrinter()
  if (!saved) return { ok: false, error: '未绑定打印机，请先扫描连接' }
  if (isLanPrinterId(saved.deviceId)) {
    const ep = lanEndpointFromId(saved.deviceId)
    if (!ep) return { ok: false, error: '局域网地址无效' }
    return connectLanPrinter(ep.host, ep.port, saved.name)
  }
  const first = await connectPrinter(saved)
  if (first.ok) return first
  const found = await scanMatchSaved(saved, 5000)
  if (!found) return first
  return connectPrinter({ deviceId: found.deviceId, name: saved.name || found.name })
}

export async function disconnectPrinter(): Promise<void> {
  const id = _connected?.deviceId || getSavedPrinter()?.deviceId
  _connected = null
  if (isLanPrinterId(id)) {
    closeLan()
    return
  }
  if (!id) return
  await closeBleLink(id)
}

/** 没有完整会话时关掉半连接，搜索才能看到其他蓝牙设备。不清除已保存的打印机。 */
export async function prepareBleScan(): Promise<void> {
  const healthy = !!(_connected?.connected && _connected.serviceId && _connected.characteristicId)
  if (healthy) return
  const id = _connected?.deviceId || getSavedPrinter()?.deviceId
  _connected = null
  if (!id || isLanPrinterId(id)) return
  await closeBleLink(id)
}

async function ensureConnected(): Promise<BlePrinterDevice> {
  const savedNow = getSavedPrinter()
  const lanId = isLanPrinterId(_connected?.deviceId) ? _connected?.deviceId : savedNow?.deviceId
  if (isLanPrinterId(lanId)) {
    const ep = lanEndpointFromId(lanId)
    if (!ep) throw new Error('局域网地址无效')
    const prev = _connected
    if (prev && !isLanPrinterId(prev.deviceId)) {
      await closeBleLink(prev.deviceId)
      _connected = null
    }
    if (!isLanAlive(ep.host)) await connectLan(ep.host, ep.port)
    const dev: Connected = {
      deviceId: lanPrinterId(ep.host, ep.port),
      name: savedNow?.name || (ep.port === 631 ? `激光 ${ep.host}` : `网口 ${ep.host}`),
      paperWidthMm: getPaperWidthMm(),
      connected: true,
    }
    _connected = dev
    return dev
  }
  if (_connected?.connected && _connected.serviceId && _connected.characteristicId) {
    const linked = await isDeviceLinked(_connected.deviceId, _connected.name)
    if (linked !== false) {
      if (!isIosPlatform()) return _connected
      try {
        await writeBytesToCurrent(new Uint8Array([0x1b, 0x40]))
        return _connected
      } catch (_) {
        await closeBleLink(_connected.deviceId)
        _connected = null
      }
    } else {
      try {
        await writeBytesToCurrent(new Uint8Array([0x1b, 0x40]))
        return _connected
      } catch (_) {
        _connected = null
      }
    }
  }
  const saved = getSavedPrinter()
  if (!saved) throw new Error('未绑定打印机，请到「打印设置」连接')
  const once = await Promise.race([
    connectPrinter(saved),
    new Promise<{ ok: false; error: string }>((resolve) => {
      setTimeout(() => resolve({ ok: false, error: '连接超时，请重新选择打印机' }), 10000)
    }),
  ])
  if (!once.ok || !once.device) throw new Error(once.error || '连接失败，请重新选择打印机')
  return once.device
}

function isWriteTypeUnsupported(err: unknown) {
  const msg = String((err as any)?.message || (err as any)?.errMsg || err || '')
  return /writetype/i.test(msg) && /not|support|valid|非法|不支持/i.test(msg)
}

function writeOnce(
  deviceId: string,
  serviceId: string,
  characteristicId: string,
  value: ArrayBuffer,
  writeType?: 'write' | 'writeNoResponse',
): Promise<void> {
  const send = (type?: 'write' | 'writeNoResponse') =>
    new Promise<void>((resolve, reject) => {
      const payload: WechatMiniprogram.WriteBLECharacteristicValueOption & {
        writeType?: 'write' | 'writeNoResponse'
      } = {
        deviceId,
        serviceId,
        characteristicId,
        value,
        success: () => resolve(),
        fail: (e) => reject(new Error((e as any).errMsg || '写入失败')),
      }
      // 官方：不传 writeType 时安卓优先 writeNoResponse，iOS 优先 write。
      // 基础库 <2.22 或不支持该特征时，带上 writeType 会直接 fail。
      if (type && isIosPlatform() && !_connected?.omitWriteType) payload.writeType = type
      wx.writeBLECharacteristicValue(payload)
    })

  return send(isIosPlatform() && !_connected?.omitWriteType ? writeType : undefined).catch((err) => {
    if (writeType && isWriteTypeUnsupported(err)) {
      if (_connected) _connected.omitWriteType = true
      return send(undefined)
    }
    throw err
  })
}

async function writeChunk(
  deviceId: string,
  target: WriteTarget,
  chunk: Uint8Array,
): Promise<void> {
  const value = toWriteBuffer(chunk)
  if (!isIosPlatform() || _connected?.omitWriteType) {
    await writeOnce(deviceId, target.serviceId, target.characteristicId, value, undefined)
    return
  }
  const cached = _connected?.writeType
  const attempts: Array<'writeNoResponse' | 'write' | undefined> = []
  if (cached) attempts.push(cached)
  if (target.canWriteNr && cached !== 'writeNoResponse') attempts.push('writeNoResponse')
  if (target.canWrite && cached !== 'write') attempts.push('write')
  if (!cached) attempts.push(undefined)
  let lastErr: Error | null = null
  for (const writeType of attempts) {
    try {
      await writeOnce(deviceId, target.serviceId, target.characteristicId, value, writeType)
      if (_connected && writeType && !_connected.omitWriteType) _connected.writeType = writeType
      return
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e?.message || e || '写入失败'))
      if (isBleSizeError(lastErr)) throw lastErr
    }
  }
  throw lastErr || new Error('写入失败')
}

async function writeOneBlePacket(chunk: Uint8Array): Promise<void> {
  const dev = _connected
  if (!dev?.serviceId || !dev.characteristicId) {
    throw new Error('打印通道未就绪')
  }
  const targets =
    dev.writeTargets && dev.writeTargets.length
      ? dev.writeTargets
      : [
          {
            serviceId: dev.serviceId,
            characteristicId: dev.characteristicId,
            canWrite: true,
            canWriteNr: true,
          },
        ]
  let lastErr: Error | null = null
  for (const target of targets) {
    try {
      await writeChunk(dev.deviceId, target, chunk)
      dev.serviceId = target.serviceId
      dev.characteristicId = target.characteristicId
      return
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e?.message || e || '写入失败'))
      if (isBleSizeError(lastErr)) throw lastErr
    }
  }
  throw lastErr || new Error('写入失败')
}

async function writeOneBleChunk(chunk: Uint8Array): Promise<void> {
  const ios = isIosPlatform()
  let cap = ios
    ? Math.max(20, _connected?.writeChunkSize || IOS_SAFE_CHUNK)
    : androidWriteCap()
  const gap = ios ? 0 : androidPacketGapMs()
  let offset = 0
  while (offset < chunk.byteLength) {
    const part = chunk.subarray(offset, Math.min(offset + cap, chunk.byteLength))
    try {
      await writeOneBlePacket(part)
      offset += part.byteLength
      if (gap > 0 && offset < chunk.byteLength) await sleep(gap)
    } catch (e) {
      if (!ios && part.byteLength > 20 && isBleSizeError(e)) {
        cap = shrinkAndroidChunk(part.byteLength)
        if (_connected) _connected.writeChunkSize = cap
        continue
      }
      throw e
    }
  }
}

async function writeBytesToCurrent(data: Uint8Array): Promise<void> {
  await writeOneBleChunk(data)
}

export async function writeBytes(data: Uint8Array): Promise<void> {
  const viaLan =
    isLanPrinterId(_connected?.deviceId) || isLanPrinterId(getSavedPrinter()?.deviceId)
  if (viaLan) {
    await ensureConnected()
    await enqueuePrint(async () => {
      try {
        await writeLan(data)
      } catch (e) {
        const ep = lanEndpointFromId(_connected?.deviceId || getSavedPrinter()?.deviceId)
        if (!ep) throw e
        await connectLan(ep.host, ep.port)
        await writeLan(data)
      }
    })
    return
  }
  await ensureConnected()
  const ios = isIosPlatform()
  if (!ios) await refreshAndroidPrintPace()
  await enqueuePrint(() =>
    kernelWriteEscPos({
      channel: ios ? 'mpIosBle' : 'mpAndroidBle',
      platform: 'mp',
      data,
      writeChunk: writeOneBleChunk,
      reconnectOnce: async () => {
        try {
          const r = await connectSavedPrinter()
          return !!(r && r.ok)
        } catch (_) {
          return false
        }
      },
    }),
  )
}

export async function printReceiptBle(opts: {
  shop?: ShopInfo | null
  orderNo: string
  customerName?: string
  customerPhone?: string
  remark?: string
  items: CartItem[]
  totalAmount: number
  totalQuantity: number
  createdAt?: string
  isReturn?: boolean
  handler?: string
  template?: string
  showLineNumber?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureConnected()
    await prepareGbk()
    const bytes = buildReceiptEscPos({
      template: (opts.template as any) || undefined,
      shopName: receiptShopTitle(
        opts.shop?.shopName,
        loadPrintTemplate().headerTitle,
        isGuest() || !isLoggedIn(),
      ),
      footer: opts.shop?.footer || undefined,
      address: opts.shop?.address || undefined,
      phone: opts.shop?.phone || undefined,
      orderNo: opts.orderNo,
      customerName: opts.customerName,
      customerPhone: opts.customerPhone,
      handler: opts.handler,
      remark: opts.remark,
      items: opts.items,
      totalAmount: opts.totalAmount,
      totalQuantity: opts.totalQuantity,
      createdAt: opts.createdAt,
      isReturn: opts.isReturn,
      showLineNumber: opts.showLineNumber,
    })
    await writeBytes(bytes)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) || '打印失败' }
  }
}

export function localPrintFailTitle(connected: boolean): string {
  if (isLanPrinterId(getSavedPrinter()?.deviceId)) {
    return connected ? '局域网打印失败' : '尚未连接局域网打印机'
  }
  return connected ? '蓝牙打印失败' : '尚未连接蓝牙打印机'
}

/** 首页打印：优先本机打印机（蓝牙或局域网）；失败返回错误供上层决定是否走云打印 */
export async function tryBlePrintOrExplain(opts: Parameters<typeof printReceiptBle>[0]) {
  const saved = getSavedPrinter()
  if (!saved) {
    return { ok: false as const, error: '未连接蓝牙打印机', needSetup: true as const }
  }
  const r = await printReceiptBle(opts)
  if (r.ok) return { ok: true as const, needSetup: false as const }
  return { ok: false as const, error: r.error || '打印失败', needSetup: false as const }
}

/** 票据预览顶栏：只读当前连接，不自动连回上次的打印机 */
export async function refreshBleStatus(_opts?: {
  tryReconnect?: boolean
}): Promise<{ connected: boolean; name: string }> {
  return readBleStatus()
}

async function readBleStatus(): Promise<{ connected: boolean; name: string }> {
  bindConnectionWatch()
  const saved = getSavedPrinter()
  const name = (_connected?.name || saved?.name || '').trim()
  if (saved && isLanPrinterId(saved.deviceId)) {
    return { connected: await isBleLiveConnected(), name: (saved.name || '').trim() }
  }
  if (_connected?.connected && !isLanPrinterId(_connected.deviceId)) {
    const linked = await isDeviceLinked(_connected.deviceId, _connected.name)
    if (linked !== false) {
      return { connected: true, name: (_connected.name || name || '已连接').trim() }
    }
    _connected = null
  }
  return { connected: false, name: (saved?.name || '').trim() }
}

/** 打开小程序后静默连回上次打印机；并发调用共用同一次连接 */
export function autoReconnectSavedPrinter(): Promise<{ connected: boolean; name: string }> {
  if (_autoReconnectJob) return _autoReconnectJob
  const job = (async () => {
    bindConnectionWatch()
    const saved = getSavedPrinter()
    if (!saved) {
      _connected = null
      return { connected: false, name: '' }
    }
    const name = (saved.name || '').trim()
    if (await isBleLiveConnected()) {
      if (!_connected) {
        try {
          await ensureConnected()
        } catch (_) {
          /* 系统已连，通道稍后再建 */
        }
      }
      return {
        connected: true,
        name: (_connected?.name || name || '已连接').trim(),
      }
    }
    try {
      await ensureConnected()
      if (_connected) {
        return {
          connected: true,
          name: (_connected.name || name || '已连接').trim(),
        }
      }
    } catch (_) {
      /* 打印机未开机时保持未连接，不弹窗 */
    }
    return { connected: false, name }
  })()
  _autoReconnectJob = job
  void job.finally(() => {
    if (_autoReconnectJob === job) _autoReconnectJob = null
  })
  return job
}
