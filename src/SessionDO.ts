import { SessionData } from './utils/session';
import type { DurableObjectState } from '@cloudflare/workers-types';

export class SessionDO {
	private state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		switch (pathname) {
			case '/read':
				return this.handleRead();
			case '/write':
				return this.handleWrite(request);
			case '/delete':
				return this.handleDelete();
			default:
				return new Response('Not found', { status: 404 });
		}
	}

	private async handleRead(): Promise<Response> {
		const data = (await this.state.storage.get<SessionData>('data')) || {};
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}

	private async handleWrite(request: Request): Promise<Response> {
		try {
			const body = (await request.json()) as SessionData;
			await this.state.storage.put('data', body);
			return new Response('OK', { status: 200 });
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}
	}

	private async handleDelete(): Promise<Response> {
		await this.state.storage.delete('data');
		return new Response('OK', { status: 200 });
	}
}
