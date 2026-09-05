# Specs

One markdown file per feature or change being planned for this fork, named
`YYYY-MM-DD-short-slug.md`. A spec is the point where an idea from
`docs/brainstorm/` has become concrete enough to build.

Suggested shape (skip sections that don't apply):

- **Problem** — what's wrong or missing today, for whom.
- **Goal** — what "done" looks like. Non-goals if scope needs guarding.
- **Approach** — the plan. Diagrams/pseudocode if it helps.
- **Decisions** — anything non-obvious the approach depends on; promote
  it to `docs/project/DECISIONS.md` once implemented.
- **Open questions** — things to resolve before or during implementation.

When a spec ships, either fold its lasting decisions into
`docs/project/DECISIONS.md`/`OVERVIEW.md` and delete the spec, or leave it
here as a historical record — either is fine, just don't let stale specs
look like active plans.
