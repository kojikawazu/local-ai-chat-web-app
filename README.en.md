# Nordic Chat — Local AI Chat Web App

[![Unit Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/unit-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/unit-test.yml)
[![Integration Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/integration-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/integration-test.yml)
[![E2E Tests](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml/badge.svg)](https://github.com/kojikawazu/local-ai-chat-web-app/actions/workflows/e2e-test.yml)

[日本語](README.md) ・ Last updated: 2026-10-22

A chat web app for talking to a local LLM (Ollama), built on the Nordic Frost design system as a private AI workspace.

Your conversation data never leaves your machine — **everything runs locally (Ollama + PostgreSQL)**. It offers a ChatGPT-like experience with conversation history, model switching, and tool-calling (agent mode), all in a single web app.

**Who is it for**: privacy-conscious individuals who want everything local / developers who want an easy UI to try local LLMs / anyone looking for a Next.js + Ollama + Prisma implementation example.

## Screenshots

<!-- After placing images under docs/images/, uncomment below -->
<!--
| Chat | Agent run | Themes |
|---|---|---|
| ![Chat](docs/images/chat.png) | ![Agent](docs/images/agent.png) | ![Themes](docs/images/themes.png) |
-->

> 📷 Screenshots are pending. They can be generated via the Playwright screenshot test (`front/tests/e2e/screenshot.spec.ts`).

## Features

- **Real-time streaming**: token-by-token rendering of Ollama responses
- **Conversation management**: create / switch / delete, persisted to PostgreSQL
- **Auto title generation**: an LLM generates a title from the first message
- **Model selection**: switch between installed Ollama models on the fly
- **Markdown rendering**: code blocks, tables, lists, etc. in AI responses
- **Image attachments**: attach images with the paperclip button, drag & drop or paste, and ask a vision-capable model (e.g. the default `qwen3.8:27b`); images are downscaled to 1,280px on the long edge in the browser before sending
- **Agent mode**: tool calling (datetime / calculator / web search / URL fetch / list, search and read files in allowed folders, create / edit files after you approve the diff) with visible reasoning and system-prompt presets
- **Theme switching**: Nordic Frost / Aurora Borealis / Midnight Ocean
- **IME-aware input**: no accidental send while composing Japanese text
- **Responsive design**: desktop and mobile

## Tech Stack

| Area | Technology |
|------|------------|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| React | React 19 (React Compiler enabled) |
| Styling | TailwindCSS 4 |
| Markdown | react-markdown + remark-gfm + rehype-highlight + mermaid |
| Diff | diff (jsdiff, for the write-approval diff) |
| LLM | Ollama (runs locally) |
| DB | PostgreSQL 16 (Docker Compose) |
| Web search | SearXNG (Docker Compose) |
| Diagrams | mermaid, PlantUML server (Docker Compose) |
| ORM | Prisma 7 |
| Testing | Vitest (unit) + Testcontainers (integration) + Playwright (E2E) |

## Quick Start

> For full steps and troubleshooting see the [macOS setup guide](manuals/setup-guide-macos.md) (macOS only; Windows/Linux not provided).

**Prerequisites**: Node.js 20+ / pnpm / Docker + Docker Compose / [Ollama](https://ollama.ai/)

```bash
# 1. Pull an LLM model (a small model is recommended; the large default is ~48GB)
ollama pull gemma3:4b

# 2. Start PostgreSQL, SearXNG (web search) and PlantUML (diagrams) from the repo root
docker compose up -d

# 3. Set up the app (run inside front/)
cd front
cp .env.example .env.local        # edit OLLAMA_MODEL if needed
pnpm install
pnpm prisma migrate dev
pnpm dev                          # -> http://localhost:3000
```

## Environment Variables

Configured in `front/.env.local` (copy from `front/.env.example`):

| Name | Description | Default |
|------|-------------|---------|
| `OLLAMA_BASE_URL` | Ollama API endpoint | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model to use (**must match a model you pulled**) | `qwen3.8:27b` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5499/chat_db` |
| `AGENT_MAX_TOOL_ROUNDS` | Max tool-calling rounds in agent mode | `10` |
| `AGENT_TOOL_TIMEOUT_MS` | Tool execution timeout (ms) | `30000` |
| `SEARXNG_URL` | SearXNG endpoint for web search (`web_search`) | `http://localhost:8888` |
| `PLANTUML_URL` | PlantUML server endpoint for PlantUML diagrams | `http://localhost:8889` |
| `LOCAL_FILE_ROOTS` | Folders (absolute paths, comma-separated, `~` allowed) the agent's file tools (list / search / read) may read | unset (tools disabled) |
| `LOCAL_FILE_WRITE_ROOTS` | Folders (inside `LOCAL_FILE_ROOTS`) where the agent may create / edit files, each write approved by you first | unset (write tools disabled) |
| `LOCAL_COMMANDS` | Program names (comma-separated) the agent may run, each run approved by you first; the working folder must be inside `LOCAL_FILE_WRITE_ROOTS` (shells, `env`, `sudo`, etc. are ignored) | unset (command tool disabled) |
| `LOCAL_COMMAND_TIMEOUT_MS` | Time limit for a command (ms, max 600000) | `120000` |
| `GITHUB_REPOS` | Repositories (`owner/name`, comma-separated) the agent's GitHub tools may use; reading needs no approval, commenting / creating a PR is approved by you first (signs in with `gh auth login`) | unset (GitHub tools disabled) |
| `BROWSER_ENABLED` | Set to `true` to let the agent open web pages in a browser, read them as an accessibility tree / screenshot, and click / type / select (each operation needs your approval) (requires `pnpm exec playwright install chromium`) | unset (browser tools disabled) |
| `BROWSER_LOCAL_ORIGINS` | Local dev-server origins (`http://localhost:5173` form, comma-separated) the browser tools may open; this app itself is never opened | unset (local servers cannot be opened) |

## Commands

```bash
cd front
pnpm dev             # start dev server
pnpm build           # production build
pnpm lint            # ESLint
pnpm format          # Prettier (write)
pnpm format:check    # Prettier (check only)
pnpm typecheck       # Type check (tsc --noEmit)
pnpm test:unit       # run unit tests (Vitest)
pnpm test:integration # run integration tests (Vitest + Testcontainers, Docker required)
pnpm test:e2e        # run E2E tests (Playwright; model qwen2.5:0.5b by default, override with E2E_OLLAMA_MODEL)
pnpm prisma studio   # open DB browser
```

## Architecture

```
Browser -> Next.js Route Handlers -> Ollama API (localhost:11434)
                                   -> Agent Loop -> Tool Executor (datetime/calc/web-search/url-fetch/local-files)
                                   -> Prisma ORM -> PostgreSQL (Docker)
```

- The frontend never talks to Ollama directly (always via Route Handlers).
- Streaming is relayed via `ReadableStream` (plain text in normal mode, NDJSON events in agent mode).
- Agent mode runs a loop inside the Route Handler, feeding tool results back to the LLM.
- CSS-variable-based theme system (switched via the `data-theme` attribute).

## Documentation

See the [docs index](docs/README.md). Project conventions live in [`CLAUDE.md`](CLAUDE.md) and [`.claude/rules/`](.claude/rules/).

## CI

GitHub Actions runs automatically (push / PR to main). Unit and E2E are separate jobs.

- **Unit Tests** (`unit-test.yml`): Vitest. No Ollama/DB required, finishes in tens of seconds.
- **Integration Tests** (`integration-test.yml`): Vitest + Testcontainers. Spins up an ephemeral PostgreSQL and verifies route handlers against a real DB (no Ollama).
- **E2E Tests** (`e2e-test.yml`): Ubuntu + PostgreSQL + Ollama (`qwen2.5:0.5b`) + Chromium.
- **Results**: playwright-report uploaded as an artifact
- **Note**: CPU-only runner, so streaming-completion tests etc. are skipped ([details](docs/08-ci-e2e-bug-report.md))

## License

This is a personal project and is **not** released under an open-source license for redistribution or commercial use (**All Rights Reserved**). You are welcome to browse the code for reference/learning. Please contact the author for usage requests.
