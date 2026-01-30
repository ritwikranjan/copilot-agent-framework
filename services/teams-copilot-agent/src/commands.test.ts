/**
 * Unit tests for Command handling.
 */

import { describe, it, expect } from 'vitest';
import {
    COMMANDS,
    isCommand,
    getCommandType,
    isAnyCommand,
    getHelpText
} from './commands.js';

describe('Commands', () => {
    describe('isCommand', () => {
        it('should match exact command', () => {
            expect(isCommand('/help', COMMANDS.HELP)).toBe(true);
            expect(isCommand('/status', COMMANDS.STATUS)).toBe(true);
            expect(isCommand('/new-session', COMMANDS.NEW_SESSION)).toBe(true);
            expect(isCommand('/end-session', COMMANDS.END_SESSION)).toBe(true);
            expect(isCommand('/resume', COMMANDS.RESUME)).toBe(true);
        });
        
        it('should match command aliases', () => {
            // NEW_SESSION aliases
            expect(isCommand('/new', COMMANDS.NEW_SESSION)).toBe(true);
            expect(isCommand('/reset', COMMANDS.NEW_SESSION)).toBe(true);
            
            // END_SESSION aliases
            expect(isCommand('/end', COMMANDS.END_SESSION)).toBe(true);
            expect(isCommand('/bye', COMMANDS.END_SESSION)).toBe(true);
            
            // RESUME aliases
            expect(isCommand('/continue', COMMANDS.RESUME)).toBe(true);
            
            // STATUS aliases
            expect(isCommand('/session', COMMANDS.STATUS)).toBe(true);
            
            // HELP aliases
            expect(isCommand('/?', COMMANDS.HELP)).toBe(true);
        });
        
        it('should be case insensitive', () => {
            expect(isCommand('/HELP', COMMANDS.HELP)).toBe(true);
            expect(isCommand('/Help', COMMANDS.HELP)).toBe(true);
            expect(isCommand('/STATUS', COMMANDS.STATUS)).toBe(true);
            expect(isCommand('/New-Session', COMMANDS.NEW_SESSION)).toBe(true);
        });
        
        it('should match command with trailing text', () => {
            expect(isCommand('/help me', COMMANDS.HELP)).toBe(true);
            expect(isCommand('/status please', COMMANDS.STATUS)).toBe(true);
            expect(isCommand('/new extra args', COMMANDS.NEW_SESSION)).toBe(true);
        });
        
        it('should trim whitespace', () => {
            expect(isCommand('  /help  ', COMMANDS.HELP)).toBe(true);
            expect(isCommand('\t/status\n', COMMANDS.STATUS)).toBe(true);
        });
        
        it('should not match partial commands without space', () => {
            expect(isCommand('/helper', COMMANDS.HELP)).toBe(false);
            expect(isCommand('/statuses', COMMANDS.STATUS)).toBe(false);
            expect(isCommand('/newbie', COMMANDS.NEW_SESSION)).toBe(false);
        });
        
        it('should not match wrong command type', () => {
            expect(isCommand('/help', COMMANDS.STATUS)).toBe(false);
            expect(isCommand('/status', COMMANDS.HELP)).toBe(false);
        });
        
        it('should not match regular messages', () => {
            expect(isCommand('hello', COMMANDS.HELP)).toBe(false);
            expect(isCommand('what is the status?', COMMANDS.STATUS)).toBe(false);
        });
    });

    describe('getCommandType', () => {
        it('should return correct command type', () => {
            expect(getCommandType('/help')).toBe('HELP');
            expect(getCommandType('/status')).toBe('STATUS');
            expect(getCommandType('/new-session')).toBe('NEW_SESSION');
            expect(getCommandType('/end-session')).toBe('END_SESSION');
            expect(getCommandType('/resume')).toBe('RESUME');
        });
        
        it('should return correct type for aliases', () => {
            expect(getCommandType('/new')).toBe('NEW_SESSION');
            expect(getCommandType('/reset')).toBe('NEW_SESSION');
            expect(getCommandType('/end')).toBe('END_SESSION');
            expect(getCommandType('/bye')).toBe('END_SESSION');
            expect(getCommandType('/continue')).toBe('RESUME');
            expect(getCommandType('/session')).toBe('STATUS');
            expect(getCommandType('/?')).toBe('HELP');
        });
        
        it('should return null for non-commands', () => {
            expect(getCommandType('hello')).toBeNull();
            expect(getCommandType('what is the status?')).toBeNull();
        });
        
        it('should return null for unknown commands', () => {
            expect(getCommandType('/unknown')).toBeNull();
            expect(getCommandType('/foo')).toBeNull();
        });
        
        it('should return null for messages not starting with /', () => {
            expect(getCommandType('help')).toBeNull();
            expect(getCommandType('status')).toBeNull();
        });
    });

    describe('isAnyCommand', () => {
        it('should return true for any valid command', () => {
            expect(isAnyCommand('/help')).toBe(true);
            expect(isAnyCommand('/status')).toBe(true);
            expect(isAnyCommand('/new-session')).toBe(true);
            expect(isAnyCommand('/end-session')).toBe(true);
            expect(isAnyCommand('/resume')).toBe(true);
            expect(isAnyCommand('/new')).toBe(true);
            expect(isAnyCommand('/end')).toBe(true);
            expect(isAnyCommand('/bye')).toBe(true);
            expect(isAnyCommand('/continue')).toBe(true);
            expect(isAnyCommand('/session')).toBe(true);
            expect(isAnyCommand('/?')).toBe(true);
        });
        
        it('should return false for non-commands', () => {
            expect(isAnyCommand('hello')).toBe(false);
            expect(isAnyCommand('what is the status?')).toBe(false);
            expect(isAnyCommand('/unknown')).toBe(false);
        });
    });

    describe('getHelpText', () => {
        it('should return help text containing all commands', () => {
            const help = getHelpText();
            
            expect(help).toContain('/status');
            expect(help).toContain('/new-session');
            expect(help).toContain('/end-session');
            expect(help).toContain('/resume');
            expect(help).toContain('/help');
            expect(help).toContain('12 hours');
        });
        
        it('should return markdown formatted text', () => {
            const help = getHelpText();
            
            expect(help).toContain('**Available Commands:**');
            expect(help).toContain('•');
            expect(help).toContain('_Sessions automatically expire');
        });
    });
});

