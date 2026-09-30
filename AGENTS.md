# Agent workflow

Use the compiler graph before opening a wide set of files. Graph ranks a search. It does not replace the test suite, and it is not Evidence.

## Order

1. Ask `tour` or `lookup` through `inspect_typescript_graph`.
2. Ask `details` or `trace` for the symbol you are going to change.
3. Read the cited source span, not the whole tree.
4. Run the failing test and edit that span.
5. Ask `trace` in reverse, or with `direction: "impact"`, for callers and tests the compiler can see.
6. Run those tests, then the repository gate for the change.

`bun tools/graph-query.ts` reads `tools/list` and rejects request fields the live schema does not publish. Pass `--question` and `--request`. The request object is only the branch you chose (`type` plus that branch's fields).

```bash
bun tools/graph-query.ts --question "Where is runScenario declared?" --request '{"type":"lookup","query":"runScenario"}'
```

The server is `node_modules/.bin/ttsc-graph --cwd . --tsconfig tsconfig.graph.json`. It speaks stdio to that local process. Do not point it at a remote URL, and do not replace a failed `ttsc-graph` launch with `tsc` or `tsx`.

Copy `.mcp.json.example` or `.codex/config.toml.example` into the project-local config if you want an agent client. Do not edit a home-directory config from this repo.

## What the graph does not see

Treat these as unobserved until you open the file:

- JSON and YAML scenarios, fixtures, and workflows
- shell scripts and package script strings
- dynamic `import()` and plugin path loading in `packages/cli/src/plugin/load.ts`
- `package.json` `exports`, `bin`, and `files`
- environment variables and bunfig preload

A `.d.ts` hit is a boundary, not proof that the implementation was indexed. `tsconfig.graph.json` is the aggregate program (money, core, CLI including the OpenTUI JSX settings, and top-level tools). When that program only shows a declaration boundary, query the package `tsconfig.json` and treat that package program as authoritative.

Do not store opaque graph node ids in docs or commits. Record the commit, the project, and the source span.

Graph output is not a reason to skip `bun run test` or the gate the change claims. Evidence citations are a separate check (`bun run evidence:check`).
