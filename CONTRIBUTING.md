# Contributing

Thanks for helping. This is a small package with a narrow job, so most contributions are one of three things.

## A musician is missing from results

First check the item on Wikidata: does it have a direct `P106` occupation (person) or `P31` class (group) from the built-in lists (`wikidata-musicians classes`)? If not, the fix belongs on Wikidata. If the item has a common musical occupation that the list lacks (bassist, violinist, opera singer, …), open an issue or a pull request that adds the QID with its English label to `src/classes.ts`; include a link to the Wikidata item for the occupation so the QID can be checked.

## Bugs and small features

Open an issue first for anything that changes the JSON shape or the CLI's exit codes; those are the contract other tools rely on (`schemaVersion` only moves on a breaking change). Otherwise send a pull request with a test. Tests use a fetch double (`tests/helpers.ts`) and never hit Wikimedia.

## Checks

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js search "Björk" --user-agent "dev (you@example.com)"   # live check, needs network
```

CI runs the same on Node 20, 22 and 24.

## Ground rules

- The core (`src/client.ts`, `src/wikidata.ts`, `src/commons.ts`, `src/http.ts`) must stay free of Node-only APIs so it keeps running in Cloudflare Workers.
- Do not add a default User-Agent that names an operator, and do not add a hosted endpoint.
- Keep verification to direct statements; do not add subclass traversal or SPARQL.
- Keep requests batched: one search, one entity fetch, one Commons query per call.
- Commit messages: a short imperative summary line, optionally followed by why.
