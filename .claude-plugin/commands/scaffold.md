---
description: Scaffold a new project from a Starter Series template (Discord/Telegram bot, MCP server, browser/VS Code extension, Electron, React Native, Cloudflare Pages, npm package, Docker deploy).
argument-hint: "[project-name] [--template <id>]"
---

You are scaffolding a new project from the **Starter Series** templates via the `create-starter` MCP server.

## Steps

1. If the user did not name a template, call `list_templates` and ask them to pick one.
2. Collect required inputs:
   - `name` *(required)* — must match `^[A-Za-z0-9][A-Za-z0-9_-]*$` (alnum start, then `[A-Za-z0-9_-]`). No dots, spaces, or path separators.
   - `description` *(optional)* — one-line description that replaces the template default.
3. Call `create_project` with the validated inputs.
4. Report what was created, including the matched starter, files written, and any next-step commands from the post-scaffold report.

## Do NOT

- Shell out to `curl`, `tar`, or `git clone` — the MCP server handles fetch, extract, placeholder substitution, and `git init` atomically.
- Run the new project's install/build/dev commands automatically — surface them to the user instead.
