# Change Log

All notable changes to the "quillai" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 0.0.2

- Initial release with support for Markdown and Plaintext files, OpenAI and Anthropic providers, and basic grammar/style checking features.

## 0.0.3

### Added

- Multi-language proofreading with a dedicated language picker command (`QuillAI: Set Proofreading Language`).
- LaTeX support (default enabled alongside Markdown and Plaintext) and configurable `quillai.languages` language IDs.
- Debug logging via the `QuillAI Debug` output channel to help diagnose scanning and provider/parsing issues.
- Progress reporting for long-document scanning (chunked analysis) so large files no longer feel “stuck”.
- Demo screenshots in the README.
- MIT License.

### Changed

- Setup flow now supports reading `quillai.apiKey` and `quillai.endpoint` directly from settings to skip interactive prompts.
- Improved configuration handling for language/locale enforcement (regional spelling and punctuation).
- Extension branding assets (logo) and documentation updates.

### Fixed

- More robust long-text analysis by chunking large documents and improving stability around provider responses.
- Streaming response handling for OpenAI/Anthropic: accumulate streamed content and better tolerate/troubleshoot JSON parsing failures to avoid false “no issues found”.
- Quick Fix reliability: suggested fixes now appear in more editor contexts (including unsaved/untitled documents) with safer fallback extraction of replacement text.

