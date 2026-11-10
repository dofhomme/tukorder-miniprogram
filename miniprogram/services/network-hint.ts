/** 无网络或请求超时后，让页面上的网络提示卡显示出来。 */

let offline = false
let poorUntil = 0
const subs = new Set<(show: boolean) => void>()
let watching = false

function visible() {
  return offline || Date.now() < poorUntil
}

function emit() {
  const show = visible()
  subs.forEach((fn) => fn(show))
}

export function subscribeNetworkHint(fn: (show: boolean) => void) {
  subs.add(fn)
  fn(visible())
  return () => {
    subs.delete(fn)
  }
}

export function setDeviceOffline(value: boolean) {
  offline = value
  if (value) poorUntil = 0
  emit()
}

export function markPoorNetwork() {
  poorUntil = Date.now() + 5000
  emit()
  setTimeout(emit, 5200)
}

export function markNetworkOk() {
  if (poorUntil === 0) return
  poorUntil = 0
  emit()
}

export function watchDeviceNetwork() {
  if (watching) return
  watching = true
  wx.getNetworkType({
    success: (res) => setDeviceOffline(res.networkType === 'none'),
    fail: () => setDeviceOffline(true),
  })
  wx.onNetworkStatusChange((res) => setDeviceOffline(!res.isConnected))
}
