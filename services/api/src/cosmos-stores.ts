/**
 * Cosmos DB Stores for the Audit System.
 *
 * Split into two single-responsibility classes:
 * - SessionCosmosStore: session persistence (ISessionStore)
 * - AuditCosmosStore: audit data persistence (IAuditStore)
 *
 * Both extend CosmosClientBase which manages connection and authentication.
 * Uses Azure Managed Identity for authentication (no key support).
 */

import { CosmosClient, Database, Container, PartitionKeyDefinition } from '@azure/cosmos';
import { ManagedIdentityCredential, DefaultAzureCredential } from '@azure/identity';
import type { SessionInfo, Interaction, ToolExecution, SessionShare } from '@ritwikranjan/copilot-agent-framework';
import type { ISessionStore, IAuditStore } from '@ritwikranjan/copilot-agent-framework';

// Cosmos DB Configuration (from the environment variables)
const COSMOS_ACCOUNT_NAME = process.env.COSMOS_ACCOUNT_NAME;
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT || `https://${COSMOS_ACCOUNT_NAME}.documents.azure.com:443/`;
const DATABASE_NAME = process.env.COSMOS_DATABASE_NAME;
// Use USER_ASSIGNED_MSI_CLIENT_ID specifically for Cosmos DB to avoid conflict with AZURE_CLIENT_ID (used for JWT/Bot)
const USER_ASSIGNED_MSI_CLIENT_ID = process.env.USER_ASSIGNED_MSI_CLIENT_ID;

// Container names
const SESSIONS_CONTAINER = 'Sessions';
const INTERACTIONS_CONTAINER = 'Interactions';
const TOOL_EXECUTIONS_CONTAINER = 'ToolExecutions';

// ============ Shared Cosmos Connection ============

/**
 * Base class providing shared Cosmos DB connection and authentication.
 *
 * Manages the CosmosClient lifecycle, database creation, and container
 * creation. Subclasses inherit the connection without duplicating auth logic.
 */
class CosmosClientBase {
    protected endpoint: string;
    private client: CosmosClient | null = null;
    private database: Database | null = null;
    private containers: Map<string, Container> = new Map();

    constructor(endpoint: string = COSMOS_ENDPOINT) {
        this.endpoint = endpoint;
    }

    /**
     * Initialize the Cosmos client.
     * Uses ManagedIdentityCredential for authentication.
     *
     * If USER_ASSIGNED_MSI_CLIENT_ID is set, uses user-assigned managed identity.
     * Otherwise, uses system-assigned managed identity or DefaultAzureCredential for local dev.
     */
    protected ensureClient(): CosmosClient {
        if (!this.client) {
            let credential;

            if (USER_ASSIGNED_MSI_CLIENT_ID) {
                // User-assigned managed identity
                credential = new ManagedIdentityCredential({
                    clientId: USER_ASSIGNED_MSI_CLIENT_ID
                });
                console.log(`Using User-Assigned Managed Identity: ${USER_ASSIGNED_MSI_CLIENT_ID}`);
            } else if (process.env.NODE_ENV === 'production') {
                // System-assigned managed identity in production
                credential = new ManagedIdentityCredential();
                console.log('Using System-Assigned Managed Identity');
            } else {
                // DefaultAzureCredential for local development (uses Azure CLI, VS Code, etc.)
                credential = new DefaultAzureCredential();
                console.log('Using DefaultAzureCredential (local development)');
            }

            this.client = new CosmosClient({
                endpoint: this.endpoint,
                aadCredentials: credential
            });
            console.log(`Connected to Cosmos DB at ${this.endpoint}`);
        }
        return this.client;
    }

    /**
     * Ensure the database exists, creating it if necessary.
     */
    protected async ensureDatabase(): Promise<Database> {
        if (!this.database) {
            const client = this.ensureClient();
            const { database } = await client.databases.createIfNotExists({
                id: DATABASE_NAME
            });
            this.database = database;
            console.log(`Using database: ${DATABASE_NAME}`);
        }
        return this.database;
    }

    /**
     * Ensure a container exists, creating it if necessary.
     */
    protected async ensureContainer(
        containerName: string,
        partitionKeyPath: string
    ): Promise<Container> {
        if (!this.containers.has(containerName)) {
            const database = await this.ensureDatabase();
            const partitionKey: PartitionKeyDefinition = {
                paths: [partitionKeyPath]
            };
            const { container } = await database.containers.createIfNotExists({
                id: containerName,
                partitionKey
            });
            this.containers.set(containerName, container);
            console.log(`Using container: ${containerName} with partition key: ${partitionKeyPath}`);
        }
        return this.containers.get(containerName)!;
    }
}

// ============ Session Store ============

