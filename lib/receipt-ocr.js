const dictionary = [
  [/молок/i, '牛奶'], [/вода|воды/i, '饮用水'], [/хлеб|батон/i, '面包'],
  [/яйц/i, '鸡蛋'], [/салфет|бумаг/i, '纸巾'], [/порош|стир/i, '洗衣液'],
  [/сыр/i, '奶酪'], [/масло/i, '黄油'], [/рис/i, '大米'],
  [/яблок/i, '苹果'], [/сахар/i, '白糖'], [/чай/i, '茶'],
  [/кофе/i, '咖啡'], [/банан/i, '香蕉'], [/картоф/i, '土豆'],
  [/макарон/i, '意面'], [/куриц/i, '鸡肉'], [/мясо/i, '肉类'],
  [/шампун/i, '洗发水'], [/мыло/i, '香皂'], [/моющ|чистящ/i, '清洁用品'],
]

const ignored = /^(?:итого|всего|сумма|к оплате|оплачено|скидка|налог|ндс|сдача|наличными|безналичными|total|subtotal|tax|vat|change)(?:\s|$|[:\-])/i
const money = '(?:\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d{1,7})[.,]\\d{2}'
const itemLine = new RegExp(`^(.{2,100}?)\\s+(${money})(?:\\s*(?:₽|руб\\.?|р\\.))?$`, 'i')
const priceLine = new RegExp(`^(${money})(?:\\s*(?:₽|руб\\.?|р\\.))?$`, 'i')

export function translateName(original) {
  const name = String(original || '').trim()
  return dictionary.find(([pattern]) => pattern.test(name))?.[1] || name
}

function makeItem(name, price) {
  const originalName = name.replace(/^\d{1,3}[.)]\s*/, '').replace(/[.…_]{2,}/g, ' ').trim()
  if (!originalName || ignored.test(originalName) || !/[A-Za-zА-Яа-яЁё]/.test(originalName)) return null
  return {
    originalName,
    nameZh: translateName(originalName),
    amount: price.replace(/[ \u00a0]/g, '').replace(',', '.'),
    splitKind: 'unclaimed',
    memberIds: [],
  }
}

export function parseReceiptText(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const items = []
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]
    const paired = current.match(itemLine)
    if (paired) {
      const item = makeItem(paired[1], paired[2])
      if (item) items.push(item)
      continue
    }
    const nextPrice = lines[i + 1]?.match(priceLine)
    if (nextPrice && !priceLine.test(current)) {
      const item = makeItem(current, nextPrice[1])
      if (item) {
        items.push(item)
        i++
      }
    }
  }
  return items
}

export function appendRecognizedItems(currentItems, text, photoId) {
  return [...currentItems, ...parseReceiptText(text).map(item => ({ ...item, photoId }))]
}
