import { currentUser, db, json, newSession, now, passwordHash, randomId, randomToken, sameOrigin, sha256 } from '@/lib/auth'

class InputError extends Error {}
const recoverySalt = 'recovery-v1'
const recoveryPattern = /^AA([0-9A-F]{16})([0-9A-F]{24})$/

function normalizeRecoveryCode(value: unknown) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '')
  const match = compact.match(recoveryPattern)
  if (!match) throw new InputError('登录码格式不正确，请完整复制')
  return { code: `AA-${match[1]}-${match[2]}`, username: `aa_${match[1].toLowerCase()}` }
}

function createRecoveryCode() {
  const idPart = randomToken().slice(0, 16).toUpperCase()
  const secret = randomToken().slice(0, 24).toUpperCase()
  return { username: `aa_${idPart.toLowerCase()}`, code: `AA-${idPart}-${secret}` }
}

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

    if (action === 'quickStart') {
      const name = String(p.name || '').trim().slice(0, 24)
      if (!name) throw new InputError('请输入昵称')
      const { username, code } = createRecoveryCode()
      const id = randomId()
      await db().prepare('INSERT INTO users(id,username,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)')
        .bind(id, username, name, recoverySalt, await sha256(code), now()).run()
      const cookie = await newSession(id, request)
      return json({ user: { id, username, name }, recoveryCode: code }, 200, { 'Set-Cookie': cookie })
    }

    if (action === 'recover') {
      const { code, username } = normalizeRecoveryCode(p.recoveryCode)
      const user = await db().prepare('SELECT id,username,name,salt,password_hash FROM users WHERE username=?')
        .bind(username).first() as {id:string;username:string;name:string;salt:string;password_hash:string} | null
      if (!user || user.salt !== recoverySalt || await sha256(code) !== user.password_hash) throw new InputError('登录码无效，请检查后重试')
      const cookie = await newSession(user.id, request)
      return json({ user: { id: user.id, username: user.username, name: user.name } }, 200, { 'Set-Cookie': cookie })
    }

    if (action === 'rotateRecovery') {
      const user = await currentUser(request)
      if (!user || !user.username.startsWith('aa_')) return json({ error: '请先登录' }, 401)
      const current = await db().prepare('SELECT salt FROM users WHERE id=?').bind(user.id).first() as {salt:string} | null
      if (current?.salt !== recoverySalt) throw new InputError('此账号使用密码登录')
      const code = `AA-${user.username.slice(3).toUpperCase()}-${randomToken().slice(0, 24).toUpperCase()}`
      await db().prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await sha256(code), user.id).run()
      return json({ recoveryCode: code })
    }

    const username = String(p.username || '').trim().toLowerCase()
    const password = String(p.password || '')
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) throw new InputError('请检查账号和密码')
    let user: {id:string;username:string;name:string;salt:string;password_hash:string} | null
    if (action === 'register') {
      const name = String(p.name || '').trim().slice(0, 24)
      if (!name) throw new InputError('请输入昵称')
      const salt = randomToken()
      const id = randomId()
      const hash = await passwordHash(password, salt)
      try {
        await db().prepare('INSERT INTO users(id,username,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(id, username, name, salt, hash, now()).run()
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed: users.username')) throw new InputError('账号已被使用，请直接登录或使用昵称快速进入')
        throw error
      }
      user = { id, username, name, salt, password_hash: '' }
    } else if (action === 'login') {
      user = await db().prepare('SELECT id,username,name,salt,password_hash FROM users WHERE username=?').bind(username).first() as typeof user
      if (!user || user.salt === recoverySalt || await passwordHash(password, user.salt) !== user.password_hash) throw new InputError('账号或密码错误')
    } else throw new InputError('未知操作')
    const cookie = await newSession(user.id, request)
    return json({ user: { id: user.id, username: user.username, name: user.name } }, 200, { 'Set-Cookie': cookie })
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400)
    console.error('身份验证服务出错', error)
    return json({ error: '暂时无法完成登录，请稍后重试' }, 500)
  }
}
