import { createRenderServer } from "./service.js";

const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port.");

createRenderServer().listen(port, "0.0.0.0", () => {
  console.log(`Restyle renderer ready on port ${port}.`);
});
