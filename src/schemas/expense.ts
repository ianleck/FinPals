/**
 * Shared validation schemas and constants for expenses
 * Single source of truth for business rules used by both API and service layer
 */

import { z } from 'zod';
import { DEFAULT_CURRENCY } from '../utils/currency-constants';

/**
 * Business rule constants
 * Extracted for reuse across API and service layers
 */
export const EXPENSE_CONSTRAINTS = {
	MAX_DESCRIPTION_LENGTH: 500,
	MAX_CATEGORY_LENGTH: 100,
	MAX_NOTE_LENGTH: 1000,
	MAX_SPLITS: 50,
	MAX_AMOUNT: 999999.99,
	MIN_AMOUNT: 0.01,
	CURRENCY_CODE_LENGTH: 3,
} as const;

/**
 * Zod schema for creating expenses
 * Used by API handlers for request validation
 */
export const CreateExpenseSchema = z.object({
	amount: z.number().positive().max(EXPENSE_CONSTRAINTS.MAX_AMOUNT),
	currency: z
		.string()
		.length(EXPENSE_CONSTRAINTS.CURRENCY_CODE_LENGTH)
		.regex(/^[A-Z]{3}$/)
		.default(DEFAULT_CURRENCY),
	description: z.string().min(1).max(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH).trim(),
	category: z.string().max(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH).optional(),
	note: z.string().max(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH).optional(),
	groupId: z.string().optional(),
	tripId: z.string().uuid().optional(),
	paidBy: z.string().optional(),
	splits: z
		.array(
			z.object({
				userId: z.string(),
				amount: z.number().positive().optional(),
			}),
		)
		.min(1)
		.max(EXPENSE_CONSTRAINTS.MAX_SPLITS),
});

/**
 * Zod schema for updating expenses
 * All fields optional except validation rules still apply
 */
export const UpdateExpenseSchema = z.object({
	amount: z.number().positive().max(EXPENSE_CONSTRAINTS.MAX_AMOUNT).optional(),
	currency: z
		.string()
		.length(EXPENSE_CONSTRAINTS.CURRENCY_CODE_LENGTH)
		.regex(/^[A-Z]{3}$/)
		.optional(),
	description: z.string().min(1).max(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH).trim().optional(),
	category: z.string().max(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH).optional(),
	note: z.string().max(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH).optional(),
});

/**
 * TypeScript types derived from schemas
 */
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>;
