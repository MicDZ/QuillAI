/**
 * Shared debug logger for QuillAI.
 * Outputs to the "QuillAI Debug" Output Channel in VS Code.
 */
import * as vscode from 'vscode';

const channel: vscode.OutputChannel = (() => {
    // Prefer log channels when available so the Output dropdown reliably shows it
    // (and the channel is treated like other VS Code logs).
    try {
        const winAny = vscode.window as any;
        if (typeof winAny.createOutputChannel === 'function') {
            // Newer VS Code: createOutputChannel({ name, log: true })
            try {
                return winAny.createOutputChannel({ name: 'QuillAI Debug', log: true });
            } catch {
                // Alternate signature in some versions: createOutputChannel(name, { log: true })
                try {
                    return winAny.createOutputChannel('QuillAI Debug', { log: true });
                } catch {
                    // Fall through to basic output channel.
                }
            }
        }
    } catch {
        // Ignore and fall back.
    }

    return vscode.window.createOutputChannel('QuillAI Debug');
})();

export const logger = {
    channel,
    info(message: string): void {
        channel.appendLine(message);
    },
    show(): void {
        channel.show(true);
    },
};
