import { request } from './api'
import { isLoggedIn } from './session'

export const PRINT_CHANNELS = [
  'mpIosBle',
  'mpAndroidBle',
  'appIosSpp',
  'appAndroidSpp',
  'windowsCom',
  'usb',
  'net9100',
] as const

export type PrintChannel = (typeof PRINT_CHANNELS)[number]

export const PRINT_CHANNEL_LABELS: Record<PrintChannel, string> = {
  mpIosBle: '小程序 iOS BLE',
  mpAndroidBle: '小程序 Android BLE',
  appIosSpp: 'App iOS',
  appAndroidSpp: 'App Android',
  windowsCom: '电脑蓝牙 COM',
  usb: 'USB 串口',
  net9100: '网口 9100',
}

export type PrintPaceRange = {
  chunkMin: number
  chunkMax: number
  intervalMin: number
  intervalMax: number
  defaultChunk: number
  defaultInterval: number
}

/** 后台可调范围。苹果只给 BLE 安全区间，连发停顿仍走本机逻辑。 */
export function printPaceRange(channel: string): PrintPaceRange {
  if (channel === 'mpIosBle') {
    return { chunkMin: 150, chunkMax: 250, intervalMin: 0, intervalMax: 10, defaultChunk: 200, defaultInterval: 6 }
  }
  if (channel === 'mpAndroidBle') {
    return { chunkMin: 20, chunkMax: 1024, intervalMin: 0, intervalMax: 3, defaultChunk: 150, defaultInterval: 3 }
  }
  return { chunkMin: 200, chunkMax: 1024, intervalMin: 0, intervalMax: 10, defaultChunk: 512, defaultInterval: 2 }
}

export const PRINT_PLATFORM_GROUPS = [
  {
    id: 'ios',
    label: '苹果小程序',
    hint: '分包 150–250 字节，间隔 0–10ms。默认 200 / 6ms',
    channels: ['mpIosBle'] as PrintChannel[],
    previewChannel: 'mpIosBle' as PrintChannel,
    ...printPaceRange('mpIosBle'),
  },
  {
    id: 'android',
    label: '安卓小程序',
    hint: '分包 20–1024 字节，间隔 0–3ms。默认 150 / 3ms，拉条可改',
    channels: ['mpAndroidBle'] as PrintChannel[],
    previewChannel: 'mpAndroidBle' as PrintChannel,
    ...printPaceRange('mpAndroidBle'),
  },
  {
    id: 'appPc',
    label: 'App / 电脑',
    hint: '分包 200–1024 字节，间隔 0–10ms',
    channels: ['appIosSpp', 'appAndroidSpp', 'windowsCom', 'usb', 'net9100'] as PrintChannel[],
    previewChannel: 'appAndroidSpp' as PrintChannel,
    ...printPaceRange('appAndroidSpp'),
  },
]

export type PrintChannelPace = {
  chunkBytes: number
  intervalMs: number
}

export type PrintGearParams = {
  chunkBytes: number
  packetIntervalMs: number
  rasterIntervalMs: number
  postWriteMs: number
  iosBufferPauseEvery: number
  iosBufferPauseMs: number
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t)
}

export function clampPrintPace(channel: string, chunkBytes: number, intervalMs: number): PrintChannelPace {
  const r = printPaceRange(channel)
  return {
    chunkBytes: clamp(Math.round(chunkBytes), r.chunkMin, r.chunkMax),
    intervalMs: clamp(Math.round(intervalMs), r.intervalMin, r.intervalMax),
  }
}

/** 旧挡位 1–10 映射到新范围，方便已存策略过渡。 */
export function paceFromLegacyGear(channel: string, gear: number): PrintChannelPace {
  const r = printPaceRange(channel)
  const t = Math.max(0, Math.min(1, ((gear | 0) - 1) / 9))
  return clampPrintPace(channel, lerp(r.chunkMin, r.chunkMax, t), lerp(r.intervalMax, r.intervalMin, t))
}

