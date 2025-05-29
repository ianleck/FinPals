import { Bot, Context, SessionFlavor, session } from 'grammy';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

// Data persisted per-user via Durable Objects
export interface SessionData {
	/** User's preferred currency */
	preferredCurrency?: string;
	/** User's timezone */
	timezone?: string;
	/** Current active group context */
	activeGroupId?: string;
	/** Temporary data for multi-step commands */
	pendingCommand?: {
		type: string;
		data: any;
		expires: number;
	};
}

interface Env {
	/** Durable Object namespace bound to the "SessionDO" durable-object in wrangler.toml */
	SESSIONS: DurableObjectNamespace;
}

// Accept any grammY context that includes SessionFlavor<SessionData>
export function setupSession<C extends Context & SessionFlavor<SessionData>>(bot: Bot<C>, env: Env) {
	bot.use(
		session({
			initial: () => {
				return {};
			},
			// Use one session per Telegram user everywhere (DMs or groups)
			getSessionKey: (ctx) => {
				const id = ctx.from?.id;
				const key = id !== undefined ? id.toString() : undefined;
				return key;
			},
			storage: {
				/** Read the session from the user-scoped Durable Object */
				read: async (key) => {
					try {
						const obj = env.SESSIONS.get(env.SESSIONS.idFromName(key));
						const res = await obj.fetch('https://do/read');
						if (res.status === 404) {
							// Force creating a new session with initial values
							return {};
						}
						const data = await res.json<SessionData>();
						return data;
					} catch (error) {
						console.error(`Error reading session: ${error}`);
						// Return initial session on error to prevent undefined sessions
						return {};
					}
				},
				/** Persist the session into the DO */
				write: async (key, value) => {
					try {
						const obj = env.SESSIONS.get(env.SESSIONS.idFromName(key));
						await obj.fetch('https://do/write', {
							method: 'POST',
							body: JSON.stringify(value),
						});
					} catch (error) {
						console.error(`Error writing session: ${error}`);
					}
				},
				/** Delete the session inside the DO */
				delete: async (key) => {
					try {
						const obj = env.SESSIONS.get(env.SESSIONS.idFromName(key));
						await obj.fetch('https://do/delete', { method: 'POST' });
					} catch (error) {
						console.error(`Error deleting session: ${error}`);
					}
				},
			},
		})
	);
}