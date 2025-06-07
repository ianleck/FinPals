import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { handleAddEnhanced } from '../commands/add-enhanced';

interface TranscriptionResult {
    text: string;
    confidence?: number;
}

export async function transcribeVoiceMessage(
    voiceFileUrl: string,
    env: any
): Promise<TranscriptionResult> {
    try {
        console.log('Downloading voice file from:', voiceFileUrl);
        // Download voice file
        const response = await fetch(voiceFileUrl);
        if (!response.ok) {
            throw new Error(`Failed to download voice file: ${response.status} ${response.statusText}`);
        }
        
        const audioBuffer = await response.arrayBuffer();
        console.log('Audio buffer size:', audioBuffer.byteLength);
        
        // Check if AI binding exists
        if (!env.AI) {
            throw new Error('AI binding not configured. Please add [ai] binding = "AI" to wrangler.toml');
        }
        
        // Convert audio buffer to format expected by Whisper
        // Whisper expects audio data as an array of numbers
        const audioData = [...new Uint8Array(audioBuffer)];
        console.log('Audio data length:', audioData.length);
        
        // Call Whisper API - ensure we're using the correct model
        console.log('Calling Whisper API...');
        const result = await env.AI.run('@cf/openai/whisper', {
            audio: audioData,
        });
        console.log('Whisper API result:', result);
        
        return {
            text: result.text || '',
            confidence: result.confidence
        };
    } catch (error) {
        console.error('Error transcribing voice:', error);
        throw error;
    }
}

export async function handleVoiceMessage(ctx: Context, db: D1Database, env: any) {
    console.log('Voice message handler called');
    const voice = ctx.message?.voice;
    if (!voice) {
        console.log('No voice object in message');
        await ctx.reply('❌ No voice message found.');
        return;
    }
    
    console.log('Voice message details:', {
        duration: voice.duration,
        file_id: voice.file_id.substring(0, 20),
        file_size: voice.file_size,
        mime_type: voice.mime_type
    });
    
    // First, let's verify we can receive voice messages
    await ctx.reply(`🎤 Voice message received!\nDuration: ${voice.duration}s\nFile ID: ${voice.file_id.substring(0, 10)}...`);
    
    try {
        console.log('Getting file info for voice:', voice.file_id);
        // Get file info from Telegram
        const file = await ctx.api.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        console.log('File URL:', fileUrl);
        
        // Send processing message
        const processingMsg = await ctx.reply('🎤 Processing voice message...');
        
        // Check if AI is available
        if (!env.AI) {
            await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
            await ctx.reply(
                '⚠️ Voice transcription is not available.\n\n' +
                'Please type your expense instead:\n' +
                '`/add [amount] [description]`',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Transcribe the voice message
        console.log('Starting transcription...');
        const transcription = await transcribeVoiceMessage(fileUrl, env);
        console.log('Transcription result:', transcription);
        
        // Delete processing message
        await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
        
        if (!transcription.text) {
            await ctx.reply('❌ Could not transcribe voice message. Please try typing the expense instead.');
            return;
        }
        
        // Parse the transcription for expense details
        const expenseData = parseExpenseFromText(transcription.text);
        
        if (!expenseData.amount) {
            await ctx.reply(
                `🎤 <b>Transcription:</b> "${transcription.text}"\n\n` +
                `❌ Could not extract expense amount. Please use format like:\n` +
                `"Add 50 dollars for lunch" or "Twenty dollars for coffee"`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        // Show transcription result
        await ctx.reply(
            `🎤 <b>Voice Transcription:</b>\n"${transcription.text}"\n\n` +
            `💵 <b>Detected:</b> $${expenseData.amount.toFixed(2)} for ${expenseData.description}`,
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Confirm', callback_data: `voice_confirm:${expenseData.amount}:${expenseData.description}` },
                        { text: '❌ Cancel', callback_data: 'voice_cancel' }
                    ]]
                }
            }
        );
        
    } catch (error: any) {
        console.error('Error handling voice message:', error);
        
        let errorMessage = '❌ Failed to process voice message.';
        
        if (error.message?.includes('AI binding not configured')) {
            errorMessage += '\n\n⚠️ Voice transcription is not configured. Please ensure AI binding is set up in your Cloudflare Worker.';
        } else if (error.message?.includes('Failed to download')) {
            errorMessage += '\n\n⚠️ Could not download the voice file. Please try again.';
        } else {
            errorMessage += '\n\n💡 Please try typing the expense instead: /add [amount] [description]';
        }
        
        await ctx.reply(errorMessage);
    }
}

function parseExpenseFromText(text: string): { amount?: number; description?: string } {
    const normalizedText = text.toLowerCase();
    
    // Try to find amount patterns
    let amount: number | undefined;
    let description = 'Expense';
    
    // Pattern 1: "X dollars/bucks" or "$X"
    const dollarMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|bucks|\$)|(?:\$|dollar sign)\s*(\d+(?:\.\d+)?)/);
    if (dollarMatch) {
        amount = parseFloat(dollarMatch[1] || dollarMatch[2]);
    }
    
    // Pattern 2: Written numbers
    if (!amount) {
        const writtenNumbers: { [key: string]: number } = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
            'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
            'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
            'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
            'eighty': 80, 'ninety': 90, 'hundred': 100
        };
        
        for (const [word, value] of Object.entries(writtenNumbers)) {
            if (normalizedText.includes(word)) {
                amount = value;
                break;
            }
        }
    }
    
    // Try to extract description
    // Common patterns: "for [description]", "on [description]", "[description] expense"
    const descPatterns = [
        /(?:for|on)\s+(.+?)(?:\s+expense)?$/i,
        /add\s+\d+.*?(?:for|on)\s+(.+)/i,
        /(.+?)\s+expense/i,
        /spent.*?on\s+(.+)/i
    ];
    
    for (const pattern of descPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            description = match[1].trim();
            break;
        }
    }
    
    // Clean up description
    description = description
        .replace(/\s+dollars?\s*$/i, '')
        .replace(/^\s*(?:a|an|the)\s+/i, '')
        .trim();
    
    return { amount, description: description || 'Expense' };
}