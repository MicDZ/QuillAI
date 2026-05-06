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

        // Only scan markdown and plaintext files
        if (document.languageId !== 'markdown' && document.languageId !== 'plaintext') {
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
            const { text } = this.extractText(document, config.maxChars);
            if (!text.trim()) {
                this.diagnosticManager.clearDiagnostics(document.uri);
                return [];
            }

            const provider = createProvider(config.provider, this.configManager);
            const systemPrompt = this.buildSystemPrompt(config.systemPrompt, config.language);
            const issues = await provider.analyze(text, systemPrompt);

            // Issues are returned with 1-based line numbers matching the numbered text.
            // No offset adjustment needed since line numbers are explicit in the sent text.
            this.diagnosticManager.updateDiagnostics(document, issues, config.diagnosticSeverity);
            return issues;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`QuillAI: ${message}`);
            return [];
        } finally {
            this.scanningDocuments.delete(uri);
        }
    }

    /**
     * Extract text from a document and add line numbers for the LLM.
     * Returns the numbered text and the line offset for paragraph extraction.
     */
    private extractText(document: vscode.TextDocument, maxChars: number): { text: string; lineOffset: number } {
        const fullText = document.getText();

        if (fullText.length <= maxChars) {
            return { text: this.addLineNumbers(document, 0, document.lineCount - 1), lineOffset: 0 };
        }

        // For large documents, extract the paragraph at the cursor
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
            // No active editor for this document, return the first chunk
            const endLine = this.findEndLineForCharLimit(document, 0, maxChars);
            return { text: this.addLineNumbers(document, 0, endLine), lineOffset: 0 };
        }

        const cursorLine = editor.selection.active.line;
        const { startLine, endLine } = this.extractParagraphRange(document, cursorLine, maxChars);
        return { text: this.addLineNumbers(document, startLine, endLine), lineOffset: startLine };
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
     * Find the last line that fits within the character limit.
     */
    private findEndLineForCharLimit(document: vscode.TextDocument, startLine: number, maxChars: number): number {
        let charCount = 0;
        let endLine = startLine;
        while (endLine < document.lineCount) {
            charCount += document.lineAt(endLine).text.length + 1; // +1 for newline
            if (charCount > maxChars) {
                break;
            }
            endLine++;
        }
        return Math.max(startLine, endLine - 1);
    }

    /**
     * Extract paragraph range around the given line number.
     * A paragraph is defined as a block of non-empty lines.
     */
    private extractParagraphRange(document: vscode.TextDocument, aroundLine: number, maxChars: number): { startLine: number; endLine: number } {
        const totalLines = document.lineCount;
        let startLine = aroundLine;
        let endLine = aroundLine;

        // Find the start of the paragraph (go up until we hit an empty line or beginning)
        while (startLine > 0) {
            const prevLine = document.lineAt(startLine - 1);
            if (prevLine.text.trim() === '') {
                break;
            }
            startLine--;
        }

        // Find the end of the paragraph (go down until we hit an empty line or end)
        while (endLine < totalLines - 1) {
            const nextLine = document.lineAt(endLine + 1);
            if (nextLine.text.trim() === '') {
                break;
            }
            endLine++;
        }

        // If paragraph is still too large, truncate
        let charCount = 0;
        for (let i = startLine; i <= endLine; i++) {
            charCount += document.lineAt(i).text.length + 1;
        }
        if (charCount > maxChars) {
            endLine = this.findEndLineForCharLimit(document, startLine, maxChars);
        }

        return { startLine, endLine };
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
