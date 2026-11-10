/**
 * 未连接打印机时的统一提示（对齐 App BluetoothSearchBottomSheet）
 * 优先打开当前页的 <bluetooth-search-sheet id="btSheet" />，否则回退系统弹窗。
 */

export type BtDialogResult = 'reconnect' | 'cancel'

export type BtDialogOpts = {
  title?: string
  searching?: boolean
  hint?: string
  /** 确认后跳转；打开搜索页，不自动连上次的打印机 */
  printerUrl?: string
}

function findBtSheet(): WechatMiniprogram.Component.TrivialInstance | null {
  try {
    const pages = getCurrentPages()
    const cur = pages[pages.length - 1] as WechatMiniprogram.Page.Instance<
      Record<string, any>,
      Record<string, any>
    > & { selectComponent?: (s: string) => any }
    if (!cur || typeof cur.selectComponent !== 'function') return null
    const sheet = cur.selectComponent('#btSheet')
    if (sheet && typeof sheet.open === 'function') return sheet
  } catch (_) {
    /* ignore */
  }
  return null
}

export function showBluetoothSetupDialog(
  opts?: BtDialogOpts,
): Promise<BtDialogResult> {
  const searching = !!opts?.searching
  const title = opts?.title || (searching ? '蓝牙搜索中' : '未连接打印机')
  const hint =
    opts?.hint ||
    '请打开蓝牙打印机，并确认手机已开启蓝牙与定位权限。'
  const printerUrl = opts?.printerUrl || '/pages/printer/printer'

  const sheet = findBtSheet()
  if (sheet) {
    return new Promise((resolve) => {
      ;(sheet as any).open(
        { title, searching, hint, printerUrl },
        (v: BtDialogResult) => resolve(v),
      )
    })
  }

  // 当前页未挂载组件：跳到打印机页并弹出同款层
  return new Promise((resolve) => {
    const q = [
      'sheet=1',
      searching ? 'searching=1' : 'searching=0',
      'auto=0',
    ].join('&')
    wx.navigateTo({
      url: `/pages/printer/printer?${q}`,
      success: () => resolve('reconnect'),
      fail: () => {
        // 最后回退系统弹窗
        const tips = [
          '打开蓝牙打印机',
          '打开手机蓝牙和手机定位',
          '设置 → 微信 → 位置信息 / 附近设备 → 允许本小程序',
          '若仍搜不到，请先在系统蓝牙里配对打印机，再点「重新连接」',
        ]
        const content = [hint, '', '温馨提示：', ...tips.map((t, i) => `${i + 1}、${t}`)].join(
          '\n',
        )
        wx.showModal({
          title,
          content,
          confirmText: searching ? '自动连接' : '重新连接',
          confirmColor: '#07C160',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: printerUrl })
              resolve('reconnect')
            } else {
              resolve('cancel')
            }
          },
          fail: () => resolve('cancel'),
        })
      },
    })
  })
}
