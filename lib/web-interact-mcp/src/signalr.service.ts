/**
 * @fileoverview SignalR service for Web Interact MCP communication
 * @description Framework-agnostic SignalR service for real-time communication with MCP servers
 * @version 1.0.0
 * @author Vijay Nirmal
 */

import * as signalR from '@microsoft/signalr';
import { ToolStartConfig, CallToolResult, createErrorResult, TransportOptions, TransportType, LogLevel } from './types';
import { ToolRegistry } from './tool-registry';

/**
 * Forward declaration to avoid circular dependency
 */
export interface WebInteractMCPController {
  start(tools: ToolStartConfig[]): Promise<CallToolResult[]>;
}

/**
 * SignalR service for Web Interact MCP communication
 * This is a framework-agnostic implementation that can be used with any JavaScript framework
 */
export class WebInteractSignalRService {
  private connection: signalR.HubConnection | null = null;
  private readonly config: TransportOptions;
  private readonly logger: Pick<Console, 'log' | 'error' | 'warn' | 'info'>;
  private reconnectAttempts = 0;
  private isManuallyDisconnected = false;

  /**
   * Maps our TransportType enum to SignalR's HttpTransportType
   * Explicitly maps each transport type and handles flag combinations
   */
  private mapTransportType(transportType: TransportType): signalR.HttpTransportType {
    let result = signalR.HttpTransportType.None;
    
    if (transportType & TransportType.WebSockets) {
      result |= signalR.HttpTransportType.WebSockets;
    }
    
    if (transportType & TransportType.ServerSentEvents) {
      result |= signalR.HttpTransportType.ServerSentEvents;
    }
    
    if (transportType & TransportType.LongPolling) {
      result |= signalR.HttpTransportType.LongPolling;
    }
    
    return result;
  }

  /**
   * Maps our LogLevel enum to SignalR's LogLevel
   */
  private mapLogLevel(logLevel: LogLevel): signalR.LogLevel {
    switch (logLevel) {
      case LogLevel.TRACE:
        return signalR.LogLevel.Trace;
      case LogLevel.DEBUG:
        return signalR.LogLevel.Debug;
      case LogLevel.INFO:
        return signalR.LogLevel.Information;
      case LogLevel.WARN:
        return signalR.LogLevel.Warning;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        return signalR.LogLevel.Error;
      case LogLevel.OFF:
        return signalR.LogLevel.None;
      default:
        return signalR.LogLevel.Information;
    }
  }

  /**
   * Creates a new WebInteractSignalRService instance
   * @param serverUrl - The base URL of the MCP server
   * @param mcpController - The MCP controller instance
   * @param toolRegistry - The tool registry instance for tool discovery
   * @param config - Configuration options for the service
   */
  constructor(
    private serverUrl: string, 
    private mcpController: WebInteractMCPController,
    private toolRegistry: ToolRegistry,
    config: Partial<TransportOptions> = {}
  ) {
    this.config = {
      hubPath: '/mcptools',
      maxRetryAttempts: 10,
      baseRetryDelayMs: 1000,
      enableLogging: false,
      logLevel: LogLevel.INFO,
      transportTypes: TransportType.WebSockets | TransportType.ServerSentEvents | TransportType.LongPolling,
      ...config
    };

    this.logger = this.config.enableLogging ? console : this.createSilentLogger();
    this.setupConnection();
  }

