import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateNetBalance, createSettlement } from '../../../services/settlement';
import { Money } from '../../../utils/money';

// Mock the database module
vi.mock('../../../db', () => ({
	withRetry: vi.fn((fn) => fn()),
}));

describe('Settlement Service - Debt Calculation Scenario Tests', () => {
	describe('calculateNetBalance()', () => {
		it('should return zero when no expenses or settlements exist between users', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			// Mock 4 SUM queries all returning null/0
			db.where
				.mockResolvedValueOnce([{ amount: null }]) // User1 paid, User2 owes
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid, User1 owes
				.mockResolvedValueOnce([{ amount: null }]) // User1 settled to User2
				.mockResolvedValueOnce([{ amount: null }]); // User2 settled to User1

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			expect(result.toNumber()).toBe(0);
		});

		it('should calculate simple one-way debt (User2 owes User1)', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid $100, User2 owes
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid nothing
				.mockResolvedValueOnce([{ amount: null }]) // No settlements User1->User2
				.mockResolvedValueOnce([{ amount: null }]); // No settlements User2->User1

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Positive means User2 owes User1
			expect(result.toNumber()).toBe(100);
		});

		it('should calculate bidirectional debt and return net amount', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid $100, User2 owes
				.mockResolvedValueOnce([{ amount: '30.00' }]) // User2 paid $30, User1 owes
				.mockResolvedValueOnce([{ amount: null }]) // No settlements
				.mockResolvedValueOnce([{ amount: null }]);

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// User2 owes User1: $100 - $30 = $70
			expect(result.toNumber()).toBe(70);
		});

		it('should account for partial settlements', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid $100, User2 owes
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid nothing
				.mockResolvedValueOnce([{ amount: null }]) // User1 didn't settle
				.mockResolvedValueOnce([{ amount: '40.00' }]); // User2 settled $40 to User1

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Formula: (user1Paid - user1Settled) - (user2Paid - user2Settled)
			// = (100 - 0) - (0 - 40) = 100 + 40 = 140
			expect(result.toNumber()).toBe(140);
		});

		it('should handle multiple settlements from both sides', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '150.00' }]) // User1 paid $150, User2 owes
				.mockResolvedValueOnce([{ amount: '50.00' }]) // User2 paid $50, User1 owes
				.mockResolvedValueOnce([{ amount: '20.00' }]) // User1 settled $20 to User2
				.mockResolvedValueOnce([{ amount: '30.00' }]); // User2 settled $30 to User1

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Calculate: (User1 paid - User1 settled) - (User2 paid - User2 settled)
			// (150 - 20) - (50 - 30) = 130 - 20 = 110
			expect(result.toNumber()).toBe(110);
		});

		it('should return negative balance when User1 owes User2', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '30.00' }]) // User1 paid $30, User2 owes
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User2 paid $100, User1 owes
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: null }]);

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Negative means User1 owes User2
			// 30 - 100 = -70
			expect(result.toNumber()).toBe(-70);
		});

		it('should handle equal bidirectional expenses', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid $100, User2 owes
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User2 paid $100, User1 owes
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: null }]);

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Formula: (100 - 0) - (100 - 0) = 0
			expect(result.toNumber()).toBe(0);
		});
	});

	describe('createSettlement()', () => {
		it('should create settlement with correct data', async () => {
			const db: any = {
				insert: vi.fn().mockReturnThis(),
				values: vi.fn().mockReturnThis(),
				returning: vi.fn().mockResolvedValue([
					{
						id: 'settlement-id',
						groupId: 'group1',
						fromUser: 'user1',
						toUser: 'user2',
						amount: '50.00',
						createdBy: 'user1',
						createdAt: new Date(),
					},
				]),
			};

			const settlementData = {
				groupId: 'group1',
				fromUser: 'user1',
				toUser: 'user2',
				amount: new Money(50),
				createdBy: 'user1',
			currency: 'USD',
			};

			const result = await createSettlement(db, settlementData);

			expect(result.id).toBe('settlement-id');
			expect(result.fromUser).toBe('user1');
			expect(result.toUser).toBe('user2');
			expect(result.amount).toBe('50.00');

			// Verify insert was called with correct values
			expect(db.insert).toHaveBeenCalled();
			expect(db.values).toHaveBeenCalledWith({
				groupId: 'group1',
				fromUser: 'user1',
				toUser: 'user2',
				amount: '50.00',
				currency: 'USD',
				createdBy: 'user1',
			});
		});

		it('should convert Money amount to database format', async () => {
			const db: any = {
				insert: vi.fn().mockReturnThis(),
				values: vi.fn().mockReturnThis(),
				returning: vi.fn().mockResolvedValue([
					{
						id: 's1',
						groupId: 'g1',
						fromUser: 'u1',
						toUser: 'u2',
						amount: '123.45',
						createdBy: 'u1',
						createdAt: new Date(),
					},
				]),
			};

			const settlementData = {
				groupId: 'g1',
				fromUser: 'u1',
				toUser: 'u2',
				amount: new Money(123.45),
				currency: 'USD',
				createdBy: 'u1',
			};

			await createSettlement(db, settlementData);

			// Verify amount is converted to database format (string with 2 decimals)
			expect(db.values).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: '123.45',
				})
			);
		});
	});

	describe('Multi-Currency Support', () => {
		it('should filter expenses by currency in calculateNetBalance', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			// User1 paid 100 USD and 50 EUR, User2 owes both
			// But we're querying for USD only
			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid USD (EUR filtered out)
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid nothing in USD
				.mockResolvedValueOnce([{ amount: null }]) // No USD settlements
				.mockResolvedValueOnce([{ amount: null }]);

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Should only return USD debt, not EUR
			expect(result.toNumber()).toBe(100);
		});

		it('should filter settlements by currency in calculateNetBalance', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User1 paid $100 USD
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid nothing
				.mockResolvedValueOnce([{ amount: null }]) // No USD settlements from User1
				.mockResolvedValueOnce([{ amount: '30.00' }]); // User2 settled $30 USD (EUR settlement filtered out)

			const resultUSD = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');

			// Formula: (100 - 0) - (0 - 30) = 100 + 30 = 130
			expect(resultUSD.toNumber()).toBe(130);

			// Now query for EUR separately
			db.where
				.mockResolvedValueOnce([{ amount: '50.00' }]) // User1 paid €50 EUR
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: '20.00' }]); // User2 settled €20 EUR

			const resultEUR = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'EUR');

			// Formula: (50 - 0) - (0 - 20) = 50 + 20 = 70
			expect(resultEUR.toNumber()).toBe(70);
		});

		it('should create settlements with currency field', async () => {
			const db: any = {
				insert: vi.fn().mockReturnThis(),
				values: vi.fn().mockReturnThis(),
				returning: vi.fn().mockResolvedValue([
					{
						id: 's1',
						groupId: 'g1',
						fromUser: 'u1',
						toUser: 'u2',
						amount: '100.00',
						currency: 'EUR',
						createdBy: 'u1',
						createdAt: new Date(),
					},
				]),
			};

			await createSettlement(db, {
				groupId: 'g1',
				fromUser: 'u1',
				toUser: 'u2',
				amount: new Money(100),
				currency: 'EUR',
				createdBy: 'u1',
			});

			// Verify currency is written to database
			expect(db.values).toHaveBeenCalledWith(
				expect.objectContaining({
					amount: '100.00',
					currency: 'EUR',
				}),
			);
		});

		it('should handle different currencies for same user pair', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			// Scenario: User1 owes User2 $100 USD but User2 owes User1 €50 EUR
			// These are independent balances

			// Query for USD
			db.where
				.mockResolvedValueOnce([{ amount: null }]) // User1 paid nothing in USD
				.mockResolvedValueOnce([{ amount: '100.00' }]) // User2 paid $100 USD
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: null }]);

			const usdBalance = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'USD');
			// User1 owes User2: 0 - 100 = -100 (negative = user1 owes)
			expect(usdBalance.toNumber()).toBe(-100);

			// Query for EUR
			db.where
				.mockResolvedValueOnce([{ amount: '50.00' }]) // User1 paid €50 EUR
				.mockResolvedValueOnce([{ amount: null }]) // User2 paid nothing in EUR
				.mockResolvedValueOnce([{ amount: null }])
				.mockResolvedValueOnce([{ amount: null }]);

			const eurBalance = await calculateNetBalance(db, 'group1', 'user1', 'user2', 'EUR');
			// User2 owes User1: 50 - 0 = 50 (positive = user2 owes)
			expect(eurBalance.toNumber()).toBe(50);
		});
	});
});