export function parseChannelPace(channel: string, src: any): PrintChannelPace {
  const r = printPaceRange(channel)
  if (src && typeof src === 'object') {
    const hasChunk = src.chunkBytes != null || src.chunk_bytes != null
    const hasInterval = src.intervalMs != null || src.interval_ms != null
    if (hasChunk || hasInterval) {
      return clampPrintPace(
        channel,
        Number(src.chunkBytes ?? src.chunk_bytes ?? r.defaultChunk),
        Number(src.intervalMs ?? src.interval_ms ?? r.defaultInterval),
      )
    }
    if (src.target != null || src.gear != null) {
      return paceFromLegacyGear(channel, Number(src.target || src.gear || 5))
    }
  }
  return { chunkBytes: r.defaultChunk, intervalMs: r.defaultInterval }
}

export function printParamsFromPace(channel: string, pace: PrintChannelPace): PrintGearParams {
  const p = clampPrintPace(channel, pace.chunkBytes, pace.intervalMs)
  const ios = channel === 'mpIosBle'
  return {
    chunkBytes: p.chunkBytes,
    packetIntervalMs: p.intervalMs,
    rasterIntervalMs: p.intervalMs,
    postWriteMs: ios ? 18 : 0,
    iosBufferPauseEvery: ios ? 160 : 0,
    iosBufferPauseMs: ios ? 8 : 0,
  }
}

/** 兼容旧调用：挡位映射到范围内的分包/间隔。 */
export function printGearParams(channel: string, gear: number): PrintGearParams {
  return printParamsFromPace(channel, paceFromLegacyGear(channel, gear))
}

export type PrintRuntimePolicy = {
  defaultOutput: 'text' | 'raster'
  successToRecover: number
  channels: Record<string, PrintChannelPace>
}

function defaultPolicy(): PrintRuntimePolicy {
  const channels: PrintRuntimePolicy['channels'] = {}
  for (const ch of PRINT_CHANNELS) {
    const r = printPaceRange(ch)
    channels[ch] = { chunkBytes: r.defaultChunk, intervalMs: r.defaultInterval }
  }
  return { defaultOutput: 'raster', successToRecover: 3, channels }
}

let _snap = defaultPolicy()
let _fetchedAt = 0
let _inflight: Promise<PrintRuntimePolicy> | null = null
const TTL_MS = 20 * 1000

export function currentPrintPolicy(): PrintRuntimePolicy {
  return _snap
}

function appliedPaceKey(channel: string) {
  return `print.pace.applied.${channel}`
}

function localChunkKey(channel: string) {
  return `print.pace.chunk.${channel}`
}

function localIntervalKey(channel: string) {
  return `print.pace.interval.${channel}`
}

function streakKey(channel: string) {
  return `print.gear.success.${channel}`
}

function appliedSig(pace: PrintChannelPace) {
  return `${pace.chunkBytes}:${pace.intervalMs}`
}

function syncLocalPaceToPolicy(policy: PrintRuntimePolicy) {
  for (const id of PRINT_CHANNELS) {
    const pace = policy.channels[id]
    if (!pace) continue
    try {
      const prev = String(wx.getStorageSync(appliedPaceKey(id)) || '')
      const next = appliedSig(pace)
      if (prev !== next) {
        wx.setStorageSync(appliedPaceKey(id), next)
        wx.removeStorageSync(localChunkKey(id))
        wx.removeStorageSync(localIntervalKey(id))
        wx.removeStorageSync(streakKey(id))
      }
    } catch (_) {}
  }
}