  /**
   * Start the SignalR connection
   * @returns Promise that resolves when the connection is established
   */
  async start(): Promise<void> {
    if (!this.connection) {
      throw new Error('SignalR connection not initialized');
    }

    if (this.connection.state === signalR.HubConnectionState.Connected) {
      this.logger.log('SignalR connection already established');
      return;
    }

    if (this.connection.state === signalR.HubConnectionState.Connecting) {
      this.logger.log('SignalR connection attempt already in progress');
      return;
    }

    try {
      this.isManuallyDisconnected = false;
      await this.connection.start();
      this.reconnectAttempts = 0;
      this.logger.log('SignalR connection started successfully');
    } catch (error) {
      this.logger.error('Error starting SignalR connection:', error);
      throw new Error(`Failed to start SignalR connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop the SignalR connection
   * @returns Promise that resolves when the connection is stopped
   */
  async stop(): Promise<void> {
    if (this.connection) {
      this.isManuallyDisconnected = true;
      await this.connection.stop();
      this.logger.log('SignalR connection stopped');
    }
  }

  /**
   * Gets the SignalR connection ID which serves as the session ID
   * @returns The connection ID or null if not connected
   */
  getConnectionId(): string | null {
    return this.connection?.connectionId || null;
  }

  /**
   * Check if the connection is active
   * @returns True if connected, false otherwise
   */
  get isConnected(): boolean {
    return this.connection?.state === signalR.HubConnectionState.Connected;
  }

  /**
   * Get the current connection state
   * @returns The current SignalR connection state
   */
  get connectionState(): signalR.HubConnectionState | null {
    return this.connection?.state || null;
  }

  /**
   * Send a ping to test the connection
   * @returns Promise that resolves with the server response
   */
  async ping(): Promise<string> {
    if (!this.connection || this.connection.state !== signalR.HubConnectionState.Connected) {
      throw new Error('SignalR connection not available');
    }

    try {
      const response = await this.connection.invoke('Ping');
      return response;
    } catch (error) {
      this.logger.error('Error sending ping:', error);
      throw error;
    }
  }

  /**
   * Dispose of the service and clean up resources
   */
  dispose(): void {
    this.isManuallyDisconnected = true;
    if (this.connection) {
      this.connection.stop().catch(error => {
        this.logger.error('Error stopping connection during disposal:', error);
      });
      this.connection = null;
    }
  }

  /**
   * Setup SignalR connection with event handlers
   * @private
   */
  private setupConnection(): void {
    const hubUrl = new URL(this.config.hubPath, this.serverUrl).toString();
    
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        transport: this.mapTransportType(this.config.transportTypes)
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Exponential backoff with jitter
          const delay = Math.min(
            this.config.baseRetryDelayMs * Math.pow(2, retryContext.previousRetryCount),
            30000 // Max 30 seconds
          );
          return delay + Math.random() * 1000; // Add jitter
        }
      })
      .configureLogging(this.mapLogLevel(this.config.logLevel))
      .build();

    this.setupEventHandlers();
  }

  /**
   * Setup SignalR event handlers
   * @private
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    // Listen for tool invocation requests from the server
    this.connection.on('InvokeTool', async (toolName: string, toolArguments: unknown): Promise<CallToolResult> => {
      this.logger.log(`Received tool invocation request: ${toolName}`, { arguments: toolArguments });
      
      try {
        return await this.invokeTool(toolName, toolArguments);
      } catch (error) {
        this.logger.error('Error executing tool:', error);
        return createErrorResult(error instanceof Error ? error : new Error(String(error)));
      }
    });

    // Listen for tool discovery requests from the server
    this.connection.on('GetTools', (): string => {
      this.logger.log('Received tools discovery request from server');
      
      try {
        const toolsJson = this.toolRegistry.getToolsAsJson();
        this.logger.log(`Returning ${JSON.parse(toolsJson).length} tools to server`);
        return toolsJson;
      } catch (error) {
        this.logger.error('Error getting tools for discovery:', error);
        return '[]';
      }
    });

    // Connection lifecycle events
    this.connection.onclose((error) => {
      if (error) {
        this.logger.error('SignalR connection closed with error:', error);
      } else {
        this.logger.log('SignalR connection closed');
      }
      
      if (!this.isManuallyDisconnected) {
        this.scheduleReconnect();
      }
    });

    this.connection.onreconnecting((error) => {
      this.logger.warn('SignalR reconnecting...', error);
    });

    this.connection.onreconnected((connectionId) => {
      this.logger.log(`SignalR reconnected with ID: ${connectionId}`);
      this.reconnectAttempts = 0;
    });
  }

  /**
   * Invoke a tool using the MCP controller
   * @private
   */
  private async invokeTool(toolName: string, params: unknown = {}): Promise<CallToolResult> {
    if (!this.mcpController) {
      throw new Error('MCP Controller not set. Call setMCPController() first.');
    }

    // Validate and sanitize parameters
    const sanitizedParams = this.sanitizeParameters(params);

    const toolConfig: ToolStartConfig = {
      toolId: toolName,
      params: sanitizedParams
    };

    try {
      const results = await this.mcpController.start([toolConfig]);
      
      // Return the first result (since we're only starting one tool)
      const result = results[0];
      if (!result) {
        return createErrorResult(new Error('No result returned from tool execution'));
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Tool execution failed for ${toolName}:`, error);
      return createErrorResult(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Sanitize parameters to ensure they are safe and valid
   * @private
   */
  private sanitizeParameters(params: unknown): Record<string, unknown> {
    if (params === null || params === undefined) {
      return {};
    }

    if (typeof params === 'object' && !Array.isArray(params)) {
      return params as Record<string, unknown>;
    }

    this.logger.warn('Invalid parameters type, using empty object:', typeof params);
    return {};
  }

  /**
   * Schedule a reconnect attempt with exponential backoff
   * @private
   */
  private async scheduleReconnect(): Promise<void> {
    if (this.isManuallyDisconnected || this.reconnectAttempts >= this.config.maxRetryAttempts) {
      this.logger.error(`Max reconnection attempts (${this.config.maxRetryAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.baseRetryDelayMs * Math.pow(2, this.reconnectAttempts - 1);
    
    this.logger.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      if (!this.isManuallyDisconnected) {
        try {
          await this.start();
        } catch (error) {
          this.logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error);
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Creates a silent logger that doesn't output anything
   * @private
   */
  private createSilentLogger(): Pick<Console, 'log' | 'error' | 'warn' | 'info'> {
    const silentFunction = () => {};
    return {
      log: silentFunction,
      error: silentFunction,
      warn: silentFunction,
      info: silentFunction
    };
  }
}

// Legacy alias for backward compatibility
export { WebInteractSignalRService as MCPSignalRService };
