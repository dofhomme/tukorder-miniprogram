import { request } from './api'

let cached: { on: boolean; at: number } | null = null

function asOn(value: boolean | number | string | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/** 管理员打开后，带货号的句子不在本地切开，整句交给大模型。 */
export async function voiceSkuUsesLlm(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 10000) return cached.on
  const res = await request<{ skuLlm?: boolean | number | string }>({
    path: '/api/v1/voice/mode',
  })
  const on = res.ok ? asOn(res.data && res.data.skuLlm) : false
  cached = { on, at: Date.now() }
  return on
}
