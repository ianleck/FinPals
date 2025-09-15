/**
 * Extracts notes from command text
 * Notes should be in quotes: "This is a note" or 'This is a note'
 */
export function extractNote(text: string): { cleanedText: string; note: string | null } {
	// Match quoted strings (both single and double quotes)
	const match = text.match(/["']([^"']+)["']/);

	if (!match) {
		return { cleanedText: text, note: null };
	}

	const note = match[1];
	const cleanedText = text.replace(match[0], '').replace(/\s+/g, ' ').trim();

	return { cleanedText, note };
}
