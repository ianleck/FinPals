/**
 * Balance API Handlers - Endpoints for balance calculations
 * Uses service functions with multi-currency support
 */

import { Env } from '../../index';
import { AuthContext } from '../middleware/auth';
import { createDb } from '../../db';
import * as balanceService from '../../services/balance';

/**
 * GET /api/v1/balances - Get balances for a group or user
 */
export async function getBalances(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	try {
		const url = new URL(request.url);
		const groupId = url.searchParams.get('groupId');
		const tripId = url.searchParams.get('tripId') || undefined;
		const personal = url.searchParams.get('personal') === 'true';

		const db = createDb(env);
		let balances;

		if (personal || !groupId) {
			// Personal balances for authenticated user
			balances = await balanceService.calculatePersonalBalances(db, auth.userId);
		} else {
			// Group balances with multi-currency support
			balances = await balanceService.calculateBalances(db, groupId, tripId);
		}

		return new Response(
			JSON.stringify({
				ok: true,
				data: { balances },
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * GET /api/v1/balances/simplified - Get simplified debt settlements
 */
export async function getSimplifiedDebts(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	try {
		const url = new URL(request.url);
		const groupId = url.searchParams.get('groupId');
		const tripId = url.searchParams.get('tripId') || undefined;

		if (!groupId) {
			return errorResponse('VALIDATION_ERROR', 'groupId is required', 400);
		}

		const db = createDb(env);
		const debts = await balanceService.getSimplifiedDebts(db, groupId, tripId);

		return new Response(
			JSON.stringify({
				ok: true,
				data: { debts },
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * Helper functions
 */
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
	if (message.includes('required') || message.includes('Invalid')) {
		return errorResponse('VALIDATION_ERROR', message, 400);
	}

	// Check for not found errors
	if (message.includes('not found')) {
		return errorResponse('NOT_FOUND', message, 404);
	}

	// Generic server error
	return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
