// Currency conversion utilities
// Supports both mock rates and real-time rates from exchangerate-api.com

import { eq, gt } from 'drizzle-orm';
import type { Database } from '../db';
import { users, exchangeRates } from '../db/schema';
import { logger } from './logger';
import type { FrankfurterResponse } from '../types/common';

const MOCK_RATES: { [key: string]: number } = {
	USD: 1,
	EUR: 0.88, // Euro (as of Jan 2025)
	GBP: 0.74, // British Pound
	JPY: 145.06, // Japanese Yen
	CNY: 7.19, // Chinese Yuan
	SGD: 1.29, // Singapore Dollar
	INR: 85.49, // Indian Rupee
	AUD: 1.54, // Australian Dollar
	CAD: 1.37, // Canadian Dollar
	// Additional currencies
	KRW: 1373.15, // Korean Won
	THB: 32.59, // Thai Baht
	MYR: 4.24, // Malaysian Ringgit
	PHP: 55.85, // Philippine Peso
	IDR: 16262.8, // Indonesian Rupiah
	VND: 26027.43, // Vietnamese Dong
	HKD: 7.85, // Hong Kong Dollar
	TWD: 29.91, // Taiwan Dollar
	NZD: 1.66, // New Zealand Dollar
	CHF: 0.82, // Swiss Franc
	SEK: 9.61, // Swedish Krona
	NOK: 10.1, // Norwegian Krone
	DKK: 6.53, // Danish Krone
	ZAR: 17.71, // South African Rand
	AED: 3.67, // UAE Dirham (pegged)
	SAR: 3.75, // Saudi Riyal (pegged)
	BRL: 5.57, // Brazilian Real
	MXN: 19.04, // Mexican Peso
	TRY: 39.18, // Turkish Lira
	RUB: 78.48, // Russian Ruble
};

// Cache for real-time rates - removed as unused
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Update exchange rates in database
export async function updateExchangeRatesInDB(db: Database): Promise<boolean> {
	try {
		// Try to fetch from Frankfurter API (free, no key needed)
		const response = await fetch('https://api.frankfurter.app/latest?from=USD');
		if (!response.ok) {
			logger.error('Failed to fetch rates from Frankfurter', response.statusText);
			return false;
		}

		const data = (await response.json()) as FrankfurterResponse;
		const rates: Record<string, number> = { USD: 1 };

		// Convert the rates to USD base
		for (const [currency, rate] of Object.entries(data.rates)) {
			rates[currency] = rate;
		}

		// Update all rates in database
		const updatePromises = Object.entries(rates).map(([currency, rate]) =>
			db
				.insert(exchangeRates)
				.values({
					currencyCode: currency,
					rateToUsd: rate.toString(),
					source: 'frankfurter',
					lastUpdated: new Date(),
				})
				.onConflictDoUpdate({
					target: exchangeRates.currencyCode,
					set: {
						rateToUsd: rate.toString(),
						source: 'frankfurter',
						lastUpdated: new Date(),
					},
				}),
		);

		await Promise.all(updatePromises);
		logger.info(`Successfully updated ${Object.keys(rates).length} exchange rates`);
		return true;
	} catch (error) {
		logger.error('Error updating exchange rates', error);
		return false;
	}
}

// Get exchange rates from database
export async function getExchangeRatesFromDB(db: Database): Promise<{ [key: string]: number } | null> {
	try {
		const oneDayAgo = new Date();
		oneDayAgo.setHours(oneDayAgo.getHours() - 24);

		const results = await db
			.select({
				currencyCode: exchangeRates.currencyCode,
				rateToUsd: exchangeRates.rateToUsd,
			})
			.from(exchangeRates)
			.where(gt(exchangeRates.lastUpdated, oneDayAgo));

		if (!results || results.length === 0) {
			return null;
		}

		const rates: { [key: string]: number } = {};
		results.forEach((row) => {
			rates[row.currencyCode] = parseFloat(row.rateToUsd);
		});

		return rates;
	} catch (error) {
		logger.error('Error getting exchange rates from DB', error);
		return null;
	}
}

export const CURRENCY_SYMBOLS: { [key: string]: string } = {
	USD: '$',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	CNY: '¥',
	SGD: '$',
	INR: '₹',
	AUD: 'A$',
	CAD: 'C$',
	// Additional currencies
	KRW: '₩',
	THB: '฿',
	MYR: 'RM',
	PHP: '₱',
	IDR: 'Rp',
	VND: '₫',
	HKD: 'HK$',
	TWD: 'NT$',
	NZD: 'NZ$',
	CHF: 'CHF',
	SEK: 'kr',
	NOK: 'kr',
	DKK: 'kr',
	ZAR: 'R',
	AED: 'د.إ',
	SAR: '﷼',
	BRL: 'R$',
	MXN: '$',
	TRY: '₺',
	RUB: '₽',
};

