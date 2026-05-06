/**
 * QuillAI - VS Code Extension
 * 
 * Non-invasive AI-powered grammar, spelling, and style checker
 * for Markdown and plaintext files.
 */
import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { DiagnosticManager } from './diagnostics';
import { ProseScanner } from './scanner';
import { ProseCodeActionProvider } from './codeActions';
import { DiffPreview } from './diffPreview';
import { LintIssue, ProviderType } from './types';

let configManager: ConfigManager;
let diagnosticManager: DiagnosticManager;
let scanner: ProseScanner;

export function activate(context: vscode.ExtensionContext) {
    console.log('QuillAI is now active!');

    // Initialize core components
    configManager = new ConfigManager(context);
    diagnosticManager = new DiagnosticManager();
    scanner = new ProseScanner(configManager, diagnosticManager);

    // ── Register Commands ──────────────────────────────────────

    // Command: Set API Key (with base_url prompt first, then model selection)
    const setApiKeyCmd = vscode.commands.registerCommand('quillai.setApiKey', async () => {
        const provider = vscode.workspace.getConfiguration('quillai').get<ProviderType>('provider', 'openai');
        const defaultBaseUrl = ConfigManager.getDefaultBaseUrl(provider);

        // Step 1: Ask for base URL
        const baseUrl = await vscode.window.showInputBox({
            prompt: `Enter the API base URL for ${provider} (e.g. ${defaultBaseUrl})`,
            placeHolder: defaultBaseUrl,
            value: defaultBaseUrl,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Base URL cannot be empty';
                }
                try {
                    new URL(value.trim());
                } catch {
                    return 'Please enter a valid URL';
                }
                return null;
            }
        });

        // If user pressed Escape, cancel the whole flow
        if (baseUrl === undefined) {
            return;
        }

        const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
        await vscode.workspace.getConfiguration('quillai').update(
            'endpoint', trimmedBaseUrl, vscode.ConfigurationTarget.Global
        );

        // Step 2: Ask for API Key
        const apiKey = await vscode.window.showInputBox({
            prompt: `Enter your API key for ${provider}`,
            password: true,
            placeHolder: 'sk-... or your API key',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API Key cannot be empty';
                }
                return null;
            }
        });

        if (!apiKey) {
            return;
        }
        await configManager.setApiKey(provider, apiKey.trim());
        vscode.window.showInformationMessage(`QuillAI: API key stored securely for ${provider}.`);

        // Step 3: Fetch available models and let user select
        const currentBaseUrl = trimmedBaseUrl;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'QuillAI: Fetching available models...',
                cancellable: false,
            },
            async () => {
                try {
                    const models = await fetchAvailableModels(currentBaseUrl, apiKey.trim(), provider);

                    if (models.length === 0) {
                        vscode.window.showWarningMessage('QuillAI: No models found from the API. You can set the model name manually in settings.');
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(models, {
                        placeHolder: 'Select the model to use for prose checking',
                        title: 'QuillAI: Choose Model',
                    });

                    if (selected) {
                        await vscode.workspace.getConfiguration('quillai').update(
                            'model', selected, vscode.ConfigurationTarget.Global
                        );
                        vscode.window.showInformationMessage(`QuillAI: Model set to "${selected}".`);
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    vscode.window.showWarningMessage(
                        `QuillAI: Failed to fetch models (${msg}). You can set the model name manually in settings.`
                    );
                }
            }
        );
    });

    // Command: Check Current Document (manual trigger)
    const checkDocCmd = vscode.commands.registerCommand('quillai.checkDocument', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('QuillAI: No active editor found.');
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'markdown' && document.languageId !== 'plaintext') {
            vscode.window.showWarningMessage('QuillAI: Current file is not Markdown or Plaintext.');
            return;
        }

        // Show progress while scanning
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'QuillAI: Scanning document...',
                cancellable: false,
            },
            async () => {
                const issues = await scanner.scanDocument(document);
                DiffPreview.showSummary(issues);
            }
        );
    });

    // Command: Clear All Diagnostics
    const clearDiagCmd = vscode.commands.registerCommand('quillai.clearDiagnostics', () => {
        diagnosticManager.clearAll();
        vscode.window.showInformationMessage('QuillAI: All diagnostics cleared.');
    });

    // Command: Preview Diff (called from CodeActions)
    const previewDiffCmd = vscode.commands.registerCommand('quillai.previewDiff', (issue: LintIssue) => {
        DiffPreview.showDiff(issue);
    });

    // Command: Apply Fix (called from CodeActions)
    const applyFixCmd = vscode.commands.registerCommand(
        'quillai.applyFix',
        async (uri: vscode.Uri, range: vscode.Range, replacement: string) => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, range, replacement);
            await vscode.workspace.applyEdit(edit);
        }
    );

    // Command: Ignore Issue (remove a specific diagnostic)
    const ignoreIssueCmd = vscode.commands.registerCommand(
        'quillai.ignoreIssue',
        (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
            const collection = diagnosticManager.getCollection();
            const existing = collection.get(uri);
            if (existing) {
                const filtered = existing.filter(d => d !== diagnostic);
                collection.set(uri, filtered);
            }
        }
    );

    // ── Register Code Action Provider ──────────────────────────

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        [
            { scheme: 'file', language: 'markdown' },
            { scheme: 'file', language: 'plaintext' },
        ],
        new ProseCodeActionProvider(),
        {
            providedCodeActionKinds: ProseCodeActionProvider.providedCodeActionKinds,
        }
    );

    // ── Register Event Listeners ───────────────────────────────

    // Debounced scan on text change
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
        const document = event.document;
        if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
            scanner.triggerScan(document);
        }
    });

    // Scan when a document is opened
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
            scanner.triggerScan(document);
        }
    });

    // Clear diagnostics when a document is closed
    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
        diagnosticManager.clearDiagnostics(document.uri);
    });

    // Re-scan when the active editor changes (for paragraph-based scanning)
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            const document = editor.document;
            if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
                scanner.triggerScan(document);
            }
        }
    });

    // Re-scan when configuration changes
    const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('quillai')) {
            // Re-scan all open documents with new settings
            vscode.workspace.textDocuments.forEach((document) => {
                if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
                    scanner.triggerScan(document);
                }
            });
        }
    });

    // ── Subscribe All Disposables ──────────────────────────────

    context.subscriptions.push(
        setApiKeyCmd,
        checkDocCmd,
        clearDiagCmd,
        previewDiffCmd,
        applyFixCmd,
        ignoreIssueCmd,
        codeActionProvider,
        onDidChangeTextDocument,
        onDidOpenTextDocument,
        onDidCloseTextDocument,
        onDidChangeActiveTextEditor,
        onDidChangeConfiguration,
        { dispose: () => scanner.dispose() },
        { dispose: () => diagnosticManager.dispose() }
    );

    // ── Initial Scan of Open Documents ─────────────────────────

    // Scan any already-open documents
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
            scanner.triggerScan(document);
        }
    });

    // ── Status Bar Item ────────────────────────────────────────

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(checklist) QuillAI';
    statusBarItem.tooltip = 'QuillAI - Click to check document';
    statusBarItem.command = 'quillai.checkDocument';
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

/**
 * Fetch available models from an OpenAI-compatible /v1/models endpoint.
 * @param baseUrl - The base URL (e.g. https://api.openai.com/v1), WITHOUT trailing path.
 */
async function fetchAvailableModels(baseUrl: string, apiKey: string, provider: ProviderType): Promise<string[]> {
    let modelsUrl = baseUrl.replace(/\/+$/, '') + '/models';

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    // Anthropic uses x-api-key header; others use Bearer token
    if (provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(modelsUrl, { method: 'GET', headers });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
        data?: Array<{ id?: string; name?: string }>;
    };

    if (!data.data || !Array.isArray(data.data)) {
        return [];
    }

    // Extract model IDs and sort alphabetically
    const models = data.data
        .map(m => m.id || m.name || '')
        .filter(id => id.length > 0)
        .sort();

    return models;
}

export function deactivate() {
    scanner?.dispose();
    diagnosticManager?.dispose();
}
