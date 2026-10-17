import * as L from './ledger.js'
import { now, randomId } from './auth'

export type User = { id:string; name:string; bankName?:string; sbpPhone?:string }
export type State = { name:string; code:string; ownerId:string; memberships:any[]; users:User[]; expenses:any[]; payments:any[]; settlements:any[]; audit:any[] }
const fail = (message:string):never => { throw new Error(message) }
const member = (s:State, id:string, allowLeft=false) => s.memberships.find(m => m.userId===id && (allowLeft || m.status==='active')) || fail('您不是宿舍成员')
const activeIds = (s:State) => s.memberships.filter(m=>m.status==='active').map(m=>m.userId)
const audit = (s:State, action:string, actor:string, target:string, detail:unknown={}) => s.audit.push({ id:randomId(), action, actorId:actor, targetId:target, detail, createdAt:now() })
const unsettled = (s:State, fromId:string, toId:string, currency:string) => {
  const balances = L.balances(s.memberships.map(m=>m.userId), s.expenses, s.settlements, currency as any)
  return L.optimizeTransfers(balances).find(t=>t.fromId===fromId && t.toId===toId)
}
const ensureEditable = (s:State, e:any) => {
  if (s.settlements.some(t=>t.confirmedAt>=e.createdAt)) fail('已有确认结算，历史账单不能更改')
  if (s.payments.some(p=>p.status==='pending')) fail('有待确认付款，请先处理')
  if ([e.payerId,...e.shares.map((x:any)=>x.memberId)].some(id=>!activeIds(s).includes(id))) fail('账单涉及已退出成员')
}

