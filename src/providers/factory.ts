/**
 * Provider factory - creates the appropriate LLM provider based on configuration.
 */
import { ILLMProvider, ProviderType } from '../types';
import { ConfigManager } from '../config';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export function createProvider(providerType: ProviderType, configManager: ConfigManager): ILLMProvider {
    switch (providerType) {
        case 'anthropic':
            return new AnthropicProvider(configManager);
        case 'openai':
        case 'ollama':
        default:
            return new OpenAIProvider(configManager);
    }
}
