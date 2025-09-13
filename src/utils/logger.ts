/**
 * Structured logging utility for FinPals
 * Provides consistent logging format across the application
 */

export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR',
}

interface LogContext {
	userId?: string;
	groupId?: string;
	command?: string;
	error?: Error;
	[key: string]: any;
}

class Logger {
	private serviceName = 'finpals-telegram';
	private logLevel: LogLevel;

	constructor() {
		// In production, we might want to reduce this to INFO or WARN
		this.logLevel = process.env.LOG_LEVEL as LogLevel || LogLevel.INFO;
	}

	private shouldLog(level: LogLevel): boolean {
		const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
		const currentLevelIndex = levels.indexOf(this.logLevel);
		const messageLevelIndex = levels.indexOf(level);
		return messageLevelIndex >= currentLevelIndex;
	}

	private formatLog(level: LogLevel, message: string, context?: LogContext): string {
		const timestamp = new Date().toISOString();
		const logEntry = {
			timestamp,
			level,
			service: this.serviceName,
			message,
			...context,
		};

		// If there's an error, serialize it properly
		if (context?.error) {
			logEntry.error = {
				name: context.error.name,
				message: context.error.message,
				stack: context.error.stack,
			};
		}

		return JSON.stringify(logEntry);
	}

	debug(message: string, context?: LogContext): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.log(this.formatLog(LogLevel.DEBUG, message, context));
		}
	}

	info(message: string, context?: LogContext): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.log(this.formatLog(LogLevel.INFO, message, context));
		}
	}

	warn(message: string, context?: LogContext): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.formatLog(LogLevel.WARN, message, context));
		}
	}

	error(message: string, context?: LogContext): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.formatLog(LogLevel.ERROR, message, context));
		}
	}

	// Helper method for logging database operations
	dbOperation(operation: string, table: string, context?: LogContext): void {
		this.debug(`Database operation: ${operation} on ${table}`, {
			...context,
			dbOperation: operation,
			dbTable: table,
		});
	}

	// Helper method for logging API calls
	apiCall(method: string, endpoint: string, context?: LogContext): void {
		this.debug(`API call: ${method} ${endpoint}`, {
			...context,
			apiMethod: method,
			apiEndpoint: endpoint,
		});
	}

	// Helper method for logging command execution
	command(commandName: string, userId: string, groupId?: string, context?: LogContext): void {
		this.info(`Command executed: ${commandName}`, {
			...context,
			command: commandName,
			userId,
			groupId,
		});
	}

	// Helper method for logging performance metrics
	performance(operation: string, duration: number, context?: LogContext): void {
		this.info(`Performance: ${operation} took ${duration}ms`, {
			...context,
			performance: {
				operation,
				duration,
			},
		});
	}
}

// Export singleton instance
export const logger = new Logger();

// Export for use in environments where we need to measure performance
export function measurePerformance<T>(
	operation: string,
	fn: () => T | Promise<T>,
	context?: LogContext
): T | Promise<T> {
	const startTime = Date.now();
	
	try {
		const result = fn();
		
		// Handle both sync and async functions
		if (result instanceof Promise) {
			return result.finally(() => {
				const duration = Date.now() - startTime;
				logger.performance(operation, duration, context);
			});
		} else {
			const duration = Date.now() - startTime;
			logger.performance(operation, duration, context);
			return result;
		}
	} catch (error) {
		const duration = Date.now() - startTime;
		logger.error(`Operation failed: ${operation}`, {
			...context,
			error: error as Error,
			duration,
		});
		throw error;
	}
}