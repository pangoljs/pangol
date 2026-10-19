# create-pangol

Create a pangol TypeScript API for Node or Bun. No runtime dependencies and no automatic dependency installation.

This package is implemented locally and has not yet been published to npm. After its first alpha publication:

```sh
npm create pangol@alpha my-api -- --runtime node
# or: npm create pangol@alpha my-api -- --runtime bun
cd my-api
npm install
npm test
npm run dev
```

Without arguments, an interactive terminal prompts for the project folder and runtime. Non-interactive use requires both. Existing destinations must be empty directories; files and destination symlinks are rejected. No `--force` option is provided.

The starter includes a public health route, a posts route with `load` and `owner`, a model with a private field, auth and ownership tests, and an `AGENTS.md`. Auth rejects all credentials until connected to a real session provider. Test identities exist only in tests. The server binds to `127.0.0.1:3000`.

Node projects require Node 22.18+ for `pangol/register`. Bun projects require Bun and Node 22.18+ for npm/CLI scripts. Until `pangol dev/serve` are available, `dev` builds the static route table and starts the selected runtime's watcher. After adding or removing routes, restart `dev`; `start` runs a previously built project.

The initializer has its own version. The template pins the framework version tested in CI; update the pin and the fixture assertion together when upgrading. Tests pack and install the actual initializer and framework tarballs offline, then run each generated project's `check`, `test`, `build` and an HTTP smoke test. Mutation checks deliberately bypass ownership, expose a private field, and accept unverified credentials, and require tests to fail. CI's Bun job tests both templates; the Node jobs (and Node-only machines) test the Node template.

## Local use

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter create-pangol build
node packages/create-pangol/dist/main.js /tmp/my-api --runtime node
pnpm --filter create-pangol test
pnpm --filter create-pangol test:bun
```

## First publication (npm package owner)

Build and run the repository's CI checks before publishing. Check the packed file list; it must include `dist`, `template`, README and LICENSE. With an npm account that has 2FA enabled, run from `packages/create-pangol`:

```sh
npm login
npm whoami
npm pack --dry-run
npm publish --access public --tag alpha
npm view create-pangol version dist-tags
```

Complete npm's authentication prompts. First publication establishes the package name; an unpublished local directory does not reserve it. Publish the working initializer rather than an empty placeholder.

Then configure this package's trusted publisher on npm: GitHub owner `pangoljs`, repository `pangol`, workflow `release.yml`, environment `npm`, matching the framework's staged-publishing setup. The package needs its own configuration. Keep direct publishing and dist-tag permissions off for that trusted publisher.

Subsequent releases use tags such as `create-pangol-v0.1.0-alpha.1` matching this package's `package.json`; framework releases continue to use `v*`. The workflow stages only the selected package. A maintainer reviews and approves with 2FA:

```sh
npm stage list create-pangol
npm stage approve <stage-id>
```

Alpha releases use `--tag alpha`; `npm create pangol@latest` becomes the documented stable entry point when a release is intentionally published with `latest`. Do not move `latest` to an alpha.
