/**
 * Common type definitions for FinPals
 */

// Telegram API types
export interface TelegramUser {
	id: number;
	is_bot?: boolean;
	first_name?: string;
	last_name?: string;
	username?: string;
	language_code?: string;
}

// API Response types
export interface ExchangeRateResponse {
	result?: string;
	rates?: Record<string, number>;
	conversion_rates?: Record<string, number>;
	timestamp?: number;
}

export interface FrankfurterResponse {
	amount: number;
	base: string;
	date: string;
	rates: Record<string, number>;
}

// Error types
export interface DatabaseError extends Error {
	code?: string;
	detail?: string;
	constraint?: string;
}

// Telegram keyboard types
export interface InlineKeyboardButton {
	text: string;
	callback_data?: string;
	url?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

// Options types - Use generic Record to be compatible with Grammy's types
export type ReplyOptions = Record<string, unknown>;

// Database result types
export interface QueryResult<T> {
	rows: T[];
	rowCount: number;
}

// Utility types
export type UnknownObject = Record<string, unknown>;
export type UnknownArray = unknown[];

// Type guards
export function isDatabaseError(error: unknown): error is DatabaseError {
	return typeof error === 'object' && error !== null && 'message' in error && typeof (error as DatabaseError).message === 'string';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
	return isRecord(obj) && key in obj;
}

// Database query result types
export interface BudgetRow {
	id: string;
	user_id: string;
	category: string;
	amount: number;
	period: string;
	currency?: string;
	created_at: string;
}

export interface ExpenseRow {
	amount: number;
	currency: string;
}

export interface CountResult {
	count: number;
}

export interface BudgetWithCurrency extends BudgetRow {
	currency: string;
}

// Expense types for commands
export interface ExpenseWithPayer {
	id: string;
	amount: string;
	currency: string | null;
	description: string | null;
	category: string | null;
	createdAt: Date;
	createdBy: string;
	notes: string | null;
	payerUsername: string | null;
	payerFirstName: string | null;
	splitCount?: number;
}
