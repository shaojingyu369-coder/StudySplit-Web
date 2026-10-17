export type RecognizedItem = {
  originalName: string
  nameZh: string
  amount: string
  splitKind: 'unclaimed' | 'personal' | 'shared'
  memberIds: string[]
  photoId?: string
}
export function translateName(original: string): string
export function parseReceiptText(text: string): RecognizedItem[]
export function appendRecognizedItems(currentItems: RecognizedItem[], text: string, photoId: string): RecognizedItem[]
