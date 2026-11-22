import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const bin = process.env.ROY_TEST_BIN ?? fileURLToPath(new URL("../dist/index.js", import.meta.url));
const id = "comp_aB3dE5gH7jK";
const target = ["--computer", id];
const publicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB";
const observed = "2026-10-01T12:00:00.000Z";
const computer = {
  id,
  pretty_name: "Example",
  assigned_user_id: "user_fixture",
  created_at: observed,
  updated_at: observed,
  ended_at: null,
};
const snapshot = {
  capturedAt: observed,
  containers: [
    {
      name: "website",
      status: "Running",
      devices: {
        ssh: {
          type: "proxy",
          bind: "host",
          connect: "tcp:127.0.0.1:22",
          listen: "tcp:0.0.0.0:2345",
        },
      },
    },
  ],
};
const cache = {
  snapshot,
  lastUpdatedAt: observed,
  lastRefreshAttemptAt: observed,
  previousRefreshAttemptAt: null,
};
const server = {
  ipv4: "192.0.2.1",
  country: "Canada East",
  updated_at: observed,
  installation: null,
  isMarkedAsInstalling: false,
  specs: {
    isBareMetal: true,
    cpu: { model: null, cores: null, threads: null, frequencyMhz: null },
    memoryGb: 16,
    isEccMemory: false,
    diskGb: 100,
    diskType: "ssd",
    diskInterface: "sata",
    publicBandwidthMbps: 1000,
  },
};

async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), "roy-cli-"));
  const requests = [];
  const http = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const call = { path: req.url, method: req.method, auth: req.headers.authorization, body };
      requests.push(call);
      const [status, data] = await handler(call, origin);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${http.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => http.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  function run(args, { input = "", token = "fixture-access", tokenOrigin = origin } = {}) {
    const proc = spawn(process.execPath, [bin, ...args], {
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        XDG_CONFIG_HOME: directory,
        ROYCOMPUTING_API_URL: origin,
        ROYCOMPUTING_TOKEN: token,
        ROYCOMPUTING_TOKEN_ORIGIN: tokenOrigin,
      },
    });
    proc.stdin.end(input);
    let out = "",
      err = "";
    proc.stdout.on("data", (part) => {
      out += part;
    });
    proc.stderr.on("data", (part) => {
      err += part;
    });
    return new Promise((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (code) => resolve({ out, err, code }));
    });
  }
  return { run, requests, origin, directory };
}

