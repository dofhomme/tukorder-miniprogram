import { request } from '../../services/api'

/**
 * 小程序腾讯接口直连 wss://asr.cloud.tencent.com。
 * 地址由服务器签发，密钥不进小程序。
 * 协议：https://cloud.tencent.com/document/product/1093/48982
 * 录音：https://developers.weixin.qq.com/miniprogram/dev/api/media/recorder/RecorderManager.start.html
 */

type ListenHandlers = {
  onStart?: () => void
  onPartial?: (text: string) => void
  onLevel?: (level: number) => void
  onResult: (text: string) => void
  onError: (msg: string) => void
}

const PACKET = 3200
const URL_TTL = 4 * 60 * 1000
const PAUSE_MS = 280
const DIGIT_PAUSE_MS = 160

function markPauses(text: string, wordList: unknown): string {
  if (!Array.isArray(wordList) || wordList.length < 2) return text
  const words: Array<{ word: string; start: number; end: number }> = []
  for (const item of wordList) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const word = String(row.word || '')
    const start = Number(row.start_time)
    const end = Number(row.end_time)
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) continue
    words.push({ word, start, end })
  }
  if (words.length < 2) return text
  let out = ''
  for (let i = 0; i < words.length; i += 1) {
    const prev = i > 0 ? words[i - 1] : null
    const cur = words[i]
    const gap = prev ? cur.start - prev.end : 0
    const digitTail = prev ? qtyTailAfter(words, i) : false
    if (
      prev &&
      gap >= (digitTail ? DIGIT_PAUSE_MS : PAUSE_MS) &&
      /[0-9A-Za-z]$/.test(prev.word) &&
      /^[0-9一二两三四五六七八九十]/.test(cur.word) &&
      !/[，,、。！？；：]$/.test(prev.word)
    ) {
      out += '，'
    }
    out += cur.word
  }
  const marked = out.trim()
  return marked || text
}

function qtyTailAfter(words: Array<{ word: string }>, index: number): boolean {
  let chunk = ''
  const last = Math.min(words.length, index + 4)
  for (let i = index; i < last; i += 1) {
    chunk += words[i].word
    if (/[件个条双份套]/.test(chunk)) break
  }
  return /^[0-9一二两]{1,2}[件个条双份套]/.test(chunk)
}

function splitTrailingOne(text: string): string {
  return text.replace(/(\d{4,8})1([件个条双份套])/g, '$1 1$2')
}

function joinVoice(parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (
      out &&
      /[0-9A-Za-z]$/.test(out) &&
      /^[0-9一二两三四五六七八九十]/.test(part) &&
      !/[，,、]$/.test(out)
    ) {
      out += '，'
    }
    out += part
  }
  return out
}

let _gen = 0
let _alive: Session | null = null
let _cachedUrl = ''
let _cachedAt = 0
let _fetching: Promise<string> | null = null

type Session = {
  gen: number
  handlers: ListenHandlers
  startedAt: number
  cancelled: boolean
  ending: boolean
  settled: boolean
  ready: boolean
  endSent: boolean
  task: WechatMiniprogram.SocketTask | null
  recorder: WechatMiniprogram.RecorderManager | null
  pending: ArrayBuffer[]
  pendingBytes: number
  steady: Record<number, string>
  partial: Record<number, string>
  latest: string
  failure: string
  pump: number
  finishTimer: number
}

function pcmLevel(buf: ArrayBuffer): number {
  const n = Math.floor(buf.byteLength / 2)
  if (n <= 0) return 0
  const view = new Int16Array(buf, 0, n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = view[i] / 32768
    sum += v * v
  }
  return Math.max(0, Math.min(1, Math.sqrt(sum / n) * 5))
}

function copyPcm(frame: ArrayBuffer): ArrayBuffer {
  const even = frame.byteLength - (frame.byteLength % 2)
  return frame.slice(0, even)
}

function explain(code: number): string {
  if (code === 4002) return '语音识别鉴权失败'
  if (code === 4003) return '语音识别服务还没开通'
  if (code === 4004 || code === 4005) return '语音识别额度不足'
  if (code === 4006) return '语音识别繁忙，请稍后再试'
  if (code === 4008) return '没听清，请再说一次'
  return '语音暂时没连上，请再说一次'
}

function asText(data: string | ArrayBuffer): string {
  if (typeof data === 'string') return data
  try {
    return new TextDecoder('utf-8').decode(data)
  } catch (_) {
    return ''
  }
}