export async function convertCurrency(amount: number, from: string, to: string, db?: Database): Promise<number> {
	// Try to get rates from database first
	if (db) {
		const dbRates = await getExchangeRatesFromDB(db);
		if (dbRates) {
			const fromRate = dbRates[from] || 1;
			const toRate = dbRates[to] || 1;
			return amount * (toRate / fromRate);
		}
	}

	// Fall back to mock rates
	const fromRate = MOCK_RATES[from] || 1;
	const toRate = MOCK_RATES[to] || 1;
	return amount * (toRate / fromRate);
}

// Get latest exchange rates (synchronous for calculations)
let cachedRates: { [key: string]: number } | null = null;
let cacheExpiry = 0;

export async function refreshRatesCache(db: Database): Promise<void> {
	const dbRates = await getExchangeRatesFromDB(db);
	if (dbRates) {
		cachedRates = dbRates;
		cacheExpiry = Date.now() + CACHE_DURATION;
	}
}

// Enhanced synchronous version that uses cached DB rates if available
export function convertCurrencySync(amount: number, from: string, to: string): number {
	// Use cached rates if available and not expired
	const rates = cachedRates && Date.now() < cacheExpiry ? cachedRates : MOCK_RATES;
	const fromRate = rates[from] || 1;
	const toRate = rates[to] || 1;
	return amount * (toRate / fromRate);
}

export function formatCurrency(amount: number, currency: string): string {
	const symbol = CURRENCY_SYMBOLS[currency];

	// Special handling for currencies without decimals
	const noDecimalCurrencies = ['JPY', 'KRW', 'IDR', 'VND'];
	if (noDecimalCurrencies.includes(currency)) {
		const formatted = Math.round(amount).toLocaleString('en-US');
		return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`;
	}

	// Unknown currency
	if (!symbol) {
		return `${amount.toFixed(2)} ${currency}`;
	}

	// Format with thousands separator
	const formatted = amount.toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

	// Handle currencies where symbol goes after amount
	const symbolAfterCurrencies = ['SEK', 'NOK', 'DKK'];
	if (symbolAfterCurrencies.includes(currency)) {
		return `${formatted} ${symbol}`;
	}

	return `${symbol}${formatted}`;
}

export function getCurrencySymbol(currency: string): string {
	return CURRENCY_SYMBOLS[currency] || currency;
}

export function parseCurrencyFromText(text: string): { amount: number; currency: string } | null {
	// Get all supported currency codes
	const allCurrencies = Object.keys(CURRENCY_SYMBOLS).join('|');

	// Match patterns like $100, €50, 100 USD, EUR 25.50, or just 50
	const patterns = [
		/([€£¥₹₩฿₱₫﷼₺₽]|RM|Rp|HK\$|NT\$|NZ\$|CHF|kr|R\$|A\$|C\$|\$)(\d+(?:\.\d+)?)/, // Symbol first
		new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${allCurrencies})`, 'i'), // Amount then code
		new RegExp(`(${allCurrencies})\\s*(\\d+(?:\\.\\d+)?)`, 'i'), // Code then amount
		/^(\d+(?:\.\d+)?)$/, // Just a number, default to USD
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			if (pattern === patterns[0]) {
				// Symbol first
				const symbol = match[1];
				const amount = parseFloat(match[2]);
				const currency = Object.entries(CURRENCY_SYMBOLS).find(([, s]) => s === symbol)?.[0] || 'USD';
				return { amount, currency };
			} else if (pattern === patterns[1]) {
				// Amount then code
				return { amount: parseFloat(match[1]), currency: match[2].toUpperCase() };
			} else if (pattern === patterns[2]) {
				// Code then amount
				return { amount: parseFloat(match[2]), currency: match[1].toUpperCase() };
			} else {
				// Just a number
				return { amount: parseFloat(match[1]), currency: 'USD' };
			}
		}
	}

	return null;
}

// Get user's preferred currency from database or default
export async function getUserCurrency(db: Database, userId: string): Promise<string> {
	const user = await db.select({ preferredCurrency: users.preferredCurrency }).from(users).where(eq(users.telegramId, userId)).limit(1);
	return user[0]?.preferredCurrency || 'USD';
}

// Set user's preferred currency
export async function setUserCurrency(db: Database, userId: string, currency: string): Promise<void> {
	await db.update(users).set({ preferredCurrency: currency }).where(eq(users.telegramId, userId));
}
