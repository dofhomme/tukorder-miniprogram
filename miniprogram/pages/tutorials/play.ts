import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { findTutorial } from '../../services/tutorials'

function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`
}

function windowBox() {
  if (typeof wx.getWindowInfo === 'function') {
    const info = wx.getWindowInfo()
    return { w: info.windowWidth, h: info.windowHeight }
  }
  const info = wx.getSystemInfoSync()
  return { w: info.windowWidth, h: info.windowHeight }
}

Page({
  data: {
    ...i18nState(),
    title: '',
    videoUrl: '',
    missing: false,
    pageH: 600,
    playerW: 320,
    playerH: 480,
    playing: false,
    full: false,
    current: 0,
    duration: 0,
    durationMax: 1,
    timeText: '00:00 / 00:00',
  },

  _vw: 480,
  _vh: 1062,
  _drag: false,

  onLoad(query: Record<string, string | undefined>) {
    bindPageI18n(this, 'tutorials')
    this.setData(this.fit())
    const lesson = findTutorial(String(query.id || ''))
    if (!lesson) {
      this.setData({ missing: true, title: t('tutorials') })
      return
    }
    const title = t(lesson.titleKey)
    wx.setNavigationBarTitle({ title })
    this.setData({
      title,
      videoUrl: lesson.videoUrl,
      missing: !lesson.videoUrl,
    })
  },

  fit() {
    const box = windowBox()
    const titlePx = 52
    const barPx = 44
    const availH = Math.max(180, box.h - titlePx - barPx)
    const aspect = this._vw > 0 && this._vh > 0 ? this._vw / this._vh : 480 / 1062
    let h = availH
    let w = h * aspect
    if (w > box.w) {
      w = box.w
      h = w / aspect
    }
    return {
      pageH: box.h,
      playerW: Math.floor(w),
      playerH: Math.floor(h),
    }
  },

  onMeta(e: WechatMiniprogram.VideoLoadedMetadata) {
    const width = Number(e.detail.width || 0)
    const height = Number(e.detail.height || 0)
    const duration = Number(e.detail.duration || 0)
    if (width > 0 && height > 0) {
      this._vw = width
      this._vh = height
    }
    this.setData({
      ...this.fit(),
      duration,
      durationMax: Math.max(1, Math.floor(duration)),
      timeText: `00:00 / ${clock(duration)}`,
    })
  },

  onPlay() {
    this.setData({ playing: true })
  },

  onPause() {
    this.setData({ playing: false })
  },

  onEnded() {
    this.setData({ playing: false })
  },

  onTime(e: WechatMiniprogram.VideoTimeUpdate) {
    if (this._drag) return
    const current = Number(e.detail.currentTime || 0)
    const duration = Number(e.detail.duration || this.data.duration || 0)
    this.setData({
      current,
      duration,
      durationMax: Math.max(1, Math.floor(duration)),
      timeText: `${clock(current)} / ${clock(duration)}`,
    })
  },

  onToggle() {
    const ctx = wx.createVideoContext('lessonVideo', this)
    if (this.data.playing) ctx.pause()
    else ctx.play()
  },

  onSeeking() {
    this._drag = true
  },

  onSeek(e: WechatMiniprogram.SliderChange) {
    const pos = Number(e.detail.value || 0)
    this._drag = false
    wx.createVideoContext('lessonVideo', this).seek(pos)
    this.setData({ current: pos })
  },

  onFullTap() {
    const ctx = wx.createVideoContext('lessonVideo', this)
    if (this.data.full) ctx.exitFullScreen()
    else ctx.requestFullScreen({ direction: 0 })
  },

  onFull(e: WechatMiniprogram.VideoFullScreenChange) {
    this.setData({ full: !!e.detail.fullScreen })
  },

  onVideoError() {
    wx.showToast({ title: t('tutorialSoon'), icon: 'none' })
  },
})
