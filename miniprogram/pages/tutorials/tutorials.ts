import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { assertMsgSecCheck } from '../../services/sec-check'
import { findHelp, helpForTutorial } from './help-desk'
import {
  TUTORIALS,
  TUTORIAL_SCENES,
  isTutorialScene,
  sceneTitleKey,
  type TutorialScene,
} from '../../services/tutorials'

type TutorialCard = {
  id: string
  title: string
  ready: boolean
}

type TutorialGroup = {
  key: TutorialScene
  title: string
  items: TutorialCard[]
}

type DeskMsg = {
  id: number
  role: 'help' | 'me'
  text: string
  playId: string
}

function buildGroups(scene: string): TutorialGroup[] {
  const scenes = scene && isTutorialScene(scene) ? [scene] : [...TUTORIAL_SCENES]
  return scenes
    .map((key) => ({
      key,
      title: t(sceneTitleKey(key)),
      items: TUTORIALS.filter((item) => item.scene === key).map((item) => ({
        id: item.id,
        title: t(item.titleKey),
        ready: !!item.videoUrl,
      })),
    }))
    .filter((group) => group.items.length > 0)
}

Page({
  data: {
    ...i18nState(),
    groups: [] as TutorialGroup[],
    selectedId: '',
    draft: '',
    deskTail: 'm1',
    desk: [
      {
        id: 1,
        role: 'help',
        text: '点上面一条帮助文件，步骤会出现在这里。也可以直接问怎么做。',
        playId: '',
      },
    ] as DeskMsg[],
  },

  _scene: '',
  _seq: 1,
  _busy: false,

  onLoad(query: Record<string, string | undefined>) {
    this._scene = String(query.scene || '')
    bindPageI18n(this, 'tutorials')
    this.apply()
  },

  onShow() {
    this.apply()
  },

  apply() {
    const groups = buildGroups(this._scene)
    const title =
      this._scene && isTutorialScene(this._scene)
        ? t(sceneTitleKey(this._scene))
        : t('tutorials')
    wx.setNavigationBarTitle({ title })
    this.setData({ groups })
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const ready = e.currentTarget.dataset.ready === true || e.currentTarget.dataset.ready === 'true'
    const hit = helpForTutorial(id)
    const mid = ++this._seq
    const desk = (this.data.desk || []).concat([
      {
        id: mid,
        role: 'help' as const,
        text: hit.text,
        playId: ready ? id : '',
      },
    ])
    this.setData({
      selectedId: id,
      desk,
      deskTail: 'm' + mid,
    })
  },

  onPlay(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/pages/tutorials/play?id=${encodeURIComponent(id)}` })
  },

  onDraft(e: WechatMiniprogram.Input) {
    this.setData({ draft: e.detail.value })
  },

  async onAsk() {
    if (this._busy) return
    const text = String(this.data.draft || '').trim()
    if (!text) {
      wx.showToast({ title: '先写要问的用法', icon: 'none' })
      return
    }
    this._busy = true
    try {
      const ok = await assertMsgSecCheck([text])
      if (!ok) return
      const hit = findHelp(text)
      const mine = ++this._seq
      const reply = ++this._seq
      const desk = (this.data.desk || []).concat([
        { id: mine, role: 'me' as const, text, playId: '' },
        { id: reply, role: 'help' as const, text: hit.text, playId: hit.playId || '' },
      ])
      this.setData({
        desk,
        draft: '',
        deskTail: 'm' + reply,
      })
    } finally {
      this._busy = false
    }
  },
})
