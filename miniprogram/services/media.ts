/** 小程序媒体走 server2，不打进主包。tabBar 图标按微信规范必须本地，不走这里。 */

export const MP_MEDIA_BASE = 'https://api.imageok.cn/downloads/mp-media'

export function mediaUrl(name: string): string {
  const n = String(name || '').replace(/^\/+/, '')
  return `${MP_MEDIA_BASE}/${n}`
}
