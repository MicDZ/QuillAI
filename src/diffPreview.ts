/**
 * Diff preview utility for QuillAI.
 * Shows a side-by-side comparison of original text and suggested replacement.
 */
import * as vscode from 'vscode';
import { LintIssue } from './types';

export class DiffPreview {
    /**
     * Show a diff preview for a single lint issue.
     * Opens an untitled diff editor showing original vs. suggested fix.
     */
    static async showDiff(issue: LintIssue): Promise<void> {
        // Create the original document
        const originalDoc = await vscode.workspace.openTextDocument({
            content: issue.original,
            language: 'plaintext',
        });

        // Create the replacement document
        const replacementDoc = await vscode.workspace.openTextDocument({
            content: issue.replacement,
            language: 'plaintext',
        });

        // Show the diff
        const title = `AI Fix: ${issue.reason}`;
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalDoc.uri,
            replacementDoc.uri,
            title,
            { preview: true }
        );
    }

    /**
     * Show a summary of all issues found in a document via information message.
     */
    static showSummary(issues: LintIssue[]): void {
        if (issues.length === 0) {
            vscode.window.showInformationMessage('QuillAI: No issues found! ✨');
            return;
        }

        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warningCount = issues.filter(i => i.severity === 'warning').length;
        const infoCount = issues.filter(i => i.severity === 'info').length;

        const parts: string[] = [];
        if (errorCount > 0) { parts.push(`${errorCount} error(s)`); }
        if (warningCount > 0) { parts.push(`${warningCount} warning(s)`); }
        if (infoCount > 0) { parts.push(`${infoCount} info`); }

        vscode.window.showInformationMessage(
            `QuillAI: Found ${issues.length} issue(s) — ${parts.join(', ')}`
        );
    }
}
