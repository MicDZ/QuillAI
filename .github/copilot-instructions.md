# QuillAI

AI-powered grammar and style checker for Markdown and Plaintext files in VS Code.

## Project Structure
- `src/extension.ts` - Main entry point
- `src/types.ts` - Type definitions (LintIssue, ProviderType, etc.)
- `src/config.ts` - Configuration manager (settings + SecretStorage)
- `src/diagnostics.ts` - DiagnosticCollection management
- `src/scanner.ts` - Debounced background scanner with paragraph extraction
- `src/codeActions.ts` - Quick fix CodeAction provider
- `src/diffPreview.ts` - Side-by-side diff preview utility
- `src/providers/` - LLM provider implementations (OpenAI, Anthropic, Ollama)

## Build & Test
- `npm run compile` - Build with esbuild
- `npm test` - Run VS Code integration tests
- `npm run lint` - Run ESLint
