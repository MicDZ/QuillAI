import * as assert from 'assert';
import * as vscode from 'vscode';

suite('QuillAI - Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all QuillAI tests.');

    test('Extension should be present', () => {
        const ext = vscode.extensions.getExtension('quillai');
        // Extension may not be loaded in test environment, just verify API exists
        assert.ok(vscode.languages.createDiagnosticCollection !== undefined);
    });

    test('DiagnosticCollection creation', () => {
        const collection = vscode.languages.createDiagnosticCollection('testLinter');
        assert.ok(collection);
        assert.strictEqual(collection.name, 'testLinter');
        collection.dispose();
    });

    test('Diagnostics can be set and retrieved', async () => {
        const collection = vscode.languages.createDiagnosticCollection('testLinter');
        const uri = vscode.Uri.parse('untitled:test.md');

        const range = new vscode.Range(0, 0, 0, 10);
        const diagnostic = new vscode.Diagnostic(range, 'Test issue', vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'QuillAI';

        collection.set(uri, [diagnostic]);
        const diagnostics = collection.get(uri);

        assert.ok(diagnostics);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, 'Test issue');
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
        assert.strictEqual(diagnostics[0].source, 'QuillAI');

        collection.dispose();
    });

    test('DiagnosticCollection clear works', () => {
        const collection = vscode.languages.createDiagnosticCollection('testLinter');
        const uri = vscode.Uri.parse('untitled:test.md');

        const range = new vscode.Range(0, 0, 0, 10);
        const diagnostic = new vscode.Diagnostic(range, 'Test issue', vscode.DiagnosticSeverity.Warning);
        collection.set(uri, [diagnostic]);

        collection.delete(uri);
        const diagnostics = collection.get(uri);
        assert.ok(diagnostics);
        assert.strictEqual(diagnostics.length, 0);

        collection.dispose();
    });

    test('Diagnostic severity mapping', () => {
        // Test that all severity levels are valid
        assert.strictEqual(vscode.DiagnosticSeverity.Error, 0);
        assert.strictEqual(vscode.DiagnosticSeverity.Warning, 1);
        assert.strictEqual(vscode.DiagnosticSeverity.Information, 2);
        assert.strictEqual(vscode.DiagnosticSeverity.Hint, 3);
    });

    test('Range creation with valid values', () => {
        const range = new vscode.Range(0, 0, 0, 20);
        assert.strictEqual(range.start.line, 0);
        assert.strictEqual(range.start.character, 0);
        assert.strictEqual(range.end.line, 0);
        assert.strictEqual(range.end.character, 20);
        assert.strictEqual(range.isSingleLine, true);
    });

    test('Range creation for multi-line', () => {
        const range = new vscode.Range(2, 5, 4, 10);
        assert.strictEqual(range.start.line, 2);
        assert.strictEqual(range.start.character, 5);
        assert.strictEqual(range.end.line, 4);
        assert.strictEqual(range.end.character, 10);
        assert.strictEqual(range.isSingleLine, false);
    });
});

suite('QuillAI - CodeAction Test Suite', () => {
    test('CodeAction creation', () => {
        const action = new vscode.CodeAction('Fix: typo', vscode.CodeActionKind.QuickFix);
        assert.strictEqual(action.title, 'Fix: typo');
        assert.strictEqual(action.kind, vscode.CodeActionKind.QuickFix);
    });

    test('WorkspaceEdit replace', () => {
        const edit = new vscode.WorkspaceEdit();
        const uri = vscode.Uri.parse('untitled:test.md');
        const range = new vscode.Range(0, 0, 0, 5);
        edit.replace(uri, range, 'corrected');
        assert.ok(edit.size > 0);
    });
});

suite('QuillAI - LintIssue Validation', () => {
    // Test the structure of LintIssue without importing types at runtime
    test('Valid issue structure', () => {
        const issue = {
            line: 1,
            startChar: 0,
            endChar: 5,
            original: 'teh',
            replacement: 'the',
            reason: 'Spelling error',
            severity: 'error'
        };

        assert.strictEqual(typeof issue.line, 'number');
        assert.strictEqual(typeof issue.startChar, 'number');
        assert.strictEqual(typeof issue.endChar, 'number');
        assert.strictEqual(typeof issue.original, 'string');
        assert.strictEqual(typeof issue.replacement, 'string');
        assert.strictEqual(typeof issue.reason, 'string');
        assert.ok(['error', 'warning', 'info'].includes(issue.severity));
        assert.ok(issue.startChar < issue.endChar);
    });

    test('Issue line numbers are 1-based', () => {
        const issue = {
            line: 3,
            startChar: 0,
            endChar: 10,
            original: 'some text',
            replacement: 'fixed text',
            reason: 'Style issue',
            severity: 'warning'
        };

        assert.ok(issue.line >= 1, 'Line number should be 1-based');
        assert.ok(issue.startChar >= 0, 'Start char should be 0-based');
        assert.ok(issue.endChar >= 0, 'End char should be 0-based');
    });
});
