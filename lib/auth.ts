import { env } from 'cloudflare:workers'

const encoder = new TextEncoder()
const hex = (bytes: Uint8Array) => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')
export const randomId = () => crypto.randomUUID()
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)))
export const now = () => new Date().toISOString()
export const db = () => {
  if (!env.DB) throw new Error('数据库尚未配置')
  return env.DB
}
export async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}
export async function passwordHash(password: string, salt: string) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 180000, hash: 'SHA-256' }, material, 256)
  return hex(new Uint8Array(bits))
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  return !!origin && origin === new URL(request.url).origin && request.headers.get('content-type')?.includes('application/json')
}
export async function currentUser(request: Request): Promise<{id: string; username: string; name: string} | null> {
  const token = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('studysplit_session='))?.slice(19)
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  const hash = await sha256(token)
  return await db().prepare('SELECT u.id,u.username,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash, now()).first() as {id:string;username:string;name:string} | null
}
export async function newSession(userId: string, request: Request) {
  const token = randomToken()
  const expires = new Date(Date.now() + 30 * 86400000)
  await db().prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), userId, expires.toISOString()).run()
  const secure = new URL(request.url).protocol === 'http:' ? '' : '; Secure'
  return `studysplit_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`
}
export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