test("commands cover every product endpoint and preserve explicit output format", async (t) => {
  const base = `/v1/computers/${id}`;
  const capturedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const lastUpdate = { ...cache, snapshot: { ...snapshot, capturedAt } };
  let computerCache = lastUpdate;
  const { run, requests } = await fixture(t, ({ method, path, auth }) => {
    assert.equal(auth, "Bearer fixture-access");
    if (path === "/v1/auth/status") return [200, { userId: "user_fixture", orgId: "org_fixture" }];
    if (path === "/v1/orders") return [200, { orders: [] }];
    if (path === base)
      return [200, { computer: { ...computer, server, state_cache: computerCache } }];
    if (path === base + "/refresh-state")
      return [200, { state_cache: lastUpdate, refreshed: true, retryAfterMs: 1000 }];
    if (path.endsWith("/ssh-keys")) return method === "GET" ? [200, { keys: [] }] : [204];
    return [202];
  });
  async function check(args, method, path, body, input) {
    const result = await run(["--json", ...args], { input });
    assert.equal(result.code, 0, result.err);
    assert.equal(result.err, "");
    const last = requests.at(-1);
    assert.equal(last.path, path);
    assert.equal(last.method, method);
    assert.deepEqual(last.body && JSON.parse(last.body), body ?? "");
    return JSON.parse(result.out);
  }
  await check(["orders", "list"], "GET", "/v1/orders");
  const beforeDetail = requests.length;
  const detail = await check(["computers", "get", id], "GET", base);
  assert.equal(detail.computer.assigned_user_id, "user_fixture");
  assert.equal(detail.computer.state_cache.snapshot.capturedAt, capturedAt);
  assert.equal(
    detail.computer.state_cache.snapshot.containers[0].sshCommand,
    "ssh -p 2345 roy@192.0.2.1",
  );
  assert.deepEqual(
    requests.slice(beforeDetail).map((r) => r.path),
    [base],
  );
  const humanDetail = await run(["computers", "get", id]);
  assert.equal(humanDetail.code, 0, humanDetail.err);
  assert.match(humanDetail.out, /^Assigned user: user_fixture$/m);
  assert.match(humanDetail.out, /^Containers \(updated 3 hours ago\)$/m);
  assert.match(humanDetail.out, /website\s+Running\s+—\s+ssh -p 2345 roy@192\.0\.2\.1/);
  computerCache = { ...cache, snapshot: { ...snapshot, containers: [] } };
  assert.match((await run(["computers", "get", id])).out, /^No containers\.$/m);
  computerCache = null;
  assert.match(
    (await run(["computers", "get", id])).out,
    /Container list unavailable.*roy containers list/,
  );
  await check(["computers", "reinstall", id], "POST", base + "/start-installation", {
    timezone: "Asia/Taipei",
  });
  const created = await check(
    ["containers", "create", "website", ...target],
    "POST",
    base + "/containers",
    { name: "website", timezone: "Asia/Taipei" },
  );
  assert.equal(created.status, "accepted");
  for (const verb of ["start", "stop", "delete"]) {
    await check(
      ["containers", verb, "website", ...target],
      verb === "delete" ? "DELETE" : "POST",
      base + "/containers/website" + (verb === "delete" ? "" : "/" + verb),
    );
  }
  const beforeList = requests.length;
  const list = await run(["containers", "list", ...target]);
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /SSH COMMAND/);
  assert.match(list.out, /^Last updated 3 hours ago$/m);
  assert.match(list.out, /website\s+Running\s+—\s+ssh -p 2345 roy@192\.0\.2\.1/);
  assert.deepEqual(
    requests.slice(beforeList).map(({ method, path }) => [method, path]),
    [
      ["POST", base + "/refresh-state"],
      ["GET", base],
    ],
  );
  for (const name of [null, "website"]) {
    const path = base + (name ? "/containers/website/ssh-keys" : "/ssh-keys");
    const args = name ? [...target, "--container", name] : target;
    await check(["ssh-keys", "list", ...args], "GET", path);
    await check(
      ["ssh-keys", "add", ...args, "--key-file", "-", "--comment", "public"],
      "POST",
      path,
      { key: publicKey, comment: "public" },
      publicKey + " original comment\n",
    );
    await check(
      ["ssh-keys", "remove", ...args, "--key-file", "-"],
      "DELETE",
      path,
      { key: publicKey },
      publicKey + " a different comment\n",
    );
  }
});

test("SSH key files and stdin supply the add comment separately from the key", async (t) => {
  const { run, requests, directory } = await fixture(t, () => [204]);
  const file = join(directory, "fixture.pub");
  const comment = "Fixture laptop  🦊";
  await writeFile(file, publicKey.replace(" ", "\t") + "\t" + comment + "\r\n");
  for (const [verb, options, body] of [
    ["add", ["--key-file", file], { key: publicKey, comment }],
    ["add", ["--key-file", file, "--comment", ""], { key: publicKey, comment: "" }],
    ["add", ["--key-file", "-"], { key: publicKey, comment: "" }],
    ["remove", ["--key-file", file], { key: publicKey }],
  ]) {
    const result = await run(["ssh-keys", verb, ...target, ...options], { input: publicKey });
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(JSON.parse(requests.at(-1).body), body);
  }
});

test("computers get displays available CPU counts and drive specifications", async (t) => {
  const specs = structuredClone(server.specs);
  const { run } = await fixture(t, () => [
    200,
    {
      computer: {
        ...computer,
        assigned_user_id: null,
        server: { ...server, specs },
        state_cache: cache,
      },
    },
  ]);
  for (const [bareMetal, cores, threads, diskType, diskInterface, label] of [
    [true, 8, 16, "ssd", "nvme", "Bare-metal 8 cores, 16 threads, 16 GB RAM, 100 GB NVMe SSD"],
    [false, 1, 1, "ssd", "sata", "1 vCPU, 1 thread, 16 GB RAM, 100 GB SATA SSD"],
    [false, 4, null, "ssd", "nvme", "4 vCPUs, 16 GB RAM, 100 GB NVMe SSD"],
    [true, null, null, "hdd", "sas", "Bare-metal 16 GB RAM, 100 GB SAS HDD"],
    [false, null, 8, "ssd", "sata", "8 threads, 16 GB RAM, 100 GB SATA SSD"],
  ]) {
    specs.isBareMetal = bareMetal;
    specs.cpu.cores = cores;
    specs.cpu.threads = threads;
    specs.diskType = diskType;
    specs.diskInterface = diskInterface;
    const result = await run(["computers", "get", id]);
    assert.equal(result.code, 0, result.err);
    assert.equal(
      result.out.split("\n").find((line) => line.startsWith("Hardware:")),
      `Hardware: ${label}`,
    );
  }
});

