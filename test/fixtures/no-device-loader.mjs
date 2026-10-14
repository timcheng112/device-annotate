// CLI may read specs, but validation must not import device, network, or process-launch clients.
const denied = new Set(["node:net", "node:tls", "node:http", "node:https", "node:dgram", "node:child_process"]);
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "agent-device" || specifier.startsWith("agent-device/")) throw new Error(`OFFLINE_BOUNDARY: ${specifier}`);
  const resolved = await nextResolve(specifier, context);
  if (denied.has(resolved.url) || resolved.url.includes("/node_modules/agent-device/")) throw new Error(`OFFLINE_BOUNDARY: ${specifier}`);
  return resolved;
}
