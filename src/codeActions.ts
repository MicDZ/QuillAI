/**
 * CodeAction provider for QuillAI.
 * Provides Quick Fixes when users click on diagnostic wavy underlines.
 */
import * as vscode from 'vscode';
import { LintIssue } from './types';

export class ProseCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    private parseReplacementFromMessage(message: string): string | null {
        // Diagnostic message format (from DiagnosticManager):
        // `${reason}\n\nSuggestion: "${replacement}"`
        const marker = 'Suggestion:';
        const idx = message.lastIndexOf(marker);
        if (idx === -1) {
            return null;
        }
        let rest = message.slice(idx + marker.length).trim();
        // rest is expected to be: "..." (quoted)
        if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
            rest = rest.slice(1, -1);
        }
        return rest.length > 0 ? rest : null;
    }

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'QuillAI') {
                continue;
            }

            const embeddedIssue = (diagnostic as unknown as { lintIssue?: LintIssue }).lintIssue;
            const replacementFromMessage = this.parseReplacementFromMessage(diagnostic.message);
            const replacement = embeddedIssue?.replacement ?? replacementFromMessage;
            if (!replacement) {
                continue;
            }

            const fixRange = new vscode.Range(
                diagnostic.range.start.line,
                diagnostic.range.start.character,
                diagnostic.range.end.line,
                diagnostic.range.end.character
            );

            const originalText = document.getText(fixRange);
            const issue: LintIssue = embeddedIssue ?? {
                line: diagnostic.range.start.line + 1,
                startChar: diagnostic.range.start.character,
                endChar: diagnostic.range.end.character,
                original: originalText,
                replacement,
                reason: diagnostic.message,
                severity: 'warning',
            };

            // 1. Quick Fix - Apply the suggestion
            const fixAction = new vscode.CodeAction(
                `Fix: "${issue.original}" → "${issue.replacement}"`,
                vscode.CodeActionKind.QuickFix
            );
            fixAction.diagnostics = [diagnostic];
            fixAction.isPreferred = true;

            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fixRange, issue.replacement);
            fixAction.edit = edit;

            // Do NOT set fixAction.command — setting both edit and command
            // causes VS Code to apply the replacement twice, corrupting text.
            actions.push(fixAction);

            // 2. Diff Preview action
            const diffAction = new vscode.CodeAction(
                'Preview Diff',
                vscode.CodeActionKind.QuickFix
            );
            diffAction.diagnostics = [diagnostic];
            diffAction.command = {
                command: 'quillai.previewDiff',
                title: 'Preview Diff',
                arguments: [issue]
            };
            actions.push(diffAction);

            // 3. Ignore this rule
            const ignoreAction = new vscode.CodeAction(
                'Ignore this issue',
                vscode.CodeActionKind.QuickFix
            );
            ignoreAction.diagnostics = [diagnostic];
            ignoreAction.command = {
                command: 'quillai.ignoreIssue',
                title: 'Ignore Issue',
                arguments: [document.uri, diagnostic]
            };
            actions.push(ignoreAction);
        }

        return actions;
    }
}