describe('COMMANDS constant', () => {
    it('should have all required command types', () => {
        expect(COMMANDS.NEW_SESSION).toBeDefined();
        expect(COMMANDS.END_SESSION).toBeDefined();
        expect(COMMANDS.RESUME).toBeDefined();
        expect(COMMANDS.STATUS).toBeDefined();
        expect(COMMANDS.HELP).toBeDefined();
    });
    
    it('should have arrays of command strings', () => {
        expect(Array.isArray(COMMANDS.NEW_SESSION)).toBe(true);
        expect(Array.isArray(COMMANDS.END_SESSION)).toBe(true);
        expect(Array.isArray(COMMANDS.RESUME)).toBe(true);
        expect(Array.isArray(COMMANDS.STATUS)).toBe(true);
        expect(Array.isArray(COMMANDS.HELP)).toBe(true);
    });
    
    it('should have at least one command per type', () => {
        expect(COMMANDS.NEW_SESSION.length).toBeGreaterThan(0);
        expect(COMMANDS.END_SESSION.length).toBeGreaterThan(0);
        expect(COMMANDS.RESUME.length).toBeGreaterThan(0);
        expect(COMMANDS.STATUS.length).toBeGreaterThan(0);
        expect(COMMANDS.HELP.length).toBeGreaterThan(0);
    });
    
    it('all commands should start with /', () => {
        const allCommands = [
            ...COMMANDS.NEW_SESSION,
            ...COMMANDS.END_SESSION,
            ...COMMANDS.RESUME,
            ...COMMANDS.STATUS,
            ...COMMANDS.HELP
        ];
        
        for (const cmd of allCommands) {
            expect(cmd.startsWith('/') || cmd === '/?').toBe(true);
        }
    });
});
