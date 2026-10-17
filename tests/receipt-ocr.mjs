import assert from 'node:assert/strict'
import { appendRecognizedItems, parseReceiptText } from '../lib/receipt-ocr.js'
import { splitReceipt } from '../lib/ledger.js'

const first = 'МОЛОКО 90,00\nХЛЕБ 45.50\nИТОГО 135,50'
const second = 'ВОДА\n1 234,56 ₽\nСАХАР 80,00\nTOTAL 1 314,56'
const manual = { originalName: '手动输入', nameZh: '手动输入', amount: '12.00', splitKind: 'personal', memberIds: ['alice'] }
const combined = appendRecognizedItems(appendRecognizedItems([manual], first, 'photo-1'), second, 'photo-2')

assert.equal(parseReceiptText(first).length, 2)
assert.equal(combined.length, 5, '两张照片的商品应合并且保留手动输入')
assert.deepEqual(combined.map(x => x.nameZh), ['手动输入', '牛奶', '面包', '饮用水', '白糖'])
assert.equal(combined[1].photoId, 'photo-1')
assert.equal(combined[3].photoId, 'photo-2')
assert.equal(combined[3].amount, '1234.56')
assert.equal(combined.some(x => /ИТОГО|TOTAL/.test(x.originalName)), false)
const hundred = Array.from({ length: 100 }, (_, i) => ({
  originalName: `商品 ${i+1}`, nameZh: `商品 ${i+1}`, amountMinor: 100,
  splitKind: 'unclaimed', memberIds: [],
}))
assert.equal(splitReceipt({currency:'RUB',payerId:'alice',items:hundred}).amountMinor,10000)
assert.throws(()=>splitReceipt({currency:'RUB',payerId:'alice',items:[...hundred,hundred[0]]}),/1至100项/)
console.log('多照片商品识别与合并测试通过')
