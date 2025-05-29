interface RateLimitSuccessResponse {
	message: string;
	time: string;
}

interface RateLimitErrorResponse {
	error: string;
}

type RateLimitResponse = RateLimitSuccessResponse | RateLimitErrorResponse;

interface RateLimitHeaders {
	'x-ratelimit-limit': string;
	'x-ratelimit-remaining': string;
	'x-ratelimit-reset': string;
}

const rateLimitMessages = {
	en: '⚠️ Rate limited! Please try again later',
	de: '⚠️ Anfragelimit erreicht! Bitte versuchen Sie es später erneut',
	fr: '⚠️ Limite de taux atteinte ! Veuillez réessayer plus tard',
	vi: '⚠️ Đã giới hạn tốc độ! Vui lòng thử lại sau',
	'zh-hans': '⚠️ 已限制访问频率！请稍后重试',
	'zh-hant': '⚠️ 已限制訪問頻率！請稍後重試',
	fil: '⚠️ Na-rate limit! Pakisubukan muli mamaya',
	nl: '⚠️ Snelheidslimiet bereikt! Probeer het later opnieuw',
	ar: '⚠️ تم تجاوز حد الطلبات! يرجى المحاولة مرة أخرى لاحقاً',
	es: '⚠️ ¡Límite alcanzado! Inténtelo de nuevo más tarde',
	hi: '⚠️ दर सीमित! कृपया बाद में पुनः प्रयास करें',
	ja: '⚠️ レート制限に達しました！後でもう一度お試しください',
	ko: '⚠️ 속도 제한! 나중에 다시 시도하세요',
	ru: '⚠️ Превышен лимит запросов! Повторите попытку позже',
	tr: '⚠️ Hız sınırı aşıldı! Lütfen daha sonra tekrar deneyin',
	th: '⚠️ ถูกจำกัดอัตรา! กรุณาลองใหม่ภายหลัง',
};

interface RateLimiterConfig {
	RATE_LIMITER_KEY: string;
	FEATURE_ENABLE_RATE_LIMITER: string;
	RATE_LIMITER_URL: string;
}

export class RateLimiter {
	private readonly baseUrl: string;
	private readonly config: RateLimiterConfig;

	private readonly enabled: boolean;

	constructor(config: RateLimiterConfig) {
		this.config = config;
		this.enabled = config.FEATURE_ENABLE_RATE_LIMITER?.toLowerCase() === 'true';
		this.baseUrl = config.RATE_LIMITER_URL;
		
	}

	async checkRateLimit(userId: number, languageCode: string = 'en'): Promise<{ allowed: boolean; message?: string }> {
		if (!this.enabled) {
			return { allowed: true };
		}

		try {
			const response = await fetch(`${this.baseUrl}/rate-limit`, {
				method: 'GET',
				headers: {
					'X-API-Key': this.config.RATE_LIMITER_KEY,
					'X-Rate-Limiter-Key': userId.toString(),
				},
			});

			// Handle non-200 responses
			if (!response.ok) {
				// If we get a 429 Too Many Requests, we should rate limit
				if (response.status === 429) {
					const message = this.getRateLimitMessage(languageCode);
					console.warn(`Rate limiter: User ${userId} was rate limited (Status: 429, Language: ${languageCode})`);
					return { allowed: false, message };
				}

				// Log other error responses but allow the request
				console.error('Rate limiter service error:', {
					status: response.status,
					statusText: response.statusText,
					userId
				});
				return { allowed: true };
			}

			// Parse response
			let data: unknown;
			try {
				data = await response.json();
			} catch (error) {
				console.error('Failed to parse rate limiter response:', error);
				return { allowed: true };
			}

			// Store rate limit headers if present
			this.processRateLimitHeaders(response.headers);

			// If we get here with a 200 status, rate limiting passed
			if (this.isSuccessResponse(data)) {
				return { allowed: true };
			}

			// If we have an error response, user is rate limited
			if (this.isErrorResponse(data)) {
				const message = this.getRateLimitMessage(languageCode);
				console.warn(`Rate limiter: User ${userId} was rate limited (Language: ${languageCode})`);
				return { allowed: false, message };
			}

			// Invalid response structure
			console.error('Invalid rate limit response structure:', data);
			return { allowed: true };
		} catch (error) {
			console.error('Rate limiter error:', error);
			return { allowed: true };
		}
	}

	private isSuccessResponse(data: unknown): data is RateLimitSuccessResponse {
		return (
			typeof data === 'object' &&
			data !== null &&
			'message' in data &&
			'time' in data &&
			typeof (data as RateLimitSuccessResponse).message === 'string' &&
			typeof (data as RateLimitSuccessResponse).time === 'string'
		);
	}

	private isErrorResponse(data: unknown): data is RateLimitErrorResponse {
		return (
			typeof data === 'object' &&
			data !== null &&
			'error' in data &&
			typeof (data as RateLimitErrorResponse).error === 'string'
		);
	}

	private processRateLimitHeaders(headers: Headers): void {
		const limit = headers.get('x-ratelimit-limit');
		const remaining = headers.get('x-ratelimit-remaining');
		const reset = headers.get('x-ratelimit-reset');

		if (limit && remaining && reset) {
			console.debug('Rate limit headers:', { limit, remaining, reset });
		}
	}

	private getRateLimitMessage(languageCode: string): string {
		// Handle Chinese variants specifically
		const normalizedCode = languageCode.toLowerCase();
		let lang = normalizedCode;

		if (!normalizedCode.startsWith('zh-')) {
			// For non-Chinese languages, just take the base language code
			lang = normalizedCode.split('-')[0];
		}

		return rateLimitMessages[lang as keyof typeof rateLimitMessages] || rateLimitMessages.en;
	}
}
