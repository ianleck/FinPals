/**
 * Expense Service - Pure functions for expense operations
 * Extracted from command handlers to enable code reuse between bot and API
 */

import { Database, withRetry } from '../db';
import { users, groups, groupMembers, expenses, expenseSplits } from '../db/schema';
import { Money } from '../utils/money';
import { eq, and, or, desc, lt, isNull, SQL } from 'drizzle-orm';
import { EXPENSE_CONSTRAINTS } from '../schemas/expense';

// Type aliases (not classes, following functional architecture)
export type CreateExpenseData = {
	amount: Money;
	currency: string;
	description: string; // Max 500 chars
	category?: string; // Max 100 chars
	groupId?: string;
	tripId?: string;
	paidBy: string;
	splits: Array<{ userId: string; amount?: Money }>; // Max 50 splits
	note?: string; // Max 1000 chars
	createdBy: string;
};

export type UpdateExpenseData = Partial<CreateExpenseData>;

export type Expense = {
	id: string;
	groupId: string | null;
	tripId: string | null;
	amount: string;
	currency: string | null;
	description: string | null;
	category: string | null;
	paidBy: string;
	createdBy: string;
	createdAt: Date;
	deleted: boolean;
	isPersonal: boolean;
	notes: string | null;
	receiptUrl: string | null;
};

/**
 * Create expense with splits
 * EXTRACTED from handleAdd (src/commands/add.ts lines 122-306)
 */
export async function createExpense(db: Database, data: CreateExpenseData): Promise<Expense> {
	// Input validation using shared constants
	if (data.description.length > EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH) {
		throw new Error(`Description too long (max ${EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH} characters)`);
	}
	if (data.category && data.category.length > EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH) {
		throw new Error(`Category too long (max ${EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH} characters)`);
	}
	if (data.note && data.note.length > EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH) {
		throw new Error(`Note too long (max ${EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH} characters)`);
	}
	if (data.splits.length > EXPENSE_CONSTRAINTS.MAX_SPLITS) {
		throw new Error(`Too many splits (max ${EXPENSE_CONSTRAINTS.MAX_SPLITS})`);
	}
	if (!data.currency.match(/^[A-Z]{3}$/)) {
		throw new Error('Invalid currency code (must be 3-letter ISO 4217)');
	}

	return withRetry(async () => {
		// Ensure user exists
		const existingUser = await db.select().from(users).where(eq(users.telegramId, data.createdBy)).limit(1);

		if (existingUser.length === 0) {
			await db.insert(users).values({
				telegramId: data.createdBy,
			});
		}

		// For group expenses, ensure group exists
		if (data.groupId) {
			const existingGroup = await db.select().from(groups).where(eq(groups.telegramId, data.groupId)).limit(1);

			if (existingGroup.length === 0) {
				throw new Error('Group not found');
			}

			// Ensure user is member
			const membership = await db
				.select()
				.from(groupMembers)
				.where(and(eq(groupMembers.groupId, data.groupId), eq(groupMembers.userId, data.createdBy)))
				.limit(1);

			if (membership.length === 0) {
				throw new Error('User not a member of group');
			}
		}

		// Insert expense
		const [newExpense] = await db
			.insert(expenses)
			.values({
				groupId: data.groupId || null,
				tripId: data.tripId || null,
				amount: data.amount.toDatabase(),
				currency: data.currency,
				description: data.description,
				category: data.category || null,
				paidBy: data.paidBy,
				createdBy: data.createdBy,
				notes: data.note || null,
				deleted: false,
				isPersonal: !data.groupId,
			})
			.returning();

		// Insert splits
		if (data.splits.length > 0) {
			await db.insert(expenseSplits).values(
				data.splits.map((split) => ({
					expenseId: newExpense.id,
					userId: split.userId,
					amount: split.amount ? split.amount.toDatabase() : data.amount.divide(data.splits.length).toDatabase(),
				})),
			);
		}

		return newExpense as Expense;
	});
}

/**
 * Get expenses with filters
 * EXTRACTED from handleExpenses
 * Uses composite cursor (timestamp + id) to handle duplicate timestamps
 */
export async function getExpenses(
	db: Database,
	filters: {
		groupId?: string;
		tripId?: string;
		paidBy?: string;
		limit?: number;
		cursor?: string; // Format: "id_timestamp"
	},
): Promise<{ expenses: Expense[]; nextCursor?: string }> {
	return withRetry(async () => {
		// Build WHERE conditions (type-safe)
		const conditions: (SQL | undefined)[] = [eq(expenses.deleted, false)];

		if (filters.groupId) {
			conditions.push(eq(expenses.groupId, filters.groupId));
		}

		if (filters.tripId) {
			conditions.push(eq(expenses.tripId, filters.tripId));
		}

		if (filters.paidBy) {
			conditions.push(eq(expenses.paidBy, filters.paidBy));
		}

		if (filters.cursor) {
			// Cursor pagination with composite key (timestamp + id)
			const [cursorId, cursorTimestamp] = filters.cursor.split('_');
			const cursorDate = new Date(cursorTimestamp);

			// Use composite cursor: WHERE (createdAt < cursor) OR (createdAt = cursor AND id < cursorId)
			conditions.push(or(lt(expenses.createdAt, cursorDate), and(eq(expenses.createdAt, cursorDate), lt(expenses.id, cursorId))));
		}

		const results = await db
			.select()
			.from(expenses)
			.where(and(...conditions))
			.orderBy(desc(expenses.createdAt), desc(expenses.id))
			.limit(filters.limit || 20);

		// Generate next cursor if there are more results
		const nextCursor =
			results.length === (filters.limit || 20) && results.length > 0
				? `${results[results.length - 1].id}_${results[results.length - 1].createdAt.toISOString()}`
				: undefined;

		return { expenses: results as Expense[], nextCursor };
	});
}

