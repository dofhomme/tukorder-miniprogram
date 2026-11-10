import { API_BASE, getOrCreateClientId, request } from './api'
import { getAccessToken, isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'

export interface AiItem {
  code: string
  quantity: number
  color?: string
  size?: string
  hands?: number
}

function aiDeniedMessage() {
  if (isGuest() || !isLoggedIn()) {
    return '游客不能使用 AI 识别，请先登录并开通云同步'
  }
  return 'AI 识别为云同步会员专属，请先开通订阅'
}

function ensureAiAllowed(): { ok: false; error: string; items: AiItem[] } | null {
  if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) {
    return { ok: false, error: aiDeniedMessage(), items: [] }
  }
  return null
}

function normalizeAmbiguous(
  raw: Array<{ spoken?: string; codes?: string[]; quantity?: number }> | undefined,
) {
  const out: Array<{ spoken: string; codes: string[]; quantity: number }> = []
  for (const row of raw || []) {
    const codes = (row.codes || []).map((c) => String(c || '').trim()).filter(Boolean)
    if (codes.length < 2) continue
    let quantity = Number(row.quantity)
    if (!Number.isFinite(quantity) || quantity === 0) quantity = 1
    out.push({
      spoken: String(row.spoken || '').trim(),
      codes,
      quantity,
    })
  }
  return out
}

function textField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = String(row[key] ?? '').trim()
    if (text) return text
  }
  return ''
}

function handsField(row: Record<string, unknown>): number {
  const raw = row.hands ?? row.hand ?? row['手数'] ?? row['几手']
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function normalizeItems(raw: Array<Record<string, unknown>> | undefined): AiItem[] {
  const items: AiItem[] = []
  for (const it of raw || []) {
    const code = textField(it, ['code', '货号'])
    if (!code) continue
    let quantity = Number(it.quantity ?? it['数量'] ?? it['件数'])
    if (!Number.isFinite(quantity) || quantity === 0) quantity = 1
    const color = textField(it, ['color', '颜色'])
    const size = textField(it, ['size', '尺码'])
    const hands = handsField(it)
    items.push({
      code,
      quantity,
      ...(color ? { color } : {}),
      ...(size ? { size } : {}),
      ...(hands ? { hands } : {}),
    })
  }
  return items
}

function decodeChunk(data: ArrayBuffer, decoder: { decode: (input: ArrayBuffer, options?: { stream?: boolean }) => string } | null) {
  if (decoder) return decoder.decode(data, { stream: true })
  const bytes = new Uint8Array(data)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  try {
    return decodeURIComponent(escape(binary))
  } catch (_) {
    return binary
  }
}

function voiceFromEvent(raw: string) {
  let hit: Record<string, unknown> | null = null
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload || payload === '[DONE]' || !payload.startsWith('{')) continue
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>
      if (obj.done === true || obj.error || obj.ok === false) hit = obj
      const data = obj.data
      if (obj.ok === true && data && typeof data === 'object') hit = data as Record<string, unknown>
    } catch (_) {}
  }
  return hit
}

/** 语音指令走短请求。Flash 流式拆出客户和货号，不上传商品库。 */
export function extractVoiceCommand(text: string) {
  const denied = ensureAiAllowed()
  if (denied) return Promise.resolve(denied)
  const spoken = String(text || '').trim()
  if (!spoken) {
    return Promise.resolve({ ok: false as const, error: '没听清，请再说一次', items: [] as AiItem[] })
  }
  return new Promise<{
    ok: boolean
    error: string | null
    items: AiItem[]
    intent?: string
    customerName?: string
    from?: string
    to?: string
    range?: string
    unpaidOnly?: boolean
    actions?: unknown
    action?: string
  }>((resolve) => {
    let buf = ''
    let settled = false
    const finish = (row: Record<string, unknown> | null, fallback?: string) => {
      if (settled) return
      settled = true
      if (!row) {
        resolve({ ok: false, error: fallback || '没听清，请再说一次', items: [] })
        return
      }
      const error = String(row.error || '').trim()
      if (row.ok === false || error) {
        resolve({
          ok: false,
          error: error || String(row.message || '没听清，请再说一次'),
          items: [],
        })
        return
      }
      resolve({
        ok: true,
        items: normalizeItems(
          Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>) : [],
        ),
        error: null,
        intent: String(row.intent || '').trim() || undefined,
        customerName: String(row.customerName || row.customer || '').trim() || undefined,
        from: String(row.from || '').trim() || undefined,
        to: String(row.to || '').trim() || undefined,
        range: String(row.range || '').trim() || undefined,
        unpaidOnly: row.unpaidOnly === true,
        actions: row.actions,
        ambiguous: [],
      })
    }
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
    const task = wx.request({
      url: `${API_BASE}/api/v1/ai/voice-command`,
      method: 'POST',
      enableChunked: true,
      timeout: 12000,
      data: { clientId: getOrCreateClientId(), text: spoken },
      header: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Client-Id': getOrCreateClientId(),
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
      success(res) {
        const status = res.statusCode || 0
        if (typeof res.data === 'string') buf += res.data
        else if (res.data && typeof res.data === 'object' && !(res.data instanceof ArrayBuffer)) {
          finish(res.data as Record<string, unknown>)
          return
        }
        if (status >= 400) {
          finish(voiceFromEvent(buf), '没听清，请再说一次')
          return
        }
        finish(voiceFromEvent(buf))
      },
      fail(err) {
        finish(null, err.errMsg || '网络错误，请检查域名与网络')
      },
    })
    task.onChunkReceived((res) => {
      buf += decodeChunk(res.data, decoder)
      const row = voiceFromEvent(buf)
      if (row && (row.done === true || row.error || row.ok === false)) finish(row)
    })
  })
}