test("computer lists default to your assignments and suggest --all only when it adds results", async (t) => {
  const other = { ...computer, id: "comp_bB3dE5gH7jK", assigned_user_id: "user_other" };
  const unassigned = { ...computer, id: "comp_cB3dE5gH7jK", assigned_user_id: null };
  let computers = [computer, other, unassigned];
  const { run, requests } = await fixture(t, ({ path }) => {
    if (path === "/v1/computers?assigned=me") {
      return [
        200,
        { computers: computers.filter((row) => row.assigned_user_id === "user_fixture") },
      ];
    }
    if (path === "/v1/computers") return [200, { computers }];
    assert.equal(path, "/v1/auth/status");
    return [200, { userId: "user_fixture", orgId: "org_fixture" }];
  });
  async function list(...args) {
    const result = await run(["computers", "list", ...args]);
    assert.equal(result.code, 0, result.err);
    return result;
  }
  const mine = await list();
  assert.match(mine.out, /ID\s+NAME\s+ASSIGNED USER/);
  assert.match(mine.out, /Example\s+user_fixture$/m);
  assert.doesNotMatch(mine.out, /user_other|Unassigned/);
  const beforeMine = requests.length;
  assert.deepEqual(JSON.parse((await list("--json")).out), { computers: [computer] });
  assert.deepEqual(
    requests.slice(beforeMine).map((req) => req.path),
    ["/v1/computers?assigned=me"],
  );
  const all = await list("--all");
  assert.match(all.out, /Example\s+user_fixture$/m);
  assert.match(all.out, /Example\s+user_other$/m);
  assert.match(all.out, /Example\s+Unassigned$/m);
  const before = requests.length;
  assert.deepEqual(JSON.parse((await list("--all", "--json")).out), { computers });
  assert.deepEqual(
    requests.slice(before).map((r) => r.path),
    ["/v1/computers"],
  );

  computers = [other, unassigned];
  assert.match((await list()).out, /roy computers list --all/);
  const beforeEmpty = requests.length;
  const emptyMine = await list("--json");
  assert.deepEqual(
    requests.slice(beforeEmpty).map((req) => req.path),
    ["/v1/computers?assigned=me", "/v1/computers"],
  );
  assert.deepEqual(JSON.parse(emptyMine.out), { computers: [] });
  assert.match(emptyMine.err, /roy computers list --all/);
  computers = [];
  const empty = await list();
  assert.equal(empty.out.trim(), "No computers.");
  assert.equal(empty.err, "");
  assert.equal((await list("--json")).err, "");
});

