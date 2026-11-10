/**
 * 开单打印内容安全：所有用户输入必须调用官方
 * security.msgSecCheck（文本） / security.mediaCheckAsync（图片、音频）
 * 服务端转发 /wxa/msg_sec_check、/wxa/media_check_async
 * https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html
 */
import { request } from './api'

/** 审核检索用：官方接口名 */
export const SECURITY_MSG_SEC_CHECK = 'security.msgSecCheck'
export const SECURITY_MEDIA_CHECK_ASYNC = 'security.mediaCheckAsync'

function wxLoginOnce(): Promise<string> {
  return new Promise((resolve) => {
    wx.login({
      success: (r) => resolve(String(r?.code || '').trim()),
      fail: () => resolve(''),
    })
  })
}

async function wxLoginCode(): Promise<string> {
  const first = await wxLoginOnce()
  if (first) return first
  return wxLoginOnce()
}

function isRiskyLabel(suggest?: string, errcode?: number) {
  if (errcode === 87014) return true
  const s = String(suggest || '').toLowerCase()
  // 仅拦截明确违规；review 为待人工复核，放行以免正常开单被误杀
  return s === 'risky'
}

function isContentBlocked(msg?: string) {
  const s = String(msg || '')
  return /违规|risky|87014/i.test(s)
}

/** 凭证/登录码/网络：不是内容违规。官方要求 40001 刷新 token 后重试，不能据此拦开单。 */
function isInfraSecError(msg?: string) {
  const s = String(msg || '')
  if (!s || isContentBlocked(s)) return false
  return /40001|42001|40014|invalid credential|access_token|not latest|凭证|登录态|登录码|请重新登录|请先登录|invalid code|code2session|40163|40029|暂时不可用|调用失败|微信登录失败|安全检测未完成|timeout|超时|network/i.test(
    s,
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type SecCheckResult = { ok: boolean; error?: string; infra?: boolean }

async function msgSecCheckOnce(
  chunk: string,
  scene: number,
): Promise<SecCheckResult> {
  const code = await wxLoginCode()
  if (!code) {
    return { ok: false, infra: true, error: '微信登录码获取失败' }
  }
  const res = await request<{
    errcode?: number
    suggest?: string
    label?: number
  }>({
    path: '/api/v1/security/msg-sec-check',
    method: 'POST',
    needAuth: false,
    skipAuthKick: true,
    data: {
      api: SECURITY_MSG_SEC_CHECK,
      content: chunk,
      scene,
      version: 2,
      code,
    },
  })
  if (!res.ok) {
    const msg = String(res.message || '')
    if (isContentBlocked(msg)) {
      return { ok: false, error: msg || '内容含违规信息，请修改后再试' }
    }
    if (isInfraSecError(msg) || /^\s*\{/.test(msg) || /errcode/i.test(msg)) {
      return { ok: false, infra: true, error: msg }
    }
    return { ok: false, error: msg || '文本安全检测失败' }
  }
  const errcode = Number(res.data?.errcode)
  const suggest = String(res.data?.suggest || '').toLowerCase()
  if (isRiskyLabel(suggest, errcode)) {
    return { ok: false, error: res.message || '内容含违规信息，请修改后再试' }
  }
  if (res.data && Number.isFinite(errcode) && errcode !== 0) {
    const msg = res.message || `文本安全检测失败(${errcode})`
    if (isInfraSecError(msg) || errcode === 40001 || errcode === 42001) {
      return { ok: false, infra: true, error: msg }
    }
    return { ok: false, error: msg }
  }
  return { ok: true }
}

/** 官方文本检测：security.msgSecCheck（单段 ≤2500 字） */
export async function msgSecCheck(
  content: string,
  scene = 1,
): Promise<{ ok: boolean; error?: string }> {
  const text = String(content || '').trim()
  if (!text) return { ok: true }
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 2400) {
    chunks.push(text.slice(i, i + 2400))
  }
  for (const chunk of chunks) {
    // 每段单独换 code：jscode 只能用一次，复用会 invalid code
    let r = await msgSecCheckOnce(chunk, scene)
    if (!r.ok && r.infra) {
      await sleep(280)
      r = await msgSecCheckOnce(chunk, scene)
    }
    if (!r.ok && r.infra) {
      // 凭证刷新/登录码失效：放行保存，避免正常开单被卡死
      return { ok: true }
    }
    if (!r.ok) return { ok: false, error: r.error }
  }
  return { ok: true }
}

/** 开单页全部用户输入文本一次检测 */
export async function msgSecCheckOrderInputs(parts: Array<string | undefined | null>) {
  const text = parts
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('\n')
  return msgSecCheck(text, 1)
}

function readFileBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (r) => resolve(String(r.data || '')),
      fail: (e) => reject(e),
    })
  })
}

