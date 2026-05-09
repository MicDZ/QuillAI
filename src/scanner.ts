/**
 * Scanner module for QuillAI.
 * Handles debounced background scanning and paragraph extraction.
 */
import * as vscode from 'vscode';
import { LintIssue } from './types';
import { ConfigManager } from './config';
import { createProvider } from './providers/factory';
import { DiagnosticManager } from './diagnostics';
import { DiffPreview } from './diffPreview';
import { logger } from './logger';

export class ProseScanner {
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private scanningDocuments: Set<string> = new Set();
    private configManager: ConfigManager;
    private diagnosticManager: DiagnosticManager;

    constructor(configManager: ConfigManager, diagnosticManager: DiagnosticManager) {
        this.configManager = configManager;
        this.diagnosticManager = diagnosticManager;
    }

    /**
     * Trigger a debounced scan for the given document.
     */
    triggerScan(document: vscode.TextDocument): void {
        const uri = document.uri.toString();

        // Only scan files matching configured language types
        const supportedLanguages = vscode.workspace.getConfiguration('quillai').get<string[]>('languages', ['markdown', 'plaintext', 'latex']);
        if (!supportedLanguages.includes(document.languageId)) {
            return;
        }

        // Clear existing debounce timer for this document
        const existingTimer = this.debounceTimers.get(uri);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new debounce timer
        const config = vscode.workspace.getConfiguration('quillai');
        const debounceMs = config.get<number>('debounceMs', 1500);

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(uri);
            await this.scanDocument(document);
        }, debounceMs);

        this.debounceTimers.set(uri, timer);
    }

    /**
     * Scan a document immediately (no debounce).
     * For documents larger than maxChars, splits into paragraph-based chunks
     * and scans each chunk to cover the entire document.
     */
    async scanDocument(
        document: vscode.TextDocument,
        options?: {
            /**
             * Called as chunks are processed. Useful for progress UI.
             * - stage='sending': right before sending to the LLM
             * - stage='done': chunk finished successfully
             * - stage='skip': chunk skipped (empty)
             * - stage='error': chunk failed
             */
            onChunkProgress?: (info: {
                chunkIndex: number; // 1-based
                totalChunks: number;
                stage: 'sending' | 'done' | 'skip' | 'error';
            }) => void;
        }
    ): Promise<LintIssue[]> {
        const uri = document.uri.toString();
        const fileName = document.fileName.split('/').pop() ?? 'unknown';

        // Prevent concurrent scans of the same document
        if (this.scanningDocuments.has(uri)) {
            logger.info(`[Scanner] SKIP (already scanning): ${fileName}`);
            return [];
        }

        const config = await this.configManager.getConfig();
        if (!config.enabled) {
            logger.info(`[Scanner] SKIP (disabled): ${fileName}`);
            return [];
        }

        this.scanningDocuments.add(uri);
        logger.info(`[Scanner] START scan: ${fileName} (${document.getText().length} chars, maxChars=${config.maxChars})`);

        try {
            const chunks = this.splitIntoChunks(document, config.maxChars);
            logger.info(`[Scanner] Split into ${chunks.length} chunk(s)`);

            if (chunks.length === 0) {
                this.diagnosticManager.clearDiagnostics(document.uri);
                return [];
            }

            const provider = createProvider(config.provider, this.configManager);
            const systemPrompt = this.buildSystemPrompt(config.systemPrompt, config.language);

            const allIssues: LintIssue[] = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (!chunk.text.trim()) {
                    logger.info(`[Scanner] Chunk ${i + 1}/${chunks.length}: empty, skipping`);
                    options?.onChunkProgress?.({
                        chunkIndex: i + 1,
                        totalChunks: chunks.length,
                        stage: 'skip',
                    });
                    continue;
                }
                logger.info(`[Scanner] Chunk ${i + 1}/${chunks.length}: ${chunk.text.length} chars, sending to LLM...`);
                options?.onChunkProgress?.({
                    chunkIndex: i + 1,
                    totalChunks: chunks.length,
                    stage: 'sending',
                });
                const startTime = Date.now();

                try {
                    const issues = await provider.analyze(chunk.text, systemPrompt);
                    logger.info(`[Scanner] Chunk ${i + 1}/${chunks.length}: got ${issues.length} issues in ${Date.now() - startTime}ms`);
                    allIssues.push(...issues);
                    options?.onChunkProgress?.({
                        chunkIndex: i + 1,
                        totalChunks: chunks.length,
                        stage: 'done',
                    });
                } catch (chunkErr) {
                    const msg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
                    logger.info(`[Scanner] Chunk ${i + 1}/${chunks.length} FAILED: ${msg}`);
                    options?.onChunkProgress?.({
                        chunkIndex: i + 1,
                        totalChunks: chunks.length,
                        stage: 'error',
                    });
                    // Continue with remaining chunks instead of aborting
                }
            }

            logger.info(`[Scanner] DONE: ${allIssues.length} total issues for ${fileName}`);
            this.diagnosticManager.updateDiagnostics(document, allIssues, config.diagnosticSeverity);
            return allIssues;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.info(`[Scanner] ERROR: ${message}`);
            vscode.window.showErrorMessage(`QuillAI: ${message}`);
            return [];
        } finally {
            this.scanningDocuments.delete(uri);
            logger.info(`[Scanner] Released scan lock: ${fileName}`);
        }
    }

    /**
     * Split a document into paragraph-based chunks that each fit within maxChars.
     * Each chunk is a numbered text string ready to send to the LLM.
     */
    private splitIntoChunks(document: vscode.TextDocument, maxChars: number): { text: string }[] {
        const totalLines = document.lineCount;
        if (totalLines === 0) {
            return [];
        }

        // Fast path: entire document fits in one chunk
        const fullText = document.getText();
        if (fullText.length <= maxChars) {
            return [{ text: this.addLineNumbers(document, 0, totalLines - 1) }];
        }

        // Split into paragraph-based chunks
        const chunks: { text: string }[] = [];
        let chunkStartLine = 0;

        while (chunkStartLine < totalLines) {
            let chunkEndLine = chunkStartLine;
            let charCount = 0;

            // Grow the chunk line by line until we exceed maxChars
            while (chunkEndLine < totalLines) {
                const lineLen = document.lineAt(chunkEndLine).text.length + 1; // +1 for newline
                if (charCount + lineLen > maxChars && chunkEndLine > chunkStartLine) {
                    // Try to break at a paragraph boundary (empty line) for cleaner splits
                    const breakLine = this.findParagraphBreak(document, chunkStartLine, chunkEndLine);
                    if (breakLine > chunkStartLine) {
                        chunkEndLine = breakLine;
                    }
                    break;
                }
                charCount += lineLen;
                chunkEndLine++;
            }

            // chunkEndLine is now exclusive (one past the last line in this chunk)
            const endLine = Math.min(chunkEndLine - 1, totalLines - 1);
            const text = this.addLineNumbers(document, chunkStartLine, endLine);
            if (text.trim()) {
                chunks.push({ text });
            }

            chunkStartLine = chunkEndLine;
        }

        return chunks;
    }

    /**
     * Find the best paragraph break (empty line) in a range for cleaner chunk splitting.
     * Searches backwards from the end of the range for an empty line.
     * Returns the line number after the empty line (start of next paragraph).
     */
    private findParagraphBreak(document: vscode.TextDocument, startLine: number, endLine: number): number {
        // Search backwards from endLine for an empty line
        for (let i = endLine - 1; i > startLine; i--) {
            if (document.lineAt(i).text.trim() === '') {
                return i + 1; // Start of the next paragraph
            }
        }
        return endLine; // No good break found, use the original end
    }

    /**
     * Add line numbers to extracted text in the format "N|text".
     * The line numbers are 1-based to match the LLM's expected output.
     */
    private addLineNumbers(document: vscode.TextDocument, startLine: number, endLine: number): string {
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            lines.push(`${i + 1}|${document.lineAt(i).text}`);
        }
        return lines.join('\n');
    }

    /**
     * Build the system prompt with language instruction.
     */
    private buildSystemPrompt(basePrompt: string, language: string): string {
        if (!language || language === 'auto') {
            return basePrompt;
        }

        const languageNames: Record<string, string> = {
            // English variants
            'en-US': 'English (United States / American English)',
            'en-GB': 'English (United Kingdom / British English)',
            en: 'English (generic)',

            // Chinese variants
            'zh-CN': 'Chinese (Simplified / 简体中文 - 中国大陆)',
            'zh-HK': 'Chinese (Traditional / 繁體中文 - 香港)',
            'zh-MO': 'Chinese (Traditional / 繁體中文 - 澳門)',
            'zh-SG': 'Chinese (Simplified / 简体中文 - 新加坡)',
            zh: 'Chinese (中文, generic)',

            ja: 'Japanese (日本語)',
            ko: 'Korean (한국어)',
            fr: 'French (Français)',
            de: 'German (Deutsch)',
            es: 'Spanish (Español)',
            pt: 'Portuguese (Português)',
            ru: 'Russian (Русский)',
            ar: 'Arabic (العربية)',
            it: 'Italian (Italiano)',
            nl: 'Dutch (Nederlands)',
            pl: 'Polish (Polski)',
            tr: 'Turkish (Türkçe)',
            vi: 'Vietnamese (Tiếng Việt)',
            th: 'Thai (ไทย)',
            id: 'Indonesian (Bahasa Indonesia)',
        };

        const languageName = languageNames[language] ?? language;
        return basePrompt + `\n\nIMPORTANT: The text you are proofreading is written in ${languageName}. Evaluate grammar, spelling, punctuation, and style according to the conventions of ${languageName}.`;
    }

    /**
     * Clear all debounce timers and scanning state.
     */
    dispose(): void {
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        this.scanningDocuments.clear();
    }
}
