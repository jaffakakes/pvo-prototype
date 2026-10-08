import { SERVICE_RUNTIME } from "../../packages/pvo-assistant/services/index.js";

const origin = "https://restyle-beta.jaffakakes28.workers.dev";
const productionDatabase = "46ed24c3-1bc3-487a-95cf-7b6b58c1db88";

/** Reject production and cross-environment resource selection before invoking Wrangler. */
export function assertBetaDeployment(config) {
  const fail = (message) => {
    throw new Error(`Beta deployment rejected: ${message}`);
  };
  if (config?.name !== "restyle-beta" || config.vars?.PUBLIC_ORIGIN !== origin)
    fail("the Worker and HTTPS origin must identify the isolated beta.");
  if (
    config.account_id !== "84880ccf8f98bb789d58cbea5436a645" ||
    config.routes ||
    config.route ||
    config.services ||
    config.env
  )
    fail(
      "custom routes, other accounts and cross-Worker services are excluded.",
    );
  const databases = config.d1_databases;
  if (
    !Array.isArray(databases) ||
    databases.length !== 1 ||
    databases[0].binding !== "DB" ||
    databases[0].database_name !== "restyle-beta-accounts" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      databases[0].database_id ?? "",
    ) ||
    databases[0].database_id === productionDatabase ||
    /^0{8}-/.test(databases[0].database_id)
  )
    fail("a separate beta account database is required.");
  const buckets = config.r2_buckets;
  if (
    !Array.isArray(buckets) ||
    buckets.length !== 1 ||
    buckets[0].binding !== "MEDIA" ||
    buckets[0].bucket_name !== "restyle-beta-media"
  )
    fail("media must use the private beta bucket.");
  if (
    config.assets?.directory !== "./.wrangler/beta/assets" ||
    config.assets?.binding !== "ASSETS" ||
    !config.vars.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    config.vars.CLERK_ISSUER !== "https://known-dog-5044.clerk.accounts.dev"
  )
    fail("checked beta assets and development sign-in are required.");
  if (
    config.vars.SERVICE_NODE_FLY_APP !== "restyle-beta-node" ||
    config.vars.SERVICE_NODE_FLY_IMAGE !==
      `registry.fly.io/restyle-beta-node@${SERVICE_RUNTIME.imageDigest}`
  )
    fail("Node execution must use the dedicated beta Fly app.");
  const containers = config.containers;
  if (
    !Array.isArray(containers) ||
    containers.length !== 1 ||
    containers[0].name !== "restyle-beta-workspaces" ||
    containers[0].class_name !== "AssistantWorkspace"
  )
    fail("development workshops must belong to beta.");
  const bindings = config.durable_objects?.bindings;
  if (
    !Array.isArray(bindings) ||
    !bindings.length ||
    bindings.some((binding) => binding.script_name || binding.namespace_id)
  )
    fail("SQLite namespaces must belong to this Worker.");
  for (const key of Object.keys(config.vars)) {
    if (/SECRET|TOKEN|API_KEY|CONNECTION_KEY|ASSISTANT_TASK_SPENDING/.test(key))
      fail("credentials and account grants belong in private Worker secrets.");
  }
  return config;
}
