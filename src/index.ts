#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { accessToken, currentUser, logout, saveLogin } from "./credentials.js";
import { registerComputers, registerOrders } from "./computers.js";
import { registerContainers } from "./containers.js";
import { apiOrigin, plain } from "./http.js";
import { deviceLogin } from "./oauth.js";
import { example, output } from "./output.js";
import { refreshProfile, userLabel } from "./profile.js";
import { registerKeys } from "./ssh-keys.js";

const program = new Command()
  .name("roy")
  .configureHelp({ showGlobalOptions: true })
  .description("Manage RoyComputing computers and containers")
  .version("0.1.0")
  .option("--json", "write one JSON result on success")
  .showHelpAfterError()
  .exitOverride();
program.addHelpText(
  "after",
  "\nStart with roy auth login, then roy computers list.\nUse roy <command> <subcommand> --help for arguments and examples.",
);
const auth = program
  .command("auth")
  .description("Sign in and inspect the active user and organization");
example(
  auth
    .command("login")
    .description("Sign in using a browser on any device")
    .action(async (_, cmd: Command) => {
      if (process.env.ROYCOMPUTING_TOKEN) {
        throw new Error("Unset ROYCOMPUTING_TOKEN to use browser login.");
      }
      const credentials = await deviceLogin();
      const user = await refreshProfile(credentials.accessToken);
      await saveLogin({ ...credentials, profile: user, profileAttemptAt: Date.now() });
      output(
        cmd,
        { ...user, api: apiOrigin() },
        `Signed in as ${userLabel(user)} in ${plain(user.orgName ?? user.orgId)}.`,
      );
    }),
  "auth login",
);
auth
  .command("status")
  .description("Verify your login and show user, organization and API")
  .action(async (_, cmd: Command) => {
    const user = await currentUser(await accessToken(), "verify");
    output(
      cmd,
      { ...user, api: apiOrigin() },
      `User: ${userLabel(user)}\nOrganization: ${plain(user.orgName ?? user.orgId)}\nAPI: ${apiOrigin()}`,
    );
  });
example(
  auth
    .command("logout")
    .description("Remove the saved login for this API")
    .action(async (_, cmd: Command) => {
      if (process.env.ROYCOMPUTING_TOKEN) {
        throw new Error("Unset ROYCOMPUTING_TOKEN to stop using the environment credential.");
      }
      await logout();
      output(cmd, { api: apiOrigin(), signedIn: false }, `Signed out of ${apiOrigin()}.`);
    }),
  "auth logout",
);
registerOrders(program);
registerComputers(program);
registerContainers(program);
registerKeys(program);

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    process.stderr.write(
      `roy: ${plain(error instanceof Error ? error.message : "Command failed")}\n`,
    );
    process.exitCode = 1;
  }
}
