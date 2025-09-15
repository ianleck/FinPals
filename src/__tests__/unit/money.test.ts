import { describe, it, expect } from 'vitest';
import { Money, parseMoney, formatMoney, sumMoney } from '../../utils/money';

describe('Money Class', () => {
	describe('Construction', () => {
		it('should create Money from number', () => {
			const money = new Money(10.5);
			expect(money.toNumber()).toBe(10.5);
			expect(money.toString()).toBe('10.50');
		});

		it('should create Money from string', () => {
			const money = new Money('25.75');
			expect(money.toNumber()).toBe(25.75);
			expect(money.toString()).toBe('25.75');
		});

		it('should create Money from cents', () => {
			const money = Money.fromCents(1550);
			expect(money.toNumber()).toBe(15.5);
			expect(money.toCents()).toBe(1550);
		});

		it('should handle Money copy constructor', () => {
			const original = new Money(10);
			const copy = new Money(original);
			expect(copy.toNumber()).toBe(10);
			expect(copy).not.toBe(original);
		});
	});

	describe('Arithmetic Operations', () => {
		it('should add money correctly', () => {
			const a = new Money(10.5);
			const b = new Money(5.25);
			const result = a.add(b);
			expect(result.toNumber()).toBe(15.75);
		});

		it('should subtract money correctly', () => {
			const a = new Money(20);
			const b = new Money(7.5);
			const result = a.subtract(b);
			expect(result.toNumber()).toBe(12.5);
		});

		it('should multiply by number', () => {
			const money = new Money(10);
			const result = money.multiply(3);
			expect(result.toNumber()).toBe(30);
		});

		it('should divide by number', () => {
			const money = new Money(30);
			const result = money.divide(3);
			expect(result.toNumber()).toBe(10);
		});

		it('should throw on division by zero', () => {
			const money = new Money(10);
			expect(() => money.divide(0)).toThrow('Division by zero');
		});
	});

	describe('Splitting', () => {
		it('should split evenly without remainder', () => {
			const money = new Money(30);
			const splits = money.splitEvenly(3);
			expect(splits).toHaveLength(3);
			splits.forEach((split) => {
				expect(split.toNumber()).toBe(10);
			});
		});

		it('should split evenly with remainder', () => {
			const money = new Money(10);
			const splits = money.splitEvenly(3);
			expect(splits).toHaveLength(3);
			expect(splits[0].toNumber()).toBe(3.34);
			expect(splits[1].toNumber()).toBe(3.33);
			expect(splits[2].toNumber()).toBe(3.33);
			// Verify total is preserved
			const total = sumMoney(splits);
			expect(total.toNumber()).toBe(10);
		});

		it('should split with weights', () => {
			const money = new Money(100);
			const splits = money.splitWeighted([1, 2, 2]);
			expect(splits).toHaveLength(3);
			expect(splits[0].toNumber()).toBe(20);
			expect(splits[1].toNumber()).toBe(40);
			expect(splits[2].toNumber()).toBe(40);
		});
	});

	describe('Comparisons', () => {
		it('should compare equality', () => {
			const a = new Money(10);
			const b = new Money(10);
			const c = new Money(20);
			expect(a.equals(b)).toBe(true);
			expect(a.equals(c)).toBe(false);
		});

		it('should compare greater than', () => {
			const a = new Money(20);
			const b = new Money(10);
			expect(a.isGreaterThan(b)).toBe(true);
			expect(b.isGreaterThan(a)).toBe(false);
		});

		it('should compare less than', () => {
			const a = new Money(10);
			const b = new Money(20);
			expect(a.isLessThan(b)).toBe(true);
			expect(b.isLessThan(a)).toBe(false);
		});

		it('should check zero, positive, negative', () => {
			const zero = new Money(0);
			const positive = new Money(10);
			const negative = new Money(-10);

			expect(zero.isZero()).toBe(true);
			expect(positive.isZero()).toBe(false);

			expect(positive.isPositive()).toBe(true);
			expect(negative.isPositive()).toBe(false);

			expect(negative.isNegative()).toBe(true);
			expect(positive.isNegative()).toBe(false);
		});
	});

	describe('Utility Methods', () => {
		it('should get absolute value', () => {
			const negative = new Money(-10);
			const positive = negative.abs();
			expect(positive.toNumber()).toBe(10);
		});

		it('should negate value', () => {
			const positive = new Money(10);
			const negative = positive.negate();
			expect(negative.toNumber()).toBe(-10);
		});

		it('should convert to database format', () => {
			const money = new Money(10.5);
			expect(money.toDatabase()).toBe('10.50');
		});

		it('should create from database format', () => {
			const money = Money.fromDatabase('25.75');
			expect(money.toNumber()).toBe(25.75);
		});

		it('should handle null database values', () => {
			const money = Money.fromDatabase(null);
			expect(money.toNumber()).toBe(0);
		});
	});
});

describe('Money Parsing', () => {
	it('should parse valid amounts', () => {
		expect(parseMoney('10.50')?.toNumber()).toBe(10.5);
		expect(parseMoney(25)?.toNumber()).toBe(25);
		expect(parseMoney('100')?.toNumber()).toBe(100);
	});

	it('should parse amounts with currency symbols', () => {
		expect(parseMoney('$10.50')?.toNumber()).toBe(10.5);
		expect(parseMoney('€25')?.toNumber()).toBe(25);
		expect(parseMoney('£100.00')?.toNumber()).toBe(100);
	});

	it('should parse amounts with commas', () => {
		expect(parseMoney('1,000')?.toNumber()).toBe(1000);
		expect(parseMoney('1,234.56')?.toNumber()).toBe(1234.56);
	});

	it('should return null for invalid amounts', () => {
		expect(parseMoney('invalid')).toBeNull();
		expect(parseMoney('')).toBeNull();
		expect(parseMoney('abc123')).toBeNull();
	});

	it('should reject negative amounts', () => {
		expect(parseMoney('-10')).toBeNull();
		expect(parseMoney('-100.50')).toBeNull();
	});

	it('should reject amounts over limit', () => {
		expect(parseMoney('1000000')).toBeNull();
		expect(parseMoney('9999999')).toBeNull();
	});
});

describe('Money Formatting', () => {
	it('should format with USD currency', () => {
		const money = new Money(1234.56);
		expect(formatMoney(money)).toBe('$1,234.56');
	});

	it('should format with other currencies', () => {
		const money = new Money(1000);
		expect(formatMoney(money, 'EUR')).toContain('1,000');
		expect(formatMoney(money, 'GBP')).toContain('1,000');
	});

	it('should format zero correctly', () => {
		const money = new Money(0);
		expect(formatMoney(money)).toBe('$0.00');
	});
});

describe('Money Utilities', () => {
	it('should sum array of money', () => {
		const amounts = [new Money(10), new Money(20), new Money(30)];
		const total = sumMoney(amounts);
		expect(total.toNumber()).toBe(60);
	});

	it('should sum empty array', () => {
		const total = sumMoney([]);
		expect(total.toNumber()).toBe(0);
	});
});
