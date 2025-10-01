/**
 * API Router - Main routing logic for REST API
 * All routes require Telegram authentication
 */

import { Env } from '../index';
import { validateTelegramAuth, checkRateLimit } from './middleware/auth';
import * as expenseHandlers from './handlers/expenses';
import * as balanceHandlers from './handlers/balances';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Group-ID',
	'Access-Control-Max-Age': '86400',
};

/**
 * Main API handler
 */
export async function handleAPI(request: Request, env: Env): Promise<Response> {
	// Handle CORS preflight
	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}

	const url = new URL(request.url);
	const path = url.pathname.replace('/api/v1', '');

	try {
		// Validate auth (all routes require authentication)
		const auth = await validateTelegramAuth(request, env);

		// Check rate limiting
		const rateLimitOk = await checkRateLimit(env, auth.userId);
		if (!rateLimitOk) {
			return errorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.', 429);
		}

		// Route to handlers (functions, not classes)
		if (path.startsWith('/expenses')) {
			const response = await expenseHandlers.route(request, env, auth);
			return addCorsHeaders(response);
		}

		if (path === '/balances') {
			const response = await balanceHandlers.getBalances(request, env, auth);
			return addCorsHeaders(response);
		}

		if (path === '/balances/simplified') {
			const response = await balanceHandlers.getSimplifiedDebts(request, env, auth);
			return addCorsHeaders(response);
		}

		// Health check endpoint (no auth required, but we already validated above)
		if (path === '/health') {
			return new Response(
				JSON.stringify({
					ok: true,
					data: { status: 'healthy', timestamp: new Date().toISOString() },
				}),
				{
					status: 200,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				},
			);
		}

		return errorResponse('NOT_FOUND', 'Endpoint not found', 404);
	} catch (error) {
		return handleApiError(error);
	}
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response): Response {
	const newHeaders = new Headers(response.headers);
	Object.entries(corsHeaders).forEach(([key, value]) => {
		newHeaders.set(key, value);
	});

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}

/**
 * Error response helper
 */
function errorResponse(code: string, message: string, status: number): Response {
	return new Response(
		JSON.stringify({
			ok: false,
			error: { code, message },
		}),
		{
			status,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		},
	);
}

/**
 * Global error handler
 */
function handleApiError(error: unknown): Response {
	const message = error instanceof Error ? error.message : 'Unknown error';

	// Auth errors
	if (message.includes('UNAUTHORIZED')) {
		return errorResponse('UNAUTHORIZED', 'Invalid or missing authentication', 401);
	}

	// Validation errors
	if (message.includes('Invalid') || message.includes('required') || message.includes('too long')) {
		return errorResponse('VALIDATION_ERROR', message, 400);
	}

	// Not found
	if (message.includes('not found')) {
		return errorResponse('NOT_FOUND', message, 404);
	}

	// Forbidden
	if (message.includes('not a member') || message.includes('FORBIDDEN')) {
		return errorResponse('FORBIDDEN', 'You do not have permission to perform this action', 403);
	}

	// Generic server error
	console.error('API Error:', error);
	return errorResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