test("omitted computer IDs resolve a sole assignment and cache it per saved login", async (t) => {
  const secondId = "comp_bB3dE5gH7jK";
  let rows = [];
  let discoveries = 0;
  const { run, requests, origin, directory } = await fixture(t, ({ path }) => {
    if (path === "/v1/computers?assigned=me") {
      discoveries++;
      return [200, { computers: rows }];
    }
    if (path === `/v1/computers/${id}/refresh-state`)
      return [200, { state_cache: cache, refreshed: true, retryAfterMs: 1000 }];
    if (path === `/v1/computers/${secondId}/ssh-keys`) return [200, { keys: [] }];
    if (path === `/v1/computers/${id}`)
      return [200, { computer: { ...computer, server, state_cache: cache } }];
    if (path === `/v1/computers/${id}/containers`) return [202];
    throw new Error("Unexpected route");
  });
  const dir = join(directory, "roycomputing");
  await mkdir(dir);
  const file = join(dir, createHash("sha256").update(origin).digest("hex") + ".json");
  await writeFile(
    file,
    JSON.stringify({
      accessToken: "saved-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000,
      tokenEndpoint: origin + "/token",
      clientId: "public-client",
      profile: { userId: "user_fixture", orgId: "org_fixture" },
    }),
  );
  const saved = (...args) => run(["--json", ...args], { token: "" });
  const none = await saved("containers", "create", "site");
  assert.equal(none.code, 1);
  assert.match(none.err, /No active computer is assigned to you/);
  assert.equal(none.out, "");
  rows = [computer, { ...computer, id: secondId }];
  const ambiguous = await saved("containers", "create", "site");
  assert.equal(ambiguous.code, 1);
  assert.match(ambiguous.err, /More than one.*--computer <id>.*roy computers list/);
  const positional = await saved("computers", "get");
  assert.equal(positional.code, 1);
  assert.match(positional.err, /roy computers get <id>/);
  assert.ok(requests.every((req) => req.method === "GET"));

  rows = [computer];
  const before = discoveries;
  const results = await Promise.all([saved("containers", "list"), saved("computers", "get")]);
  for (const result of results) assert.equal(result.code, 0, result.err);
  assert.equal(discoveries, before + 1);
  rows = [];
  const explicit = await saved("ssh-keys", "list", "--computer", secondId);
  assert.equal(explicit.code, 0, explicit.err);
  assert.equal(requests.at(-1).path, `/v1/computers/${secondId}/ssh-keys`);
  const create = await saved("containers", "create", "site");
  assert.equal(create.code, 0, create.err);
  assert.equal(JSON.parse(create.out).computer, id);
  assert.equal(discoveries, before + 1);
  const external = await run(["containers", "list"]);
  assert.equal(external.code, 1);
  assert.match(external.err, /No active computer/);

  const login = JSON.parse(await readFile(file, "utf8"));
  login.soleComputer.checkedAt = Date.now() - 300_001;
  await writeFile(file, JSON.stringify(login));
  rows = [{ ...computer, id: secondId }];
  const newTarget = await saved("ssh-keys", "list");
  assert.equal(newTarget.code, 0, newTarget.err);
  assert.equal(requests.at(-1).path, `/v1/computers/${secondId}/ssh-keys`);
});

test("errors stay on stderr, invalid targets and private key inputs never reach the API", async (t) => {
  const { run, requests } = await fixture(t, () => [503, { error: "Service unavailable" }]);
  const error = await run(["containers", "create", "website", ...target, "--json"]);
  assert.equal(error.code, 1);
  assert.equal(error.out, "");
  assert.match(error.err, /HTTP 503.*roy containers list/);
  assert.equal(requests.length, 1);
  assert.equal((await run(["containers", "delete", "..", ...target])).code, 2);
  for (const input of [
    "-----BEGIN PRIVATE KEY-----\nfixture",
    publicKey + "\n" + publicKey + "\n",
    "restrict " + publicKey + "\n",
  ]) {
    const invalid = await run(["ssh-keys", "add", ...target, "--key-file", "-"], { input });
    assert.equal(invalid.code, 1);
    assert.match(invalid.err, /Expected one OpenSSH public key/);
  }
  const isolated = await run(["computers", "list"], {
    tokenOrigin: "https://api.roycomputing.com",
  });
  assert.equal(isolated.code, 1);
  assert.equal(requests.length, 1);
});

