# RoyComputing CLI

Manage your computers, containers, orders and SSH keys from a terminal. Requires Node.js 22.12 or later.

```sh
npm install --global @roycomputing/cli
roy auth login
roy computers list
```

Add `--all` to include other users’ and unassigned computers.

With one assigned computer, omit its ID. The CLI remembers that selection for five minutes per saved login. With multiple assignments, pass `--computer <id>` to container and SSH-key commands or `roy computers get <id>` to inspect one.

```sh
roy containers create website
roy containers list website --wait 120
roy ssh-keys add --container website --key-file ~/.ssh/id_ed25519.pub
```

Run the SSH command shown by `roy containers list`.

Use `roy --help` to explore commands. Add `--json` for machine-readable output. Piping preserves the selected format. Results go to stdout and errors to stderr. Exit codes are 0 for success, 1 for a failed operation and 2 for invalid arguments.

Browser login saves credentials in your user configuration directory, separately for each API origin. The CLI caches your display name, email and organization name with that login and refreshes them on demand at most once every five minutes. Use `roy auth status` to verify the active user and organization and `roy auth logout` to remove the login. For automation, supply an access token through `ROYCOMPUTING_TOKEN`. To use another API, set `ROYCOMPUTING_API_URL`. An explicit token for that API also needs its matching `ROYCOMPUTING_TOKEN_ORIGIN`.
