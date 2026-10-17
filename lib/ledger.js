'use strict'

const MAX_MINOR = 100000000 // 单笔上限：100 万货币单位
const currencies = ['RUB', 'CNY', 'USD']
const symbols = { RUB: '₽', CNY: '¥', USD: '$' }
const categories = ['卫生纸', '洗衣液', '清洁用品', '饮用水', '厨房用品', '其他']
function fail(message) { throw new Error(message) }
function integer(value, label = '金额') { if (!Number.isSafeInteger(value) || value < 0) fail(`${label}不合法`); return value }
function validateCurrency(currency) { if (!currencies.includes(currency)) fail('不支持的币种'); return currency }
function parseMoney(input) {
  const s = String(input == null ? '' : input).trim()
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(s)) fail('请输入不超过100万元的金额，最多两位小数')
  const [whole, fraction = ''] = s.split('.')
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (value <= 0 || value > MAX_MINOR) fail('金额必须大于0且不超过100万元')
  return value
}
function formatMoney(minor) { integer(minor); return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}` }
function allocate(total, weights, ids) {
  integer(total)
  if (!Array.isArray(weights) || !weights.length || weights.length !== ids.length) fail('请选择参与分摊的成员')
  const sum = weights.reduce((acc, w) => acc + integer(w, '分摊权重'), 0)
  if (!sum || !Number.isSafeInteger(sum)) fail('分摊权重不合法')
  function exactPart(weight) {
    const product = total * weight
    if (Number.isSafeInteger(product)) return { amountMinor: Math.floor(product / sum), remainder: product % sum }
    let n = weight, partQ = Math.floor(total / sum), partR = total % sum, resultQ = 0, resultR = 0
    while (n > 0) {
      if (n % 2) {
        resultQ += partQ
        if (resultR >= sum - partR) { resultR -= sum - partR; resultQ++ } else resultR += partR
      }
      n = Math.floor(n / 2)
      if (n > 0) {
        partQ *= 2
        if (partR >= sum - partR) { partR -= sum - partR; partQ++ } else partR += partR
      }
    }
    if (!Number.isSafeInteger(resultQ)) fail('分摊金额超出安全范围')
    return { amountMinor: resultQ, remainder: resultR }
  }
  const rows = weights.map((weight, i) => ({ id: ids[i], ...exactPart(weight), order: i }))
  const rest = total - rows.reduce((acc, row) => acc + row.amountMinor, 0)
  const ranked = rows.slice().sort((a, b) => b.remainder - a.remainder || a.order - b.order)
  for (let i = 0; i < rest; i++) ranked[i].amountMinor++
  return rows.map(({ id, amountMinor }) => ({ memberId: id, amountMinor }))
}
function splitExpense(input) {
  validateCurrency(input.currency)
  const amountMinor = integer(input.amountMinor)
  if (!amountMinor || amountMinor > MAX_MINOR) fail('账单金额不合法')
  const participantIds = input.participantIds || []
  if (new Set(participantIds).size !== participantIds.length || !participantIds.length) fail('参与成员不合法')
  let weights
  if (input.splitMode === 'equal') weights = participantIds.map(() => 1)
  else if (input.splitMode === 'ratio') {
    weights = participantIds.map(id => integer(input.values[id], '比例'))
    if (weights.some(w => !w)) fail('比例必须大于0')
  } else if (input.splitMode === 'custom') {
    weights = participantIds.map(id => integer(input.values[id], '自定义金额'))
    if (weights.reduce((a, b) => a + b, 0) !== amountMinor) fail('自定义金额之和必须等于账单金额')
  } else fail('分摊方式不合法')
  return allocate(amountMinor, weights, participantIds)
}
function splitReceipt(input) {
  validateCurrency(input.currency)
  const items = input.items
  if (!Array.isArray(items) || !items.length || items.length > 100) fail('小票商品须为1至100项')
  let amountMinor = 0
  const checked = items.map((item, index) => {
    const price = integer(item.amountMinor, '商品金额')
    if (!price) fail(`第${index + 1}项商品金额必须大于0`)
    const originalName = String(item.originalName || '').trim().slice(0, 80)
    const nameZh = String(item.nameZh || '').trim().slice(0, 80)
    if (!originalName && !nameZh) fail(`第${index + 1}项缺少商品名称`)
    const memberIds = item.memberIds
    if (!Array.isArray(memberIds) || new Set(memberIds).size !== memberIds.length || memberIds.some(id => typeof id !== 'string' || !id)) fail(`第${index + 1}项分摊成员不合法`)
    if (!['unclaimed', 'personal', 'shared'].includes(item.splitKind)) fail(`第${index + 1}项归属不合法`)
    if (item.splitKind === 'unclaimed' && (memberIds.length || !input.payerId)) fail('待认领商品须由付款人暂时承担')
    if (item.splitKind === 'personal' && memberIds.length !== 1) fail('自用商品只能由一人承担')
    if (item.splitKind === 'shared' && memberIds.length < 2) fail('共用商品至少选择两人')
    amountMinor += price
    if (!Number.isSafeInteger(amountMinor) || amountMinor > MAX_MINOR) fail('小票总额超过单笔上限')
    return { originalName, nameZh: nameZh || originalName, amountMinor: price, splitKind: item.splitKind, memberIds }
  })
  const totals = new Map()
  const receiptItems = checked.map(item => {
    const owners = item.splitKind === 'unclaimed' ? [input.payerId] : item.memberIds
    const shares = allocate(item.amountMinor, owners.map(() => 1), owners)
    for (const share of shares) totals.set(share.memberId, (totals.get(share.memberId) || 0) + share.amountMinor)
    return { ...item, shares }
  })
  return { amountMinor, shares: [...totals].map(([memberId, amountMinor]) => ({ memberId, amountMinor })), receiptItems }
}
function balances(memberIds, expenses, settlements, currency) {
  validateCurrency(currency)
  const result = Object.fromEntries(memberIds.map(id => [id, 0]))
  for (const expense of expenses) {
    if (expense.status === 'void' || expense.currency !== currency) continue
    if (!(expense.payerId in result)) result[expense.payerId] = 0
    result[expense.payerId] += integer(expense.amountMinor)
    for (const share of expense.shares) {
      if (!(share.memberId in result)) result[share.memberId] = 0
      result[share.memberId] -= integer(share.amountMinor)
    }
  }
  for (const settlement of settlements) {
    if (settlement.status !== 'confirmed' || settlement.currency !== currency) continue
    if (!(settlement.fromId in result)) result[settlement.fromId] = 0
    if (!(settlement.toId in result)) result[settlement.toId] = 0
    result[settlement.fromId] += integer(settlement.amountMinor)
    result[settlement.toId] -= integer(settlement.amountMinor)
  }
  if (Object.values(result).reduce((a, b) => a + b, 0) !== 0) fail('账务金额不守恒')
  return result
}
function optimizeTransfers(balanceMap) {
  const debtors = Object.entries(balanceMap).filter(([, v]) => v < 0).map(([id, v]) => ({ id, remaining: -v })).sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id))
  const creditors = Object.entries(balanceMap).filter(([, v]) => v > 0).map(([id, v]) => ({ id, remaining: v })).sort((a, b) => b.remaining - a.remaining || a.id.localeCompare(b.id))
  const transfers = []
  let d = 0, c = 0
  while (d < debtors.length && c < creditors.length) {
    const amountMinor = Math.min(debtors[d].remaining, creditors[c].remaining)
    if (amountMinor) transfers.push({ fromId: debtors[d].id, toId: creditors[c].id, amountMinor })
    debtors[d].remaining -= amountMinor
    creditors[c].remaining -= amountMinor
    if (!debtors[d].remaining) d++
    if (!creditors[c].remaining) c++
  }
  return transfers
}
function monthlyStats(expenses, settlements, month, currency) {
  validateCurrency(currency)
  const rows = expenses.filter(e => e.status !== 'void' && e.currency === currency && e.purchasedAt.slice(0, 7) === month)
  const byCategory = Object.create(null), paid = Object.create(null), consumed = Object.create(null)
  for (const e of rows) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amountMinor
    paid[e.payerId] = (paid[e.payerId] || 0) + e.amountMinor
    for (const share of e.shares) consumed[share.memberId] = (consumed[share.memberId] || 0) + share.amountMinor
  }
  const outstanding = optimizeTransfers(balances([], expenses, settlements, currency)).reduce((a, t) => a + t.amountMinor, 0)
  return { totalMinor: rows.reduce((a, e) => a + e.amountMinor, 0), byCategory, paid, consumed, outstanding, rows }
}
export { MAX_MINOR, currencies, symbols, categories, parseMoney, formatMoney, validateCurrency, splitExpense, splitReceipt, balances, optimizeTransfers, monthlyStats }
