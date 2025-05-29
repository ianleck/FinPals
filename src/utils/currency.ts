// Currency conversion utilities
// In production, this would use a real API like exchangerate-api.com

const MOCK_RATES: { [key: string]: number } = {
	USD: 1,
	EUR: 0.85,
	GBP: 0.73,
	JPY: 110,
	CNY: 6.45,
	SGD: 1.35,
	INR: 75,
	AUD: 1.35,
	CAD: 1.25
};

export const CURRENCY_SYMBOLS: { [key: string]: string } = {
	USD: '$',
	EUR: '€',
	GBP: '£',
	JPY: '¥',
	CNY: '¥',
	SGD: '$',
	INR: '₹',
	AUD: 'A$',
	CAD: 'C$'
};

export function convertCurrency(amount: number, from: string, to: string): number {
	const fromRate = MOCK_RATES[from] || 1;
	const toRate = MOCK_RATES[to] || 1;
	return amount * (toRate / fromRate);
}

export function formatCurrency(amount: number, currency: string): string {
	const symbol = CURRENCY_SYMBOLS[currency] || '$';
	return `${symbol}${amount.toFixed(2)}`;
}

export function parseCurrencyFromText(text: string): { amount: number; currency: string } | null {
	// Match patterns like $100, €50, 100 USD, etc.
	const patterns = [
		/^([€£¥₹]|A\$|C\$)(\d+(?:\.\d+)?)/,  // Symbol first
		/^(\d+(?:\.\d+)?)\s*(USD|EUR|GBP|JPY|CNY|SGD|INR|AUD|CAD)/i,  // Amount then code
		/^\$(\d+(?:\.\d+)?)/  // Default $ to USD
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
			} else {
				// Default $
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