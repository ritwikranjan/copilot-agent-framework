/**
 * Teams Copilot Agent - Unified service combining Teams Bot with direct Copilot SDK integration.
 * 
 * This service:
 * - Handles Teams Bot Framework messages using @microsoft/teams.apps SDK
 * - Connects directly to Copilot CLI server via @github/copilot-sdk
 * - Includes session management and audit logging via Cosmos DB
 * - Supports MCP tools and configurable system prompts
 */

// Telemetry MUST be imported first — before any other modules — so OpenTelemetry can patch them
import { trackMessageStart, trackMessageEnd, trackSession, trackError } from './telemetry.js';

import { App, type IPlugin } from '@microsoft/teams.apps';
import { BotBuilderPlugin } from '@microsoft/teams.botbuilder';
import { DevtoolsPlugin } from '@microsoft/teams.dev';
import { ManagedIdentityCredential } from '@azure/identity';
import {
    initializeCopilotService,
    getServiceConfig,
    type CopilotResponse,
    sendMessageStreaming,
    getConversationSessionStatus,
    endConversationSession,
    resumeConversationSession,
    getKustoQueriesForSession
} from './copilot-service.js';
import { formatRemainingTime, type UserInfo } from './cosmos_integration/index.js';
import { COMMANDS, isCommand, getHelpText } from './commands.js';

// Configuration
const PORT = parseInt(process.env.PORT || '3978');
const BOT_ID = process.env.BOT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.BOT_ID;
const IS_DEV = process.env.NODE_ENV !== 'production';

// Prevent unhandled rejections from crashing the process.
// The Teams SDK internal retry mechanism can throw 403 errors on stream operations
// (e.g. informative stream chunks rejected by Bot Framework after stream expiry).
// These are non-fatal — the actual content is delivered via sendMessage().
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] Suppressed:', reason instanceof Error ? reason.message : reason);
});

/**
 * Create token factory for User-Assigned MSI.
 * Used for authenticating with Bot Framework Connector.
 */
const createTokenFactory = () => {
    return async (scope: string | string[], tenantId?: string): Promise<string> => {
        console.log(`[Token] Acquiring token for scope: ${scope}, tenant: ${tenantId || 'default'}`);
        
        const managedIdentityCredential = new ManagedIdentityCredential({
            clientId: AZURE_CLIENT_ID,
        });
        
        const scopes = Array.isArray(scope) ? scope : [scope];
        const tokenResponse = await managedIdentityCredential.getToken(scopes, {
            tenantId: tenantId,
        });
        
        console.log(`[Token] Token acquired successfully, expires: ${tokenResponse.expiresOnTimestamp}`);
        return tokenResponse.token;
    };
};

/**
 * Configure credentials for User-Assigned MSI.
 * Provides the token for outbound Bot Connector API calls.
 */
const tokenCredentials = BOT_ID ? {
    clientId: BOT_ID,
    token: createTokenFactory(),
} : undefined;

/**
 * Create plugins array based on environment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugins: IPlugin<any, any>[] = [];

// Add BotBuilderPlugin for production Bot Framework integration
if (BOT_ID) {
    plugins.push(new BotBuilderPlugin());
    console.log('Using BotBuilderPlugin for Bot Framework');
}

// Add DevtoolsPlugin for development/testing
if (IS_DEV || !BOT_ID) {
    plugins.push(new DevtoolsPlugin());
    console.log('Using DevtoolsPlugin for local development');
}

/**
 * Create the Teams App with token credentials and plugins.
 */
const app = new App({
    ...tokenCredentials,
    plugins,
});

/**
 * Helper to safely extract property from activity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeGet<T>(obj: any, key: string): T | undefined {
    return obj?.[key] as T | undefined;
}

/**
 * Extract user info from Teams activity for audit logging.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getUserInfoFromActivity(activity: any): UserInfo {
    const from = safeGet<{ aadObjectId?: string; id?: string; name?: string }>(activity, 'from');
    const username = from?.aadObjectId || from?.id || 'unknown';
    const hostname = safeGet<string>(activity, 'serviceUrl') || 'teams';
    
    return {
        username,
        hostname
    };
}

/**
 * Log all activities for debugging.
 */
