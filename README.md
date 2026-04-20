# Omni Output Filter

An [Omni Code](https://github.com/GraysonBannister/omni-code) add-on that compresses Bash/Shell tool output before it enters the agent's context window. Works with all LLM providers — no external dependencies beyond Node.js.

Inspired by [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk).

**Estimated savings: ~60–90% on shell-heavy workflows**

## What It Filters

Applied to `Bash` and `Shell` tool output only. All other tools (Read, Grep, etc.) pass through untouched.

| Filter | What it does |
|--------|-------------|
| Strip `\r` | Removes Windows-style carriage returns |
| Deduplication | Collapses consecutive identical lines (e.g. 20× "Building..." → 2 lines) |
| Blank line collapse | Reduces runs of 3+ blank lines to one |
| npm/yarn install | Replaces verbose dependency trees with a one-line summary |
| cargo build | Removes "Compiling crate vX.Y.Z" lines, keeps warnings and errors |
| pip install | Removes "Collecting/Downloading" lines, keeps final summary |
| Stack trace trim | Keeps first 8 + last 4 frames of deep traces, omits middle |
| Long line cap | Truncates lines over 400 chars |
| Head/tail trim | For outputs over 300 lines, keeps first 100 + last 50 with a gap marker |

## Usage

Install the addon and it activates automatically. No configuration required. Every Bash tool call will have its output compressed before the agent sees it.

To disable, uninstall or disable the addon in the Omni Code Add-ons panel.

## Requirements

- Omni Code v2.0.0 or later
- No external dependencies

## Installation

Install via the Omni Code Add-ons panel or directly from the [registry](https://graysonbannister.github.io/omni-code-website/addons).

## License

MIT
