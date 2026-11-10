/** 微信同声传译 WechatSI 0.3.10：按住说话转文字。电脑端不调用 requirePlugin。 */

import { canLoadVoicePlugin } from '../../services/voice-si'

const MAX_MS = 15000

type SiManager = {
  start: (opts: { duration?: number; lang?: string }) => void
  stop: () => void
  onStart?: (res: { msg?: string }) => void
  onRecognize?: (res: { result?: string }) => void
  onStop?: (res: { result?: string; duration?: number }) => void
  onError?: (res: { retcode?: number; msg?: string }) => void
}

type ListenHandlers = {
  onStart?: () => void
  onPartial?: (text: string) => void
  onResult: (text: string) => void
  onError: (msg: string) => void
}

let _mgr: SiManager | null | undefined
let _bound = false
let _partial = ''
let _ignoreStop = false
let _handlers: ListenHandlers | null = null

function errorText(code: number, msg?: string) {
  if (code === -30001) return '麦克风不可用'
  if (code === -30003 || code === -30004) return '没听清，请再说一次'
  if (code === -30005) return '语音识别服务异常'
  if (code === -30006) return '识别超时，请再说短一点'
  if (code === -30011) return '正在识别，请稍后再说'
  if (code === -40001) return '语音识别繁忙，请稍后再试'
  return String(msg || '语音识别失败')
}

function bindManager(mgr: SiManager) {
  if (_bound) return
  _bound = true
  mgr.onStart = () => {
    _partial = ''
    if (_handlers && _handlers.onStart) _handlers.onStart()
  }
  mgr.onRecognize = (res) => {
    const raw = res as { result?: unknown; text?: unknown } | string | undefined
    let t = ''
    if (typeof raw === 'string') t = raw.trim()
    else if (raw) {
      const piece = raw.result != null ? raw.result : raw.text
      t = String(piece || '').trim()
    }
    if (!t) return
    const prev = _partial
    _partial = t.length >= prev.length || t.startsWith(prev) ? t : prev + t
    if (_handlers && _handlers.onPartial) _handlers.onPartial(_partial)
  }
  mgr.onStop = (res) => {
    const ignore = _ignoreStop
    _ignoreStop = false
    const text = String(res?.result || _partial || '').trim()
    const dur = Number(res?.duration || 0)
    const cb = _handlers
    _handlers = null
    _partial = ''
    if (!cb || ignore) return
    if (dur > 0 && dur < 350) {
      cb.onError('说话时间太短')
      return
    }
    if (!text) {
      cb.onError('没听清，请再说一次')
      return
    }
    cb.onResult(text)
  }
  mgr.onError = (res) => {
    const code = Number(res?.retcode || 0)
    const ignore = _ignoreStop
    _ignoreStop = false
    const cb = _handlers
    _handlers = null
    _partial = ''
    if (!cb || ignore) return
    if (code === -30002 || code === -30012) return
    cb.onError(errorText(code, res?.msg))
  }
}

function pluginToManager(plugin: { getRecordRecognitionManager?: () => SiManager } | null): SiManager | null {
  if (!plugin || typeof plugin.getRecordRecognitionManager !== 'function') return null
  const mgr = plugin.getRecordRecognitionManager()
  if (mgr) bindManager(mgr)
  return mgr
}

function loadPlugin(): SiManager | null {
  if (_mgr !== undefined) return _mgr
  if (!canLoadVoicePlugin()) {
    _mgr = null
    return _mgr
  }
  try {
    const plugin = requirePlugin('WechatSI') as { getRecordRecognitionManager?: () => SiManager }
    _mgr = pluginToManager(plugin)
  } catch (_) {
    _mgr = null
  }
  return _mgr
}

export function ensureMicAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    const askRecord = () => {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: () => {
          wx.showModal({
            title: '需要麦克风',
            content: '语音填单需要麦克风，用于把说话转成开单文字。',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting({})
            },
          })
          resolve(false)
        },
      })
    }
    const wxAny = wx as WechatMiniprogram.Wx & {
      requirePrivacyAuthorize?: (opt: { success?: () => void; fail?: () => void }) => void
    }
    if (typeof wxAny.requirePrivacyAuthorize === 'function') {
      wxAny.requirePrivacyAuthorize({
        success: askRecord,
        fail: () => resolve(false),
      })
      return
    }
    askRecord()
  })
}

export function startVoiceListen(handlers: ListenHandlers): boolean {
  _partial = ''
  _handlers = handlers
  const mgr = loadPlugin()
  if (!mgr) {
    _handlers = null
    handlers.onError(
      canLoadVoicePlugin() ? '语音插件未加载，请重新点预览后再试' : '电脑端不加载语音插件，请用手机预览',
    )
    return false
  }
  try {
    mgr.start({ duration: MAX_MS, lang: 'zh_CN' })
    return true
  } catch (e: any) {
    _handlers = null
    handlers.onError(String(e?.errMsg || e?.message || '无法开始录音'))
    return false
  }
}

export function stopVoiceListen() {
  if (!_mgr) return
  try {
    _mgr.stop()
  } catch (_) {}
}

/** 上滑取消：停掉识别，不把文字送去开单。 */
export function cancelVoiceListen() {
  _ignoreStop = true
  _partial = ''
  if (!_mgr) {
    _handlers = null
    _ignoreStop = false
    return
  }
  try {
    _mgr.stop()
  } catch (_) {
    _handlers = null
    _ignoreStop = false
  }
}
