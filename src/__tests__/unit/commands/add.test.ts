import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseMoney } from '../../../utils/money';

describe('Add Command', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Input Parsing', () => {
		it('should parse valid amount', () => {
			const money = parseMoney('25.50');
			expect(money).not.toBeNull();
			expect(money?.toNumber()).toBe(25.5);
		});

		it('should parse amount with currency symbol', () => {
			const money = parseMoney('$100');
			expect(money).not.toBeNull();
			expect(money?.toNumber()).toBe(100);
		});

		it('should reject invalid amount', () => {
			const money = parseMoney('invalid');
			expect(money).toBeNull();
		});

		it('should reject negative amount', () => {
			const money = parseMoney('-50');
			expect(money).toBeNull();
		});

		it('should reject zero amount', () => {
			const money = parseMoney('0');
			expect(money).toBeNull();
		});
	});
});
