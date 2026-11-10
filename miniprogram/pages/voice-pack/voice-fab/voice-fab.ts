import { requireCloudSync } from '../../../services/account-gate'
import { t } from '../../../services/i18n'
import { canLoadVoicePlugin } from '../../../services/voice-si'
import { playVoiceSendSfx, vibrateVoiceHold } from '../sfx'
import { cancelVoiceListen, ensureMicAuth, startVoiceListen, stopVoiceListen } from '../si'
import { cancelTencentListen, startTencentListen, stopTencentListen, warmTencentListen } from '../tencent-asr'
import { currentVoiceEngine, type VoiceEngine } from '../voice-mode'

const BAR_COUNT = 56
const CANCEL_LIFT = 72
const SLOTS = Array.from({ length: BAR_COUNT }, (_, i) => i)

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  幺: 1,
  二: 2,
  贰: 2,
  两: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
}

const CN_CHAR = '零〇一二三四五六七八九幺两壹贰叁肆伍陆柒捌玖十百千万亿'
const NUM_RE = new RegExp(`[${CN_CHAR}]+`, 'g')

function cnValue(token: string): number | null {
  let total = 0
  let section = 0
  let num = 0
  let seen = false
  for (const ch of token) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch]
      seen = true
      continue
    }
    if (ch === '十' || ch === '百' || ch === '千') {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000
      section += (num || 1) * unit
      num = 0
      seen = true
      continue
    }
    if (ch === '万' || ch === '亿') {
      const unit = ch === '万' ? 10000 : 100000000
      total += (section + num) * unit
      section = 0
      num = 0
      seen = true
      continue
    }
    return null
  }
  if (!seen) return null
  return total + section + num
}

/** 屏幕上的语音文字：数量和货号里的中文数字改成阿拉伯数字。 */
function arabicVoiceText(raw: string): string {
  return String(raw || '').replace(NUM_RE, (token, offset: number, all: string) => {
    const next = all.slice(offset + token.length)
    if (token === '一' && /^(直|下|些|样|般|起|定|边|会)/.test(next)) return token
    if (/[十百千万亿]/.test(token)) {
      const n = cnValue(token)
      return n == null ? token : String(n)
    }
    return token
      .split('')
      .map((ch) => (ch in CN_DIGIT ? String(CN_DIGIT[ch]) : ch))
      .join('')
  })
}

