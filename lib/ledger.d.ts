export type Currency = 'RUB' | 'CNY' | 'USD'
export type SplitMode = 'equal' | 'ratio' | 'custom' | 'itemized'
export interface Share { memberId: string; amountMinor: number }
export interface ReceiptItem { originalName: string; nameZh: string; amountMinor: number; splitKind: 'unclaimed' | 'personal' | 'shared'; memberIds: string[]; shares: Share[]; claimedBy?: string; claimedAt?: string }
export interface Expense { id: string; dormId: string; title: string; amountMinor: number; currency: Currency; payerId: string; purchasedAt: string; category: string; note: string; splitMode: SplitMode; splitValues?: Record<string, number>; receiptItems?: ReceiptItem[]; shares: Share[]; status: 'active' | 'void'; version: number; createdBy: string; createdAt: string }
export interface Settlement { id: string; dormId: string; paymentId: string; fromId: string; toId: string; amountMinor: number; currency: Currency; status: 'confirmed'; confirmedBy: string; confirmedAt: string }
export interface Payment { id: string; dormId: string; fromId: string; toId: string; amountMinor: number; currency: Currency; status: 'pending' | 'confirmed' | 'rejected'; idempotencyKey: string; createdAt: string; confirmedAt?: string; confirmedBy?: string; rejectedAt?: string; rejectedBy?: string; rejectReason?: string }
export declare const currencies: Currency[]
export declare const symbols: Record<Currency, string>
export declare const categories: string[]
export declare function parseMoney(v: string): number
export declare function formatMoney(v: number): string
export declare function validateCurrency(v: string): Currency
export declare function splitExpense(input: { amountMinor: number; currency: Currency; participantIds: string[]; splitMode: SplitMode; values: Record<string, number> }): Share[]
export declare function splitReceipt(input: { currency: Currency; payerId?: string; items: { originalName: string; nameZh: string; amountMinor: number; splitKind: 'unclaimed' | 'personal' | 'shared'; memberIds: string[] }[] }): { amountMinor: number; shares: Share[]; receiptItems: ReceiptItem[] }
export declare function balances(ids: string[], expenses: Expense[], settlements: Settlement[], currency: Currency): Record<string, number>
export declare function optimizeTransfers(balances: Record<string, number>): { fromId: string; toId: string; amountMinor: number }[]
export declare function monthlyStats(expenses: Expense[], settlements: Settlement[], month: string, currency: Currency): any
