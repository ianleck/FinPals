/**
 * Money handling utilities using integer math (cents)
 * Ensures accurate financial calculations without floating point errors
 */

/**
 * Money class for accurate financial calculations
 * Internally stores amounts as cents (integers) to avoid floating point errors
 */
export class Money {
	private cents: number; // Store as integer cents

	constructor(value: string | number | Money) {
		if (value instanceof Money) {
			this.cents = value.cents;
			return;
		}

		// Convert to cents, handling both string and number inputs
		const numValue = typeof value === 'string' ? parseFloat(value) : value;
		this.cents = Math.round(numValue * 100);
	}

	/**
	 * Create Money from cents
	 */
	static fromCents(cents: number): Money {
		const money = new Money(0);
		money.cents = Math.round(cents);
		return money;
	}

	/**
	 * Create Money from database string value
	 */
	static fromDatabase(value: string | null | undefined): Money {
		if (!value) return new Money(0);
		return new Money(value);
	}

	/**
	 * Convert to cents (for integer calculations)
	 */
	toCents(): number {
		return this.cents;
	}

	/**
	 * Convert to database string format
	 */
	toDatabase(): string {
		return (this.cents / 100).toFixed(2);
	}

	/**
	 * Convert to display string
	 */
	toString(): string {
		return (this.cents / 100).toFixed(2);
	}

	/**
	 * Convert to number (use carefully)
	 */
	toNumber(): number {
		return this.cents / 100;
	}

	/**
	 * Add another Money amount
	 */
	add(other: Money): Money {
		return Money.fromCents(this.cents + other.cents);
	}

	/**
	 * Subtract another Money amount
	 */
	subtract(other: Money): Money {
		return Money.fromCents(this.cents - other.cents);
	}

	/**
	 * Multiply by a number
	 */
	multiply(factor: number): Money {
		return Money.fromCents(Math.round(this.cents * factor));
	}

	/**
	 * Divide by a number
	 */
	divide(divisor: number): Money {
		if (divisor === 0) throw new Error('Division by zero');
		return Money.fromCents(Math.round(this.cents / divisor));
	}

	/**
	 * Split amount evenly among n people
	 * Returns array of amounts that sum to original
	 */
	splitEvenly(count: number): Money[] {
		if (count <= 0) throw new Error('Count must be positive');

		const baseAmount = Math.floor(this.cents / count);
		const remainder = this.cents % count;

		const splits: Money[] = [];
		for (let i = 0; i < count; i++) {
			if (i < remainder) {
				// Add one cent to first few people to handle remainder
				splits.push(Money.fromCents(baseAmount + 1));
			} else {
				splits.push(Money.fromCents(baseAmount));
			}
		}

		return splits;
	}

	/**
	 * Split amount with custom weights
	 */
	splitWeighted(weights: number[]): Money[] {
		const totalWeight = weights.reduce((sum, w) => sum + w, 0);
		if (totalWeight === 0) throw new Error('Total weight must be positive');

		const splits: Money[] = [];
		let allocatedCents = 0;

		for (let i = 0; i < weights.length; i++) {
			if (i === weights.length - 1) {
				// Last person gets remainder to avoid rounding errors
				splits.push(Money.fromCents(this.cents - allocatedCents));
			} else {
				const shareCents = Math.round((this.cents * weights[i]) / totalWeight);
				splits.push(Money.fromCents(shareCents));
				allocatedCents += shareCents;
			}
		}

		return splits;
	}

	/**
	 * Check equality
	 */
	equals(other: Money): boolean {
		return this.cents === other.cents;
	}

	/**
	 * Check if greater than
	 */
	isGreaterThan(other: Money): boolean {
		return this.cents > other.cents;
	}

	/**
	 * Check if less than
	 */
	isLessThan(other: Money): boolean {
		return this.cents < other.cents;
	}

	/**
	 * Check if greater than or equal
	 */
	isGreaterThanOrEqual(other: Money): boolean {
		return this.cents >= other.cents;
	}

	/**
	 * Check if less than or equal
	 */
	isLessThanOrEqual(other: Money): boolean {
		return this.cents <= other.cents;
	}

	/**
	 * Check if zero
	 */
	isZero(): boolean {
		return this.cents === 0;
	}

	/**
	 * Check if positive
	 */
	isPositive(): boolean {
		return this.cents > 0;
	}

	/**
	 * Check if negative
	 */
	isNegative(): boolean {
		return this.cents < 0;
	}

	/**
	 * Get absolute value
	 */
	abs(): Money {
		return Money.fromCents(Math.abs(this.cents));
	}

	/**
	 * Negate the amount
	 */
	negate(): Money {
		return Money.fromCents(-this.cents);
	}

	/**
	 * Round to nearest cent (no-op since we store as cents)
	 */
	round(): Money {
		return new Money(this);
	}
}

/**
 * Parse money from user input
 */
export function parseMoney(value: string | number): Money | null {
	try {
		// Remove currency symbols and whitespace
		const cleaned = value.toString().replace(/[$€£¥₹,\s]/g, '');

		// Check if valid number
		if (!cleaned || isNaN(Number(cleaned))) {
			return null;
		}

		const money = new Money(cleaned);

		// Validate reasonable range for money
		if (money.isZero() || money.isNegative() || money.isGreaterThan(new Money(999999.99))) {
			return null;
		}

		return money;
	} catch {
		return null;
	}
}

/**
 * Format money for display with currency symbol
 */
export function formatMoney(money: Money, currency: string = 'SGD'): string {
	const formatter = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

	return formatter.format(money.toNumber());
}

/**
 * Format money without currency symbol
 */
export function formatMoneyPlain(money: Money): string {
	return money.toString();
}

/**
 * Sum an array of Money values
 */
export function sumMoney(amounts: Money[]): Money {
	return amounts.reduce((sum, amount) => sum.add(amount), new Money(0));
}

/**
 * Calculate percentage of amount
 */
export function calculatePercentage(amount: Money, percentage: number): Money {
	return amount.multiply(percentage / 100);
}

/**
 * Calculate tip amount
 */
export function calculateTip(amount: Money, tipPercentage: number): Money {
	return calculatePercentage(amount, tipPercentage);
}

/**
 * Convert between currencies (requires exchange rate)
 */
export function convertCurrency(amount: Money, exchangeRate: number): Money {
	return amount.multiply(exchangeRate);
}

/**
 * Validate money amount for database storage
 */
export function validateMoneyAmount(amount: Money): boolean {
	// Check if positive and within reasonable range
	return amount.isPositive() && amount.isLessThanOrEqual(new Money(999999.99)) && amount.isGreaterThanOrEqual(new Money(0.01));
}