Component({
  properties: {
    holdText: { type: String, value: '按住说话' },
    releaseText: { type: String, value: '松开识别' },
    busyText: { type: String, value: '识别中…' },
    iconOnly: { type: Boolean, value: false },
    quiet: { type: Boolean, value: false },
    label: { type: String, value: '' },
    keyboardUp: { type: Boolean, value: false },
  },
  data: {
    holding: false,
    busy: false,
    cancel: false,
    liveText: '',
    slots: SLOTS,
    tick: 0,
    loud: 0.28,
    shadeOpacity: 0.9,
    shadeScale: 1,
    inkScale: 1,
    shimmer: 0.35,
  },
  _armed: false,
  _downY: 0,
  _wantCancel: false,
  _engine: 'plugin' as VoiceEngine,
  _listenOn: false,
  _kbHeld: false,
  _waveTimer: 0,
  _loud: 0.28,
  _loudTarget: 0.28,
  _tick: 0,
  _phase: 0,
  lifetimes: {
    attached() {
      void currentVoiceEngine().then((engine) => {
        if (engine !== 'plugin') warmTencentListen()
      })
    },
    detached() {
      this._armed = false
      this._stopWave()
      this._stopListen(true)
      this._dropKb()
    },
  },
  pageLifetimes: {
    hide() {
      this._armed = false
      this._wantCancel = false
      this._stopWave()
      this._stopListen(true)
      this._dropKb()
      this.setData({ holding: false, busy: false, cancel: false, liveText: '' })
    },
  },
  methods: {
    _stopWave() {
      if (!this._waveTimer) return
      clearInterval(this._waveTimer)
      this._waveTimer = 0
    },
    _paintWave() {
      this._tick += 50
      this._loud += (this._loudTarget - this._loud) * 0.28
      this._loudTarget += (0.34 - this._loudTarget) * 0.02
      this._phase += 0.28 + this._loud * 0.9
      const s = Math.sin(this._phase)
      const s2 = Math.sin(this._phase * 1.35 + 0.6)
      const vib = s * 0.65 + s2 * 0.35
      const amp = 0.42 + this._loud * 0.58
      const pulse = vib * 0.5 + 0.5
      const shadeOpacity = 0.82 + pulse * 0.18
      const shadeScale = 0.9 + amp * 0.16 + vib * 0.025
      const inkScale = 0.96 + amp * 0.22 + vib * 0.04
      const shimmer = 0.22 + amp * (0.18 + pulse * 0.42)
      this.setData({
        tick: this._tick,
        loud: this._loud,
        shadeOpacity: Math.round(shadeOpacity * 100) / 100,
        shadeScale: Math.round(shadeScale * 1000) / 1000,
        inkScale: Math.round(inkScale * 1000) / 1000,
        shimmer: Math.round(shimmer * 100) / 100,
      })
    },
    _startWave() {
      this._stopWave()
      this._tick = 0
      this._phase = 0
      this._loud = 0.34
      this._loudTarget = 0.34
      this._paintWave()
      this._waveTimer = setInterval(() => {
        if (!this.data.holding) return
        this._paintWave()
      }, 50) as unknown as number
    },
    _stopListen(cancel: boolean) {
      const api = this._engine !== 'plugin'
      this._listenOn = false
      if (cancel) {
        if (api) cancelTencentListen()
        else cancelVoiceListen()
        return
      }
      if (api) stopTencentListen()
      else stopVoiceListen()
    },
    _touchY(e: WechatMiniprogram.TouchEvent): number {
      const touch = e.touches && e.touches[0]
      return touch ? Number(touch.clientY) || 0 : 0
    },
    _dropKb() {
      if (!this._kbHeld) return
      this._kbHeld = false
      this.triggerEvent('idle')
    },
    async onHoldStart(e: WechatMiniprogram.TouchEvent) {
      if (this.data.busy || this.data.holding) return
      this._downY = this._touchY(e)
      this._wantCancel = false
      this._armed = true
      if (this.data.keyboardUp) {
        this._kbHeld = true
        this.triggerEvent('willhold')
        wx.hideKeyboard()
        await new Promise((resolve) => setTimeout(resolve, 300))
      } else {
        wx.hideKeyboard()
      }
      if (!this._armed) {
        this._dropKb()
        return
      }
      if (!canLoadVoicePlugin()) {
        this._armed = false
        this._dropKb()
        this.triggerEvent('error', { msg: t('voicePcHint') })
        return
      }
      if (!requireCloudSync('voice')) {
        this._armed = false
        this._dropKb()
        return
      }
      void currentVoiceEngine().then((engine) => {
        if (engine !== 'plugin') warmTencentListen()
      })
      const ok = await ensureMicAuth()
      if (!ok || !this._armed) {
        this._armed = false
        this._dropKb()
        return
      }
      vibrateVoiceHold()
      this.setData({ holding: true, cancel: this._wantCancel, liveText: '' })
      this._startWave()
      const engine = await currentVoiceEngine()
      if (!this._armed) {
        this._stopWave()
        this._dropKb()
        this.setData({ holding: false, cancel: false, liveText: '' })
        return
      }
      this._engine = engine
      this._listenOn = true
      const handlers = {
        onStart: () => {
          if (engine !== 'plugin' || this._armed) return
          this._stopListen(true)
          this._stopWave()
          this.setData({ holding: false, cancel: false, liveText: '' })
        },
        onPartial: (text: string) => {
          if (!this._armed && !this.data.holding && !this.data.busy) return
          if (engine === 'plugin') this._loudTarget = 1
          this.setData({ liveText: arabicVoiceText(text) })
        },
        onResult: (text: string) => {
          this._listenOn = false
          this._stopWave()
          this._dropKb()
          this.setData({ holding: false, busy: false, cancel: false, liveText: '' })
          this.triggerEvent('transcript', { text })
        },
        onError: (msg: string) => {
          this._listenOn = false
          this._stopWave()
          this._dropKb()
          this.setData({ holding: false, busy: false, cancel: false, liveText: '' })
          this.triggerEvent('error', { msg })
        },
      }
      const started = engine !== 'plugin'
        ? startTencentListen({
          ...handlers,
          onLevel: (level: number) => {
            if (!this._armed && !this.data.holding) return
            this._loudTarget = Math.max(0.16, level)
          },
        })
        : startVoiceListen(handlers)
      if (started === false) {
        this._listenOn = false
        this._stopWave()
        this._dropKb()
        this.setData({ holding: false, cancel: false, liveText: '' })
        if (engine !== 'plugin') this.triggerEvent('error', { msg: '请先松开上一次语音' })
      }
    },
    onHoldMove(e: WechatMiniprogram.TouchEvent) {
      if (!this._armed && !this.data.holding) return
      const next = this._downY - this._touchY(e) > CANCEL_LIFT
      if (next === this._wantCancel) return
      this._wantCancel = next
      if (next) vibrateVoiceHold()
      if (this.data.holding) this.setData({ cancel: next })
    },
    onHoldEnd() {
      const cancel = this._wantCancel
      const wasHolding = this.data.holding || this._armed
      this._armed = false
      this._wantCancel = false
      this._stopWave()
      if (!wasHolding) {
        this._dropKb()
        return
      }
      if (!this._listenOn) {
        this._dropKb()
        this.setData({ holding: false, busy: false, cancel: false, liveText: '' })
        return
      }
      if (cancel) {
        this._stopListen(true)
        this._dropKb()
        this.setData({ holding: false, busy: false, cancel: false, liveText: '' })
        return
      }
      playVoiceSendSfx()
      this._dropKb()
      this.setData({ busy: true, holding: false, cancel: false })
      this._stopListen(false)
    },
    onHoldCancel() {
      this._wantCancel = true
      this.onHoldEnd()
    },
  },
})
