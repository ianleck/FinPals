import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
    getUserBudgets, 
    checkBudgetLimits, 
    calculateBudgetUsage,
    getBudgetPeriodDays 
} from '../../utils/budget-helpers';
import { createMockDB } from '../mocks/database';

describe('budget-helpers', () => {
    let db: D1Database;
    let mockPreparedStatement: any;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('getUserBudgets', () => {
        it('should fetch user budgets with usage', async () => {
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 1,
                        category: 'Food & Dining',
                        amount: 500,
                        period: 'monthly',
                        spent: 350.50,
                        percentage: 70.1
                    },
                    {
                        id: 2,
                        category: 'Transportation',
                        amount: 200,
                        period: 'monthly',
                        spent: 180,
                        percentage: 90
                    }
                ]
            });

            const budgets = await getUserBudgets(db, '123456789');

            expect(budgets).toHaveLength(2);
            expect(budgets[0]).toMatchObject({
                category: 'Food & Dining',
                amount: 500,
                spent: 350.50,
                percentage: 70.1
            });
            expect(budgets[1].percentage).toBe(90);
        });

        it('should handle empty budgets', async () => {
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: []
            });

            const budgets = await getUserBudgets(db, '123456789');

            expect(budgets).toEqual([]);
        });
    });

    describe('checkBudgetLimits', () => {
        it('should return warnings for exceeded budgets', async () => {
            // Mock budgets with one exceeded
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        category: 'Food & Dining',
                        amount: 100,
                        period: 'daily',
                        spent: 95,
                        percentage: 95
                    },
                    {
                        category: 'Transportation',
                        amount: 50,
                        period: 'daily',
                        spent: 55,
                        percentage: 110
                    }
                ]
            });

            const warnings = await checkBudgetLimits(db, '123456789', 'Transportation', 10);

            expect(warnings).toHaveLength(2);
            expect(warnings[0]).toMatchObject({
                category: 'Transportation',
                isExceeded: true,
                message: expect.stringContaining('exceeded')
            });
            expect(warnings[1]).toMatchObject({
                category: 'Food & Dining',
                isExceeded: false,
                message: expect.stringContaining('95%')
            });
        });

        it('should only return warnings for near or exceeded budgets', async () => {
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        category: 'Entertainment',
                        amount: 200,
                        period: 'monthly',
                        spent: 50,
                        percentage: 25
                    }
                ]
            });

            const warnings = await checkBudgetLimits(db, '123456789', 'Entertainment', 10);

            expect(warnings).toHaveLength(0);
        });

        it('should handle the added expense amount', async () => {
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        category: 'Food & Dining',
                        amount: 100,
                        period: 'daily',
                        spent: 80,
                        percentage: 80
                    }
                ]
            });

            const warnings = await checkBudgetLimits(db, '123456789', 'Food & Dining', 25);

            expect(warnings).toHaveLength(1);
            expect(warnings[0].newPercentage).toBe(105); // 80 + 25 = 105
            expect(warnings[0].isExceeded).toBe(true);
        });
    });

    describe('calculateBudgetUsage', () => {
        it('should calculate correct usage percentage', () => {
            expect(calculateBudgetUsage(50, 100)).toBe(50);
            expect(calculateBudgetUsage(75, 100)).toBe(75);
            expect(calculateBudgetUsage(0, 100)).toBe(0);
            expect(calculateBudgetUsage(150, 100)).toBe(150);
        });

        it('should handle zero budget', () => {
            expect(calculateBudgetUsage(50, 0)).toBe(0);
        });

        it('should round to one decimal place', () => {
            expect(calculateBudgetUsage(33.333, 100)).toBe(33.3);
            expect(calculateBudgetUsage(66.666, 100)).toBe(66.7);
        });
    });

    describe('getBudgetPeriodDays', () => {
        it('should return correct days for each period', () => {
            expect(getBudgetPeriodDays('daily')).toBe(1);
            expect(getBudgetPeriodDays('weekly')).toBe(7);
            expect(getBudgetPeriodDays('monthly')).toBe(30);
        });

        it('should return 30 for unknown periods', () => {
            expect(getBudgetPeriodDays('yearly' as any)).toBe(30);
            expect(getBudgetPeriodDays('' as any)).toBe(30);
        });
    });
});