test("device approval, concurrent refresh, verified identity and logout", async (t) => {
  let rotations = 0;
  let profileRequests = 0;
  let denyStatus = false;
  let profileUnavailable = false;
  const ids = { userId: "user_fixture", orgId: "org_fixture" };
  let fields = {
    firstName: "Alex",
    lastName: "Lee",
    email: "alex@example.test",
    orgName: "Example Org",
  };
  const { run, requests, origin, directory } = await fixture(t, ({ path, auth, body }, base) => {
    if (path === "/v1/cli/auth/config") return [200, { issuer: base, clientId: "public-client" }];
    if (path === "/.well-known/oauth-authorization-server")
      return [
        200,
        {
          issuer: base,
          device_authorization_endpoint: base + "/device",
          token_endpoint: base + "/token",
          revocation_endpoint: base + "/revoke",
        },
      ];
    const form = new URLSearchParams(body);
    if (path === "/device") {
      assert.equal(form.get("client_id"), "public-client");
      assert.equal(form.get("scope"), "user:org:read offline_access profile email");
      return [
        200,
        {
          device_code: "private-device",
          user_code: "AB-CD",
          verification_uri: base + "/approve",
          verification_uri_complete: base + "/approve?code=AB-CD",
          expires_in: 120,
          interval: 1,
        },
      ];
    }
    if (path === "/token") {
      if (form.get("grant_type") === "refresh_token") {
        assert.equal(form.get("refresh_token"), "private-refresh");
        rotations++;
        return [
          200,
          {
            access_token: "access-two",
            refresh_token: "refresh-two",
            expires_in: 300,
            token_type: "Bearer",
          },
        ];
      }
      assert.equal(form.get("device_code"), "private-device");
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
      return [
        200,
        {
          access_token: "access-one",
          refresh_token: "private-refresh",
          expires_in: 10,
          token_type: "Bearer",
        },
      ];
    }
    if (path === "/revoke") {
      assert.equal(form.get("token"), "refresh-two");
      return [200, {}];
    }
    if (path === "/v1/computers?assigned=me") return [200, { computers: [computer] }];
    if (auth === "Bearer fixture-access") {
      assert.equal(path, "/v1/auth/status");
      return [200, { userId: "user_env", orgId: "org_env" }];
    }
    assert.equal(auth, rotations ? "Bearer access-two" : "Bearer access-one");
    if (path === "/v1/auth/status?profile=true") {
      profileRequests++;
      return profileUnavailable
        ? [503, { error: "Profile unavailable" }]
        : [200, { ...ids, ...fields }];
    }
    assert.equal(path, "/v1/auth/status");
    return denyStatus ? [403, { error: "Membership required" }] : [200, ids];
  });
  const saved = { token: "" };
  const login = await run(["auth", "login"], saved);
  assert.equal(login.code, 0, login.err);
  assert.equal(login.out.trim(), "Signed in as Alex Lee (alex@example.test) in Example Org.");
  assert.match(login.err, /approve\?code=AB-CD/);
  assert.doesNotMatch(login.err + login.out, /private-device|private-refresh|access-one/);
  const dir = join(directory, "roycomputing");
  const [file] = await readdir(dir);
  assert.equal((await stat(join(dir, file))).mode & 0o777, 0o600);
  const statuses = await Promise.all([
    run(["auth", "status", "--json"], saved),
    run(["auth", "status"], saved),
  ]);
  for (const result of statuses) assert.equal(result.code, 0, result.err);
  assert.deepEqual(JSON.parse(statuses[0].out), {
    ...ids,
    ...fields,
    api: origin,
  });
  assert.match(statuses[1].out, /^User: Alex Lee \(alex@example\.test\)$/m);
  assert.equal(rotations, 1);
  assert.equal(profileRequests, 1);

  async function expireProfile() {
    const path = join(dir, file);
    const login = JSON.parse(await readFile(path, "utf8"));
    login.profileAttemptAt = Date.now() - 300_001;
    await writeFile(path, JSON.stringify(login));
  }
  const list = () => run(["computers", "list"], saved);
  const before = requests.length;
  assert.match((await list()).out, /Alex Lee \(alex@example\.test\)/);
  assert.deepEqual(
    requests.slice(before).map((r) => r.path),
    ["/v1/computers?assigned=me"],
  );
  await expireProfile();
  fields = { lastName: "Rivera", orgName: "Renamed Org" };
  const concurrent = await Promise.all([list(), list(), list()]);
  for (const result of concurrent) assert.match(result.out, /Example\s+Rivera$/m, result.err);
  assert.equal(profileRequests, 2);

  await expireProfile();
  profileUnavailable = true;
  assert.match((await list()).out, /Example\s+Rivera$/m);
  assert.match((await list()).out, /Example\s+Rivera$/m);
  assert.equal(profileRequests, 3);
  denyStatus = true;
  assert.equal((await run(["auth", "status"], saved)).code, 1);
  denyStatus = false;
  const external = await run(["auth", "status", "--json"]);
  assert.deepEqual(JSON.parse(external.out), { userId: "user_env", orgId: "org_env", api: origin });
  ids.orgId = "org_different";
  const switched = await run(["auth", "status"], saved);
  assert.match(switched.out, /^User: user_fixture$/m);
  assert.match(switched.out, /^Organization: org_different$/m);
  assert.equal((await run(["auth", "logout"], saved)).code, 0);
  assert.deepEqual(await readdir(dir), []);
  assert.equal(requests.at(-1).path, "/revoke");
  assert.equal((await run(["auth", "status"], saved)).code, 1);
});

