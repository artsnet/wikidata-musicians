# Security policy

## Reporting

Report vulnerabilities privately through GitHub's "Report a vulnerability" form on this repository (Security tab), not in a public issue. Include the input that triggers the problem and the version. You will get an acknowledgement within a week.

## Scope

In scope: anything that lets input or response content reach somewhere it should not, such as contacting a host other than `www.wikidata.org` or `commons.wikimedia.org`, returning an image URL that is not `https`, unbounded memory or time on a hostile response, missing or wrong attribution data that would lead a user to display an image without its license, or a way for Wikidata text to be interpreted as instructions by the CLI or the MCP server.

Out of scope: Wikidata data quality (wrong occupations, missing labels) and rate limiting by Wikimedia caused by how the package was run.

## Design notes

- Only two hosts are contacted, both over HTTPS, with a per-request timeout.
- Responses are parsed defensively: every field is type-checked before use and unexpected shapes become `unavailable`.
- Commons author credits have markup stripped; license and file URLs must be `https`.
- Verification uses direct P106 / P31 statements only, so a crafted item cannot qualify through an unexpected subclass chain.
- The MCP server is stdio-only, read-only, and has no hosted endpoint. Tool results are labelled as data in the tool descriptions.
- No credentials are read or stored. The only environment variables used are the User-Agent and the language list.
