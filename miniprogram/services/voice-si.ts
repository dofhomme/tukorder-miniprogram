/** 仅开关记忆，不含插件。插件只在开单页分包、且仅手机端加载。 */

import { isCloudSyncAllowed } from './subscription'

export const VOICE_FAB_KEY = 'tuk_voice_fab'

let _plat: string | null = null

function devicePlatform(): string {
  if (_plat != null) return _plat
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const p = String(wx.getDeviceInfo().platform || '').toLowerCase()
      if (p) {
        _plat = p
        return _plat
      }
    }
  } catch (_) {}
  try {
    _plat = String(wx.getSystemInfoSync().platform || '').toLowerCase()
  } catch (_) {
    _plat = ''
  }
  return _plat
}

/** 仅 iOS / Android / 鸿蒙手机加载 WechatSI。开发者工具、Windows、Mac 不 requirePlugin。 */
export function canLoadVoicePlugin(): boolean {
  const p = devicePlatform()
  if (p === 'devtools' || p === 'windows' || p === 'mac' || p === 'ohos_pc') return false
  return true
}

export function isVoiceFabOn(): boolean {
  if (!canLoadVoicePlugin() || !isCloudSyncAllowed()) return false
  try {
    return wx.getStorageSync(VOICE_FAB_KEY) === '1'
  } catch (_) {}
  return false
}

export function setVoiceFabOn(on: boolean) {
  try {
    wx.setStorageSync(VOICE_FAB_KEY, on ? '1' : '0')
  } catch (_) {}
}
