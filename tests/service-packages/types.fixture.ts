import {
  parseServiceAgreement,
  parseServiceInvocation,
  parseServiceReply,
  parseServicePackage,
  SERVICE_RUNTIME,
  type ServiceAgreement,
  type ServiceExecute,
  type ServicePackage,
  type ServiceValueSchema,
} from "../../packages/pvo-assistant/services/index.js";

const agreement: ServiceAgreement = parseServiceAgreement({});
const call = parseServiceInvocation(agreement, {});
const execute: ServiceExecute = async ({ state }) => ({
  result: "accepted",
  state,
});
const result = parseServiceReply(agreement, call, await execute(call));
const source: ServicePackage = parseServicePackage({});
source.runtime = SERVICE_RUNTIME;
const schema: ServiceValueSchema = {
  type: "array",
  maxItems: 5,
  items: { type: "null" },
};
// @ts-expect-error Runtime requires the platform-supported target.
source.runtime = "unrestricted-node";
// @ts-expect-error The initial package lock admits no external dependencies.
source.dependencies = [{ name: "anything", version: "latest" }];
// @ts-expect-error Test claims are not a source-package capability.
source.passed = true;
const executable: ServiceValueSchema = {
  // @ts-expect-error Data descriptions cannot execute a custom validator.
  type: "function",
  code: "return true",
};
// @ts-expect-error A service must propose state alongside its result.
const incomplete: ServiceExecute = () => ({ result: null });
void result;
void schema;
void executable;
void incomplete;
