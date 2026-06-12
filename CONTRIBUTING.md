# Contributing to phpustik

First of all, thank you for taking the time to contribute. Every bug report,
documentation fix, feature proposal and pull request is welcome.

## Code of Conduct

By participating in this project you agree to be respectful, constructive and
inclusive. Harassment of any kind will not be tolerated.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Operating system and Node.js version (`node -v`).
- Output of `php -v` and `php -m`.
- The exact command (or MCP tool call) that failed.
- A minimal reproduction snippet (without confidential code).
- The full server log, with `PHPUSTIK_LOG_LEVEL=debug` set.

## Suggesting features

Open an issue with the **Feature request** template. Describe the user
problem first, then the proposed solution. Compatibility with the MCP
specification is non-negotiable — proposals that would break the protocol
will be politely declined.

## Local development

### Prerequisites

| Tool                | Minimum version | Notes                                        |
| ------------------- | --------------- | -------------------------------------------- |
| Node.js             | 18.19           | 20.x LTS recommended                         |
| npm                 | 9               | Yarn / pnpm also work                        |
| PHP                 | 8.0             | Required for tool tests                      |
| Composer (optional) | 2.x             | Required only when exercising PHPStan / CS   |

### Setup

```bash
git clone https://github.com/phpustik/phpustik.git
cd phpustik
npm install
```

### Scripts

| Command              | Description                              |
| -------------------- | ---------------------------------------- |
| `npm run build`      | Compile TypeScript to `dist/`            |
| `npm run dev`        | Run the server with `tsx` (no build)     |
| `npm run typecheck`  | Strict TypeScript check without emit     |
| `npm run lint`       | ESLint over the entire repo              |
| `npm run lint:fix`   | Auto-fix lint issues                     |
| `npm run format`     | Format with Prettier                     |
| `npm run inspect`    | Launch the MCP Inspector against `dist/` |
| `npm run clean`      | Remove build artifacts                   |

### Pull request workflow

1. Fork the repository and create a feature branch:
   ```bash
   git checkout -b feat/awesome-thing
   ```
2. Make your changes. Keep commits small and atomic.
3. Ensure CI will pass locally:
   ```bash
   npm run lint && npm run typecheck && npm run build
   ```
4. Add or update tests where applicable.
5. Update `README.md` and `CHANGELOG.md` if behaviour changes.
6. Open a pull request using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).

## Commit message convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add support for phpcs tool
fix: handle ENOENT for phpstan on Windows
docs: clarify Cursor installation steps
chore: bump typescript-eslint to 8.20
```

## Release process

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/).
The version in `package.json` is updated on every commit to `main`, and a
GitHub release is created with the generated notes.

## License

By contributing you agree that your contributions will be licensed under the
MIT License — see [LICENSE](LICENSE).
