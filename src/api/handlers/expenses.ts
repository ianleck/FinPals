/**
 * Expense API Handlers - RESTful endpoints for expense management
 * Uses service functions (same ones used by bot commands)
 */

import { Env } from '../../index';
import { AuthContext } from '../middleware/auth';
import { createDb } from '../../db';
import * as expenseService from '../../services/expense';
import { Money } from '../../utils/money';
import { DEFAULT_CURRENCY } from '../../utils/currency-constants';
import { CreateExpenseSchema, UpdateExpenseSchema, type CreateExpenseInput, type UpdateExpenseInput } from '../../schemas/expense';

/**
 * Route expense requests to appropriate handlers
 */
export async function route(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace('/api/v1/expenses', '');

	if (request.method === 'POST' && path === '') {
		return createExpenseHandler(request, env, auth);
	}

	if (request.method === 'GET' && path === '') {
		return getExpensesHandler(request, env, auth);
	}

	if (request.method === 'GET' && path.match(/^\/[a-f0-9-]+$/)) {
		return getExpenseHandler(request, env, auth, path.substring(1));
	}

	if (request.method === 'PATCH' && path.match(/^\/[a-f0-9-]+$/)) {
		return updateExpenseHandler(request, env, auth, path.substring(1));
	}

	if (request.method === 'DELETE' && path.match(/^\/[a-f0-9-]+$/)) {
		return deleteExpenseHandler(request, env, auth, path.substring(1));
	}

	return errorResponse('NOT_FOUND', 'Endpoint not found', 404);
}

/**
 * POST /api/v1/expenses - Create expense
 */
async function createExpenseHandler(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	try {
		// Check idempotency
		const idempotencyKey = request.headers.get('Idempotency-Key');
		if (!idempotencyKey) {
			return errorResponse('VALIDATION_ERROR', 'Idempotency-Key header required', 400);
		}

		const cacheKey = `idempotency:${auth.userId}:${idempotencyKey}`;
		const cached = await env.KV.get(cacheKey);
		if (cached) {
			return new Response(cached, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Validate input using Zod schema
		const body = await request.json();
		const validated = CreateExpenseSchema.parse(body);

		// Get group context
		const groupId = validated.groupId || request.headers.get('X-Group-ID') || undefined;

		// Call service function (same function bot uses)
		const db = createDb(env);
		const expense = await expenseService.createExpense(db, {
			amount: new Money(validated.amount),
			currency: validated.currency || DEFAULT_CURRENCY,
			description: validated.description,
			category: validated.category,
			groupId,
			tripId: validated.tripId,
			paidBy: validated.paidBy || auth.userId,
			splits: validated.splits.map((s) => ({
				userId: s.userId,
				amount: s.amount ? new Money(s.amount) : undefined,
			})),
			note: validated.note,
			createdBy: auth.userId,
		});

		// Cache response
		const response = JSON.stringify(successResponse(expense));
		await env.KV.put(cacheKey, response, { expirationTtl: 300 });

		return new Response(response, {
			status: 201,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * GET /api/v1/expenses - List expenses with pagination
 */
async function getExpensesHandler(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	try {
		const url = new URL(request.url);
		const groupId = url.searchParams.get('groupId') || undefined;
		const tripId = url.searchParams.get('tripId') || undefined;
		const cursor = url.searchParams.get('cursor') || undefined;
		const limit = parseInt(url.searchParams.get('limit') || '20');

		if (limit > 100) {
			return errorResponse('VALIDATION_ERROR', 'Limit cannot exceed 100', 400);
		}

		const db = createDb(env);
		const result = await expenseService.getExpenses(db, {
			groupId,
			tripId,
			limit,
			cursor,
		});

		return new Response(JSON.stringify(successResponse(result)), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * GET /api/v1/expenses/:id - Get single expense
 */
async function getExpenseHandler(request: Request, env: Env, auth: AuthContext, id: string): Promise<Response> {
	try {
		const db = createDb(env);
		const expense = await expenseService.getExpenseById(db, id);

		if (!expense) {
			return errorResponse('NOT_FOUND', 'Expense not found', 404);
		}

		return new Response(JSON.stringify(successResponse(expense)), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * PATCH /api/v1/expenses/:id - Update expense
 */
async function updateExpenseHandler(request: Request, env: Env, auth: AuthContext, id: string): Promise<Response> {
	try {
		const body = await request.json();
		const validated = UpdateExpenseSchema.parse(body);

		const db = createDb(env);

		// Build update data
		const updateData: expenseService.UpdateExpenseData = {};
		if (validated.amount !== undefined) updateData.amount = new Money(validated.amount);
		if (validated.description !== undefined) updateData.description = validated.description;
		if (validated.category !== undefined) updateData.category = validated.category;
		if (validated.note !== undefined) updateData.note = validated.note;
		if (validated.currency !== undefined) updateData.currency = validated.currency;

		const expense = await expenseService.updateExpense(db, id, updateData);

		return new Response(JSON.stringify(successResponse(expense)), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * DELETE /api/v1/expenses/:id - Soft delete expense
 */
async function deleteExpenseHandler(request: Request, env: Env, auth: AuthContext, id: string): Promise<Response> {
	try {
		const db = createDb(env);
		await expenseService.deleteExpense(db, id);

		return new Response(JSON.stringify(successResponse({ deleted: true })), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * Helper functions
 */
function successResponse(data: any) {
	return { ok: true, data };
}

function errorResponse(code: string, message: string, status: number) {
	return new Response(
		JSON.stringify({
			ok: false,
			error: { code, message },
		}),
		{
			status,
			headers: { 'Content-Type': 'application/json' },
		},
	);
}

function handleApiError(error: unknown): Response {
	const message = error instanceof Error ? error.message : 'Unknown error';

	// Check for validation errors
	if (message.includes('too long') || message.includes('Invalid') || message.includes('required')) {
		return errorResponse('VALIDATION_ERROR', message, 400);
	}

	// Check for not found errors
	if (message.includes('not found')) {
		return errorResponse('NOT_FOUND', message, 404);
	}

	// Check for auth errors
	if (message.includes('not a member') || message.includes('UNAUTHORIZED')) {
		return errorResponse('FORBIDDEN', message, 403);
	}

	// Generic server error
	return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
