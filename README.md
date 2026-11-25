# RoyComputing CLI

Manage your computers, containers, orders and SSH keys from a terminal.

## Installation

**macOS and glibc-based Linux** (x64 or ARM64)

```sh
curl -fsSL https://roycomputing.com/install.sh | sh
```

**Windows** (x64 or ARM64)

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://roycomputing.com/install.ps1 | iex"
```

Run the same command again to update. The installer puts `roy` in `~/.local/bin` on macOS and Linux or `%LOCALAPPDATA%\RoyComputing\bin` on Windows. If your current terminal needs a PATH update, the installer prints the command to run.

With Node.js 22.12 or later, you can also use `npm install --global @roycomputing/cli`.

Run `roy version --check` to check for an update now. Standalone installations check GitHub Releases and npm installations check the npm registry. First use records the time locally for that API origin and installation type. An interactive command checks for updates once 24 hours have passed. Successful checks restart the 24-hour interval. If a check fails, automatic checks stay quiet and the next interactive command can retry after five minutes. Once a check finds a newer version, subsequent commands print the installation-specific update command to stderr until you update. Help, local version output, JSON mode and noninteractive commands can show the cached notice without contacting the release service.

## Getting started

```sh
roy auth login
roy computers list
```

If you have more than one computer, pass `--computer <id>` to container and SSH-key commands or `roy computers get <id>` to inspect one.

```sh
roy containers create website
roy containers list website --wait 120
roy ssh-keys add --container website --key-file ~/.ssh/id_ed25519.pub
```

Run the SSH command shown by `roy containers list`.

Use `roy --help` to explore commands. Add `--json` for machine-readable output. Results go to stdout and errors to stderr. Exit codes are 0 for success, 1 for a failed operation and 2 for invalid arguments.

Browser login saves credentials in your user configuration directory. Use `roy auth status` to verify the active user and organization and `roy auth logout` to remove the login. For automation, supply an access token through `ROYCOMPUTING_TOKEN`.

## Releasing

Set the version in `package.json` and push a matching stable tag such as `v0.1.0` on that commit. GitHub Actions tests all six standalone binaries and the packed npm package. After the tests pass, separate jobs publish the binaries to GitHub Releases and the tested tarball to npm with the `latest` dist-tag. If one publish job fails, choose **Re-run failed jobs** on that workflow run.

The npm package uses trusted publishing. In the npm settings for `@roycomputing/cli`, configure a GitHub Actions trusted publisher for owner `roycomputing`, repository `cli`, and workflow filename `release.yml`. Leave the environment blank and allow direct publishing with `npm publish`. [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/)