test("listing a named container waits for an SSH address, respects cooldown, and excludes the host SSH port", async (t) => {
  let count = 0;
  let first;
  let available = true;
  const { run, requests } = await fixture(t, ({ path }) => {
    if (path.endsWith("/refresh-state")) {
      count++;
      const item = structuredClone(snapshot.containers[0]);
      if (count === 1) {
        first = Date.now();
        item.config = { "user.roycomputing.is-marked-as": "creating" };
      } else if (!available) {
        item.devices.ssh.listen = "tcp:0.0.0.0:2999";
      } else {
        assert.ok(Date.now() - first >= 1100);
      }
      return [
        200,
        {
          refreshed: true,
          retryAfterMs: 1100,
          state_cache: {
            ...cache,
            snapshot: {
              ...snapshot,
              containers: [item, { ...item, name: "other", status: "Stopped" }],
            },
          },
        },
      ];
    }
    return [200, { computer: { ...computer, server, state_cache: cache } }];
  });
  const ready = await run(["containers", "list", "website", ...target, "--wait", "10", "--json"]);
  assert.equal(ready.code, 0, ready.err);
  assert.deepEqual(JSON.parse(ready.out), {
    containers: [{ ...snapshot.containers[0], sshCommand: "ssh -p 2345 roy@192.0.2.1" }],
    updatedAt: observed,
  });
  assert.equal(count, 2);
  available = false;
  const before = requests.length;
  const unavailable = await run(["containers", "list", ...target, "--json"]);
  assert.equal(unavailable.code, 0, unavailable.err);
  assert.deepEqual(
    JSON.parse(unavailable.out).containers.map((c) => [c.name, c.sshCommand]),
    [
      ["website", null],
      ["other", null],
    ],
  );
  assert.equal(requests.length, before + 1);
  const timeout = await run(["containers", "list", "website", ...target, "--wait", "1"]);
  assert.equal(timeout.code, 1);
  assert.match(timeout.err, /No SSH address available for website yet/);
  const missing = await run(["containers", "list", ...target, "--wait", "1"]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /Specify the container/);
});

