type ResolveFn = (v: 'reconnect' | 'cancel') => void

type OpenOpts = {
  title?: string
  searching?: boolean
  hint?: string
  /** 确认后跳转；打开搜索页，不自动连上次的打印机 */
  printerUrl?: string
}

Component({
  data: {
    visible: false,
    searching: false,
    title: '未连接打印机',
    hint: '',
    confirmText: '重新连接',
    tips: [] as string[],
  },

  lifetimes: {
    attached() {
      ;(this as any)._resolve = null as ResolveFn | null
      ;(this as any)._printerUrl = '/pages/printer/printer'
    },
  },

  methods: {
    open(opts?: OpenOpts, resolve?: ResolveFn) {
      const searching = !!opts?.searching
      const title = opts?.title || (searching ? '蓝牙搜索中' : '未连接打印机')
      const hint =
        (opts?.hint || '').trim() ||
        '请打开蓝牙打印机，并确认手机已开启蓝牙与定位权限。'
      const tips = [
        '打开蓝牙打印机',
        '打开手机蓝牙和手机定位',
        '设置 → 微信 → 位置信息 / 附近设备 → 允许本小程序',
        '若仍搜不到，请先在系统蓝牙里配对打印机，再从搜索结果里点选连接',
      ]
      ;(this as any)._resolve = resolve || null
      ;(this as any)._printerUrl = opts?.printerUrl || '/pages/printer/printer'
      this.setData({
        visible: true,
        searching,
        title,
        hint,
        confirmText: '去搜索连接',
        tips,
      })
    },

    close(result: 'reconnect' | 'cancel') {
      if (!this.data.visible) return
      this.setData({ visible: false })
      const resolve = (this as any)._resolve as ResolveFn | null
      ;(this as any)._resolve = null
      if (resolve) resolve(result)
      this.triggerEvent(result === 'reconnect' ? 'reconnect' : 'cancel')
    },

    noop() {},

    onCancel() {
      this.close('cancel')
    },

    onOpenSettings() {
      wx.openSetting({})
    },

    onConfirm() {
      const url = String((this as any)._printerUrl || '')
      this.close('reconnect')
      // printerUrl 为空或 local：由宿主页 bind:reconnect 自行扫描/连接
      if (!url || url === 'local') return
      wx.navigateTo({
        url,
        fail: () => {
          // 已在目标页时改用 redirect / 触发宿主
          wx.redirectTo({ url, fail: () => {} })
        },
      })
    },
  },
})
