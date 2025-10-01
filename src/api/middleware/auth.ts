/**
 * Authentication Middleware - Telegram Mini App auth validation
 * Validates Telegram initData using HMAC-SHA256 as per Telegram docs
 */

import { Env } from '../../index';

export type AuthContext = {
	userId: string;
	username?: string;
	firstName?: string;
};

/**
 * Validate Telegram Mini App authorization
 * Uses HMAC-SHA256 validation as per Telegram Bot API documentation
 */
export async function validateTelegramAuth(request: Request, env: Env): Promise<AuthContext> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader?.startsWith('tma ')) {
		throw new Error('UNAUTHORIZED: Missing Telegram auth');
	}

	const initData = authHeader.substring(4);
	const isValid = await validateTelegramInitData(initData, env.BOT_TOKEN);

	if (!isValid) {
		throw new Error('UNAUTHORIZED: Invalid signature');
	}

	const user = parseInitDataUser(initData);

	return {
		userId: user.id.toString(),
		username: user.username,
		firstName: user.first_name,
	};
}

/**
 * Validate Telegram initData signature
 * Follows Telegram's HMAC-SHA256 validation algorithm
 */
async function validateTelegramInitData(initData: string, botToken: string): Promise<boolean> {
	const params = new URLSearchParams(initData);
	const hash = params.get('hash');
	if (!hash) return false;

	params.delete('hash');

	// Check auth_date < 1 hour
	const authDate = parseInt(params.get('auth_date') || '0');
	if (Date.now() / 1000 - authDate > 3600) return false;

	// HMAC validation (per Telegram docs)
	const dataCheckString = Array.from(params.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');

	const secretKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);

	const secret = await crypto.subtle.sign('HMAC', secretKey, new TextEncoder().encode(botToken));

	const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheckString));

	const hexSignature = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return hexSignature === hash;
}

/**
 * Parse user data from initData
 */
function parseInitDataUser(initData: string): any {
	const params = new URLSearchParams(initData);
	const userJson = params.get('user');
	if (!userJson) throw new Error('No user in initData');
	return JSON.parse(userJson);
}

/**
 * Rate limiting middleware using KV
 * Limits to 60 requests per minute per user
 */
export async function checkRateLimit(env: Env, userId: string): Promise<boolean> {
	const key = `rate:${userId}:${Math.floor(Date.now() / 60000)}`;
	const count = await env.KV.get(key);

	if (count && parseInt(count) >= 60) {
		return false; // Rate limit exceeded
	}

	// Increment counter
	const newCount = count ? parseInt(count) + 1 : 1;
	await env.KV.put(key, newCount.toString(), { expirationTtl: 60 });

	return true;
}