export async function ensurePrintPolicy(force = false): Promise<PrintRuntimePolicy> {
  if (!force && Date.now() - _fetchedAt < TTL_MS && _fetchedAt) return _snap
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      if (!isLoggedIn()) return _snap
      const res = await request<PrintRuntimePolicy>({ path: '/api/v1/print/runtime-policy' })
      if (res.ok && res.data && typeof res.data === 'object') {
        const raw = res.data as any
        const next = defaultPolicy()
        next.defaultOutput = raw.defaultOutput === 'text' ? 'text' : 'raster'
        next.successToRecover = clamp(Number(raw.successToRecover) || 3, 1, 20)
        const ch = raw.channels || {}
        for (const id of PRINT_CHANNELS) {
          next.channels[id] = parseChannelPace(id, ch[id])
        }
        _snap = next
        _fetchedAt = Date.now()
        syncLocalPaceToPolicy(next)
      }
    } catch (_) {
      /* keep cache */
    }
    return _snap
  })()
  try {
    return await _inflight
  } finally {
    _inflight = null
  }
}

export async function effectivePace(channel: string): Promise<PrintChannelPace> {
  const policy = (await ensurePrintPolicy()).channels[channel] || parseChannelPace(channel, null)
  const r = printPaceRange(channel)
  let chunk = policy.chunkBytes
  let interval = policy.intervalMs
  // 安卓 BLE 包长由 MTU 决定；本机降速会把间隔堆到 3ms，越打越慢
  if (channel === 'mpAndroidBle') return clampPrintPace(channel, chunk, interval)
  try {
    const lc = Number(wx.getStorageSync(localChunkKey(channel)))
    const li = Number(wx.getStorageSync(localIntervalKey(channel)))
    if (lc >= r.chunkMin && lc <= r.chunkMax) chunk = lc
    if (li >= r.intervalMin && li <= r.intervalMax) interval = li
  } catch (_) {}
  return clampPrintPace(channel, chunk, interval)
}

export async function effectivePrintParams(channel: string): Promise<PrintGearParams> {
  return printParamsFromPace(channel, await effectivePace(channel))
}

export async function effectiveGear(channel: string): Promise<number> {
  const r = printPaceRange(channel)
  const pace = await effectivePace(channel)
  const span = Math.max(1, r.chunkMax - r.chunkMin)
  const t = (pace.chunkBytes - r.chunkMin) / span
  return clamp(Math.round(1 + t * 9), 1, 10)
}

export async function notePrintSuccess(channel: string) {
  const snap = await ensurePrintPolicy()
  const target = snap.channels[channel] || parseChannelPace(channel, null)
  let streak = 0
  try {
    streak = Number(wx.getStorageSync(streakKey(channel))) || 0
  } catch (_) {}
  streak += 1
  const cur = await effectivePace(channel)
  if (streak >= snap.successToRecover && (cur.chunkBytes < target.chunkBytes || cur.intervalMs > target.intervalMs)) {
    const next = clampPrintPace(
      channel,
      Math.min(target.chunkBytes, cur.chunkBytes + 20),
      Math.max(target.intervalMs, cur.intervalMs - 1),
    )
    wx.setStorageSync(localChunkKey(channel), next.chunkBytes)
    wx.setStorageSync(localIntervalKey(channel), next.intervalMs)
    wx.setStorageSync(streakKey(channel), 0)
  } else {
    wx.setStorageSync(streakKey(channel), streak)
  }
}

export async function stepDownGear(channel: string): Promise<number> {
  const r = printPaceRange(channel)
  const cur = await effectivePace(channel)
  const next = clampPrintPace(
    channel,
    Math.max(r.chunkMin, cur.chunkBytes - 20),
    Math.min(r.intervalMax, cur.intervalMs + 1),
  )
  wx.setStorageSync(localChunkKey(channel), next.chunkBytes)
  wx.setStorageSync(localIntervalKey(channel), next.intervalMs)
  wx.setStorageSync(streakKey(channel), 0)
  return effectiveGear(channel)
}

export async function reportPrintTelemetry(body: {
  platform: string
  channel: string
  gear: number
  bytes: number
  durationMs: number
  errorClass?: string | null
}) {
  if (body.errorClass === 'emptyPaper') return
  if (!isLoggedIn()) return
  try {
    await request({
      path: '/api/v1/print/telemetry',
      method: 'POST',
      data: body,
    })
  } catch (_) {}
}
