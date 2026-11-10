const { getTabItems } = require('../services/i18n')
const { tabBarTheme } = require('../services/workspace')
const { requestBillSubscribe } = require('../services/subscribe')
const { isCloudSyncAllowed } = require('../services/subscription')
const appVersion = require('../services/app-version')
const applyMpUpdate =
  typeof appVersion.applyMpUpdate === 'function' ? appVersion.applyMpUpdate : function () {}
const isMpUpdateReady =
  typeof appVersion.isMpUpdateReady === 'function' ? appVersion.isMpUpdateReady : function () { return false }
const subscribeMpUpdate =
  typeof appVersion.subscribeMpUpdate === 'function'
    ? appVersion.subscribeMpUpdate
    : function () { return function () {} }

Component({
  data: {
    selected: 0,
    hidden: false,
    updateReady: false,
    theme: tabBarTheme(),
    list: getTabItems(),
  },

  lifetimes: {
    ready() {
      this._ready = true
      this.setData({ updateReady: isMpUpdateReady() })
      this._unsubUpdate = subscribeMpUpdate((phase) => {
        if (!this._ready) return
        const ready = phase === 'ready'
        if (ready !== this.data.updateReady) this.setData({ updateReady: ready })
      })
      this.syncBar()
    },
    detached() {
      this._ready = false
      if (this._unsubUpdate) this._unsubUpdate()
    },
  },

  pageLifetimes: {
    show() {
      if (this._ready) this.syncBar()
    },
  },

  methods: {
    syncBar() {
      const list = getTabItems()
      const theme = tabBarTheme()
      const pages = getCurrentPages() || []
      const raw = pages.length ? String(pages[pages.length - 1].route || '') : ''
      const route = raw && raw.charAt(0) !== '/' ? '/' + raw : raw
      let selected = this.data.selected
      const idx = list.findIndex((item) => item.pagePath === route)
      if (idx >= 0) selected = idx
      const prev = this.data.list || []
      const same = this.data.theme === theme
        && this.data.selected === selected
        && prev.length === list.length
        && prev.every((item, i) => item && list[i] && item.text === list[i].text && item.pagePath === list[i].pagePath && item.iconPath === list[i].iconPath && item.selectedIconPath === list[i].selectedIconPath)
      if (same) return
      this.setData({ list, theme, selected })
    },

    onApplyUpdate() {
      applyMpUpdate()
    },

    onSwitch(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      const path = String(ds.path || '')
      const i = Number(ds.index)
      if (!path || i !== i) return
      if (path.indexOf('/pages/chain/chain') >= 0 && !isCloudSyncAllowed()) {
        wx.navigateTo({ url: '/pages/subscription/subscription?from=supply' })
        return
      }

      // 已在当前页：只保证底栏可见，不再 switchTab
      if (this.data.selected === i && !this.data.hidden) {
        return
      }
      if (this._switching) return
      this._switching = true

      // 须在点击回调里调起；代理点 Tab 即续一次账单通知额度
      if (this.data.theme === 'agent') {
        try {
          requestBillSubscribe()
        } catch (_) {}
      }

      // 先立刻切页，再改选中态，避免 setData 渲染抢在 switchTab 前面造成延迟
      wx.switchTab({
        url: path,
        fail() {},
        complete: () => {
          setTimeout(() => {
            this._switching = false
          }, 280)
        },
      })
      this.setData({ selected: i, hidden: false })
    },
  },
})
