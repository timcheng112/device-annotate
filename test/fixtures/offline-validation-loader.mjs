// Test-only import guard. The schema must work without any device or host I/O API.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "agent-device" || specifier.startsWith("agent-device/")) {
    throw new Error(`OFFLINE_BOUNDARY: ${specifier}`);
  }
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.startsWith("node:") || resolved.url.includes("/node_modules/agent-device/")) {
    throw new Error(`OFFLINE_BOUNDARY: ${specifier}`);
  }
  return resolved;
}
