import { isLoggedIn } from './services/session'
import { ensureUgPack, getLocale } from './services/i18n'
import {
  onAppShowSessionCheck,
  startSessionGuard,
} from './services/session-guard'
import { flushOrderSyncQueue } from './services/team'
import { isAgentWorkspace, resetDevelopLaunchWorkspace } from './services/workspace'
import { captureLaunchInvites, handleScannedAgentInvite } from './services/lookup'
import { watchDeviceNetwork } from './services/network-hint'
import * as appVersion from './services/app-version'

App<IAppOption>({
  globalData: {},
  _bgTimer: 0 as ReturnType<typeof setTimeout> | 0,
  onLaunch(options) {
    resetDevelopLaunchWorkspace()
    watchDeviceNetwork()
    captureLaunchInvites(options?.query)
    handleScannedAgentInvite(options)
    // 自定义 tabBar：隐藏原生底栏，避免「两截底部颜色」
    wx.hideTabBar({ animation: false, fail() {} })
    if (typeof appVersion.watchMpUpdate === 'function') appVersion.watchMpUpdate()
    if (isLoggedIn()) {
      startSessionGuard()
    }
    if (getLocale() === 'ug') void ensureUgPack()
    if (isAgentWorkspace()) return
    // 首屏先出来，打印机重连和未同步账单稍后再做
    this.deferBackgroundWork()
  },
  onShow(options) {
    captureLaunchInvites(options?.query)
    handleScannedAgentInvite(options)
    onAppShowSessionCheck()
    if (isAgentWorkspace()) return
    this.deferBackgroundWork()
  },
  deferBackgroundWork() {
    if (this._bgTimer) clearTimeout(this._bgTimer)
    this._bgTimer = setTimeout(() => {
      this._bgTimer = 0
      void flushOrderSyncQueue()
    }, 1200) as unknown as number
  },
})
