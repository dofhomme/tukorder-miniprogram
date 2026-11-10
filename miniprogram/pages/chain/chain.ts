import { CacheKeys, cachePeek, cacheRemove, cacheSet } from '../../services/cache'
import { countListedSupplyCosts, fetchSupplyAgents, fetchSupplyMap, type SupplyBlock } from '../../services/supply'
import { isAgentAccount, supplyEntryBlock } from '../../services/team'
import { getTabItems, i18nState, t, tabIndexFor } from '../../services/i18n'
import { isAgentWorkspace, tabBarTheme } from '../../services/workspace'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'

const ROUTES: Record<string, string> = {
  style: '/pages/supply/styles',
  fabric: '/pages/supply/parties?role=fabric',
  trim: '/pages/supply/parties?role=trim',
  factory: '/pages/supply/parties?role=factory',
  supplier: '/pages/supply/parties?role=supplier',
  cost: '/pages/supply/cost',
  agent: '/pages/supply/agents',
  margin: '/pages/analytics/analytics?tab=2',
}

const RING = ['style', 'fabric', 'trim', 'factory', 'agent', 'supplier', 'margin']

const TITLE: Record<string, string> = {
  style: 'chainStyle',
  fabric: 'chainFabric',
  trim: 'chainTrim',
  factory: 'chainFactory',
  supplier: 'chainSupplier',
  agent: 'chainAgent',
  margin: 'chainSales',
  cost: 'chainCost',
}

const UNIT: Record<string, string> = {
  style: 'chainUnitStyle',
  cost: 'chainUnitStyle',
  fabric: 'chainUnitShop',
  trim: 'chainUnitShop',
  factory: 'chainUnitShop',
  supplier: 'chainUnitShop',
  agent: 'chainUnitShop',
}

const HINT: Record<string, string> = {
  fabric: 'chainUnpaid',
  trim: 'chainUnpaid',
  factory: 'chainUnpaid',
  supplier: 'chainUnpaid',
  agent: 'chainUncollected',
  margin: 'chainLinkedSum',
}

const ICON: Record<string, string> = {
  style: '/assets/supply/style.svg',
  fabric: '/assets/supply/fabric.svg',
  trim: '/assets/supply/trim.svg',
  factory: '/assets/supply/factory.svg',
  supplier: '/assets/supply/supplier.svg',
  agent: '/assets/supply/agent.svg',
  margin: '/assets/supply/margin.svg',
  cost: '/assets/supply/cost.svg',
}

type RingBlock = SupplyBlock & {
  countText: string
  amountText: string
  meta: string
  icon: string
  style: string
}

function ringStyle(index: number, total: number): string {
  const angle = ((-90 + (360 / total) * index) * Math.PI) / 180
  const radius = 33
  const x = 50 + Math.cos(angle) * radius
  const y = 50 + Math.sin(angle) * radius
  return `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;`
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    ...i18nState(),
    loading: true,
    q: '',
    ring: [] as RingBlock[],
    hub: null as RingBlock | null,
    focus: '',
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onShow() {
    if (isAgentWorkspace() || isAgentAccount()) {
      wx.switchTab({ url: '/pages/home/home' })
      return
    }
    this._shown = true
    const run = () => {
      if (!this._shown) return
      this.setData(i18nState())
      const bar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
      if (bar) {
        bar.setData({
          selected: tabIndexFor('chain'),
          hidden: false,
          list: getTabItems(),
          theme: tabBarTheme(),
        })
      }
      const block = supplyEntryBlock()
      if (block === 'pay') {
        wx.switchTab({
          url: '/pages/home/home',
          complete: () => {
            wx.navigateTo({ url: '/pages/subscription/subscription?from=supply' })
          },
        })
        return
      }
      if (block === 'agent' || block === 'staff') {
        wx.showToast({
          title: block === 'agent' ? '代理不能打开供应链' : '没有供应链权限',
          icon: 'none',
        })
        wx.switchTab({ url: '/pages/home/home' })
        return
      }
      void this.load()
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(run)
    else setTimeout(run, 0)
  },

  onHide() {
    this._shown = false
  },

  async load() {
    const q = String(this.data.q || '').trim()
    const listedCount = countListedSupplyCosts().catch(() => null)
    if (!q && !this.data.ring.length) {
      const cached = cachePeek<SupplyBlock[]>(CacheKeys.supplyMap)
      if (cached && cached.length) this.paint(cached)
    }
    const r = await fetchSupplyMap(q)
    if (!r.ok || !r.data) {
      this.setData({ loading: false })
      const msg = r.message || t('loadFailed')
      wx.showToast({ title: msg, icon: 'none' })
      if (msg.indexOf('供应链') >= 0 || msg.indexOf('代理') >= 0) {
        cacheRemove(CacheKeys.supplyMap)
        wx.switchTab({ url: '/pages/home/home' })
      }
      return
    }
    const blocks = r.data.blocks || []
    const agents = await fetchSupplyAgents()
    if (agents.ok && agents.data) {
      const sales = (agents.data.items || []).reduce(
        (sum, item) => sum + (Number(item.unpaidSales) || 0),
        0,
      )
      const agent = blocks.find((block) => block.key === 'agent')
      if (agent) {
        const n = Math.round(sales * 100) / 100
        agent.amount = n > 0.004 ? n : null
        agent.alert = n > 0.004
      }
    }
    const costCount = await listedCount
    if (costCount != null) {
      const cost = blocks.find((block) => block.key === 'cost')
      if (cost) cost.count = costCount
    }
    if (!q) cacheSet(CacheKeys.supplyMap, blocks)
    this.paint(blocks)
  },

  paint(blocks: SupplyBlock[]) {
    const byKey: Record<string, SupplyBlock> = {}
    for (const block of blocks) byKey[block.key] = block
    const paint = (block: SupplyBlock | undefined, index: number): RingBlock | null => {
      if (!block) return null
      const unit = UNIT[block.key] ? t(UNIT[block.key]) : block.unit || ''
      const hintKey =
        block.key === 'cost'
          ? block.hint === '实际单件'
            ? 'chainLiveUnit'
            : block.hint === '档案价'
              ? 'chainArchive'
              : ''
          : HINT[block.key] || ''
      const hint = hintKey ? t(hintKey) : block.hint || ''
      const countText = block.count == null ? '' : `${block.count}${unit}`
      const amountText = block.amount == null
        ? ''
        : `${block.hint === '未付' ? '-' : ''}¥${block.amount}`
      return {
        ...block,
        title: TITLE[block.key] ? t(TITLE[block.key]) : block.title,
        unit,
        hint,
        countText,
        amountText,
        meta: amountText || countText || hint,
        icon: ICON[block.key] || '',
        style: index < 0 ? '' : ringStyle(index, RING.length),
      }
    }
    const ring = RING.map((key, index) => paint(byKey[key], index)).filter(
      (item): item is RingBlock => !!item,
    )
    this.setData({
      loading: false,
      ring,
      hub: paint(byKey.cost, -1),
    })
  },

  onSearch(e: WechatMiniprogram.Input) {
    this.setData({ q: e.detail.value || '' })
  },

  onSearchTap() {
    void this.load()
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    const url = ROUTES[key]
    if (!url) return
    this.setData({ focus: key })
    wx.navigateTo({ url })
  },
})
