import { containerTable, withSshCommand } from "./container-list.js";
import { localTimezone } from "./timezone.js";
import type { Command } from "commander";
import { computerHelp, computerTarget, getComputers } from "./target.js";
import { userLabel } from "./profile.js";
import { get, mutate } from "./client.js";
import { accessToken, currentUser } from "./credentials.js";
import { plain } from "./http.js";
import { detail, orders, type Identity } from "./schemas.js";
import { computerId, example, output, table, timeAgo, usesJson } from "./output.js";

function countLabel(count: number | null, unit: string): string | undefined {
  if (count === null) {
    return undefined;
  }
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function assignedUser(id: string | null, user?: Identity): string {
  if (id === null) {
    return "Unassigned";
  }
  return id === user?.userId ? userLabel(user) : plain(id);
}

async function listComputers(options: { all?: boolean }, cmd: Command): Promise<void> {
  const token = await accessToken();
  const rows = await getComputers(token, options.all);
  const machineReadable = usesJson(cmd);
  const user =
    !machineReadable && rows.some((row) => row.assignedUserId !== null)
      ? await currentUser(token)
      : undefined;
  const hint = "Run roy computers list --all to include other computers in this organization.";
  const othersExist =
    !options.all && rows.length === 0 && (await getComputers(token, true)).length > 0;
  if (othersExist && machineReadable) {
    process.stderr.write(`${hint}\n`);
  }
  output(
    cmd,
    { computers: rows },
    table(
      ["ID", "NAME", "ASSIGNED USER"],
      rows.map((row) => [row.id, row.prettyName, assignedUser(row.assignedUserId, user)]),
      othersExist ? `No computers are assigned to you. ${hint}` : "No computers.",
    ),
  );
}

export function registerComputers(program: Command): void {
  const group = program.command("computers").description("Find and manage computers");
  group
    .command("list")
    .description("List your latest 50 active assigned computers")
    .option("--all", "include computers assigned to others and unassigned computers")
    .action(listComputers);
  group
    .command("get")
    .argument("[id]", computerHelp, computerId)
    .description("Show hardware, installation and containers")
    .action(async (explicit: string | undefined, _, cmd: Command) => {
      const { id, token } = await computerTarget(explicit, "a computer ID: roy computers get <id>");
      const data = await get(`computers/${id}`, detail, token);
      const { prettyName, server, stateCache, assignedUserId } = data.computer;
      const user = assignedUserId && !usesJson(cmd) ? await currentUser(token) : undefined;
      const snapshot = stateCache?.snapshot;
      const containers = snapshot?.containers.map((c) => withSshCommand(c, server.ipv4)) ?? [];
      if (snapshot) {
        snapshot.containers = containers;
      }
      const { cpu, isBareMetal, memoryGb, diskGb, diskType, diskInterface } = server.specs;
      const storageInterface = diskInterface === "nvme" ? "NVMe" : diskInterface.toUpperCase();
      const hardware = [
        countLabel(cpu.cores, isBareMetal ? "core" : "vCPU"),
        countLabel(cpu.threads, "thread"),
        `${memoryGb} GB RAM`,
        `${diskGb} GB ${storageInterface} ${diskType.toUpperCase()}`,
      ]
        .filter(Boolean)
        .join(", ");
      output(
        cmd,
        data,
        [
          `Computer: ${plain(prettyName)} (${id})`,
          `Assigned user: ${assignedUser(assignedUserId, user)}`,
          `Host SSH: ssh -p 2999 roy@${server.ipv4}`,
          `Location: ${plain(server.country)}`,
          `Hardware: ${isBareMetal ? "Bare-metal " : ""}${hardware}`,
          `Installation: ${plain(server.installation?.status ?? (server.isMarkedAsInstalling ? "installing" : "No installation in progress"))}`,
          "",
          snapshot
            ? `Containers (updated ${timeAgo(snapshot.capturedAt)})\n${containerTable(containers)}`
            : `Container list unavailable. Run roy containers list --computer ${id} to refresh it.`,
        ].join("\n"),
      );
    });
  example(
    group
      .command("reinstall")
      .argument("<id>", "computer ID", computerId)
      .description("Reinstall the computer operating system. This erases data.")
      .action(async (id: string, _, cmd: Command) => {
        const next = `roy computers get ${id}`;
        await mutate(
          `computers/${id}/start-installation`,
          "POST",
          202,
          { timezone: localTimezone() },
          `Inspect installation with: ${next}`,
        );
        output(
          cmd,
          { status: "accepted", computer: id },
          `Reinstallation requested. Check progress with: ${next}`,
        );
      }),
    "computers reinstall <id>",
  );
}

export function registerOrders(program: Command): void {
  program
    .command("orders")
    .description("Inspect organization orders")
    .command("list")
    .description("List the latest 20 orders")
    .action(async (_, cmd: Command) => {
      const data = await get("orders", orders);
      output(
        cmd,
        data,
        table(
          ["ORDER", "STATUS", "BILLING", "COMPUTER"],
          data.orders.map((row) => [
            row.id,
            row.indicativeStatusPrettyString,
            row.indicativeBillingStatusPrettyString,
            row.computer?.prettyName ?? "—",
          ]),
          "No orders.",
        ),
      );
    });
}
