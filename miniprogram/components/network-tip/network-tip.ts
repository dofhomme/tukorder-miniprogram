import { markNetworkOk, setDeviceOffline, subscribeNetworkHint } from '../../services/network-hint'

Component({
  data: { show: false },
  lifetimes: {
    attached() {
      const off = subscribeNetworkHint((show) => {
        if (show !== this.data.show) this.setData({ show })
      })
      ;(this as unknown as { _off?: () => void })._off = off
    },
    detached() {
      const off = (this as unknown as { _off?: () => void })._off
      if (off) off()
    },
  },
  methods: {
    onRetry() {
      wx.getNetworkType({
        success: (res) => {
          const down = res.networkType === 'none'
          setDeviceOffline(down)
          if (!down) markNetworkOk()
          else wx.showToast({ title: '仍未连上网络', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '仍未连上网络', icon: 'none' }),
      })
    },
  },
})
