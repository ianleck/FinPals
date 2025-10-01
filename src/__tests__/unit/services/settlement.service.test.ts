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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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

			const result = await calculateNetBalance(db, 'group1', 'user1', 'user2');

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
});
