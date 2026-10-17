import assert from 'node:assert/strict'

const base=process.env.STUDYSPLIT_TEST_URL||'http://127.0.0.1:5173'
const unique=Date.now().toString(36)
function client() {
  let cookie=''
  return async (path, body) => {
    const res=await fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','Origin':base,...(cookie?{Cookie:cookie}:{})}:cookie?{Cookie:cookie}:{},body:body?JSON.stringify(body):undefined})
    const set=res.headers.get('set-cookie')
    if(set)cookie=set.split(';')[0]
    const data=await res.json()
    if(!res.ok)throw new Error(`${res.status}: ${data.error}`)
    return data
  }
}
const a=client(),b=client()
const startedA=await a('/api/auth',{action:'quickStart',name:'小林'})
const startedB=await b('/api/auth',{action:'quickStart',name:'小林'})
const alice=startedA.user,bob=startedB.user
assert.notEqual(alice.id,bob.id,'同昵称室友应获得独立身份')
assert.match(startedA.recoveryCode,/^AA-[0-9A-F]{16}-[0-9A-F]{24}$/)
const recovered=client()
assert.equal((await recovered('/api/auth',{action:'recover',recoveryCode:startedA.recoveryCode})).user.id,alice.id)
try{await recovered('/api/auth',{action:'recover',recoveryCode:startedA.recoveryCode.slice(0,-1)+'Z'});assert.fail('错误登录码不应通过')}
catch(e){assert.match(e.message,/登录码/)}
const created=await a('/api/ledger',{action:'createDorm',name:'测试宿舍'})
const dormId=created.currentDormId
await b('/api/ledger',{action:'joinDorm',code:created.dorm.code})
const bill=await a('/api/ledger',{action:'addExpense',dormId,title:'饮用水',amount:'480.00',currency:'RUB',payerId:alice.id,purchasedAt:'2026-10-17',category:'饮用水',splitMode:'equal',participantIds:[alice.id,bob.id]})
assert.equal(bill.result.amountMinor,48000)
assert.equal(bill.result.shares.reduce((s,x)=>s+x.amountMinor,0),48000)
assert.equal((await b('/api/ledger?dormId='+dormId)).dorm.expenses[0].title,'饮用水')
const paid=await b('/api/ledger',{action:'markPaid',dormId,toId:alice.id,currency:'RUB',amount:'200.00',idempotencyKey:'test-'+unique})
assert.equal(paid.result.status,'pending')
const repeated=await b('/api/ledger',{action:'markPaid',dormId,toId:alice.id,currency:'RUB',amount:'200.00',idempotencyKey:'test-'+unique})
assert.equal(repeated.result.id,paid.result.id)
try{await b('/api/ledger',{action:'confirmPayment',dormId,id:paid.result.id});assert.fail('付款人不应确认')}
catch(e){assert.match(e.message,/只有收款人/)}
const confirmed=await a('/api/ledger',{action:'confirmPayment',dormId,id:paid.result.id})
assert.equal(confirmed.result.status,'confirmed')
assert.equal(confirmed.dorm.settlements.length,1)
const again=await a('/api/ledger',{action:'confirmPayment',dormId,id:paid.result.id})
assert.equal(again.dorm.settlements.length,1)
const receipt=await a('/api/ledger',{action:'addExpense',dormId,title:'超市小票',currency:'RUB',payerId:alice.id,purchasedAt:'2026-10-17',category:'其他',splitMode:'itemized',items:[{originalName:'МОЛОКО',nameZh:'牛奶',amount:'90.00',splitKind:'unclaimed',memberIds:[]},{originalName:'ВОДА',nameZh:'饮用水',amount:'60.00',splitKind:'shared',memberIds:[alice.id,bob.id]}],receiptTotal:'150.00'})
assert.equal(receipt.result.amountMinor,15000)
const claimed=await b('/api/ledger',{action:'claimReceiptItem',dormId,id:receipt.result.id,version:1,index:0,claim:true})
assert.equal(claimed.result.receiptItems[0].claimedBy,bob.id)
assert.equal(claimed.result.shares.reduce((s,x)=>s+x.amountMinor,0),15000)
try{await b('/api/ledger',{action:'voidExpense',dormId,id:receipt.result.id,version:2});assert.fail('非创建者不应删除')}
catch(e){assert.match(e.message,/无权删除/)}
const race=await a('/api/ledger',{action:'addExpense',dormId,title:'并发认领',currency:'RUB',payerId:alice.id,purchasedAt:'2026-10-17',category:'其他',splitMode:'itemized',items:[{originalName:'ХЛЕБ',nameZh:'面包',amount:'30.00',splitKind:'unclaimed',memberIds:[]}]})
const attempts=await Promise.allSettled([
  a('/api/ledger',{action:'claimReceiptItem',dormId,id:race.result.id,version:1,index:0,claim:true}),
  b('/api/ledger',{action:'claimReceiptItem',dormId,id:race.result.id,version:1,index:0,claim:true})
])
assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1)
const afterRace=await a('/api/ledger?dormId='+dormId)
assert.equal(afterRace.dorm.expenses.find(x=>x.id===race.result.id).version,2)
console.log('共享账单、小票认领、部分付款、权限与幂等确认测试通过')
