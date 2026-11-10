/** 按住说话：振动 + 松开发送音。音效放 server2，不打进小程序包。 */

const SEND_SRC = 'https://api.imageok.cn/downloads/mp-media/wechat-send.wav'

let _audio: WechatMiniprogram.InnerAudioContext | null = null
let _optionReady = false

function ensureAudioOption() {
  if (_optionReady) return
  _optionReady = true
  const wxAny = wx as WechatMiniprogram.Wx & {
    setInnerAudioOption?: (opt: {
      mixWithOther?: boolean
      obeyMuteSwitch?: boolean
    }) => void
  }
  if (typeof wxAny.setInnerAudioOption === 'function') {
    try {
      wxAny.setInnerAudioOption({ mixWithOther: true, obeyMuteSwitch: false })
    } catch (_) {}
  }
}

export function vibrateVoiceHold() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (_) {
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (_) {}
  }
}

export function playVoiceSendSfx() {
  try {
    ensureAudioOption()
    if (!_audio) {
      _audio = wx.createInnerAudioContext()
      _audio.src = SEND_SRC
      _audio.obeyMuteSwitch = false
      _audio.volume = 1
    }
    _audio.stop()
    _audio.seek(0)
    _audio.play()
  } catch (_) {}
}
