---
name: modern-cli-tools
description: Prefer the modern command-line search tools over the base ones. Load it before you search or navigate a project -- before you grep for text, find files, change directory, or look for code by its structure. It names `rg`, `fd`, `zoxide` and `ast-grep`, and the plain tool to use when one is not installed.
---

# Modern CLI tools

Four tools are faster than the base ones, respect `.gitignore`, and give better
results. Use them first; each has a plain tool to fall back on.

| To do this | Use | If it is not installed |
| --- | --- | --- |
| Search file contents for text | `rg` | `grep -rn` |
| Find files by name | `fd` | `find` |
| Jump to a directory you have been in | `zoxide` (`z`) | `cd` with the plain path |
| Find code by its syntax | `ast-grep` (`sg`) | `rg`, or `grep` |

## `rg` instead of `grep`

`rg 'pattern' path` searches recursively, skips ignored and hidden files, and is
fast. Add `-t ts` to limit by file type, `-g '*.md'` to limit by glob, `-l` for
file names only.

## `fd` instead of `find`

`fd name` finds files whose name matches; `fd -e md` filters by extension;
`fd -t d name` finds directories. It skips ignored files.

## `zoxide` instead of long `cd` paths

`z name` jumps to a directory you have visited before whose path matches
`name`. It only knows directories it has learned: when `z` finds nothing, use
the plain path with `cd`.

## `ast-grep` for code structure

Use `ast-grep` (also installed as `sg`) when the pattern is syntactic: a call
with any arguments, a function of a given shape, an import. For example
`ast-grep run -p 'console.log($$$ARGS)' -l ts`. When the pattern is only text,
`rg` is enough.

## When a tool is missing

A tool that is not installed never blocks the work. If `rg`, `fd`, `zoxide` or
`ast-grep` is not found, use `grep`, `find`, `cd` or `rg`/`grep` as the table
says and carry on. Do not install the tools yourself.