test("waiting for a container lets it appear and reports what the last list showed at timeout", async (t) => {
  let polls = 0;
  let retryAfterMs = 1000;
  let nextSnapshot = () => (polls === 1 ? { ...snapshot, containers: [] } : snapshot);
  const { run } = await fixture(t, ({ path }) => {
    if (path.endsWith("/refresh-state")) {
      polls++;
      return [
        200,
        {
          refreshed: true,
          retryAfterMs,
          state_cache: { ...cache, snapshot: nextSnapshot() },
        },
      ];
    }
    return [200, { computer: { ...computer, server, state_cache: cache } }];
  });
  const args = ["containers", "list", "website", ...target, "--wait"];
  const ready = await run([...args, "10"]);
  assert.equal(ready.code, 0, ready.err);
  assert.match(ready.out, /ssh -p 2345/);
  assert.equal(polls, 2);

  retryAfterMs = 60_000;
  nextSnapshot = () => ({
    ...snapshot,
    containers: [{ ...snapshot.containers[0], name: "other" }],
  });
  const started = Date.now();
  const absent = await run([...args, "1"]);
  assert.equal(absent.code, 1);
  assert.match(
    absent.err,
    /No container named website in the latest list\. Check with roy containers list --computer/,
  );
  assert.ok(Date.now() - started >= 1000);
  assert.equal(polls, 3);

  nextSnapshot = () => null;
  const unknown = await run([...args, "1"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /Container list unavailable/);
});

test("SSH-key listings show the file modification time only when available", async (t) => {
  const lastModifiedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const keys = [];
  const { run } = await fixture(t, ({ path }) => [
    200,
    path.includes("/containers/") ? { keys: [] } : { keys, lastModifiedAt },
  ]);
  const args = ["ssh-keys", "list", ...target];
  const host = await run(args);
  assert.equal(host.code, 0, host.err);
  assert.equal(host.out, "Last modified 3 hours ago\nNo SSH keys.\n");
  assert.deepEqual(JSON.parse((await run([...args, "--json"])).out), { keys: [], lastModifiedAt });
  keys.push({ key: publicKey, comment: "laptop", options: "" });
  const populated = await run(args);
  assert.equal(populated.code, 0, populated.err);
  assert.match(populated.out, /^Last modified 3 hours ago\nFINGERPRINT +COMMENT\n/);
  const containerArgs = [...args, "--container", "website"];
  const container = await run(containerArgs);
  assert.equal(container.code, 0, container.err);
  assert.equal(container.out, "No SSH keys.\n");
  assert.deepEqual(JSON.parse((await run([...containerArgs, "--json"])).out), { keys: [] });
});

test("SSH-key fingerprints match OpenSSH and identify the exact key on the selected target", async (t) => {
  const type = "ssh-ed25519";
  function field(bytes) {
    const data = Buffer.from(bytes);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    return Buffer.concat([size, data]);
  }
  const bytes = Buffer.alloc(32, 1);
  const key = type + " " + Buffer.concat([field(type), field(bytes)]).toString("base64");
  // ssh-keygen -E sha256 -lf for the synthetic Ed25519 public key above.
  const fingerprint = "SHA256:RXm/ruZ0eTzRXKwi1AQEDynB0VgHQ2ac9KPSFdf/YnA";
  const certType = type + "-cert-v01@openssh.com";
  const certificate =
    certType +
    " " +
    Buffer.concat([field(certType), field("nonce"), field(bytes)]).toString("base64");
  const longComment = "a".repeat(28) + "🌟bc";
  const entry = { key, comment: longComment, options: "restrict" };
  let keys = [entry, { ...entry, comment: "b".repeat(30) }];
  const { run, requests } = await fixture(t, ({ method }) =>
    method === "GET" ? [200, { keys }] : [204],
  );
  const list = await run(["ssh-keys", "list", ...target]);
  assert.equal(list.code, 0, list.err);
  const [header, first, second] = list.out.trimEnd().split("\n");
  assert.deepEqual(header.split(/\s+/), ["FINGERPRINT", "COMMENT"]);
  assert.deepEqual(first.split(/\s+/), [fingerprint, "a".repeat(28) + "🌟…"]);
  assert.deepEqual(second.split(/\s+/), [fingerprint, "b".repeat(30)]);
  const json = await run(["ssh-keys", "list", ...target, "--json"]);
  assert.deepEqual(JSON.parse(json.out).keys[0], { ...entry, fingerprint });

  for (const container of [undefined, "website"]) {
    const args = ["ssh-keys", "remove", ...target, "--fingerprint", fingerprint];
    if (container) args.push("--container", container);
    const path = `/v1/computers/${id}${container ? "/containers/website/ssh-keys" : "/ssh-keys"}`;
    const before = requests.length;
    const result = await run(args);
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(
      requests.slice(before).map((r) => [r.method, r.path]),
      [
        ["GET", path],
        ["DELETE", path],
      ],
    );
    assert.deepEqual(JSON.parse(requests.at(-1).body), { key });
  }
  const args = ["ssh-keys", "remove", ...target, "--fingerprint", fingerprint];
  keys = [{ ...entry, key: certificate }];
  const cert = await run(args);
  assert.equal(cert.code, 0, cert.err);
  assert.deepEqual(JSON.parse(requests.at(-1).body), { key: certificate });
  keys.push(entry);
  const before = requests.length;
  const ambiguous = await run(args);
  assert.equal(ambiguous.code, 1);
  assert.match(ambiguous.err, /Different keys share.*--key-file/);
  keys = [];
  const missing = await run(args);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /No SSH key matches.*roy ssh-keys list/);
  for (const options of [
    [],
    ["--fingerprint", "short"],
    ["--fingerprint", fingerprint, "--key-file", "-"],
  ]) {
    assert.equal((await run(["ssh-keys", "remove", ...target, ...options])).code, 2);
  }
  assert.deepEqual(
    requests.slice(before).map((r) => r.method),
    ["GET", "GET"],
  );
});
