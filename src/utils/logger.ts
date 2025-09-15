/**
 * Simple logger for Cloudflare Workers
 */

interface LogContext {
	userId?: string;
	groupId?: string;
	[key: string]: unknown;
}

/**
 * Sanitize sensitive data from errors
 */
function sanitize(data: unknown): unknown {
	if (!data) return data;

	const str = JSON.stringify(data);
	const sanitized = str
		.replace(/("token":|"password":|"secret":|"key":)[^,}]*/gi, '$1"[REDACTED]"')
		.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');

	try {
		return JSON.parse(sanitized);
	} catch {
		return data;
	}
}

export const logger = {
	info: (msg: string, ctx?: LogContext) => {
		console.log(`[INFO] ${msg}`, ctx || '');
	},

	warn: (msg: string, ctx?: LogContext) => {
		console.warn(`[WARN] ${msg}`, ctx || '');
	},

	error: (msg: string, error?: unknown, ctx?: LogContext) => {
		const safeError = error ? sanitize(error) : undefined;
		console.error(`[ERROR] ${msg}`, safeError, ctx || '');
	},

	debug: () => {
		// Debug logs disabled in production
	},
};
