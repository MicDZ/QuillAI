/**
 * Configuration manager for QuillAI.
 * Handles reading settings and managing API keys via SecretStorage.
 */
import * as vscode from 'vscode';
import { LinterConfig, ProviderType } from './types';

const SECRET_KEY_PREFIX = 'quillai.apiKey.';

export class ConfigManager {
    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Get the full linter configuration from VS Code settings + secret storage.
     */
    async getConfig(): Promise<LinterConfig> {
        const config = vscode.workspace.getConfiguration('quillai');
        const provider = config.get<ProviderType>('provider', 'openai');
        const apiKey = await this.getApiKey(provider);

        return {
            provider,
            model: config.get<string>('model', 'gpt-4o'),
            endpoint: config.get<string>('endpoint', ''),
            apiKey,
            debounceMs: config.get<number>('debounceMs', 1500),
            maxChars: config.get<number>('maxChars', 5000),
            systemPrompt: config.get<string>('systemPrompt', ''),
            enabled: config.get<boolean>('enabled', true),
            diagnosticSeverity: config.get<'error' | 'warning' | 'information' | 'hint'>('diagnosticSeverity', 'warning'),
            language: config.get<string>('language', 'auto'),
        };
    }

    /**
     * Store an API key securely in VS Code SecretStorage.
     */
    async setApiKey(provider: ProviderType, apiKey: string): Promise<void> {
        const secretKey = SECRET_KEY_PREFIX + provider;
        await this.context.secrets.store(secretKey, apiKey);
    }

    /**
     * Retrieve the API key for a given provider from SecretStorage.
     */
    async getApiKey(provider: ProviderType): Promise<string> {
        const secretKey = SECRET_KEY_PREFIX + provider;
        return (await this.context.secrets.get(secretKey)) ?? '';
    }

    /**
     * Get the default base URL for a provider.
     * This is the base URL WITHOUT the specific API path suffix.
     */
    static getDefaultBaseUrl(provider: ProviderType): string {
        switch (provider) {
            case 'openai':
                return 'https://api.openai.com/v1';
            case 'anthropic':
                return 'https://api.anthropic.com';
            case 'ollama':
                return 'http://localhost:11434/v1';
            default:
                return 'https://api.openai.com/v1';
        }
    }
}
