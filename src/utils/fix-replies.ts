// This file helps identify and fix direct ctx.reply calls
// Run this to see which files need updating

import { promises as fs } from 'fs';
import * as path from 'path';

async function findDirectReplies() {
	const commandsDir = path.join(__dirname, '../commands');
	const files = await fs.readdir(commandsDir);

	console.log('Files with direct ctx.reply() calls that need updating:\n');

	for (const file of files) {
		if (!file.endsWith('.ts')) continue;

		const filePath = path.join(commandsDir, file);
		const content = await fs.readFile(filePath, 'utf8');

		// Find ctx.reply calls that aren't in replyAndCleanup
		const lines = content.split('\n');
		const directReplies: number[] = [];

		lines.forEach((line, index) => {
			if (line.includes('ctx.reply(') && !line.includes('replyAndCleanup')) {
				directReplies.push(index + 1);
			}
		});

		if (directReplies.length > 0) {
			console.log(`${file}: Lines ${directReplies.join(', ')}`);
		}
	}

	console.log('\nTo fix these files:');
	console.log('1. Add: import { reply } from "../utils/reply";');
	console.log('2. Replace: ctx.reply(...) with reply(ctx, ...)');
}

findDirectReplies().catch(console.error);
