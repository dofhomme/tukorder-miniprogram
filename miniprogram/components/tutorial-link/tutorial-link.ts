import { t } from '../../services/i18n'
import { tutorialsEnabled } from '../../services/tutorials'

Component({
  properties: {
    scene: { type: String, value: '' },
  },
  data: {
    label: '帮助',
    enabled: true,
  },
  pageLifetimes: {
    show() {
      this.setData({ label: t('tutorialShort'), enabled: tutorialsEnabled() })
    },
  },
  lifetimes: {
    attached() {
      this.setData({ label: t('tutorialShort'), enabled: tutorialsEnabled() })
    },
  },
  methods: {
    onOpen() {
      const scene = String(this.properties.scene || '').trim()
      const query = scene ? `?scene=${encodeURIComponent(scene)}` : ''
      wx.navigateTo({ url: `/pages/tutorials/tutorials${query}` })
    },
  },
})
