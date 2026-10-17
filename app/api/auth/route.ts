import { currentUser, db, json, newSession, now, passwordHash, randomId, randomToken, sameOrigin, sha256 } from '@/lib/auth'

export async function GET(request: Request) {
  return json({ user: await currentUser(request) })
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请求来源不合法' }, 403)
  try {
    const p = await request.json() as Record<string, unknown>
    const action = String(p.action || '')
    if (action === 'logout') {
      const token = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('studysplit_session='))?.slice(19)
      if (token) await db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run()
      return json({ ok: true }, 200, { 'Set-Cookie': 'studysplit_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' })
    }
    const username = String(p.username || '').trim().toLowerCase()
    const password = String(p.password || '')
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) throw new Error('账号须为3至24位字母、数字或下划线；密码至少10位')
    let user: {id:string;username:string;name:string;salt:string;password_hash:string} | null
    if (action === 'register') {
      const name = String(p.name || '').trim().slice(0, 24)
      if (!name) throw new Error('请输入昵称')
      const salt = randomToken()
      const id = randomId()
      try { await db().prepare('INSERT INTO users(id,username,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id, username, name, salt, await passwordHash(password, salt), now()).run() }
      catch { throw new Error('账号已被使用，请换一个') }
      user = { id, username, name, salt, password_hash: '' }
    } else if (action === 'login') {
      user = await db().prepare('SELECT id,username,name,salt,password_hash FROM users WHERE username=?').bind(username).first() as typeof user
      if (!user) throw new Error('账号或密码错误')
      if (await passwordHash(password, user.salt) !== user.password_hash) throw new Error('账号或密码错误')
    } else throw new Error('未知操作')
    const cookie = await newSession(user.id, request)
    return json({ user: { id: user.id, username: user.username, name: user.name } }, 200, { 'Set-Cookie': cookie })
  } catch (error) { return json({ error: error instanceof Error ? error.message : '操作失败' }, 400) }
}