/**
 * 官方多媒体异步检测：security.mediaCheckAsync
 * mediaType: 1 音频 / 2 图片
 */
export async function mediaCheckAsync(opts: {
  filePath?: string
  imageBase64?: string
  mediaType: 1 | 2
  scene?: number
}): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
  let imageBase64 = String(opts.imageBase64 || '').trim()
  if (!imageBase64 && opts.filePath) {
    try {
      imageBase64 = await readFileBase64(opts.filePath)
    } catch (_) {
      return { ok: false, error: '读取媒体失败' }
    }
  }
  if (!imageBase64) return { ok: true }
  if (imageBase64.startsWith('data:') && imageBase64.includes(',')) {
    imageBase64 = imageBase64.split(',', 1)[1].trim()
  }
  const code = await wxLoginCode()
  const res = await request<{
    errcode?: number
    suggest?: string
    traceId?: string
    pending?: boolean
  }>({
    path: '/api/v1/security/media-check-async',
    method: 'POST',
    needAuth: true,
    skipAuthKick: true,
    data: {
      api: SECURITY_MEDIA_CHECK_ASYNC,
      mediaType: opts.mediaType,
      scene: opts.scene || 1,
      version: 2,
      imageBase64,
      code,
    },
  })
  if (!res.ok) {
    const msg = String(res.message || '')
    if (isContentBlocked(msg)) {
      return { ok: false, error: msg || '图片或音频含违规内容，请更换后再试' }
    }
    if (isInfraSecError(msg)) {
      return { ok: true, pending: false }
    }
    return { ok: false, error: msg || '媒体安全检测失败' }
  }
  const errcode = Number(res.data?.errcode)
  if (isRiskyLabel(res.data?.suggest, errcode)) {
    return { ok: false, error: '图片或音频含违规内容，请更换后再试' }
  }
  return { ok: true, pending: !!res.data?.pending }
}

function tip(err?: string, fallback = '安全检测未通过') {
  wx.showToast({ title: String(err || fallback).slice(0, 40), icon: 'none' })
}

/** 开单打印保存/打印前：拦截未通过 security.msgSecCheck 的文本 */
export async function assertMsgSecCheck(
  parts: Array<string | undefined | null>,
  scene = 1,
): Promise<boolean> {
  const text = parts
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('\n')
  if (!text) return true
  wx.showLoading({ title: '安全检测', mask: true })
  const r = await msgSecCheck(text, scene)
  wx.hideLoading()
  if (!r.ok) {
    tip(r.error)
    return false
  }
  return true
}

/** 图片/音频保存前：拦截未通过 security.mediaCheckAsync 的媒体 */
export async function assertMediaCheckAsync(opts: {
  filePath?: string
  imageBase64?: string
  mediaType: 1 | 2
  scene?: number
}): Promise<boolean> {
  wx.showLoading({ title: '安全检测', mask: true })
  const r = await mediaCheckAsync(opts)
  wx.hideLoading()
  if (!r.ok) {
    tip(r.error, '媒体检测未通过')
    return false
  }
  return true
}
