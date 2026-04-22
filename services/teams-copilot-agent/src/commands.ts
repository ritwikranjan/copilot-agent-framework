/**
 * Command handling for Teams Copilot Agent.
 * 
 * Provides command parsing and definitions for session management commands.
 */

// Session commands
export const COMMANDS = {
    NEW_SESSION: ['/new-session', '/new', '/reset'],
    END_SESSION: ['/end-session', '/end', '/bye'],
    RESUME: ['/resume', '/continue'],
    STATUS: ['/status', '/session'],
    SHOW_KUSTO_QUERIES: ['/show_kusto_queries', '/queries', '/kql'],
    HELP: ['/help', '/?']
} as const;

export type CommandType = keyof typeof COMMANDS;

/**
 * Check if a message matches any of the given commands.
 */
export function isCommand(message: string, commands: readonly string[]): boolean {
    const lower = message.toLowerCase().trim();
    return commands.some(cmd => lower === cmd || lower.startsWith(cmd + ' '));
}

/**
 * Get the command type from a message, or null if not a command.
 */
export function getCommandType(message: string): CommandType | null {
    if (!message.startsWith('/')) {
        return null;
    }
    
    for (const [type, commands] of Object.entries(COMMANDS)) {
        if (isCommand(message, commands)) {
            return type as CommandType;
        }
    }
    
    return null;
}

/**
 * Check if a message is any known command.
 */
export function isAnyCommand(message: string): boolean {
    return getCommandType(message) !== null;
}

/**
 * Get help text for all available commands.
 */
export function getHelpText(): string {
    return (
        '**Available Commands:**\n\n' +
        '• `/status` - Check your current session status\n' +
        '• `/queries` - Show KQL queries executed in this session\n' +
        '• `/new-session` - Start a fresh conversation (ends current session)\n' +
        '• `/end-session` - End your current session\n' +
        '• `/resume` - Resume after session expiration\n' +
        '• `/help` - Show this help message\n\n' +
        '_Sessions automatically expire after 12 hours._'
    );
}