export function applyAction(s:State, actor:string, action:string, p:any): {result:any; changed:boolean} {
  member(s, actor)
  const ids = activeIds(s)
  if (action==='addExpense') {
    if (!ids.includes(p.payerId)) fail('请选择宿舍内的付款人')
    const currency = L.validateCurrency(p.currency)
    let amountMinor:number, shares:any[], receiptItems:any[]|undefined
    if (p.splitMode==='itemized') {
      if (!Array.isArray(p.items) || p.items.some((x:any)=>!Array.isArray(x.memberIds) || x.memberIds.some((id:string)=>!ids.includes(id)))) fail('商品分摊成员不合法')
      const receipt=L.splitReceipt({currency,payerId:p.payerId,items:p.items.map((x:any)=>({originalName:x.originalName,nameZh:x.nameZh,amountMinor:L.parseMoney(x.amount),splitKind:x.splitKind,memberIds:x.memberIds}))})
      amountMinor=receipt.amountMinor; shares=receipt.shares; receiptItems=receipt.receiptItems
      if (p.receiptTotal && L.parseMoney(p.receiptTotal)!==amountMinor) fail('商品合计与小票总额不一致')
    } else {
      if (!Array.isArray(p.participantIds) || p.participantIds.some((id:string)=>!ids.includes(id))) fail('分摊成员不合法')
      amountMinor=L.parseMoney(p.amount)
      const values:Record<string,number>={}
      for (const id of p.participantIds) values[id]=p.splitMode==='custom' ? L.parseMoney(p.values?.[id]) : Number(p.values?.[id]||1)
      shares=L.splitExpense({currency,amountMinor,participantIds:p.participantIds,splitMode:p.splitMode,values})
    }
    const title=String(p.title||'').trim().slice(0,40) || fail('请输入账单名称')
    const purchasedAt=String(p.purchasedAt||'').slice(0,10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)) fail('购买日期不合法')
    const e={id:randomId(),title,amountMinor,currency,payerId:p.payerId,purchasedAt,category:String(p.category||'其他').slice(0,20),note:String(p.note||'').slice(0,200),splitMode:p.splitMode,shares,receiptItems,status:'active',version:1,createdBy:actor,createdAt:now()}
    s.expenses.unshift(e); audit(s,'add_expense',actor,e.id,{after:e}); return {result:e,changed:true}
  }
  if (action==='claimReceiptItem') {
    const e=s.expenses.find(x=>x.id===p.id && x.status==='active' && x.splitMode==='itemized') || fail('小票账单不存在')
    ensureEditable(s,e)
    if (e.version!==p.version) fail('账单已被修改，请刷新')
    if (!Number.isInteger(p.index) || p.index<0 || p.index>=e.receiptItems.length) fail('商品不存在')
    const target=e.receiptItems[p.index]
    if (p.claim===true && target.splitKind!=='unclaimed') fail('该商品已被认领')
    if (p.claim===false && target.claimedBy!==actor) fail('只能撤销自己的认领')
    const before=structuredClone(e)
    const items=e.receiptItems.map((x:any,i:number)=>({originalName:x.originalName,nameZh:x.nameZh,amountMinor:x.amountMinor,splitKind:i===p.index?(p.claim?'personal':'unclaimed'):x.splitKind,memberIds:i===p.index?(p.claim?[actor]:[]):x.memberIds}))
    const receipt=L.splitReceipt({currency:e.currency,payerId:e.payerId,items})
    receipt.receiptItems.forEach((x:any,i:number)=>{ if(i===p.index && p.claim){x.claimedBy=actor;x.claimedAt=now()} else if(i!==p.index && e.receiptItems[i].claimedBy){x.claimedBy=e.receiptItems[i].claimedBy;x.claimedAt=e.receiptItems[i].claimedAt} })
    e.receiptItems=receipt.receiptItems;e.shares=receipt.shares;e.version++
    audit(s,p.claim?'claim_item':'unclaim_item',actor,e.id,{before,after:e});return {result:e,changed:true}
  }
  if (action==='voidExpense') {
    const e=s.expenses.find(x=>x.id===p.id && x.status==='active') || fail('账单不存在')
    if (e.createdBy!==actor && member(s,actor).role!=='admin') fail('无权删除账单')
    if (e.version!==p.version) fail('账单已被修改，请刷新')
    ensureEditable(s,e)
    const before=structuredClone(e);e.status='void';e.version++
    audit(s,'void_expense',actor,e.id,{before,after:e});return {result:e,changed:true}
  }
  if (action==='markPaid') {
    member(s,p.toId)
    if (!p.idempotencyKey) fail('缺少操作标识')
    const prior=s.payments.find(x=>x.fromId===actor && x.idempotencyKey===p.idempotencyKey)
    if (prior) return {result:prior,changed:false}
    const currency=L.validateCurrency(p.currency)
    if (s.payments.some(x=>x.fromId===actor && x.toId===p.toId && x.currency===currency && x.status==='pending')) fail('已有付款待确认')
    const transfer=unsettled(s,actor,p.toId,currency) || fail('当前没有该笔欠款')
    const amountMinor=L.parseMoney(p.amount)
    if (amountMinor>transfer.amountMinor) fail('付款金额超过欠款')
    const pay={id:randomId(),fromId:actor,toId:p.toId,currency,amountMinor,status:'pending',idempotencyKey:String(p.idempotencyKey),createdAt:now()}
    s.payments.unshift(pay);audit(s,'mark_paid',actor,pay.id,{amountMinor,currency});return {result:pay,changed:true}
  }
  if (action==='confirmPayment'||action==='rejectPayment') {
    const pay=s.payments.find(x=>x.id===p.id) || fail('付款记录不存在')
    if (pay.toId!==actor) fail('只有收款人可以处理')
    if (pay.status==='confirmed' && action==='confirmPayment') return {result:pay,changed:false}
    if (pay.status!=='pending') fail('付款已处理')
    if (action==='confirmPayment') {
      const transfer=unsettled(s,pay.fromId,pay.toId,pay.currency)
      if (!transfer || transfer.amountMinor<pay.amountMinor) fail('欠款已变化，请拒绝并重新登记')
      pay.status='confirmed';pay.confirmedBy=actor;pay.confirmedAt=now()
      s.settlements.push({id:randomId(),paymentId:pay.id,fromId:pay.fromId,toId:pay.toId,currency:pay.currency,amountMinor:pay.amountMinor,status:'confirmed',confirmedBy:actor,confirmedAt:pay.confirmedAt})
      audit(s,'confirm_payment',actor,pay.id,{amountMinor:pay.amountMinor,currency:pay.currency})
    } else {pay.status='rejected';pay.rejectedBy=actor;pay.rejectedAt=now();pay.rejectReason=String(p.reason||'未收到款项').slice(0,100);audit(s,'reject_payment',actor,pay.id)}
    return {result:pay,changed:true}
  }
  if (action==='saveProfile') {
    const u=s.users.find(x=>x.id===actor) || fail('用户不存在')
    u.name=String(p.name||'').trim().slice(0,24)||fail('请输入昵称')
    u.bankName=String(p.bankName||'').trim().slice(0,40)
    u.sbpPhone=String(p.sbpPhone||'').trim().slice(0,30)
    audit(s,'save_profile',actor,actor);return {result:u,changed:true}
  }
  if (action==='transferAdmin') {
    if (member(s,actor).role!=='admin') fail('仅管理员可操作')
    const next=member(s,p.userId);next.role='admin';member(s,actor).role='member';s.ownerId=p.userId
    audit(s,'transfer_admin',actor,p.userId);return {result:true,changed:true}
  }
  if (action==='leaveDorm') {
    const m=member(s,actor)
    if (m.role==='admin' && activeIds(s).length>1) fail('请先移交管理员')
    if (L.currencies.some(c=>L.balances(s.memberships.map(x=>x.userId),s.expenses,s.settlements,c)[actor]!==0)) fail('请先结清个人账务')
    if (s.payments.some(x=>x.status==='pending' && [x.fromId,x.toId].includes(actor))) fail('有待确认付款')
    m.status='left';m.leftAt=now();audit(s,'leave_dorm',actor,actor);return {result:true,changed:true}
  }
  return fail('未知操作')
}

export function safeSnapshot(s:State, userId:string) {
  member(s,userId)
  const active=new Set(activeIds(s))
  return {name:s.name,code:s.code,ownerId:s.ownerId,memberships:s.memberships,users:s.users.map(u=>active.has(u.id)?u:{id:u.id,name:u.name}),expenses:s.expenses,payments:s.payments,settlements:s.settlements,audit:s.audit}
}
