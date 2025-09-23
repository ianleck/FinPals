/**
 * Currency conversion and formatting utilities
 * Uses Frankfurter API for real-time exchange rates with caching
 */

import { eq, gt } from 'drizzle-orm';
import type { Database } from '../db';
import { users, exchangeRates } from '../db/schema';
import { logger } from './logger';

interface ExchangeRateResponse {
	amount: number;
	base: string;
	date: string;
	rates: Record<string, number>;
}

// Popular currencies for Southeast Asia region
const SUPPORTED_CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'JPY', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'CNY', 'HKD', 'TWD', 'KRW', 'INR', 'AUD', 'CAD', 'NZD'];

// Cache duration for exchange rates
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

/**
 * Fetch exchange rates from Frankfurter API (free, no key required)
 * Frankfurter supports SGD and most major currencies
 */
async function fetchRatesFromAPI(baseCurrency: string = 'SGD'): Promise<Record<string, number>> {
	try {
		// Frankfurter API - free, reliable, supports SGD
		const symbols = SUPPORTED_CURRENCIES.filter(c => c !== baseCurrency).join(',');
		const url = `https://api.frankfurter.dev/latest?base=${baseCurrency}&symbols=${symbols}`;

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`API returned ${response.status}: ${response.statusText}`);
		}

		const data = await response.json() as ExchangeRateResponse;

		// Include the base currency with rate 1
		return {
			[baseCurrency]: 1,
			...data.rates
		};
	} catch (error) {
		logger.error('Failed to fetch exchange rates from API', error);
		throw error;
	}
}

/**
 * Update exchange rates in database
 * Fetches fresh rates and stores them for caching
 */
export async function updateExchangeRatesInDB(db: Database, baseCurrency: string = 'SGD'): Promise<Record<string, number> | null> {
	try {
		const freshRates = await fetchRatesFromAPI(baseCurrency);

		// Store rates directly with baseCurrency as reference
		for (const [currency, rate] of Object.entries(freshRates)) {
			await db
				.insert(exchangeRates)
				.values({
					currencyCode: currency,
					rateToUsd: rate.toFixed(10), // Store relative to base, not USD
					source: 'frankfurter',
					lastUpdated: new Date(),
				})
				.onConflictDoUpdate({
					target: exchangeRates.currencyCode,
					set: {
						rateToUsd: rate.toFixed(10),
						lastUpdated: new Date(),
					},
				});
		}

		logger.info(`Successfully updated ${Object.keys(freshRates).length} exchange rates`);
		return freshRates; // Return the rates to avoid re-fetching
	} catch (error) {
		logger.error('Error updating exchange rates', error);
		return null;
	}
}

/**
 * Get exchange rates with caching
 * Returns cached rates if fresh, otherwise fetches new rates
 */
export async function getExchangeRates(
	db: Database,
	baseCurrency: string = 'SGD',
	maxAge: number = CACHE_DURATION
): Promise<Record<string, number>> {
	try {
		// Check cache first
		const cacheTime = new Date(Date.now() - maxAge);
		const cached = await db
			.select()
			.from(exchangeRates)
			.where(gt(exchangeRates.lastUpdated, cacheTime));

		if (cached.length > 0) {
			// Build rates from cache relative to base currency
			const rates: Record<string, number> = {};
			const baseRate = cached.find(r => r.currencyCode === baseCurrency);

			if (baseRate) {
				for (const rate of cached) {
					// Calculate rate relative to requested base
					rates[rate.currencyCode] = Number(rate.rateToUsd) / Number(baseRate.rateToUsd);
				}
				return rates;
			}
		}

		// Cache miss or stale, fetch and update
		const freshRates = await updateExchangeRatesInDB(db, baseCurrency);
		return freshRates || {};
	} catch (error) {
		logger.error('Failed to get exchange rates', error);

		// Return fallback rates (1:1) if all else fails
		const fallbackRates: Record<string, number> = {};
		for (const currency of SUPPORTED_CURRENCIES) {
			fallbackRates[currency] = currency === baseCurrency ? 1 : 1;
		}
		return fallbackRates;
	}
}

export const CURRENCY_SYMBOLS: { [key: string]: string } = {
	USD: '$',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	CNY: '¥',
	SGD: 'S$', // Singapore Dollar
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

/**
 * Convert amount between currencies using real exchange rates
 */
export async function convertCurrency(
	db: Database,
	amount: number,
	from: string,
	to: string
): Promise<number> {
	if (from === to) {
		return amount;
	}

	try {
		// Get rates based on fromCurrency as base
		const rates = await getExchangeRates(db, from);
		const rate = rates[to];

		if (!rate) {
			logger.warn(`No exchange rate found for ${from} to ${to}`);
			return amount; // Return original amount if rate not found
		}

		return amount * rate;
	} catch (error) {
		logger.error(`Failed to convert ${amount} from ${from} to ${to}`, error);
		return amount; // Return original amount on error
	}
}

// Cached rates for synchronous operations
let cachedRates: Record<string, number> | null = null;
let cacheExpiry = 0;
let cacheBase = 'SGD';

/**
 * Refresh the rates cache for synchronous operations
 */
export async function refreshRatesCache(db: Database, baseCurrency: string = 'SGD'): Promise<void> {
	try {
		const rates = await getExchangeRates(db, baseCurrency);
		cachedRates = rates;
		cacheExpiry = Date.now() + CACHE_DURATION;
		cacheBase = baseCurrency;
	} catch (error) {
		logger.error('Failed to refresh rates cache', error);
	}
}

/**
 * Synchronous currency conversion using cached rates
 * Falls back to 1:1 if no rates available
 */
export function convertCurrencySync(amount: number, from: string, to: string): number {
	if (from === to) return amount;

	// If no cache or expired, return original amount
	if (!cachedRates || Date.now() > cacheExpiry) {
		logger.warn('No cached rates available for sync conversion');
		return amount;
	}

	// Convert via base currency if needed
	if (cacheBase === from) {
		return amount * (cachedRates[to] || 1);
	} else if (cacheBase === to) {
		return amount / (cachedRates[from] || 1);
	} else {
		// Convert through base currency
		const fromRate = cachedRates[from] || 1;
		const toRate = cachedRates[to] || 1;
		return amount * (toRate / fromRate);
	}
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
				const currency = Object.entries(CURRENCY_SYMBOLS).find(([, s]) => s === symbol)?.[0] || 'SGD';
				return { amount, currency };
			} else if (pattern === patterns[1]) {
				// Amount then code
				return { amount: parseFloat(match[1]), currency: match[2].toUpperCase() };
			} else if (pattern === patterns[2]) {
				// Code then amount
				return { amount: parseFloat(match[2]), currency: match[1].toUpperCase() };
			} else {
				// Just a number, default to SGD
				return { amount: parseFloat(match[1]), currency: 'SGD' };
			}
		}
	}

	return null;
}

// Get user's preferred currency from database or default
export async function getUserCurrency(db: Database, userId: string): Promise<string> {
	const user = await db.select({ preferredCurrency: users.preferredCurrency }).from(users).where(eq(users.telegramId, userId)).limit(1);
	return user[0]?.preferredCurrency || 'SGD';
}

// Set user's preferred currency
export async function setUserCurrency(db: Database, userId: string, currency: string): Promise<void> {
	await db.update(users).set({ preferredCurrency: currency }).where(eq(users.telegramId, userId));
}