/**
 * Cosmos DB implementation of ISessionStore.
 *
 * Manages the Sessions container, partitioned by `/user_info/username`
 * for efficient user-centric queries.
 */
export class SessionCosmosStore extends CosmosClientBase implements ISessionStore {
    private _initialized = false;
    /**
     * Initialize the Sessions container.
     */
    async initialize(): Promise<void> {
        if (this._initialized) return;
        console.log('Initializing SessionCosmosStore...');
        await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        console.log('SessionCosmosStore initialization complete.');
        this._initialized = true;
    }

    /**
     * Create a new session record.
     */
    async createSession(sessionData: SessionInfo): Promise<SessionInfo> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const { resource } = await container.items.create(sessionData);
        console.log(`Created session: ${sessionData.id}`);
        return resource as SessionInfo;
    }

    /**
     * Update an existing session record.
     */
    async updateSession(
        sessionId: string,
        partitionKey: string,
        sessionData: SessionInfo
    ): Promise<SessionInfo> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const { resource } = await container.item(sessionId, partitionKey).replace(sessionData);
        console.log(`Updated session: ${sessionId}`);
        return resource as SessionInfo;
    }

    /**
     * Get a session by ID.
     */
    async getSession(sessionId: string, partitionKey: string): Promise<SessionInfo | null> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        try {
            const { resource } = await container.item(sessionId, partitionKey).read<SessionInfo>();
            return resource ?? null;
        } catch (error: unknown) {
            if ((error as { code?: number }).code === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get a session by name for a specific user.
     */
    async getSessionByName(username: string, sessionName: string): Promise<SessionInfo | null> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.name = @name',
            parameters: [{ name: '@name', value: sessionName }]
        };

        const { resources } = await container.items
            .query<SessionInfo>(querySpec, { partitionKey: username })
            .fetchAll();

        return resources.length > 0 ? resources[0] : null;
    }

    /**
     * Get all sessions for a user.
     */
    async getSessionsByUser(username: string): Promise<SessionInfo[]> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const querySpec = {
            query: 'SELECT * FROM c ORDER BY c.start_time DESC'
        };

        const { resources } = await container.items
            .query<SessionInfo>(querySpec, { partitionKey: username })
            .fetchAll();

        return resources;
    }

    /**
     * Get an active session by conversation ID for a user.
     * Returns sessions that are active and not expired.
     */
    async getSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const now = new Date().toISOString();
        const querySpec = {
            query: `SELECT * FROM c WHERE c.conversation_id = @conversationId 
                    AND c.status = 'active' 
                    AND (c.expires_at > @now OR NOT IS_DEFINED(c.expires_at))
                    ORDER BY c.start_time DESC`,
            parameters: [
                { name: '@conversationId', value: conversationId },
                { name: '@now', value: now }
            ]
        };

        const { resources } = await container.items
            .query<SessionInfo>(querySpec, { partitionKey: username })
            .fetchAll();

        return resources.length > 0 ? resources[0] : null;
    }

    /**
     * Get the most recent session for a conversation, regardless of status/expiry.
     * Used by /resume to find the last expired session and carry over its copilot_session_id.
     */
    async getLastSessionByConversationId(username: string, conversationId: string): Promise<SessionInfo | null> {
        const container = await this.ensureContainer(SESSIONS_CONTAINER, '/user_info/username');
        const querySpec = {
            query: `SELECT * FROM c WHERE c.conversation_id = @conversationId 
                    ORDER BY c.start_time DESC
                    OFFSET 0 LIMIT 1`,
            parameters: [
                { name: '@conversationId', value: conversationId }
            ]
        };

        const { resources } = await container.items
            .query<SessionInfo>(querySpec, { partitionKey: username })
            .fetchAll();

        return resources.length > 0 ? resources[0] : null;
    }

    // ============ Sharing Operations (Cosmos) ============
    // TODO: These need a SessionShares container (partition key: /shared_with_username)
    // For now, stub implementations that will be filled when Cosmos sharing container is created.

    async shareSession(share: SessionShare): Promise<SessionShare> {
        throw new Error('Cosmos shareSession not yet implemented — use InMemorySessionStore for development');
    }

    async getSharedSessions(_username: string): Promise<SessionShare[]> {
        return [];
    }

    async getSessionByShareId(_shareId: string): Promise<SessionInfo | null> {
        return null;
    }

    async revokeShare(_shareId: string): Promise<boolean> {
        return false;
    }

    async getSharesForSession(_sessionId: string): Promise<SessionShare[]> {
        return [];
    }
}

// ============ Audit Store ============

/**
 * Cosmos DB implementation of IAuditStore.
 *
 * Manages the Interactions and ToolExecutions containers,
 * both partitioned by `/session_id` for session-centric queries.
 */
