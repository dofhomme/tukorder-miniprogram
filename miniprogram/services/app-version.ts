/** 小程序版本与云端 App 版本检查（对齐 App UpdateDiagnoseDialog） */

import { API_BASE, request } from './api'

/** 与小程序上传版本号保持一致。正式版界面优先显示微信后台的版本号。 */
export const MP_VERSION = '2.0.17'
export const MP_BUILD = 166

export interface RemoteAppVersion {
  version: string
  build: number
  forceUpdate: boolean
  downloadUrl: string
  notes: string
}

export function localVersionLabel(): string {
  try {
    const acc = wx.getAccountInfoSync()
    const env = acc?.miniProgram?.envVersion
    const pub = (acc?.miniProgram?.version || '').trim()
    // 正式版用微信后台版本号；开发/体验版用内置常量
    if (env === 'release' && pub) {
      return `V${pub}`
    }
  } catch (_) {}
  return `V${MP_VERSION}`
}

export function localBuild(): number {
  return MP_BUILD
}

function compareSemver(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split(/[.\-+]/)
      .map((e) => parseInt(e.trim(), 10) || 0)
  const pa = parts(a)
  const pb = parts(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da - db
  }
  return 0
}

export function isRemoteNewer(remote: RemoteAppVersion): boolean {
  const local = localBuild()
  if (remote.build > local) return true
  if (remote.build < local) return false
  return compareSemver(remote.version, MP_VERSION) > 0
}

export async function fetchRemoteAppVersion(): Promise<{
  ok: boolean
  error?: string
  remote?: RemoteAppVersion
}> {
  const res = await request<Record<string, unknown>>({
    path: `/api/v1/app/version?_t=${Date.now()}`,
    // version 接口通常无需登录；request 会带 token 也无妨
  })
  if (!res.ok || !res.data) {
    return { ok: false, error: res.message || '获取服务器版本失败' }
  }
  const d = res.data
  const version = String(d.version || d.versionName || '').trim()
  const buildRaw = d.build ?? d.buildNumber
  const build =
    typeof buildRaw === 'number'
      ? buildRaw
      : parseInt(String(buildRaw || '0'), 10) || 0
  if (!version || build <= 0) {
    return { ok: false, error: '云端未配置有效版本号' }
  }
  return {
    ok: true,
    remote: {
      version,
      build,
      forceUpdate: d.forceUpdate === true || d.force === true,
      downloadUrl: String(d.downloadUrl || d.apkUrl || '').trim() ||
        `${API_BASE}/downloads/tukorder.apk`,
      notes: String(d.notes || d.releaseNotes || '').trim(),
    },
  }
}

/** 检查微信小程序自身是否有待更新包 */
export function checkMpUpdate(): Promise<{
  hasUpdate: boolean
  ready: boolean
  error?: string
}> {
  return new Promise((resolve) => {
    if (typeof wx.getUpdateManager !== 'function') {
      resolve({ hasUpdate: false, ready: false, error: '当前基础库不支持更新检查' })
      return
    }
    const um = wx.getUpdateManager()
    let settled = false
    const done = (v: { hasUpdate: boolean; ready: boolean; error?: string }) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    setTimeout(() => done({ hasUpdate: false, ready: false, error: '检查超时' }), 8000)
    um.onCheckForUpdate((res) => {
      if (!res.hasUpdate) {
        done({ hasUpdate: false, ready: false })
      }
      // 有更新时等 onUpdateReady
    })
    um.onUpdateReady(() => {
      done({ hasUpdate: true, ready: true })
    })
    um.onUpdateFailed(() => {
      done({ hasUpdate: true, ready: false, error: '新版本下载失败，请删除小程序后重进' })
    })
  })
}

type MpUpdatePhase = 'idle' | 'ready' | 'none' | 'failed'

let mpUpdatePhase: MpUpdatePhase = 'idle'
let mpUpdateWatching = false
const mpUpdateSubs = new Set<(phase: MpUpdatePhase) => void>()

function setMpUpdatePhase(next: MpUpdatePhase) {
  mpUpdatePhase = next
  mpUpdateSubs.forEach((fn) => {
    try {
      fn(next)
    } catch (_) {}
  })
}

/** App 启动时尽早挂上更新监听，底栏用结果决定要不要显示「立即更新」 */
export function watchMpUpdate() {
  if (mpUpdateWatching) return
  mpUpdateWatching = true
  if (typeof wx.getUpdateManager !== 'function') {
    setMpUpdatePhase('none')
    return
  }
  const um = wx.getUpdateManager()
  um.onCheckForUpdate((res) => {
    if (!res.hasUpdate && mpUpdatePhase !== 'ready') setMpUpdatePhase('none')
  })
  um.onUpdateReady(() => {
    setMpUpdatePhase('ready')
  })
  um.onUpdateFailed(() => {
    if (mpUpdatePhase !== 'ready') setMpUpdatePhase('failed')
  })
}

export function isMpUpdateReady(): boolean {
  return mpUpdatePhase === 'ready'
}

export function subscribeMpUpdate(cb: (phase: MpUpdatePhase) => void): () => void {
  mpUpdateSubs.add(cb)
  if (!mpUpdateWatching) watchMpUpdate()
  return () => {
    mpUpdateSubs.delete(cb)
  }
}

export function applyMpUpdate() {
  if (typeof wx.getUpdateManager !== 'function') return
  const um = wx.getUpdateManager()
  um.applyUpdate()
}

export function openAppDownload(url: string) {
  const link = url || `${API_BASE}/downloads/tukorder.apk`
  wx.setClipboardData({
    data: link,
    success: () => {
      wx.showModal({
        title: '下载链接已复制',
        content:
          '小程序无法直接安装 App 安装包。链接已复制，请用手机浏览器打开下载「图可开单打印」App。\n\n' +
          link,
        showCancel: false,
        confirmText: '知道了',
      })
    },
  })
}
