// Currency conversion utilities
// Supports both mock rates and real-time rates from exchangerate-api.com

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

// Cache for real-time rates
let ratesCache: { rates: { [key: string]: number }; timestamp: number } | null = null;
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Update exchange rates in database
export async function updateExchangeRatesInDB(db: D1Database): Promise<boolean> {
	try {
		// Try to fetch from Frankfurter API (free, no key needed)
		const response = await fetch('https://api.frankfurter.app/latest?from=USD');
		if (!response.ok) {
			console.error('Failed to fetch rates from Frankfurter:', response.statusText);
			return false;
		}

		const data = (await response.json()) as any;
		const rates: { [key: string]: number } = { USD: 1 };

		// Convert the rates to USD base
		for (const [currency, rate] of Object.entries(data.rates)) {
			rates[currency] = rate as number;
		}

		// Update all rates in database
		const updatePromises = Object.entries(rates).map(([currency, rate]) =>
			db
				.prepare(
					'INSERT OR REPLACE INTO exchange_rates (currency_code, rate_to_usd, source, last_updated) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
				)
				.bind(currency, rate as number, 'frankfurter')
				.run()
		);

		await Promise.all(updatePromises);
		console.log(`Successfully updated ${Object.keys(rates).length} exchange rates`);
		return true;
	} catch (error) {
		console.error('Error updating exchange rates:', error);
		return false;
	}
}

// Get exchange rates from database
export async function getExchangeRatesFromDB(db: D1Database): Promise<{ [key: string]: number } | null> {
	try {
		const results = await db
			.prepare('SELECT currency_code, rate_to_usd FROM exchange_rates WHERE last_updated > datetime("now", "-24 hours")')
			.all();

		if (!results.results || results.results.length === 0) {
			return null;
		}

		const rates: { [key: string]: number } = {};
		results.results.forEach((row: any) => {
			rates[row.currency_code] = row.rate_to_usd;
		});

		return rates;
	} catch (error) {
		console.error('Error getting exchange rates from DB:', error);
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

// Fetch real-time exchange rates from various free APIs
async function fetchRealTimeRates(apiKey?: string): Promise<{ [key: string]: number } | null> {
	try {
		// Check cache first
		if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_DURATION) {
			return ratesCache.rates;
		}

		// Try different free APIs in order of preference

		// 1. Frankfurter API (European Central Bank data) - completely free, no key needed
		try {
			const response = await fetch('https://api.frankfurter.app/latest?from=USD');
			if (response.ok) {
				const data = (await response.json()) as any;
				const rates: { [key: string]: number } = { USD: 1 };

				// Convert the rates to USD base
				for (const [currency, rate] of Object.entries(data.rates)) {
					rates[currency] = rate as number;
				}

				// Cache the rates
				ratesCache = {
					rates,
					timestamp: Date.now(),
				};
				return rates;
			}
		} catch (e) {
			console.log('Frankfurter API failed, trying next...');
		}

		// 2. ExchangeRate-API (if API key provided)
		if (apiKey) {
			try {
				const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);
				if (response.ok) {
					const data = (await response.json()) as any;
					if (data.result === 'success') {
						// Cache the rates
						ratesCache = {
							rates: data.conversion_rates,
							timestamp: Date.now(),
						};
						return data.conversion_rates;
					}
				}
			} catch (e) {
				console.log('ExchangeRate-API failed, trying next...');
			}
		}

		// 3. Fixer.io free tier (requires free API key, 100 requests/month)
		// Uncomment and add your key if you want to use this
		// const fixerKey = 'YOUR_FIXER_API_KEY';
		// try {
		//   const response = await fetch(`http://data.fixer.io/api/latest?access_key=${fixerKey}&base=EUR`);
		//   if (response.ok) {
		//     const data = await response.json();
		//     if (data.success) {
		//       // Convert from EUR base to USD base
		//       const usdRate = data.rates.USD;
		//       const rates: { [key: string]: number } = {};
		//       for (const [currency, rate] of Object.entries(data.rates)) {
		//         rates[currency] = (rate as number) / usdRate;
		//       }
		//       rates.USD = 1;
		//       ratesCache = { rates, timestamp: Date.now() };
		//       return rates;
		//     }
		//   }
		// } catch (e) {
		//   console.log('Fixer.io failed');
		// }

		return null;
	} catch (error) {
		console.error('Error fetching exchange rates:', error);
		return null;
	}
}

export async function convertCurrency(amount: number, from: string, to: string, db?: D1Database): Promise<number> {
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

export async function refreshRatesCache(db: D1Database): Promise<void> {
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
				const currency = Object.entries(CURRENCY_SYMBOLS).find(([_, s]) => s === symbol)?.[0] || 'USD';
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
export async function getUserCurrency(db: D1Database, userId: string): Promise<string> {
	const user = await db.prepare('SELECT preferred_currency FROM users WHERE telegram_id = ?').bind(userId).first();
	return (user?.preferred_currency as string) || 'USD';
}

// Set user's preferred currency
export async function setUserCurrency(db: D1Database, userId: string, currency: string): Promise<void> {
	await db.prepare('UPDATE users SET preferred_currency = ? WHERE telegram_id = ?').bind(currency, userId).run();
}
