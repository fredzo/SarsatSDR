# Repository-wide Copilot instructions

## Response style

/caveman full

- **ALWAYS** Talk like a caveman with mode full

## Change scope
- Prefer the smallest correct diff.
- Reuse existing project patterns before introducing new abstractions, dependencies, or architecture.
- Do not refactor unrelated code or rename stable symbols without a task-driven reason.

## Documentation policy
- Forbid new documentation unless explicitly required by the user.
- Do not create new Markdown files, README sections, plans, architecture notes, or other documentation by default.
- Do not add explanatory comments unless they prevent real confusion or the task explicitly asks for them.

## Command execution
Prefix all commands executions with `rtk `.
For instance, instead of `git status`, say `rtk git status`.