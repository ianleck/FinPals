/**
 * Input validation utilities for FinPals
 */

export const LIMITS = {
	MAX_AMOUNT: 999999.99,
	MIN_AMOUNT: 0.01,
	MAX_DESCRIPTION_LENGTH: 200,
	MAX_CATEGORY_LENGTH: 50,
	MAX_GROUP_NAME_LENGTH: 100,
	MAX_USERNAME_LENGTH: 32,
} as const;

/**
 * Validate monetary amount
 */
export function validateAmount(amount: number): { valid: boolean; error?: string } {
	if (isNaN(amount)) {
		return { valid: false, error: 'Amount must be a number' };
	}
	
	if (amount <= 0) {
		return { valid: false, error: 'Amount must be greater than 0' };
	}
	
	if (amount < LIMITS.MIN_AMOUNT) {
		return { valid: false, error: `Amount must be at least $${LIMITS.MIN_AMOUNT}` };
	}
	
	if (amount > LIMITS.MAX_AMOUNT) {
		return { valid: false, error: `Amount cannot exceed $${LIMITS.MAX_AMOUNT.toLocaleString()}` };
	}
	
	// Check for excessive decimal places
	const decimalPlaces = (amount.toString().split('.')[1] || '').length;
	if (decimalPlaces > 2) {
		return { valid: false, error: 'Amount can only have up to 2 decimal places' };
	}
	
	return { valid: true };
}

/**
 * Validate and sanitize description
 */
export function validateDescription(description: string): { valid: boolean; sanitized: string; error?: string } {
	// Remove excessive whitespace
	const sanitized = description.trim().replace(/\s+/g, ' ');
	
	if (!sanitized) {
		return { valid: false, sanitized: '', error: 'Description cannot be empty' };
	}
	
	if (sanitized.length > LIMITS.MAX_DESCRIPTION_LENGTH) {
		return { 
			valid: false, 
			sanitized: sanitized.substring(0, LIMITS.MAX_DESCRIPTION_LENGTH), 
			error: `Description cannot exceed ${LIMITS.MAX_DESCRIPTION_LENGTH} characters` 
		};
	}
	
	// Remove potential HTML/script tags for security
	const cleaned = sanitized
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#x27;');
	
	return { valid: true, sanitized: cleaned };
}

/**
 * Validate category name
 */
export function validateCategory(category: string): { valid: boolean; sanitized: string; error?: string } {
	const sanitized = category.trim();
	
	if (!sanitized) {
		return { valid: false, sanitized: '', error: 'Category cannot be empty' };
	}
	
	if (sanitized.length > LIMITS.MAX_CATEGORY_LENGTH) {
		return { 
			valid: false, 
			sanitized: sanitized.substring(0, LIMITS.MAX_CATEGORY_LENGTH), 
			error: `Category cannot exceed ${LIMITS.MAX_CATEGORY_LENGTH} characters` 
		};
	}
	
	return { valid: true, sanitized };
}

/**
 * Validate budget period
 */
export function validatePeriod(period: string): period is 'daily' | 'weekly' | 'monthly' {
	return ['daily', 'weekly', 'monthly'].includes(period.toLowerCase());
}

/**
 * Validate username format
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
	if (!username) {
		return { valid: false, error: 'Username cannot be empty' };
	}
	
	if (username.length > LIMITS.MAX_USERNAME_LENGTH) {
		return { valid: false, error: 'Username is too long' };
	}
	
	// Telegram username rules: alphanumeric and underscores, min 5 chars
	if (!/^[a-zA-Z0-9_]{5,}$/.test(username)) {
		return { valid: false, error: 'Invalid username format' };
	}
	
	return { valid: true };
}

/**
 * Parse and validate custom split format (@username=amount)
 */
export function parseCustomSplit(text: string): { username: string; amount: number } | null {
	const match = text.match(/^@([a-zA-Z0-9_]+)=(\d+(?:\.\d{1,2})?)$/);
	if (!match) return null;
	
	const [, username, amountStr] = match;
	const amount = parseFloat(amountStr);
	
	const amountValidation = validateAmount(amount);
	if (!amountValidation.valid) return null;
	
	return { username, amount };
}