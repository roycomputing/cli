import type { Container } from "./schemas.js";
import { table } from "./output.js";

export function connectionPort(container: Container): number | undefined {
  const ssh = container.devices?.ssh;
  if (
    container.status !== "Running" ||
    container.config?.["user.roycomputing.is-marked-as"] ||
    ssh?.type !== "proxy" ||
    ssh.bind !== "host" ||
    ssh.connect !== "tcp:127.0.0.1:22"
  ) {
    return undefined;
  }
  const match = /^tcp:0\.0\.0\.0:(\d{1,5})(?![\s\S])/u.exec(ssh.listen ?? "");
  const port = Number(match?.[1]);
  return port > 0 && port <= 65535 && port !== 2999 ? port : undefined;
}

export function withSshCommand(container: Container, host: string | undefined) {
  const port = connectionPort(container);
  return {
    ...container,
    sshCommand: host && port !== undefined ? `ssh -p ${port} roy@${host}` : null,
  };
}

export function containerTable(
  containers: ReturnType<typeof withSshCommand>[],
  empty = "No containers.",
): string {
  return table(
    ["NAME", "STATUS", "OPERATION", "SSH COMMAND"],
    containers.map((c) => [
      c.name ?? "—",
      c.status ?? "Unknown",
      c.config?.["user.roycomputing.is-marked-as"] ?? "—",
      c.sshCommand ?? "—",
    ]),
    empty,
  );
}
