# Contributing to Nestcore

Thanks for considering a contribution — bug reports, feature ideas, and PRs are all welcome.

## Getting started

1. Read the [requirements](README.md#-requirements) and get the backend/frontend running locally.
2. Check open [issues](https://github.com/nawfdev/home_panel/issues) — comment on one before starting large work so effort isn't duplicated.
3. Fork the repo and create a branch off `main`: `git checkout -b fix/short-description`.

## Project layout

- `be/` — Go backend (`cmd/homepanel`, `internal/...`)
- `fe/` — React/TypeScript frontend
- `docs/` — setup guides and internal notes

## Development

```bash
# backend
cd be && go run ./cmd/homepanel

# frontend
cd fe && npm install && npm run dev
```

Run backend tests/vet before submitting:

```bash
cd be && go build ./... && go vet ./...
```

Run frontend typecheck:

```bash
cd fe && npx tsc --noEmit
```

## Commit style

- Keep commits focused — one logical change per commit.
- Write commit messages that explain *why*, not just *what* (e.g. `fix: pollTorrent never resolved because aria2 reports "active" while seeding`, not `fix bug`).

## Pull requests

- Describe what changed and why in the PR description.
- Link the issue it resolves, if any (`Closes #123`).
- Keep the diff scoped to the stated goal — unrelated cleanup belongs in its own PR.
- Make sure `go build ./...` and `npx tsc --noEmit` both pass before requesting review.

## Reporting bugs / requesting features

Use the issue templates under **New Issue** — they ask for the info needed to reproduce or evaluate a request quickly.

## Security issues

Do **not** open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md) instead.
