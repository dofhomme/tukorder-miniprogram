/** 微信小程序胶囊按钮安全区（自定义导航栏必备） */

export type CapsuleLayout = {
  statusBarHeight: number
  /** 胶囊按钮行高度（含上下间距，与胶囊垂直对齐） */
  navBarHeight: number
  /** 状态栏 + 导航行总高度 */
  headerHeight: number
  /** 内容区右侧需预留宽度（避开胶囊） */
  capsuleSafeRight: number
  menuButton: {
    width: number
    height: number
    top: number
    right: number
    bottom: number
    left: number
  }
  windowWidth: number
}

const FALLBACK: CapsuleLayout = {
  statusBarHeight: 20,
  navBarHeight: 44,
  headerHeight: 64,
  capsuleSafeRight: 96,
  menuButton: {
    width: 87,
    height: 32,
    top: 48,
    right: 365,
    bottom: 80,
    left: 278,
  },
  windowWidth: 375,
}

let _cached: CapsuleLayout | null = null
/** 开发者工具偶发 windowMap is not iterable，失败后不再调用原生 API */
let _menuApiBroken = false
let _isDevTools: boolean | null = null

function isDevToolsEnv(): boolean {
  if (_isDevTools != null) return _isDevTools
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const d = wx.getDeviceInfo()
      if (d && String(d.platform).toLowerCase() === 'devtools') {
        _isDevTools = true
        return true
      }
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const sys = wx.getSystemInfoSync()
    if (sys && String(sys.platform).toLowerCase() === 'devtools') {
      _isDevTools = true
      return true
    }
  } catch (_) {
    /* ignore */
  }
  _isDevTools = false
  return false
}

function isValidMenu(menu: WechatMiniprogram.Rect | null | undefined): boolean {
  return (
    !!menu &&
    Number(menu.width) > 20 &&
    Number(menu.height) > 10 &&
    Number(menu.left) > 40 &&
    Number(menu.top) >= 0
  )
}

function readSystemMetrics(): { statusBarHeight: number; windowWidth: number } {
  try {
    // 优先新 API，避免部分基础库 getSystemInfoSync 告警
    const w = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : null
    if (w && (w.statusBarHeight || w.windowWidth)) {
      return {
        statusBarHeight: Number(w.statusBarHeight) || FALLBACK.statusBarHeight,
        windowWidth: Number(w.windowWidth) || FALLBACK.windowWidth,
      }
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const sys = wx.getSystemInfoSync()
    return {
      statusBarHeight: Number(sys.statusBarHeight) || FALLBACK.statusBarHeight,
      windowWidth: Number(sys.windowWidth) || FALLBACK.windowWidth,
    }
  } catch (_) {
    return {
      statusBarHeight: FALLBACK.statusBarHeight,
      windowWidth: FALLBACK.windowWidth,
    }
  }
}

/** 安全读取胶囊；失败返回 null，并标记 API 不可用（避免控制台反复报错） */
function safeMenuButtonRect(): WechatMiniprogram.Rect | null {
  // DevTools 会抛 MiniProgramError（windowMap is not iterable），即使 catch 也会刷控制台
  if (_menuApiBroken || isDevToolsEnv()) {
    _menuApiBroken = true
    return null
  }
  if (typeof wx.getMenuButtonBoundingClientRect !== 'function') {
    _menuApiBroken = true
    return null
  }
  try {
    const menu = wx.getMenuButtonBoundingClientRect()
    if (!isValidMenu(menu)) return null
    return menu
  } catch (_) {
    // 真机偶发失败：永久降级，避免反复打 Error
    _menuApiBroken = true
    return null
  }
}

function layoutFromFallback(
  statusBarHeight: number,
  windowWidth: number,
): CapsuleLayout {
  return {
    ...FALLBACK,
    statusBarHeight,
    windowWidth,
    headerHeight: statusBarHeight + FALLBACK.navBarHeight,
    capsuleSafeRight: Math.min(110, Math.floor(windowWidth * 0.28)),
  }
}

export function getCapsuleLayout(force = false): CapsuleLayout {
  if (_cached && !force) return _cached

  const { statusBarHeight, windowWidth } = readSystemMetrics()
  const menu = safeMenuButtonRect()

  if (!menu) {
    _cached = layoutFromFallback(statusBarHeight, windowWidth)
    return _cached
  }

  const gap = Math.max(0, menu.top - statusBarHeight)
  const navBarHeight = Math.max(32, gap * 2 + menu.height)
  const rawRight = windowWidth - menu.left + 8
  const capsuleSafeRight = Math.min(
    Math.max(72, rawRight),
    Math.floor(windowWidth * 0.36),
  )

  _cached = {
    statusBarHeight,
    navBarHeight,
    headerHeight: statusBarHeight + navBarHeight,
    capsuleSafeRight,
    menuButton: {
      width: menu.width,
      height: menu.height,
      top: menu.top,
      right: menu.right,
      bottom: menu.bottom,
      left: menu.left,
    },
    windowWidth,
  }
  return _cached
}

/** 供页面 data 绑定的样式对象（px） */
export function capsuleStyleVars(force = false) {
  const L = getCapsuleLayout(force)
  return {
    statusBarHeight: L.statusBarHeight,
    navBarHeight: L.navBarHeight,
    headerHeight: L.headerHeight,
    capsuleSafeRight: L.capsuleSafeRight,
    menuButtonHeight: L.menuButton.height,
    menuButtonTop: L.menuButton.top,
  }
}

/** 默认占位（不读 wx，避免 Page data 初始化阶段异常） */
export function capsuleStyleDefaults() {
  return {
    statusBarHeight: FALLBACK.statusBarHeight,
    navBarHeight: FALLBACK.navBarHeight,
    headerHeight: FALLBACK.headerHeight,
    capsuleSafeRight: FALLBACK.capsuleSafeRight,
    menuButtonHeight: FALLBACK.menuButton.height,
    menuButtonTop: FALLBACK.menuButton.top,
  }
}

/**
 * 在页面就绪后测量胶囊（避开 DevTools onLoad 阶段 windowMap 未就绪）。
 * 用法：onReady() { applyCapsuleStyle(this) }
 */
export function applyCapsuleStyle(
  page: WechatMiniprogram.Page.Instance<AnyObject, AnyObject>,
) {
  const apply = () => {
    try {
      // DevTools 直接用兜底，避免触碰胶囊 API
      if (isDevToolsEnv()) {
        const { statusBarHeight, windowWidth } = readSystemMetrics()
        const L = layoutFromFallback(statusBarHeight, windowWidth)
        page.setData({
          statusBarHeight: L.statusBarHeight,
          navBarHeight: L.navBarHeight,
          headerHeight: L.headerHeight,
          capsuleSafeRight: L.capsuleSafeRight,
          menuButtonHeight: L.menuButton.height,
          menuButtonTop: L.menuButton.top,
        })
        return
      }
      page.setData(capsuleStyleVars(true))
    } catch (_) {
      page.setData(capsuleStyleDefaults())
    }
  }
  // 下一帧再读，降低真机 onLoad 阶段未就绪概率
  if (typeof wx.nextTick === 'function') {
    wx.nextTick(apply)
  } else {
    setTimeout(apply, 0)
  }
}
