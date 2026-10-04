import { Container } from "@cloudflare/containers";

/** Cloudflare Durable Object entry point for the private FFmpeg service. */
export class RenderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;
}
