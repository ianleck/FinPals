import { describe, it, expect, vi } from 'vitest';
import { generateInsight } from '../../utils/smart-insights';

describe('generateInsight', () => {
	beforeEach(() => {
		// Mock date for consistent testing
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-15 14:00:00'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should generate price insights for expensive items', () => {
		const insight = generateInsight('dinner', 150, 'Food & Dining', 4);
		expect(insight).toContain('💡');
		expect(insight?.toLowerCase()).toContain('fancy');
	});

	it('should generate time-based insights for lunch', () => {
		vi.setSystemTime(new Date('2024-01-15 12:30:00'));
		const insight = generateInsight('meal', 50, 'Food & Dining', 3);
		expect(insight).toContain('🕐');
		expect(insight?.toLowerCase()).toContain('lunch');
	});

	it('should generate morning coffee insights', () => {
		vi.setSystemTime(new Date('2024-01-15 08:30:00'));
		const insight = generateInsight('coffee', 5, 'Food & Dining', 1);
		expect(insight).toContain('☕');
		expect(insight?.toLowerCase()).toContain('coffee');
	});

	it('should generate party insights for large groups', () => {
		const insight = generateInsight('drinks', 200, 'Entertainment', 8);
		expect(insight).toContain('🎉');
		expect(insight?.toLowerCase()).toContain('party');
	});

	it('should not generate insights randomly (mocked random)', () => {
		// Mock Math.random to always return 0.99 (above threshold)
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		const insight = generateInsight('lunch', 20, 'Food & Dining', 2);
		expect(insight).toBeNull();
	});

	it('should generate category-specific insights', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.01);
		
		const transportInsight = generateInsight('uber', 25, 'Transportation', 2);
		expect(transportInsight).toContain('🚗');
		
		const entertainmentInsight = generateInsight('movie', 30, 'Entertainment', 2);
		expect(entertainmentInsight).toContain('🎬');
	});

	it('should handle null category', () => {
		const insight = generateInsight('expense', 50, null, 3);
		// Should still potentially generate price or time insights
		expect(insight === null || typeof insight === 'string').toBe(true);
	});
});