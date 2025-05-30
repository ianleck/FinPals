import { describe, it, expect } from 'vitest';
import { 
	formatCurrency, 
	parseCurrencyFromText, 
	convertCurrency,
	getCurrencySymbol 
} from '../../utils/currency';

describe('Currency utilities', () => {
	describe('formatCurrency', () => {
		it('should format USD correctly', () => {
			expect(formatCurrency(100, 'USD')).toBe('$100.00');
			expect(formatCurrency(50.5, 'USD')).toBe('$50.50');
			expect(formatCurrency(1234.56, 'USD')).toBe('$1,234.56');
		});

		it('should format EUR correctly', () => {
			expect(formatCurrency(100, 'EUR')).toBe('€100.00');
		});

		it('should format GBP correctly', () => {
			expect(formatCurrency(100, 'GBP')).toBe('£100.00');
		});

		it('should format JPY without decimals', () => {
			expect(formatCurrency(1000, 'JPY')).toBe('¥1,000');
		});

		it('should handle unknown currency', () => {
			expect(formatCurrency(100, 'XYZ' as any)).toBe('100.00 XYZ');
		});
	});

	describe('parseCurrencyFromText', () => {
		it('should parse currency symbols', () => {
			expect(parseCurrencyFromText('$50 for lunch')).toEqual({
				amount: 50,
				currency: 'USD',
			});
			expect(parseCurrencyFromText('€25.50')).toEqual({
				amount: 25.5,
				currency: 'EUR',
			});
			expect(parseCurrencyFromText('£100')).toEqual({
				amount: 100,
				currency: 'GBP',
			});
		});

		it('should parse currency codes', () => {
			expect(parseCurrencyFromText('50 USD')).toEqual({
				amount: 50,
				currency: 'USD',
			});
			expect(parseCurrencyFromText('EUR 25.50')).toEqual({
				amount: 25.5,
				currency: 'EUR',
			});
		});

		it('should default to USD when no currency specified', () => {
			expect(parseCurrencyFromText('50')).toEqual({
				amount: 50,
				currency: 'USD',
			});
		});

		it('should return null for invalid input', () => {
			expect(parseCurrencyFromText('no numbers here')).toBeNull();
			expect(parseCurrencyFromText('')).toBeNull();
		});
	});

	describe('convertCurrency', () => {
		it('should return same amount for same currency', () => {
			expect(convertCurrency(100, 'USD', 'USD')).toBe(100);
		});

		it('should convert between currencies', () => {
			// USD to EUR (rate: 0.85)
			expect(convertCurrency(100, 'USD', 'EUR')).toBe(85);
			
			// EUR to USD
			expect(convertCurrency(85, 'EUR', 'USD')).toBeCloseTo(100, 1);
		});

		it('should handle conversions with JPY', () => {
			// USD to JPY (rate: 110)
			expect(convertCurrency(100, 'USD', 'JPY')).toBe(11000);
			
			// JPY to USD
			expect(convertCurrency(11000, 'JPY', 'USD')).toBeCloseTo(100, 1);
		});

		it('should handle unknown currencies', () => {
			// Should return original amount if currency not found
			expect(convertCurrency(100, 'XYZ' as any, 'USD')).toBe(100);
			expect(convertCurrency(100, 'USD', 'XYZ' as any)).toBe(100);
		});
	});

	describe('getCurrencySymbol', () => {
		it('should return correct symbols', () => {
			expect(getCurrencySymbol('USD')).toBe('$');
			expect(getCurrencySymbol('EUR')).toBe('€');
			expect(getCurrencySymbol('GBP')).toBe('£');
			expect(getCurrencySymbol('JPY')).toBe('¥');
			expect(getCurrencySymbol('CNY')).toBe('¥');
			expect(getCurrencySymbol('SGD')).toBe('$');
		});

		it('should return currency code for unknown currency', () => {
			expect(getCurrencySymbol('XYZ' as any)).toBe('XYZ');
		});
	});
});