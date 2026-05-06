/**
 * Diagnostics manager for QuillAI.
 * Converts LLM-found issues into VS Code diagnostics with wavy underlines.
 */
import * as vscode from 'vscode';
import { LintIssue } from './types';

export class DiagnosticManager {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('quillai');
    }

    /**
     * Map a severity string to VS Code DiagnosticSeverity.
     */
    private mapSeverity(
        severity: string | undefined,
        defaultSeverity: 'error' | 'warning' | 'information' | 'hint'
    ): vscode.DiagnosticSeverity {
        const sev = severity?.toLowerCase() ?? defaultSeverity;
        switch (sev) {
            case 'error':
                return vscode.DiagnosticSeverity.Error;
            case 'warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'info':
            case 'information':
                return vscode.DiagnosticSeverity.Information;
            case 'hint':
                return vscode.DiagnosticSeverity.Hint;
            default:
                return vscode.DiagnosticSeverity[defaultSeverity.charAt(0).toUpperCase() + defaultSeverity.slice(1) as keyof typeof vscode.DiagnosticSeverity]
                    ?? vscode.DiagnosticSeverity.Warning;
        }
    }

    /**
     * Validate and fix a LintIssue against the actual document text.
     * 
     * Strategy: Never trust the AI's startChar/endChar. Instead, use `original`
     * as the search key to find the real position in the document. This is far
     * more reliable because the AI often miscalculates character offsets
     * (especially when line numbers are prepended to the sent text).
     * 
     * Steps:
     * 1. Try exact match of `original` on the reported line → use it directly
     * 2. Try exact match on the reported line after stripping a leading line-number
     *    prefix the AI may have accidentally included (e.g. "1|Hello")
     * 3. Try a fuzzy search on the reported line: if `original` is a substring
     *    of the line (or the line is a substring of `original`), find the overlap
     * 4. Search adjacent lines (±2) in case the AI got the line number wrong
     * 5. As a last resort, search the entire document
     * 6. Discard the issue if nothing matches
     */
    private validateIssue(
        issue: LintIssue,
        document: vscode.TextDocument
    ): LintIssue | null {
        // 1-based line to 0-based
        const line = Math.max(0, issue.line - 1);

        // Check if original is empty — can't validate, discard
        if (!issue.original || issue.original.trim().length === 0) {
            return null;
        }

        // Check if replacement would change meaning (too large a change)
        // Reject if replacement is more than 3x the length of original (likely a rewrite, not a fix)
        if (issue.replacement.length > issue.original.length * 3 + 20) {
            return null;
        }

        // Clean the `original` field: the AI sometimes includes the line-number
        // prefix (e.g. "1|Hello world") or has extra whitespace.
        let cleanedOriginal = issue.original;
        const lineNumPrefix = cleanedOriginal.match(/^\d+\|/);
        if (lineNumPrefix) {
            cleanedOriginal = cleanedOriginal.substring(lineNumPrefix[0].length);
        }

        // --- Step 1-3: Search on the reported line ---
        if (line < document.lineCount) {
            const result = this.findOnLine(document, line, cleanedOriginal);
            if (result) {
                return { ...issue, original: result.match, startChar: result.start, endChar: result.end };
            }
        }

        // --- Step 4: Search adjacent lines (±2) ---
        for (const offset of [-1, 1, -2, 2]) {
            const adjLine = line + offset;
            if (adjLine < 0 || adjLine >= document.lineCount) { continue; }
            const result = this.findOnLine(document, adjLine, cleanedOriginal);
            if (result) {
                return { ...issue, line: adjLine + 1, original: result.match, startChar: result.start, endChar: result.end };
            }
        }

        // --- Step 5: Search the entire document ---
        for (let i = 0; i < document.lineCount; i++) {
            if (i >= line - 2 && i <= line + 2) { continue; } // already checked
            const result = this.findOnLine(document, i, cleanedOriginal);
            if (result) {
                return { ...issue, line: i + 1, original: result.match, startChar: result.start, endChar: result.end };
            }
        }

        // --- Step 6: Could not find `original` anywhere — discard ---
        return null;
    }

    /**
     * Try to find `original` on a specific line using multiple strategies.
     * Returns the match position and the matched text, or null if not found.
     */
    private findOnLine(
        document: vscode.TextDocument,
        lineIndex: number,
        original: string
    ): { start: number; end: number; match: string } | null {
        const lineText = document.lineAt(lineIndex).text;

        // Strategy A: Exact substring match
        const idx = lineText.indexOf(original);
        if (idx !== -1) {
            return { start: idx, end: idx + original.length, match: original };
        }

        // Strategy B: Trimmed match
        const trimmed = original.trim();
        if (trimmed.length > 0 && trimmed !== original) {
            const trimIdx = lineText.indexOf(trimmed);
            if (trimIdx !== -1) {
                return { start: trimIdx, end: trimIdx + trimmed.length, match: trimmed };
            }
        }

        // Strategy C: The AI may have included a trailing/leading character that
        // doesn't match. Try matching the "core" of the original by stripping
        // one char from each end and searching.
        if (original.length > 3) {
            const shorter = original.substring(1, original.length - 1);
            const shortIdx = lineText.indexOf(shorter);
            if (shortIdx !== -1) {
                // Expand to find the actual boundaries by checking what's around
                // the match and trying to match more of the original
                return { start: shortIdx, end: shortIdx + shorter.length, match: shorter };
            }
        }

        return null;
    }

    /**
     * Convert LintIssues to VS Code Diagnostics and apply them to a document.
     */
    updateDiagnostics(
        document: vscode.TextDocument,
        issues: LintIssue[],
        defaultSeverity: 'error' | 'warning' | 'information' | 'hint'
    ): void {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const rawIssue of issues) {
            // Validate and auto-correct the issue against actual document text
            const issue = this.validateIssue(rawIssue, document);
            if (!issue) {
                continue;
            }

            const line = Math.max(0, issue.line - 1);
            const lineText = document.lineAt(line).text;
            const startChar = Math.min(issue.startChar, lineText.length);
            const endChar = Math.min(issue.endChar, lineText.length);

            if (startChar >= endChar) {
                continue;
            }

            const range = new vscode.Range(line, startChar, line, endChar);
            const severity = this.mapSeverity(issue.severity, defaultSeverity);

            const diagnostic = new vscode.Diagnostic(
                range,
                `${issue.reason}\n\nSuggestion: "${issue.replacement}"`,
                severity
            );

            diagnostic.source = 'QuillAI';
            diagnostic.code = 'prose-issue';

            // Store the corrected issue data on the diagnostic for use by CodeActions
            (diagnostic as unknown as Record<string, unknown>).lintIssue = issue;

            diagnostics.push(diagnostic);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * Clear diagnostics for a specific document.
     */
    clearDiagnostics(uri: vscode.Uri): void {
        this.diagnosticCollection.delete(uri);
    }

    /**
     * Clear all diagnostics.
     */
    clearAll(): void {
        this.diagnosticCollection.clear();
    }

    /**
     * Get the diagnostic collection (for use with CodeAction providers).
     */
    getCollection(): vscode.DiagnosticCollection {
        return this.diagnosticCollection;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
