/**
 * Balance Service - Pure functions for balance calculations
 * Extracted from command handlers with CRITICAL multi-currency fix
 */

import { Database, withRetry } from '../db';
import { simplifyDebts } from '../utils/debt-simplification';
import { Money } from '../utils/money';
import { expenses, expenseSplits, settlements } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { DEFAULT_CURRENCY } from '../utils/currency-constants';

export type UserBalance = {
	userId: string;
	currency: string;
	balance: number;
};

/**
 * Calculate balances for a group (with multi-currency support)
 * EXTRACTED from handleBalance (src/commands/balance.ts lines 67-140)
 * ENHANCED to handle multiple currencies separately
 *
 * CRITICAL FIX: Previous implementation combined all currencies into single balance
 * New implementation: Each user can owe in multiple currencies separately
 * Example: User can owe $50 USD AND €30 EUR simultaneously
 */
export async function calculateBalances(
	db: Database,
	groupId: string,
	tripId?: string,
): Promise<UserBalance[]> {
	return withRetry(async () => {
		// Get all expenses WITH currency
		const groupExpenses = await db
			.select({
				id: expenses.id,
				amount: expenses.amount,
				currency: expenses.currency,
				paidBy: expenses.paidBy,
			})
			.from(expenses)
			.where(
				and(eq(expenses.groupId, groupId), eq(expenses.deleted, false), tripId ? eq(expenses.tripId, tripId) : isNull(expenses.tripId)),
			);

		// Get splits
		const splits = await db
			.select({
				expenseId: expenseSplits.expenseId,
				userId: expenseSplits.userId,
				amount: expenseSplits.amount,
			})
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(
				and(eq(expenses.groupId, groupId), eq(expenses.deleted, false), tripId ? eq(expenses.tripId, tripId) : isNull(expenses.tripId)),
			);

		// Get all settlements
		const groupSettlements = await db
			.select({
				fromUser: settlements.fromUser,
				toUser: settlements.toUser,
				amount: settlements.amount,
				currency: settlements.currency,
			})
			.from(settlements)
			.where(and(eq(settlements.groupId, groupId), tripId ? eq(settlements.tripId, tripId) : isNull(settlements.tripId)));

		// Calculate net balances grouped by userId AND currency
		// Map structure: userId -> currency -> Money
		const balanceMap = new Map<string, Map<string, Money>>();

		// Add amounts paid by users
		for (const expense of groupExpenses) {
			const currency = expense.currency || DEFAULT_CURRENCY;
			if (!balanceMap.has(expense.paidBy)) {
				balanceMap.set(expense.paidBy, new Map());
			}
			const userCurrencies = balanceMap.get(expense.paidBy)!;
			const current = userCurrencies.get(currency) || new Money(0);
			userCurrencies.set(currency, current.add(Money.fromDatabase(expense.amount)));
		}

		// Build expense->currency lookup for splits
		const expenseCurrency = new Map<string, string>();
		for (const expense of groupExpenses) {
			expenseCurrency.set(expense.id, expense.currency || DEFAULT_CURRENCY);
		}

		// Subtract amounts owed by users
		for (const split of splits) {
			const currency = expenseCurrency.get(split.expenseId) || DEFAULT_CURRENCY;
			if (!balanceMap.has(split.userId)) {
				balanceMap.set(split.userId, new Map());
			}
			const userCurrencies = balanceMap.get(split.userId)!;
			const current = userCurrencies.get(currency) || new Money(0);
			userCurrencies.set(currency, current.subtract(Money.fromDatabase(split.amount)));
		}

		// Apply settlements
		for (const settlement of groupSettlements) {
			const currency = settlement.currency || DEFAULT_CURRENCY;
			const amount = Money.fromDatabase(settlement.amount);

			// From user: subtract (they paid)
			if (!balanceMap.has(settlement.fromUser)) {
				balanceMap.set(settlement.fromUser, new Map());
			}
			const fromCurrencies = balanceMap.get(settlement.fromUser)!;
			const fromBalance = fromCurrencies.get(currency) || new Money(0);
			fromCurrencies.set(currency, fromBalance.subtract(amount));

			// To user: add (they received)
			if (!balanceMap.has(settlement.toUser)) {
				balanceMap.set(settlement.toUser, new Map());
			}
			const toCurrencies = balanceMap.get(settlement.toUser)!;
			const toBalance = toCurrencies.get(currency) || new Money(0);
			toCurrencies.set(currency, toBalance.add(amount));
		}

		// Flatten to array with separate entries per currency
		const result: UserBalance[] = [];
		for (const [userId, currencies] of balanceMap.entries()) {
			for (const [currency, balance] of currencies.entries()) {
				// Only include non-zero balances (within 1 cent tolerance)
				if (Math.abs(balance.toNumber()) >= 0.01) {
					result.push({
						userId,
						currency,
						balance: balance.toNumber(),
					});
				}
			}
		}

		return result;
	});
}

/**
 * Get simplified debts
 * REUSES existing utility (no extraction needed)
 */
export async function getSimplifiedDebts(db: Database, groupId: string, tripId?: string) {
	return simplifyDebts(db, groupId, tripId);
}

/**
 * Calculate balances for personal expenses (single user)
 */
export async function calculatePersonalBalances(db: Database, userId: string): Promise<UserBalance[]> {
	return withRetry(async () => {
		// Get all personal expenses
		const personalExpenses = await db
			.select({
				id: expenses.id,
				amount: expenses.amount,
				currency: expenses.currency,
			})
			.from(expenses)
			.where(and(eq(expenses.paidBy, userId), eq(expenses.isPersonal, true), eq(expenses.deleted, false)));

		// Calculate total by currency
		const currencyTotals = new Map<string, Money>();

		for (const expense of personalExpenses) {
			const currency = expense.currency || DEFAULT_CURRENCY;
			const current = currencyTotals.get(currency) || new Money(0);
			currencyTotals.set(currency, current.add(Money.fromDatabase(expense.amount)));
		}

		// Convert to result array
		const result: UserBalance[] = [];
		for (const [currency, total] of currencyTotals.entries()) {
			if (total.toNumber() >= 0.01) {
				result.push({
					userId,
					currency,
					balance: total.toNumber(),
				});
			}
		}

		return result;
	});
}
