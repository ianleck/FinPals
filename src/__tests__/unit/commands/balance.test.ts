import { describe, it, expect } from 'vitest';
import { Money } from '../../../utils/money';

describe('Balance Command', () => {
	describe('Balance Calculations', () => {
		it('should calculate net balance correctly', () => {
			const paid = new Money(100);
			const owe = new Money(30);
			const net = paid.subtract(owe);
			expect(net.toNumber()).toBe(70);
		});

		it('should identify who owes whom', () => {
			const balance1 = new Money(50); // Person owes
			const balance2 = new Money(-50); // Person is owed

			expect(balance1.isPositive()).toBe(true);
			expect(balance2.isNegative()).toBe(true);
		});

		it('should handle zero balance', () => {
			const balance = new Money(0);
			expect(balance.isZero()).toBe(true);
		});
	});
});
