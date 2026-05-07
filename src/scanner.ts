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
    async scanDocument(document: vscode.TextDocument): Promise<LintIssue[]> {
        const uri = document.uri.toString();

        // Prevent concurrent scans of the same document
        if (this.scanningDocuments.has(uri)) {
            return [];
        }

        const config = await this.configManager.getConfig();
        if (!config.enabled) {
            return [];
        }

        this.scanningDocuments.add(uri);

        try {
            const chunks = this.splitIntoChunks(document, config.maxChars);
            if (chunks.length === 0) {
                this.diagnosticManager.clearDiagnostics(document.uri);
                return [];
            }

            const provider = createProvider(config.provider, this.configManager);
            const systemPrompt = this.buildSystemPrompt(config.systemPrompt, config.language);

            const allIssues: LintIssue[] = [];

            for (const chunk of chunks) {
                if (!chunk.text.trim()) {
                    continue;
                }
                const issues = await provider.analyze(chunk.text, systemPrompt);
                // Issues already have correct 1-based line numbers from the numbered text
                allIssues.push(...issues);
            }

            this.diagnosticManager.updateDiagnostics(document, allIssues, config.diagnosticSeverity);
            return allIssues;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`QuillAI: ${message}`);
            return [];
        } finally {
            this.scanningDocuments.delete(uri);
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
            en: 'English',
            zh: 'Chinese (中文)',
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
