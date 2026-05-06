/**
 * OpenAI-compatible LLM provider.
 * Works with OpenAI API and Ollama (which mimics OpenAI's API).
 */
import * as vscode from 'vscode';
import { ILLMProvider, LintIssue } from '../types';
import { ConfigManager } from '../config';

export class OpenAIProvider implements ILLMProvider {
    constructor(
        private configManager: ConfigManager
    ) {}

    async analyze(text: string, systemPrompt: string): Promise<LintIssue[]> {
        const config = await this.configManager.getConfig();
        const baseUrl = (config.endpoint || ConfigManager.getDefaultBaseUrl(config.provider)).replace(/\/+$/, '');
        const endpoint = baseUrl + '/chat/completions';

        if (!config.apiKey) {
            throw new Error(`API Key not configured for ${config.provider}. Use "QuillAI: Set API Key" command.`);
        }

        const body = {
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Proofread the following text. Each line is prefixed with its 1-based line number and a pipe delimiter (N|). Find grammar, spelling, and punctuation errors only.\n\nIMPORTANT: When writing your response, the \`original\` field must be the exact substring from the line AFTER the pipe (|). Do NOT include the line number prefix. Do NOT rewrite text — only fix clear errors.\n\n${text}` }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed (${response.status}): ${errorText}`);
            }

            const data = await response.json() as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                throw new Error('Empty response from API');
            }

            return this.parseResponse(content);
        } catch (err) {
            if (err instanceof Error) {
                throw new Error(`OpenAI API error: ${err.message}`);
            }
            throw err;
        }
    }

    protected parseResponse(content: string): LintIssue[] {
        try {
            // Try to extract JSON from the response (some models wrap it in markdown code blocks)
            let jsonStr = content.trim();
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            const parsed = JSON.parse(jsonStr);

            // Handle both { issues: [...] } and [...] formats
            const issues: LintIssue[] = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);

            return issues.filter((issue: unknown) => this.isValidIssue(issue));
        } catch {
            console.error('Failed to parse LLM response:', content);
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