app.on('activity', async ({ activity, next }) => {
    const type = safeGet<string>(activity, 'type');
    const text = safeGet<string>(activity, 'text');
    const from = safeGet<{ id?: string }>(activity, 'from');
    console.log(`[Activity] type=${type}, text="${text || ''}", from=${from?.id || 'unknown'}`);
    await next();
});

/**
 * Handle incoming messages.
 */
app.on('message', async ({ send, activity, stream }) => {
    const userMessage = safeGet<string>(activity, 'text')?.trim();
    
    if (!userMessage) {
        await send('Please send a text message.');
        return;
    }
    
    const userInfo = getUserInfoFromActivity(activity);
    const conversation = safeGet<{ id?: string }>(activity, 'conversation');
    const conversationId = conversation?.id || '';
    
    console.log(`[Message] "${userMessage}" from ${userInfo.username}`);
    const msgStartTime = trackMessageStart();
    
    // Handle commands
    if (userMessage.startsWith('/')) {
        // Help command
        if (isCommand(userMessage, COMMANDS.HELP)) {
            await send(getHelpText());
            return;
        }
        
        // Status command
        if (isCommand(userMessage, COMMANDS.STATUS)) {
            const status = await getConversationSessionStatus(conversationId, userInfo.username);
            if (!status.exists) {
                await send('📭 No active session. Send a message to start a new conversation!');
            } else if (status.expired) {
                await send('⏰ Your session has expired. Send `/resume` to continue or just send a new message.');
            } else {
                const remaining = status.remainingTimeMs ? formatRemainingTime(status.remainingTimeMs) : 'unknown';
                await send(
                    `✅ **Active Session**\n\n` +
                    `• Created: ${status.createdAt?.toLocaleString() || 'unknown'}\n` +
                    `• Last activity: ${status.lastActivityAt?.toLocaleString() || 'unknown'}\n` +
                    `• Time remaining: ${remaining}`
                );
            }
            return;
        }
        
        // New session command
        if (isCommand(userMessage, COMMANDS.NEW_SESSION)) {
            const existed = await endConversationSession(conversationId, userInfo.username);
            trackSession('new');
            if (existed) {
                await send('🔄 Previous session ended. Send a message to start a fresh conversation!');
            } else {
                await send('📭 No active session to end. Send a message to start a new conversation!');
            }
            return;
        }
        
        // End session command
        if (isCommand(userMessage, COMMANDS.END_SESSION)) {
            const ended = await endConversationSession(conversationId, userInfo.username);
            if (ended) {
                trackSession('ended');
                await send('👋 Session ended. Thanks for chatting! Send a message anytime to start a new conversation.');
            } else {
                await send('📭 No active session to end.');
            }
            return;
        }
        
        // Show Kusto queries command
        if (isCommand(userMessage, COMMANDS.SHOW_KUSTO_QUERIES)) {
            // Parse optional page number: /queries 2
            const parts = userMessage.trim().split(/\s+/);
            const page = parts.length > 1 ? parseInt(parts[1], 10) || 1 : 1;

            try {
                const result = await getKustoQueriesForSession(conversationId, userInfo.username, page);
                if (!result) {
                    await send('📭 No active session. Send a message to start a conversation first.');
                    return;
                }
                if (result.totalQueries === 0) {
                    await send('🔍 No Kusto queries have been executed in this session yet.');
                    return;
                }

                let msg = `**📊 KQL Queries (page ${result.page}/${result.totalPages}, ${result.totalQueries} total)**\n\n`;
                for (const q of result.queries) {
                    const time = new Date(q.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    msg += `---\n**#${q.index}** — \`${time}\` · \`${q.database}\`\n\n`;
                    msg += '```kql\n' + q.query + '\n```\n\n';
                }

                if (result.totalPages > 1) {
                    msg += `_Use \`/queries ${result.page + 1}\` for next page_`;
                }

                await send(msg);
            } catch (err) {
                console.error('[show_kusto_queries] Error:', err);
                await send('❌ Failed to retrieve queries. Please try again.');
            }
            return;
        }
        
        // Resume command
        if (isCommand(userMessage, COMMANDS.RESUME)) {
            const status = await getConversationSessionStatus(conversationId, userInfo.username);
            if (status.exists && !status.expired) {
                const remaining = status.remainingTimeMs ? formatRemainingTime(status.remainingTimeMs) : 'unknown';
                await send(`✅ Your session is still active (${remaining} remaining). Just continue chatting!`);
            } else {
                // Resume: create new session carrying over the copilot_session_id
                const result = await resumeConversationSession(conversationId, userInfo);
                trackSession('resume');
                if (result.hadCopilotSession) {
                    await send('🔄 Session resumed with previous conversation context. Continue where you left off!');
                } else {
                    await send('🔄 New session started (no prior context found). Send your message to begin!');
                }
            }
            return;
        }
    }
    
    // Send typing indicator
    try {
        await send({ type: 'typing' });
    } catch {
        console.log('Typing indicator skipped');
    }
    
    try {
        // Send message to Copilot via direct SDK integration
        // Pass stream for first turn, send for subsequent turns as separate messages
        const response: CopilotResponse = await sendMessageStreaming(
            userMessage,
            userInfo,
            stream,
            send,
            { conversationId }
        );
        
        console.log(`[Response] success=${response.success}, sessionId=${response.sessionId}`);
        trackMessageEnd(msgStartTime, response.success);
        
        // Handle session expiration
        if (response.sessionExpired) {
            trackSession('expired');
            await send(response.error || 'Your session has expired. Send `/resume` to continue.');
            return;
        }
        
        // Note: For streaming, content is sent via stream.emit() and stream.close() is called
        // Only send final message if streaming was not successful or there was an error
        if (!response.success) {
            await send(response.error || 'Sorry, an error occurred while processing your message.');
        }
    } catch (error) {
        console.error('[Error]', error);
        trackMessageEnd(msgStartTime, false);
        trackError('message_handler', (error as Error).message);
        await send('Sorry, something went wrong. Please try again.');
    }
});

/**
 * Health check endpoint handler.
 * The SDK handles this automatically, but we add logging.
 */
app.on('activity', async ({ activity, next }) => {
    const type = safeGet<string>(activity, 'type');
    const name = safeGet<string>(activity, 'name');
    if (type === 'invoke' && name === 'healthCheck') {
        console.log('[Health] Health check received');
    }
    await next();
});

/**
 * Start the application.
 */
async function main(): Promise<void> {
    // Initialize Copilot service
    initializeCopilotService();
    
    // Get service config for logging
    const config = getServiceConfig();
    
    // Start the Teams App
    await app.start(PORT);
    
    console.log('========================================');
    console.log('Teams Copilot Agent');
    console.log('========================================');
    console.log(`Port: ${PORT}`);
    console.log(`BOT_ID: ${BOT_ID || 'not set (dev mode)'}`);
    console.log(`AZURE_CLIENT_ID: ${AZURE_CLIENT_ID || 'not set'}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`CLI URL: ${config.cliUrl}`);
    console.log(`Model: ${config.model}`);
    console.log(`Agent: ${config.agentName}`);
    console.log(`MCP Tools: ${config.hasMcpServers ? 'enabled' : 'disabled'}`);
    console.log(`Audit: ${config.auditEnabled ? 'enabled' : 'disabled'}`);
    console.log(`MSI Enabled: ${!!tokenCredentials}`);
    console.log(`DevTools: ${IS_DEV || !BOT_ID ? 'enabled' : 'disabled'}`);
    console.log('========================================');
}

// Run the application
main().catch(error => {
    console.error('Failed to start application:', error);
    process.exit(1);
});