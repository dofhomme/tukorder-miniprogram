/** 平台管理员 API（用户管理 / 用户反馈）
 * 生产仍校验 X-Admin-Phone + X-Client-Id；新版后端另验 Bearer + ADMIN_PHONE。
 */

import { request } from '../../services/api'
import { getSession } from '../../services/session'

export function isSessionAdmin(): boolean {
  return !!getSession()?.isAdmin
}

/** 兼容生产旧鉴权：带上管理员手机号；新后端可忽略该头，只认会话。 */
function adminHeaders(): Record<string, string> {
  const phone = (getSession()?.phone || '').trim()
  return phone ? { 'X-Admin-Phone': phone } : {}
}

export interface AdminUserRow {
  id: number
  phone: string
  clientId: string
  nickname?: string | null
  createdAt?: string | null
  isAdmin?: boolean
  paid?: boolean
  accessLabel?: string
  expireAt?: string | null
  source?: string
}

export interface AdminFeedbackRow {
  id: number
  userPhone: string
  userNickname?: string | null
  shopName?: string | null
  message: string
  createdAt?: string | null
}

export async function listAdminUsers(): Promise<{
  ok: boolean
  error?: string
  users: AdminUserRow[]
}> {
  if (!isSessionAdmin()) {
    return { ok: false, error: '请使用管理员账号登录', users: [] }
  }
  const res = await request<AdminUserRow[]>({
    path: '/api/v1/app/admin/users',
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message, users: [] }
  const list = Array.isArray(res.data) ? res.data : []
  return {
    ok: true,
    users: list.map((u) => ({
      id: Number(u.id),
      phone: String(u.phone || ''),
      clientId: String(
        (u as { clientId?: string; client_id?: string }).clientId ||
          (u as { client_id?: string }).client_id ||
          '',
      ),
      nickname: u.nickname || null,
      createdAt:
        (u as { createdAt?: string; created_at?: string }).createdAt ||
        (u as { created_at?: string }).created_at ||
        null,
      isAdmin: !!(u as { isAdmin?: boolean }).isAdmin,
      paid: !!(u as { paid?: boolean }).paid,
      accessLabel: String((u as { accessLabel?: string }).accessLabel || '未开通'),
      expireAt: (u as { expireAt?: string | null }).expireAt || null,
      source: String((u as { source?: string }).source || ''),
    })),
  }
}

export async function updateAdminUser(opts: {
  userId: number
  phone?: string
  password?: string
  nickname?: string
  clientId?: string
}): Promise<{ ok: boolean; error?: string }> {
  const data: Record<string, string> = {}
  if (opts.phone) data.phone = opts.phone
  if (opts.password) data.password = opts.password
  if (opts.nickname != null) data.nickname = opts.nickname
  if (opts.clientId) data.clientId = opts.clientId
  const res = await request({
    path: `/api/v1/app/admin/users/${opts.userId}`,
    method: 'PUT',
    data,
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true }
}

export async function grantUserTrial(
  userId: number,
  days: number,
): Promise<{ ok: boolean; error?: string; accessLabel?: string }> {
  if (!isSessionAdmin()) return { ok: false, error: '非管理员' }
  const res = await request<{ accessLabel?: string }>({
    path: `/api/v1/app/admin/users/${userId}/trial`,
    method: 'POST',
    data: { days },
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true, accessLabel: res.data?.accessLabel }
}

export async function deleteAdminUser(
  userId: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await request({
    path: `/api/v1/app/admin/users/${userId}`,
    method: 'DELETE',
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true }
}

export async function listAdminFeedback(limit = 200): Promise<{
  ok: boolean
  error?: string
  items: AdminFeedbackRow[]
}> {
  if (!isSessionAdmin()) {
    return { ok: false, error: '请使用管理员账号登录', items: [] }
  }
  const res = await request<AdminFeedbackRow[]>({
    path: `/api/v1/app/admin/feedback?limit=${limit}`,
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message, items: [] }
  const list = Array.isArray(res.data) ? res.data : []
  return { ok: true, items: list }
}

export async function deleteAdminFeedback(
  id: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await request({
    path: `/api/v1/app/admin/feedback/${id}`,
    method: 'DELETE',
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true }
}

export async function getPrintPolicy(): Promise<{
  ok: boolean
  error?: string
  policy: any
}> {
  if (!isSessionAdmin()) return { ok: false, error: '请使用管理员账号登录', policy: null }
  const res = await request<any>({
    path: '/api/v1/app/admin/print-policy',
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message, policy: null }
  return { ok: true, policy: res.data || {} }
}

export async function savePrintPolicy(policy: any): Promise<{
  ok: boolean
  error?: string
  policy: any
}> {
  if (!isSessionAdmin()) return { ok: false, error: '非管理员', policy: null }
  const res = await request<any>({
    path: '/api/v1/app/admin/print-policy',
    method: 'PUT',
    data: policy,
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message, policy: null }
  return { ok: true, policy: res.data || policy }
}

export async function getPrintTelemetry(days = 7): Promise<{
  ok: boolean
  error?: string
  items: Array<Record<string, any>>
}> {
  if (!isSessionAdmin()) return { ok: false, error: '请使用管理员账号登录', items: [] }
  const res = await request<{ items?: Array<Record<string, any>> }>({
    path: `/api/v1/app/admin/print-telemetry?days=${days}`,
    headers: adminHeaders(),
  })
  if (!res.ok) return { ok: false, error: res.message, items: [] }
  return { ok: true, items: res.data?.items || [] }
}
