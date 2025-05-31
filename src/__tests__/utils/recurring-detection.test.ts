import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectRecurringExpenses, createRecurringReminder } from '../../utils/recurring-detection';
import { createTestDatabase } from '../helpers/test-utils';

describe('Recurring Expense Detection', () => {
    let db: D1Database;

    beforeEach(() => {
        db = createTestDatabase();
        vi.clearAllMocks();
    });

    describe('detectRecurringExpenses', () => {
        it('should detect monthly recurring expenses', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock expense history with monthly pattern
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    {
                        description: 'Spotify subscription',
                        amount: 9.99,
                        category: 'Entertainment',
                        paid_by: 'user123',
                        created_at: '2024-01-15T10:00:00Z'
                    },
                    {
                        description: 'Spotify subscription',
                        amount: 9.99,
                        category: 'Entertainment',
                        paid_by: 'user123',
                        created_at: '2024-02-15T10:30:00Z'
                    },
                    {
                        description: 'Spotify subscription',
                        amount: 9.99,
                        category: 'Entertainment',
                        paid_by: 'user123',
                        created_at: '2024-03-15T09:45:00Z'
                    }
                ]
            });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(1);
            expect(patterns[0]).toMatchObject({
                description: 'Spotify subscription',
                amount: 9.99,
                frequency: 'monthly',
                confidence: expect.any(Number),
                nextExpectedDate: expect.any(Date)
            });
            expect(patterns[0].confidence).toBeGreaterThan(0.8);
        });

        it('should detect weekly recurring expenses', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock weekly coffee purchases
            const weeklyDates = [];
            for (let i = 0; i < 6; i++) {
                weeklyDates.push({
                    description: 'Morning coffee',
                    amount: 5.00,
                    category: 'Food & Dining',
                    paid_by: 'user123',
                    created_at: new Date(2024, 0, 8 + (i * 7), 8, 0, 0).toISOString()
                });
            }
            
            mockStmt.all.mockResolvedValueOnce({ results: weeklyDates });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(1);
            expect(patterns[0]).toMatchObject({
                description: 'Morning coffee',
                amount: 5.00,
                frequency: 'weekly',
                confidence: expect.any(Number)
            });
        });

        it('should detect daily recurring expenses', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock daily lunch expenses
            const dailyDates = [];
            for (let i = 0; i < 10; i++) {
                dailyDates.push({
                    description: 'lunch',
                    amount: 12.00,
                    category: 'Food & Dining',
                    paid_by: 'user123',
                    created_at: new Date(2024, 0, 1 + i, 12, 30, 0).toISOString()
                });
            }
            
            mockStmt.all.mockResolvedValueOnce({ results: dailyDates });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(1);
            expect(patterns[0]).toMatchObject({
                description: 'lunch',
                frequency: 'daily',
                confidence: expect.any(Number)
            });
        });

        it('should handle amount variations within threshold', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock expenses with slight amount variations
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    {
                        description: 'Netflix',
                        amount: 15.99,
                        created_at: '2024-01-01T00:00:00Z'
                    },
                    {
                        description: 'Netflix',
                        amount: 15.99,
                        created_at: '2024-02-01T00:00:00Z'
                    },
                    {
                        description: 'Netflix',
                        amount: 17.99, // Price increase
                        created_at: '2024-03-01T00:00:00Z'
                    }
                ]
            });

            const patterns = await detectRecurringExpenses(db, 'group123', {
                amountVariationThreshold: 0.2 // 20% variation allowed
            });

            expect(patterns).toHaveLength(1);
            expect(patterns[0].averageAmount).toBeCloseTo(16.66, 2);
        });

        it.skip('should group similar descriptions', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock expenses with similar descriptions
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    { description: 'uber to work', amount: 15, created_at: '2024-01-01T08:00:00Z', category: 'Transportation', paid_by: '123', participants: '123,456' },
                    { description: 'Uber to office', amount: 14, created_at: '2024-01-08T08:15:00Z', category: 'Transportation', paid_by: '123', participants: '123,456' },
                    { description: 'uber ride to work', amount: 16, created_at: '2024-01-15T08:00:00Z', category: 'Transportation', paid_by: '123', participants: '123,456' },
                    { description: 'Uber - work', amount: 15, created_at: '2024-01-22T08:30:00Z', category: 'Transportation', paid_by: '123', participants: '123,456' }
                ]
            });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(1);
            expect(patterns[0].description).toContain('uber');
            expect(patterns[0].frequency).toBe('weekly');
        });

        it('should predict next occurrence date', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock monthly rent payments
            const today = new Date();
            const dates = [];
            for (let i = 3; i >= 1; i--) {
                const date = new Date(today);
                date.setMonth(date.getMonth() - i);
                date.setDate(1); // First of each month
                dates.push({
                    description: 'Rent payment',
                    amount: 1500,
                    created_at: date.toISOString()
                });
            }
            
            mockStmt.all.mockResolvedValueOnce({ results: dates });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(1);
            const nextDate = patterns[0].nextExpectedDate;
            expect(nextDate.getDate()).toBe(1); // Should be first of month
            expect(nextDate.getTime()).toBeGreaterThan(today.getTime());
        });

        it('should calculate confidence score based on consistency', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock inconsistent pattern
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    { description: 'gym', amount: 50, created_at: '2024-01-01T00:00:00Z' },
                    { description: 'gym', amount: 50, created_at: '2024-02-01T00:00:00Z' },
                    { description: 'gym', amount: 50, created_at: '2024-03-15T00:00:00Z' }, // Late payment
                    { description: 'gym', amount: 50, created_at: '2024-04-01T00:00:00Z' }
                ]
            });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns[0].confidence).toBeLessThan(1.0);
            expect(patterns[0].confidence).toBeGreaterThan(0.6);
        });

        it('should filter out non-recurring expenses', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock random expenses
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    { description: 'dinner', amount: 45, created_at: '2024-01-05T00:00:00Z' },
                    { description: 'dinner', amount: 45, created_at: '2024-01-20T00:00:00Z' },
                    { description: 'dinner', amount: 45, created_at: '2024-02-14T00:00:00Z' }
                    // Irregular intervals, should not be detected as recurring
                ]
            });

            const patterns = await detectRecurringExpenses(db, 'group123');

            expect(patterns).toHaveLength(0);
        });
    });

    describe('createRecurringReminder', () => {
        it('should create reminder for upcoming recurring expense', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const pattern = {
                description: 'Netflix subscription',
                amount: 15.99,
                frequency: 'monthly' as const,
                nextExpectedDate: new Date('2024-02-01'),
                confidence: 0.95,
                averageAmount: 15.99
            };

            const reminder = await createRecurringReminder(pattern);

            expect(reminder).toContain('Netflix subscription');
            expect(reminder).toContain('$15.99');
            expect(reminder).toContain('monthly');
            expect(reminder).toContain('February');
        });

        it('should suggest creating a template for high-confidence patterns', async () => {
            const pattern = {
                description: 'Spotify',
                amount: 9.99,
                frequency: 'monthly' as const,
                nextExpectedDate: new Date(),
                confidence: 0.9,
                averageAmount: 9.99
            };

            const reminder = await createRecurringReminder(pattern, {
                suggestTemplate: true
            });

            expect(reminder).toContain('template');
            expect(reminder).toContain('/templates');
        });

        it('should handle daily reminders appropriately', async () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            const pattern = {
                description: 'Morning coffee',
                amount: 5,
                frequency: 'daily' as const,
                nextExpectedDate: tomorrow,
                confidence: 0.85,
                averageAmount: 5
            };

            const reminder = await createRecurringReminder(pattern);

            expect(reminder).toContain('tomorrow');
            expect(reminder).toContain('coffee');
        });

        it('should include participants if available', async () => {
            const pattern = {
                description: 'Team lunch',
                amount: 60,
                frequency: 'weekly' as const,
                nextExpectedDate: new Date(),
                confidence: 0.8,
                averageAmount: 60,
                participants: ['@john', '@sarah', '@mike']
            };

            const reminder = await createRecurringReminder(pattern);

            expect(reminder).toContain('john');
            expect(reminder).toContain('sarah');
            expect(reminder).toContain('mike');
        });
    });

    describe('UX Enhancements', () => {
        it('should provide actionable reminders', async () => {
            const pattern = {
                description: 'Rent payment',
                amount: 1500,
                frequency: 'monthly' as const,
                nextExpectedDate: new Date('2024-02-01'),
                confidence: 1.0,
                averageAmount: 1500
            };

            const reminder = await createRecurringReminder(pattern, {
                includeQuickActions: true
            });

            expect(reminder).toContain('Add expense');
            expect(reminder).toContain('/add 1500.00 Rent payment');
        });

        it('should batch multiple upcoming expenses', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock multiple recurring patterns
            const patterns = [
                {
                    description: 'Netflix',
                    frequency: 'monthly',
                    nextExpectedDate: new Date('2024-02-01'),
                    amount: 15.99
                },
                {
                    description: 'Spotify',
                    frequency: 'monthly',
                    nextExpectedDate: new Date('2024-02-01'),
                    amount: 9.99
                },
                {
                    description: 'Gym',
                    frequency: 'monthly',
                    nextExpectedDate: new Date('2024-02-01'),
                    amount: 50
                }
            ];

            const batchReminder = await createRecurringReminder(patterns as any, {
                batchReminders: true
            });

            expect(batchReminder).toContain('3 recurring expenses');
            expect(batchReminder).toContain('$75.98'); // Total
            expect(batchReminder).toContain('Netflix');
            expect(batchReminder).toContain('Spotify');
            expect(batchReminder).toContain('Gym');
        });
    });
});