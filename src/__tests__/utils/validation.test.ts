import { describe, it, expect } from 'vitest';
import {
    validateAmount,
    validateDescription,
    validateCategory,
    sanitizeInput,
    validateBudgetPeriod,
    validateUsername
} from '../../utils/validation';

describe('validation utilities', () => {
    describe('validateAmount', () => {
        it('should accept valid amounts', () => {
            expect(validateAmount('10')).toBe(true);
            expect(validateAmount('10.50')).toBe(true);
            expect(validateAmount('0.01')).toBe(true);
            expect(validateAmount('9999.99')).toBe(true);
        });

        it('should reject invalid amounts', () => {
            expect(validateAmount('-10')).toBe(false);
            expect(validateAmount('0')).toBe(false);
            expect(validateAmount('abc')).toBe(false);
            expect(validateAmount('10.555')).toBe(false); // Too many decimals
            expect(validateAmount('10000')).toBe(false); // Too large
            expect(validateAmount('')).toBe(false);
            expect(validateAmount('10.50.50')).toBe(false);
        });
    });

    describe('validateDescription', () => {
        it('should accept valid descriptions', () => {
            expect(validateDescription('Lunch at restaurant')).toBe(true);
            expect(validateDescription('Coffee ☕')).toBe(true);
            expect(validateDescription('Uber to downtown')).toBe(true);
            expect(validateDescription('A')).toBe(true); // Minimum length
        });

        it('should reject invalid descriptions', () => {
            expect(validateDescription('')).toBe(false);
            expect(validateDescription('A'.repeat(201))).toBe(false); // Too long
            expect(validateDescription('<script>alert("xss")</script>')).toBe(false);
            expect(validateDescription('Test\x00')).toBe(false); // Null character
        });

        it('should handle emojis correctly', () => {
            expect(validateDescription('Pizza 🍕🍕🍕')).toBe(true);
            expect(validateDescription('🎬 Movie night')).toBe(true);
        });
    });

    describe('validateCategory', () => {
        it('should accept valid categories', () => {
            expect(validateCategory('Food & Dining')).toBe(true);
            expect(validateCategory('Transportation')).toBe(true);
            expect(validateCategory('Entertainment')).toBe(true);
            expect(validateCategory('Other')).toBe(true);
        });

        it('should normalize categories', () => {
            expect(validateCategory('food & dining')).toBe(true);
            expect(validateCategory('TRANSPORTATION')).toBe(true);
            expect(validateCategory('  Entertainment  ')).toBe(true);
        });

        it('should reject invalid categories', () => {
            expect(validateCategory('')).toBe(false);
            expect(validateCategory('A'.repeat(51))).toBe(false);
            expect(validateCategory('<invalid>')).toBe(false);
        });
    });

    describe('sanitizeInput', () => {
        it('should remove dangerous characters', () => {
            expect(sanitizeInput('Hello<script>alert("xss")</script>')).toBe('Helloscriptalert("xss")/script');
            expect(sanitizeInput('Test & Co.')).toBe('Test  Co.');
            expect(sanitizeInput('Normal text')).toBe('Normal text');
        });

        it('should trim whitespace', () => {
            expect(sanitizeInput('  Hello  ')).toBe('Hello');
            expect(sanitizeInput('\n\tTest\n')).toBe('Test');
        });

        it('should handle special characters', () => {
            expect(sanitizeInput('Price: $10.50')).toBe('Price: $10.50');
            expect(sanitizeInput('Email@test.com')).toBe('Email@test.com');
            expect(sanitizeInput('Test\x00String')).toBe('TestString');
        });
    });

    describe('validateBudgetPeriod', () => {
        it('should accept valid periods', () => {
            expect(validateBudgetPeriod('daily')).toBe(true);
            expect(validateBudgetPeriod('weekly')).toBe(true);
            expect(validateBudgetPeriod('monthly')).toBe(true);
        });

        it('should handle case variations', () => {
            expect(validateBudgetPeriod('Daily')).toBe(true);
            expect(validateBudgetPeriod('WEEKLY')).toBe(true);
            expect(validateBudgetPeriod('Monthly')).toBe(true);
        });

        it('should reject invalid periods', () => {
            expect(validateBudgetPeriod('yearly')).toBe(false);
            expect(validateBudgetPeriod('hourly')).toBe(false);
            expect(validateBudgetPeriod('')).toBe(false);
            expect(validateBudgetPeriod('invalid')).toBe(false);
        });
    });

    describe('validateUsername', () => {
        it('should accept valid usernames', () => {
            expect(validateUsername('john_doe')).toBe(true);
            expect(validateUsername('alice123')).toBe(true);
            expect(validateUsername('bob')).toBe(true);
            expect(validateUsername('user_name_123')).toBe(true);
        });

        it('should handle with @ symbol', () => {
            expect(validateUsername('@john_doe')).toBe(true);
            expect(validateUsername('@alice123')).toBe(true);
        });

        it('should reject invalid usernames', () => {
            expect(validateUsername('')).toBe(false);
            expect(validateUsername('ab')).toBe(false); // Too short
            expect(validateUsername('a'.repeat(33))).toBe(false); // Too long
            expect(validateUsername('user name')).toBe(false); // Space
            expect(validateUsername('user-name')).toBe(false); // Hyphen
            expect(validateUsername('user.name')).toBe(false); // Dot
            expect(validateUsername('вася')).toBe(false); // Non-ASCII
        });
    });
});