/**
 * Update expense
 * EXTRACTED from handleEdit
 */
export async function updateExpense(db: Database, id: string, data: UpdateExpenseData): Promise<Expense> {
	// Input validation using shared constants
	if (data.description && data.description.length > EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH) {
		throw new Error(`Description too long (max ${EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH} characters)`);
	}
	if (data.category && data.category.length > EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH) {
		throw new Error(`Category too long (max ${EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH} characters)`);
	}
	if (data.note && data.note.length > EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH) {
		throw new Error(`Note too long (max ${EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH} characters)`);
	}
	if (data.currency && !data.currency.match(/^[A-Z]{3}$/)) {
		throw new Error('Invalid currency code (must be 3-letter ISO 4217)');
	}

	return withRetry(async () => {
		const updateData: any = {};

		if (data.amount) updateData.amount = data.amount.toDatabase();
		if (data.description !== undefined) updateData.description = data.description;
		if (data.category !== undefined) updateData.category = data.category;
		if (data.note !== undefined) updateData.notes = data.note;
		if (data.currency) updateData.currency = data.currency;

		const [updated] = await db.update(expenses).set(updateData).where(eq(expenses.id, id)).returning();

		if (!updated) {
			throw new Error('Expense not found');
		}

		return updated as Expense;
	});
}

/**
 * Soft delete expense
 * EXTRACTED from handleDelete
 */
export async function deleteExpense(db: Database, id: string): Promise<void> {
	await withRetry(async () => {
		const result = await db.update(expenses).set({ deleted: true }).where(eq(expenses.id, id)).returning();

		if (result.length === 0) {
			throw new Error('Expense not found');
		}
	});
}

/**
 * Get a single expense by ID
 */
export async function getExpenseById(db: Database, id: string): Promise<Expense | null> {
	return withRetry(async () => {
		const [expense] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.deleted, false))).limit(1);

		return (expense as Expense) || null;
	});
}

/**
 * Update expense amount and proportionally adjust splits
 * Uses transaction for atomicity - critical for Cloudflare Workers
 */
export async function updateExpenseAmount(db: Database, id: string, newAmount: Money): Promise<void> {
	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Get current expense
			const [expense] = await tx.select({ amount: expenses.amount, isPersonal: expenses.isPersonal }).from(expenses).where(and(eq(expenses.id, id), eq(expenses.deleted, false))).limit(1);

			if (!expense) {
				throw new Error('Expense not found');
			}

			const oldAmount = Money.fromDatabase(expense.amount);
			const ratio = newAmount.divide(oldAmount.toNumber());

			// Update expense amount
			await tx.update(expenses).set({ amount: newAmount.toDatabase() }).where(eq(expenses.id, id));

			// If not personal, update splits proportionally
			if (!expense.isPersonal) {
				const splits = await tx.select({ userId: expenseSplits.userId, amount: expenseSplits.amount }).from(expenseSplits).where(eq(expenseSplits.expenseId, id));

				// Update each split proportionally
				for (const split of splits) {
					const oldSplitAmount = Money.fromDatabase(split.amount);
					const newSplitAmount = oldSplitAmount.multiply(ratio.toNumber());

					await tx.update(expenseSplits).set({ amount: newSplitAmount.toDatabase() }).where(and(eq(expenseSplits.expenseId, id), eq(expenseSplits.userId, split.userId)));
				}
			}
		});
	});
}

/**
 * Update expense splits with new participant amounts
 * Uses transaction for atomicity - critical for Cloudflare Workers
 */
export async function updateExpenseSplits(
	db: Database,
	id: string,
	newSplits: Array<{ userId: string; amount: Money }>,
): Promise<void> {
	if (newSplits.length === 0) {
		throw new Error('At least one split required');
	}

	if (newSplits.length > EXPENSE_CONSTRAINTS.MAX_SPLITS) {
		throw new Error(`Too many splits (max ${EXPENSE_CONSTRAINTS.MAX_SPLITS})`);
	}

	return withRetry(async () => {
		return await db.transaction(async (tx) => {
			// Verify expense exists and is not personal
			const [expense] = await tx.select({ isPersonal: expenses.isPersonal }).from(expenses).where(and(eq(expenses.id, id), eq(expenses.deleted, false))).limit(1);

			if (!expense) {
				throw new Error('Expense not found');
			}

			if (expense.isPersonal) {
				throw new Error('Cannot update splits for personal expenses');
			}

			// Delete old splits
			await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, id));

			// Insert new splits
			await tx.insert(expenseSplits).values(
				newSplits.map((split) => ({
					expenseId: id,
					userId: split.userId,
					amount: split.amount.toDatabase(),
				})),
			);
		});
	});
}
