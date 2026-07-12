# Changelog

All notable changes to Pixie will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-07-12

### Changed
- Refined the right panel file list with clearer breadcrumbs, file metadata, and hover actions.
- Replaced right panel tab emoji with consistent line icons.

### Fixed
- Restricted file tab navigation to the active workspace so users cannot browse above the workspace root.

## [0.8.1] - 2025-07-05

### Added
- Comprehensive multilingual support (i18n) with English, Simplified Chinese, and Japanese
- Scheduled tasks support for running prompts on a schedule (daily, weekdays, or every N minutes/hours)
- Cancellation support for builtin engine loops
- Ability to switch between loop tasks while one is running
- Builtin and Codex engines added to backend AgentEngineId enum
- Engine support for scheduled tasks

### Fixed
- BETA badge visibility in sidebar header
- Codex tool calls being dropped from the stream
- Codex conversation continuation support
- Codex session continuation support
- Codex parser to handle actual codex JSON format
- Codex model list refreshed with current GPT-5 family
- TypeScript build errors for scheduled tasks engine support
- Codex added to expandedEngines initial state
- Codex should emit Final event instead of TextDelta
- Codex added to ENGINE_SETUP_INFO in App.tsx

### Changed
- Updated engine configurations and default settings
- Improved loop task management and user experience

## [0.8.0-beta.4] - 2025-06-XX

### Added
- Initial beta release features

---

## Version Naming Convention

- Stable releases: `0.8.0`, `0.8.1`, etc.
- Beta/Prerelease releases: `0.8.0-beta.1`, `0.8.0-beta.2`, etc.
- Tags for GitHub Actions: `app-v0.8.0`, `app-v0.8.1`, etc.

For the full release history, see [GitHub Releases](https://github.com/white1or1black/pixie/releases)
