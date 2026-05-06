<p align="center">
  <img src="assets/logo_big.png" alt="QuillAI Logo" width="400">
</p>



An AI-powered VS Code extension that provides real-time grammar, spelling, and style checking for Markdown and plaintext files — like having a professional proofreader built into your editor.

## Features

- 🔍 **Real-time Background Scanning** — Automatically checks your prose as you type with configurable debounce (default 1500ms)
- 🌊 **Wavy Underline Diagnostics** — Issues are highlighted directly in the editor with severity-colored wave underlines
- ⚡ **Quick Fixes** — Click on any highlighted issue to see the suggested replacement and apply it with one click
- 📊 **Diff Preview** — Before applying a fix, see a clear side-by-side comparison of the original text and the suggested correction
- 🔌 **Multi-Provider Support** — Works with OpenAI (GPT-4o), Anthropic (Claude 3.5 Sonnet), and local models via Ollama
- 🔒 **Secure API Key Storage** — API keys are stored in VS Code's encrypted SecretStorage, never in config files
- 📄 **Smart Paragraph Scanning** — For large documents (>5000 chars), intelligently scans only the paragraph at the cursor position

## Getting Started

### 1. Set Your API Key

Run the command: **QuillAI: Set API Key**

Or use the Command Palette (`Cmd+Shift+P`) → "QuillAI: Set API Key"

### 2. Configure Your Provider

Open VS Code Settings (`Cmd+,`) and search for "QuillAI":

| Setting | Default | Description |
|---------|---------|-------------|
| `quillai.provider` | `openai` | LLM provider: `openai`, `anthropic`, or `ollama` |
| `quillai.model` | `gpt-4o` | Model name (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`, `llama3`) |
| `quillai.endpoint` | _(auto)_ | Custom API endpoint URL |
| `quillai.debounceMs` | `1500` | Delay in ms before scanning after typing stops |
| `quillai.maxChars` | `5000` | Max characters per scan (larger docs use paragraph extraction) |
| `quillai.enabled` | `true` | Enable/disable automatic background scanning |
| `quillai.diagnosticSeverity` | `warning` | Default severity for issues |
| `quillai.systemPrompt` | _(built-in)_ | Custom system prompt for the LLM |

### 3. Start Writing

Open any `.md` or `.txt` file. The extension will automatically scan your text and highlight issues.

## Commands

| Command | Description |
|---------|-------------|
| `QuillAI: Check Current Document` | Manually trigger a full document scan |
| `QuillAI: Set API Key` | Set or update your API key securely |
| `QuillAI: Clear All Diagnostics` | Remove all highlighted issues |

## Using with Ollama (Local Models)

1. Install and start [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3`
3. Set provider to `ollama` in settings
4. Set model to `llama3` (or your preferred model)
5. API Key is not required for local models

## Requirements

- VS Code 1.118.0 or higher
- An API key for OpenAI or Anthropic (unless using Ollama locally)

## Privacy & Security

- API keys are stored exclusively in VS Code's `SecretStorage` (encrypted)
- API keys are never written to configuration files or logged
- Text is sent to the configured LLM provider for analysis only
- No telemetry or data collection by this extension

Calling out known issues can help limit users opening duplicate issues against your extension.


---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