function closeTask(session: Session) {
  const task = session.task
  session.task = null
  if (!task) return
  try { task.close({}) } catch (_) {}
}

function settle(session: Session, text: string, err: string) {
  if (session.settled || session.gen !== _gen) return
  session.settled = true
  if (_alive === session) _alive = null
  if (session.pump) clearInterval(session.pump)
  if (session.finishTimer) clearTimeout(session.finishTimer)
  try { session.recorder && session.recorder.stop() } catch (_) {}
  closeTask(session)
  warmTencentListen()
  if (session.cancelled) return
  if (err) session.handlers.onError(err)
  else if (text) session.handlers.onResult(text)
}

function takePending(session: Session, maxBytes: number, force: boolean): ArrayBuffer | null {
  if (session.pendingBytes < 2) return null
  if (!force && session.pendingBytes < maxBytes) return null
  let take = Math.min(session.pendingBytes, maxBytes)
  if (take % 2) take -= 1
  if (take < 2) return null
  const out = new Uint8Array(take)
  let filled = 0
  while (filled < take && session.pending.length) {
    const head = new Uint8Array(session.pending[0])
    const need = take - filled
    if (head.byteLength <= need) {
      out.set(head, filled)
      filled += head.byteLength
      session.pending.shift()
    } else {
      out.set(head.subarray(0, need), filled)
      const rest = new Uint8Array(head.byteLength - need)
      rest.set(head.subarray(need))
      session.pending[0] = rest.buffer
      filled += need
    }
  }
  session.pendingBytes -= filled
  return out.buffer
}

function flush(session: Session, force: boolean) {
  const task = session.task
  if (!session.ready || !task) return
  const max = force || session.pendingBytes > 9600 ? 6400 : PACKET
  while (session.pendingBytes >= 2) {
    const frame = takePending(session, max, force)
    if (!frame) break
    task.send({
      data: frame,
      fail: () => {
        if (!session.failure) session.failure = '语音暂时没连上，请再说一次'
      },
    })
    if (!force && session.pendingBytes < PACKET) break
  }
}

