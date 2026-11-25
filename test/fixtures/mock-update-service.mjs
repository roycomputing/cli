// Exercise the published-service URL and headers while keeping requests on the local fixture server.
const origin = process.env.ROYCOMPUTING_API_URL;
if (process.env.ROY_TEST_NOW) {
  const now = Number(process.env.ROY_TEST_NOW);
  Date.now = () => now;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (url === "https://registry.npmjs.org/@roycomputing%2Fcli/latest") {
    return originalFetch(origin + "/fixture/npm-latest", options);
  }
  if (new URL(url).origin !== origin) throw new Error("Unexpected network request");
  return originalFetch(url, options);
};
if (process.env.ROY_TEST_TTY === "1") {
  Object.defineProperty(process.stdout, "isTTY", { value: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true });
}
