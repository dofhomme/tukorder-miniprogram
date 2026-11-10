export const formatTime = (date: Date) => {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return (
    [year, month, day].map(formatNumber).join('/') +
    ' ' +
    [hour, minute, second].map(formatNumber).join(':')
  )
}

const formatNumber = (n: number) => {
  const s = n.toString()
  return s[1] ? s : '0' + s
}

/** 本地墙钟 YYYY-MM-DD HH:mm:ss（禁止 toISOString，避免东八区被写成 UTC） */
export function formatLocalDateTime(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

/**
 * 对齐 App Formatters.combineDateWithNow：
 * 保留开单日的年月日，时分秒取当前时刻；返回 MySQL 友好本地字符串。
 */
export function combineDateStrWithNow(dateStr?: string): string {
  const now = new Date()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  const y = m ? Number(m[1]) : now.getFullYear()
  const mo = m ? Number(m[2]) - 1 : now.getMonth()
  const day = m ? Number(m[3]) : now.getDate()
  const d = new Date(y, mo, day, now.getHours(), now.getMinutes(), now.getSeconds())
  if (Number.isNaN(d.getTime())) return formatLocalDateTime(now)
  return formatLocalDateTime(d)
}

/** 展示用：服务端 naive datetime 按字面本地时间显示，避免被当 UTC 再偏一次 */
export function formatOrderDateTimeLabel(raw?: string | null): string {
  if (!raw) return ''
  const s = String(raw).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
