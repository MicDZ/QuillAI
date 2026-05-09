/**
 * OpenAI-compatible LLM provider.
 * Works with OpenAI API and Ollama (which mimics OpenAI's API).
 */
import { ILLMProvider, LintIssue } from '../types';
import { ConfigManager } from '../config';
import { logger } from '../logger';

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
                { role: 'user', content: `Analyze the following text. Each line is prefixed with its 1-based line number and a pipe delimiter (N|). Detect all issues according to the diagnostic scope defined above.\n\nIMPORTANT: When writing your response, the \`original\` field must be the exact substring from the line AFTER the pipe (|). Do NOT include the line number prefix.\n\n${text}` }
            ],
            temperature: 0.1,
            max_tokens: 16384,
            response_format: { type: 'json_object' }
        };

        try {
            logger.info(`[OpenAI] Sending ${text.length} chars to ${config.model} at ${endpoint}...`);
            const startTime = Date.now();

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeout);
            logger.info(`[OpenAI] Response received in ${Date.now() - startTime}ms, status=${response.status}`);

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
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error(`OpenAI API timeout: request took too long (>120s). Try reducing document size.`);
            }
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
            const rawIssues: unknown[] = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);

            logger.info(`[QuillAI] LLM returned ${rawIssues.length} raw issues`);

            // Normalize and validate issues (tolerate string-typed numbers)
            const issues = rawIssues
                .map((issue) => this.normalizeIssue(issue))
                .filter((issue): issue is LintIssue => issue !== null);

            logger.info(`[QuillAI] ${issues.length} issues passed validation`);
            return issues;
        } catch {
            // Try to recover from truncated JSON responses
            const recovered = this.tryRecoverTruncatedJson(content);
            if (recovered.length > 0) {
                logger.info(`[QuillAI] Recovered ${recovered.length} issues from truncated response`);
                return recovered;
            }
            logger.info(`[QuillAI] Failed to parse LLM response: ${content.substring(0, 500)}`);
            return [];
        }
    }

    /**
     * Normalize an issue object: coerce string-typed numbers to actual numbers,
     * fill in defaults for missing severity, etc.
     */
    private normalizeIssue(issue: unknown): LintIssue | null {
        if (!issue || typeof issue !== 'object') {
            return null;
        }
        const obj = issue as Record<string, unknown>;

        // Coerce string numbers to actual numbers
        const line = typeof obj.line === 'string' ? parseInt(obj.line, 10) : obj.line;
        const startChar = typeof obj.startChar === 'string' ? parseInt(obj.startChar, 10) : obj.startChar;
        const endChar = typeof obj.endChar === 'string' ? parseInt(obj.endChar, 10) : obj.endChar;

        if (
            typeof line !== 'number' || isNaN(line) ||
            typeof startChar !== 'number' || isNaN(startChar) ||
            typeof endChar !== 'number' || isNaN(endChar) ||
            typeof obj.original !== 'string' ||
            typeof obj.replacement !== 'string' ||
            typeof obj.reason !== 'string'
        ) {
            logger.info(`[QuillAI] Rejected issue: ${JSON.stringify(obj)}`);
            return null;
        }

        const severity = (typeof obj.severity === 'string' && ['error', 'warning', 'info'].includes(obj.severity))
            ? obj.severity as 'error' | 'warning' | 'info'
            : 'warning';

        return { line, startChar, endChar, original: obj.original, replacement: obj.replacement, reason: obj.reason, severity };
    }

    /**
     * Attempt to recover valid issues from a truncated JSON response.
     * When the LLM's output is cut off mid-JSON, we try to extract
     * any complete issue objects from the partial output.
     */
    private tryRecoverTruncatedJson(content: string): LintIssue[] {
        try {
            let jsonStr = content.trim();
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1].trim();
            }

            // Find all complete issue objects by matching balanced braces
            const issues: LintIssue[] = [];
            let depth = 0;
            let start = -1;

            for (let i = 0; i < jsonStr.length; i++) {
                if (jsonStr[i] === '{') {
                    if (depth === 0) {
                        start = i;
                    }
                    depth++;
                } else if (jsonStr[i] === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        const candidate = jsonStr.substring(start, i + 1);
                        try {
                            const obj = JSON.parse(candidate);
                            const normalized = this.normalizeIssue(obj);
                            if (normalized) {
                                issues.push(normalized);
                            }
                        } catch {
                            // Not a valid JSON object, skip
                        }
                        start = -1;
                    }
                }
            }

            return issues;
        } catch {
            return [];
        }
    }
}