export class AuditCosmosStore extends CosmosClientBase implements IAuditStore {
    private _initialized = false;
    /**
     * Initialize the Interactions and ToolExecutions containers.
     */
    async initialize(): Promise<void> {
        if (this._initialized) return;
        console.log('Initializing AuditCosmosStore...');
        await this.ensureContainer(INTERACTIONS_CONTAINER, '/session_id');
        await this.ensureContainer(TOOL_EXECUTIONS_CONTAINER, '/session_id');
        console.log('AuditCosmosStore initialization complete.');
        this._initialized = true;
    }

    // ============ Interactions Operations ============

    /**
     * Create a new interaction record.
     */
    async createInteraction(interactionData: Interaction): Promise<Interaction> {
        const container = await this.ensureContainer(INTERACTIONS_CONTAINER, '/session_id');
        const { resource } = await container.items.create(interactionData);
        console.log(`Created interaction: ${interactionData.id}`);
        return resource as Interaction;
    }

    /**
     * Update an existing interaction record.
     */
    async updateInteraction(
        interactionId: string,
        partitionKey: string,
        interactionData: Interaction
    ): Promise<Interaction> {
        const container = await this.ensureContainer(INTERACTIONS_CONTAINER, '/session_id');
        const { resource } = await container.item(interactionId, partitionKey).replace(interactionData);
        console.log(`Updated interaction: ${interactionId}`);
        return resource as Interaction;
    }

    /**
     * Get all interactions for a session.
     */
    async getInteractionsBySession(sessionId: string): Promise<Interaction[]> {
        const container = await this.ensureContainer(INTERACTIONS_CONTAINER, '/session_id');
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.session_id = @session_id ORDER BY c.timestamp',
            parameters: [{ name: '@session_id', value: sessionId }]
        };

        const { resources } = await container.items
            .query<Interaction>(querySpec, { partitionKey: sessionId })
            .fetchAll();

        return resources;
    }

    // ============ Tool Executions Operations ============

    /**
     * Create a new tool execution record.
     */
    async createToolExecution(toolData: ToolExecution): Promise<ToolExecution> {
        const container = await this.ensureContainer(TOOL_EXECUTIONS_CONTAINER, '/session_id');
        const { resource } = await container.items.create(toolData);
        console.log(`Created tool execution: ${toolData.id}`);
        return resource as ToolExecution;
    }

    /**
     * Update an existing tool execution record.
     */
    async updateToolExecution(
        toolId: string,
        partitionKey: string,
        toolData: ToolExecution
    ): Promise<ToolExecution> {
        const container = await this.ensureContainer(TOOL_EXECUTIONS_CONTAINER, '/session_id');
        const { resource } = await container.item(toolId, partitionKey).replace(toolData);
        console.log(`Updated tool execution: ${toolId}`);
        return resource as ToolExecution;
    }

    /**
     * Get all tool executions for a session.
     */
    async getToolExecutionsBySession(sessionId: string): Promise<ToolExecution[]> {
        const container = await this.ensureContainer(TOOL_EXECUTIONS_CONTAINER, '/session_id');
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.session_id = @session_id ORDER BY c.start_time',
            parameters: [{ name: '@session_id', value: sessionId }]
        };

        const { resources } = await container.items
            .query<ToolExecution>(querySpec, { partitionKey: sessionId })
            .fetchAll();

        return resources;
    }

    /**
     * Get all tool executions for a specific interaction.
     */
    async getToolExecutionsByInteraction(
        sessionId: string,
        interactionId: string
    ): Promise<ToolExecution[]> {
        const container = await this.ensureContainer(TOOL_EXECUTIONS_CONTAINER, '/session_id');
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.session_id = @session_id AND c.interaction_id = @interaction_id ORDER BY c.start_time',
            parameters: [
                { name: '@session_id', value: sessionId },
                { name: '@interaction_id', value: interactionId }
            ]
        };

        const { resources } = await container.items
            .query<ToolExecution>(querySpec, { partitionKey: sessionId })
            .fetchAll();

        return resources;
    }
}

// ============ Singletons ============

let _sessionStore: SessionCosmosStore | null = null;
let _auditStore: AuditCosmosStore | null = null;

/**
 * Get the shared SessionCosmosStore instance.
 */
export function getSessionCosmosStore(): SessionCosmosStore {
    if (!_sessionStore) {
        _sessionStore = new SessionCosmosStore();
    }
    return _sessionStore;
}

/**
 * Get the shared AuditCosmosStore instance.
 */
export function getAuditCosmosStore(): AuditCosmosStore {
    if (!_auditStore) {
        _auditStore = new AuditCosmosStore();
    }
    return _auditStore;
}