export async function extractOrderText(text: string, catalogCodes?: string[]) {
  const denied = ensureAiAllowed()
  if (denied) return denied
  const res = await request<{
    items: Array<Record<string, unknown>>
    ambiguous?: Array<{ spoken?: string; codes?: string[]; quantity?: number }>
    intent?: string
    customerName?: string
    customer?: string
    from?: string
    to?: string
    range?: string
    unpaidOnly?: boolean
    actions?: unknown
    commands?: unknown
    action?: string
    command?: string
  }>({
    path: '/api/v1/ai/extract-order',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      text,
      catalogCodes: catalogCodes || [],
    },
    timeout: 60000,
  })
  if (!res.ok) return { ok: false as const, error: res.message, items: [] as AiItem[] }
  const data = res.data || ({} as NonNullable<typeof res.data>)
  return {
    ok: true as const,
    items: normalizeItems(data.items),
    ambiguous: normalizeAmbiguous(data.ambiguous),
    error: null as string | null,
    intent: String(data.intent || '').trim() || undefined,
    customerName: String(data.customerName || data.customer || (data as { 客户?: string })['客户'] || '').trim() || undefined,
    from: String(data.from || '').trim() || undefined,
    to: String(data.to || '').trim() || undefined,
    range: String(data.range || '').trim() || undefined,
    unpaidOnly: data.unpaidOnly === true,
    actions: data.actions != null ? data.actions : data.commands,
    action: String(data.action || data.command || '').trim() || undefined,
  }
}

/** 相册/拍照识图：上传压缩图，只识别图中文字。货号解析在「识别并填入」。 */
export async function extractOrderImage(
  imageBase64: string,
  catalogCodes?: string[],
  mime = 'image/jpeg',
) {
  const denied = ensureAiAllowed()
  if (denied) return denied
  const b64 = String(imageBase64 || '')
    .replace(/^data:image\/\w+;base64,/, '')
    .trim()
  if (!b64) {
    return { ok: false as const, error: '图片无效', items: [] as AiItem[] }
  }
  if (b64.length > 2_800_000) {
    return { ok: false as const, error: '图片过大，请换一张更清晰的近景图', items: [] as AiItem[] }
  }
  const res = await request<{
    items: Array<Record<string, unknown>>
    ambiguous?: Array<{ spoken?: string; codes?: string[]; quantity?: number }>
    ocrText?: string
  }>({
    path: '/api/v1/ai/extract-order',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      imageBase64: b64,
      imageMime: mime,
      catalogCodes: catalogCodes || [],
    },
    timeout: 25000,
  })
  if (!res.ok) return { ok: false as const, error: res.message, items: [] as AiItem[] }
  return {
    ok: true as const,
    items: normalizeItems(res.data?.items),
    ambiguous: normalizeAmbiguous(res.data?.ambiguous),
    ocrText: String(res.data?.ocrText || ''),
    error: null as string | null,
  }
}

/** 吊牌建档：同一识图接口，只要文字，60 秒超时。不把结果写入单据。 */
export async function extractHangtagImage(imageBase64: string, mime = 'image/jpeg') {
  const denied = ensureAiAllowed()
  if (denied) return { ok: false as const, error: denied.error, ocrText: '' }
  const b64 = String(imageBase64 || '')
    .replace(/^data:image\/\w+;base64,/, '')
    .trim()
  if (!b64) return { ok: false as const, error: '图片无效', ocrText: '' }
  if (b64.length > 2_800_000) {
    return { ok: false as const, error: '图片过大，请换一张更清晰的近景图', ocrText: '' }
  }
  const res = await request<{ ocrText?: string }>({
    path: '/api/v1/ai/extract-order',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      imageBase64: b64,
      imageMime: mime,
    },
    timeout: 60000,
  })
  if (!res.ok) return { ok: false as const, error: res.message, ocrText: '' }
  return { ok: true as const, error: '', ocrText: String(res.data?.ocrText || '') }
}