function publish(session: Session) {
  const ids = Object.keys(session.steady)
    .concat(Object.keys(session.partial))
    .map((id) => Number(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort((a, b) => a - b)
  session.latest = splitTrailingOne(joinVoice(ids.map((id) => session.steady[id] || session.partial[id] || '')))
  const text = session.latest.trim()
  if (text && session.handlers.onPartial) session.handlers.onPartial(text)
}

function takeResult(session: Session, result: Record<string, unknown>) {
  const index = Number(result.index || 0)
  const text = markPauses(String(result.voice_text_str || ''), result.word_list)
  const slice = Number(result.slice_type == null ? 1 : result.slice_type)
  if (slice === 2) {
    session.steady[index] = text
    delete session.partial[index]
  } else if (text) {
    session.partial[index] = text
  }
  publish(session)
}

function finishSend(session: Session) {
  if (session.endSent || !session.ready || !session.task || session.settled) return
  if (session.finishTimer) clearTimeout(session.finishTimer)
  flush(session, true)
  session.endSent = true
  session.task.send({ data: JSON.stringify({ type: 'end' }) })
  const wait = session.latest.trim() ? 400 : 1500
  session.finishTimer = setTimeout(() => {
    const text = session.latest.trim()
    settle(session, text, text ? '' : (session.failure || '没听清，请再说一次'))
  }, wait) as unknown as number
}

function onServer(session: Session, raw: string) {
  if (!raw) return
  let decoded: Record<string, unknown>
  try {
    decoded = JSON.parse(raw) as Record<string, unknown>
  } catch (_) {
    return
  }
  const code = Number(decoded.code == null ? 0 : decoded.code)
  if (code !== 0) {
    session.failure = explain(code)
    settle(session, '', session.failure)
    return
  }
  if (!session.ready) {
    session.ready = true
    flush(session, false)
    if (session.ending) finishSend(session)
  }
  const result = decoded.result
  if (result && typeof result === 'object') takeResult(session, result as Record<string, unknown>)
  if (Number(decoded.final || 0) === 1) {
    const text = session.latest.trim()
    settle(session, text, text ? '' : (session.failure || '没听清，请再说一次'))
  }
}

function beginRecorder(session: Session) {
  const recorder = wx.getRecorderManager()
  session.recorder = recorder
  recorder.onFrameRecorded((ev) => {
    if (session.gen !== _gen || session.cancelled || session.settled) return
    const frame = ev.frameBuffer
    if (!frame || frame.byteLength < 2) return
    const slice = copyPcm(frame)
    if (slice.byteLength < 2) return
    session.pending.push(slice)
    session.pendingBytes += slice.byteLength
    const level = pcmLevel(slice)
    if (session.handlers.onLevel) session.handlers.onLevel(level)
    if (session.ready) flush(session, false)
  })
  recorder.onError(() => {
    if (session.gen !== _gen || session.settled) return
    settle(session, '', '无法使用麦克风')
  })
  recorder.start({
    duration: 60000,
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
    format: 'PCM',
    frameSize: 1,
    audioSource: 'auto',
  })
  if (session.handlers.onStart) session.handlers.onStart()
}

function fetchUrl(): Promise<string> {
  if (_cachedUrl && Date.now() - _cachedAt < URL_TTL) return Promise.resolve(_cachedUrl)
  if (_fetching) return _fetching
  _fetching = request<{ url?: string }>({
    path: '/api/v1/voice/tencent-asr-url',
    method: 'POST',
    data: { surface: 'mp' },
    timeout: 8000,
  }).then((res) => {
    const url = res.ok && res.data ? String(res.data.url || '') : ''
    if (!url.startsWith('wss://asr.cloud.tencent.com/')) {
      throw new Error(res.message || '语音识别尚未配置')
    }
    _cachedUrl = url
    _cachedAt = Date.now()
    return url
  }).finally(() => {
    _fetching = null
  })
  return _fetching
}

async function claimUrl(): Promise<string> {
  const url = await fetchUrl()
  if (_cachedUrl === url) {
    _cachedUrl = ''
    _cachedAt = 0
  }
  return url
}

export function forgetTencentUrl() {
  _cachedUrl = ''
  _cachedAt = 0
}

export function warmTencentListen() {
  void fetchUrl().catch(() => {})
}

function connect(session: Session, url: string) {
  const task = wx.connectSocket({
    url,
    tcpNoDelay: true,
    perMessageDeflate: false,
    timeout: 8000,
  })
  session.task = task
  if (session.gen !== _gen || session.cancelled || session.settled) {
    closeTask(session)
    return
  }
  task.onMessage((res) => {
    if (session.gen !== _gen || session.settled) return
    onServer(session, asText(res.data))
  })
  task.onError(() => {
    if (session.gen !== _gen || session.settled) return
    session.failure = session.failure || '语音暂时没连上，请再说一次'
    const text = session.latest.trim()
    if (session.ending && text) settle(session, text, '')
    else settle(session, '', session.failure)
  })
  task.onClose(() => {
    if (session.gen !== _gen || session.settled) return
    const text = session.latest.trim()
    if (session.ending && text) settle(session, text, '')
    else if (!session.ready) settle(session, '', session.failure || '语音暂时没连上，请再说一次')
  })
}

export function startTencentListen(handlers: ListenHandlers): boolean {
  if (_alive && !_alive.settled) return false
  const gen = ++_gen
  const session: Session = {
    gen,
    handlers,
    startedAt: Date.now(),
    cancelled: false,
    ending: false,
    settled: false,
    ready: false,
    endSent: false,
    task: null,
    recorder: null,
    pending: [],
    pendingBytes: 0,
    steady: {},
    partial: {},
    latest: '',
    failure: '',
    pump: 0,
    finishTimer: 0,
  }
  _alive = session
  beginRecorder(session)
  session.pump = setInterval(() => {
    if (session.gen !== _gen || session.settled) return
    flush(session, false)
  }, 40) as unknown as number
  void claimUrl().then((url) => {
    if (session.gen !== _gen || session.cancelled || session.settled) return
    connect(session, url)
  }).catch((error: Error) => {
    if (session.gen !== _gen || session.settled) return
    settle(session, '', (error && error.message) || '语音识别尚未配置')
  })
  return true
}

export function stopTencentListen() {
  const session = _alive
  if (!session || session.settled) return
  if (Date.now() - session.startedAt < 350) {
    settle(session, '', '说话时间太短')
    return
  }
  session.ending = true
  try { session.recorder && session.recorder.stop() } catch (_) {}
  if (session.ready) {
    finishSend(session)
    return
  }
  session.finishTimer = setTimeout(() => {
    if (session.settled) return
    if (session.ready) finishSend(session)
    else settle(session, '', session.failure || '语音暂时没连上，请再说一次')
  }, 1500) as unknown as number
}

export function cancelTencentListen() {
  const session = _alive
  if (!session || session.settled) return
  session.cancelled = true
  settle(session, '', '')
}
