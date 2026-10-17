import { currentUser, db, json, now, randomId, randomToken, sameOrigin } from '@/lib/auth'
import { applyAction, safeSnapshot, type State } from '@/lib/dorm'

type DormRow = {id:string;code:string;name:string;state_json:string;revision:number}
const bad = (message:string):never => { throw new Error(message) }

async function myDorms(userId:string):Promise<DormRow[]> {
  const rows=await db().prepare("SELECT id,code,name,state_json,revision FROM dorms WHERE EXISTS (SELECT 1 FROM json_each(dorms.state_json,'$.memberships') WHERE json_extract(value,'$.userId')=? AND json_extract(value,'$.status')='active') ORDER BY created_at DESC").bind(userId).all<DormRow>()
  return rows.results || []
}
async function snapshot(userId:string, dormId?:string) {
  const rows=await myDorms(userId)
  const selected=rows.find(x=>x.id===dormId)||rows[0]
  return {dorms:rows.map(x=>({id:x.id,name:x.name,code:x.code})),currentDormId:selected?.id||'',dorm:selected?{...safeSnapshot(JSON.parse(selected.state_json) as State,userId),id:selected.id,revision:selected.revision}:null}
}
export async function GET(request:Request) {
  try {
    const user=await currentUser(request)
    if (!user) return json({error:'请先登录'},401)
    return json({user,...await snapshot(user.id,new URL(request.url).searchParams.get('dormId')||'')})
  } catch(error) { return json({error:error instanceof Error?error.message:'读取失败'},500) }
}

async function changeDorm(id:string, actor:string, action:string, p:any) {
  for (let attempt=0;attempt<5;attempt++) {
    const row=await db().prepare('SELECT id,code,name,state_json,revision FROM dorms WHERE id=?').bind(id).first<DormRow>()
    if (!row) throw new Error('宿舍不存在')
    const state=JSON.parse(row.state_json) as State
    let result:any, changed=true
    if (action==='joinDorm') {
      if (state.memberships.some(m=>m.userId===actor && m.status==='active')) bad('您已加入该宿舍')
      const user=await db().prepare('SELECT id,name FROM users WHERE id=?').bind(actor).first<{id:string;name:string}>()
      if (!user) throw new Error('用户不存在')
      const prior=state.memberships.find(m=>m.userId===actor)
      if (prior) {prior.status='active';prior.joinedAt=now()} else state.memberships.push({userId:actor,role:'member',status:'active',joinedAt:now()})
      if (!state.users.some(u=>u.id===actor)) state.users.push({id:actor,name:user.name})
      state.audit.push({id:randomId(),action:'join_dorm',actorId:actor,targetId:id,createdAt:now()})
      result={id}
    } else ({result,changed}=applyAction(state,actor,action,p))
    if (!changed) return result
    const update=await db().prepare('UPDATE dorms SET state_json=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(state),id,row.revision).run()
    if (update.meta.changes===1) return result
  }
  bad('多人同时操作，请刷新后重试')
}

export async function POST(request:Request) {
  if (!sameOrigin(request)) return json({error:'请求来源不合法'},403)
  const user=await currentUser(request)
  if (!user) return json({error:'请先登录'},401)
  try {
    const p=await request.json() as any
    const action=String(p.action||'')
    if (action==='createDorm') {
      const name=String(p.name||'').trim().slice(0,30)||bad('请输入宿舍名称')
      const id=randomId(),code=randomToken().slice(0,12).toUpperCase()
      const state:State={name,code,ownerId:user.id,memberships:[{userId:user.id,role:'admin',status:'active',joinedAt:now()}],users:[{id:user.id,name:user.name}],expenses:[],payments:[],settlements:[],audit:[{id:randomId(),action:'create_dorm',actorId:user.id,targetId:id,createdAt:now()}]}
      await db().prepare('INSERT INTO dorms(id,code,name,state_json,revision,created_at) VALUES(?,?,?,?,1,?)').bind(id,code,name,JSON.stringify(state),now()).run()
      return json({result:{id,code},...await snapshot(user.id,id)})
    }
    let dormId=String(p.dormId||'')
    if (action==='joinDorm') {
      const code=String(p.code||'').trim().toUpperCase()
      if (!/^[0-9A-F]{12}$/.test(code)) bad('请输入12位邀请码')
      const row=await db().prepare('SELECT id FROM dorms WHERE code=?').bind(code).first<{id:string}>()
      dormId=row?.id||bad('邀请码无效')
    }
    if (!dormId) bad('请选择宿舍')
    const result=await changeDorm(dormId,user.id,action,p)
    return json({result,...await snapshot(user.id,dormId)})
  } catch(error) { return json({error:error instanceof Error?error.message:'操作失败'},400) }
}
