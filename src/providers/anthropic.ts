/**
 * Anthropic (Claude) LLM provider.
 */
import * as vscode from 'vscode';
import { ILLMProvider, LintIssue } from '../types';
import { ConfigManager } from '../config';

export class AnthropicProvider implements ILLMProvider {
    constructor(
        private configManager: ConfigManager
    ) {}

    async analyze(text: string, systemPrompt: string): Promise<LintIssue[]> {
        const config = await this.configManager.getConfig();
        const baseUrl = (config.endpoint || ConfigManager.getDefaultBaseUrl('anthropic')).replace(/\/+$/, '');
        const endpoint = baseUrl + '/v1/messages';

        if (!config.apiKey) {
            throw new Error('API Key not configured for Anthropic. Use "QuillAI: Set API Key" command.');
        }

        const body = {
            model: config.model || 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
                { role: 'user', content: `Proofread the following text. Each line is prefixed with its 1-based line number and a pipe delimiter (N|). Find grammar, spelling, and punctuation errors only.\n\nIMPORTANT: When writing your response, the \`original\` field must be the exact substring from the line AFTER the pipe (|). Do NOT include the line number prefix. Do NOT rewrite text — only fix clear errors.\n\n${text}` }
            ],
            temperature: 0.1,
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed (${response.status}): ${errorText}`);
            }

            const data = await response.json() as {
                content?: Array<{ type?: string; text?: string }>;
            };

            const content = data.content?.[0]?.text;
            if (!content) {
                throw new Error('Empty response from Anthropic API');
            }

            return this.parseResponse(content);
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(`Anthropic API error: ${err.message}`);
            }
            throw err;
        }
    }

    private parseResponse(content: string): LintIssue[] {
        try {
            let jsonStr = content.trim();
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            const parsed = JSON.parse(jsonStr);
            const issues: LintIssue[] = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);

            return issues.filter((issue: unknown) => this.isValidIssue(issue));
        } catch {
            console.error('Failed to parse Anthropic response:', content);
            return [];
        }
    }

    private isValidIssue(issue: unknown): issue is LintIssue {
        if (!issue || typeof issue !== 'object') {
            return false;
        }
        const obj = issue as Record<string, unknown>;
        return (
            typeof obj.line === 'number' &&
            typeof obj.startChar === 'number' &&
            typeof obj.endChar === 'number' &&
            typeof obj.original === 'string' &&
            typeof obj.replacement === 'string' &&
            typeof obj.reason === 'string'
        );
    }
}
