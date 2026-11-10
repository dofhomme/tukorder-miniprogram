import { request } from '../../services/api'
import { forgetTencentUrl } from './tencent-asr'

export type VoiceEngine = 'plugin' | 'free' | 'paid'

let _cached: { mode: VoiceEngine; hotword: boolean; train: boolean; at: number } | null = null

function asFlag(value: boolean | number | string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  return value === true || value === 1 || value === '1' || value === 'true'
}

function asEngine(data: { mp?: string; mode?: string } | null | undefined): VoiceEngine {
  const mp = data && data.mp
  if (mp === 'free' || mp === 'paid' || mp === 'plugin') return mp
  return data && data.mode === 'api' ? 'free' : 'plugin'
}

/** 只给小程序用。手机和电脑另有自己的免费/收费开关，读不到微信插件。 */
export async function currentVoiceEngine(): Promise<VoiceEngine> {
  if (_cached && Date.now() - _cached.at < 10000) return _cached.mode
  const res = await request<{ mp?: string; mode?: string; hotword?: boolean; train?: boolean }>({
    path: '/api/v1/voice/mode',
  })
  const mode = res.ok ? asEngine(res.data) : 'plugin'
  const hotword = res.ok ? asFlag(res.data && res.data.hotword, true) : true
  const train = res.ok ? asFlag(res.data && res.data.train, true) : true
  if (_cached && (_cached.mode !== mode || _cached.hotword !== hotword || _cached.train !== train)) {
    forgetTencentUrl()
  }
  _cached = { mode, hotword, train, at: Date.now() }
  return mode
}
