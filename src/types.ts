/**
 * Type definitions for QuillAI
 */

/**
 * Represents a single issue found by the LLM.
 */
export interface LintIssue {
    /** 1-based line number */
    line: number;
    /** 0-based start character offset within the line */
    startChar: number;
    /** 0-based end character offset within the line */
    endChar: number;
    /** The original problematic text */
    original: string;
    /** The suggested replacement text */
    replacement: string;
    /** Brief explanation of the issue */
    reason: string;
    /** Severity: error, warning, or info */
    severity: 'error' | 'warning' | 'info';
}

/**
 * Supported LLM providers.
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama';

/**
 * Configuration for the extension, read from VS Code settings.
 */
export interface LinterConfig {
    provider: ProviderType;
    model: string;
    endpoint: string;
    apiKey: string;
    debounceMs: number;
    maxChars: number;
    systemPrompt: string;
    enabled: boolean;
    diagnosticSeverity: 'error' | 'warning' | 'information' | 'hint';
    language: string;
}

/**
 * Response from an LLM provider.
 */
export interface ProviderResponse {
    issues: LintIssue[];
    rawResponse?: string;
    error?: string;
}

/**
 * Interface for LLM providers.
 */
export interface ILLMProvider {
    /**
     * Analyze text and return issues found.
     * @param text - The text to analyze
     * @param systemPrompt - The system prompt to use
     * @returns A list of lint issues
     */
    analyze(text: string, systemPrompt: string): Promise<LintIssue[]>;
}
