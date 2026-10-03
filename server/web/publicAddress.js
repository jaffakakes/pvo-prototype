import { HttpError } from "../http.js";

/** Only ordinary public HTTPS hostnames are supported, including on redirects. */
export function publicHttpsUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new HttpError(400, "Use a complete public HTTPS URL."); }
  const host = url.hostname.toLowerCase();
  if (url.href.length > 2048 || url.protocol !== "https:" || url.username || url.password || url.port
    || !host.includes(".") || host.endsWith(".") || host.startsWith("[")
    || /^\d+(?:\.\d+){3}$/.test(host)
    || !/^[a-z0-9.-]+$/.test(host)
    || host.split(".").some(label => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))
    || /(?:^|\.)(?:localhost|local|internal|intranet|test|invalid|example|onion|home|lan)$/.test(host))
    throw new HttpError(400, "Only public HTTPS websites are supported.");
  url.hash = "";
  return url;
}

function publicIpv4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split(".").map(Number);
  if (parts.some(part => part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || a === 100 && b >= 64 && b <= 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99)
    || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113);
}

/** IPv6 accepts global unicast only; mapped IPv4, local and special ranges fail. */
export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  if (!address.includes(":")) return publicIpv4(address);
  if (!/^[0-9a-f:]+$/i.test(address) || address.split("::").length > 2) return false;
  const [left, right] = address.toLowerCase().split("::");
  const before = left ? left.split(":") : [];
  const after = right ? right.split(":") : [];
  const missing = 8 - before.length - after.length;
  if (right === undefined ? missing !== 0 : missing < 1) return false;
  const words = [...before, ...Array(missing).fill("0"), ...after];
  if (words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return false;
  const [first, second] = words.map(word => parseInt(word, 16));
  return first >= 0x2000 && first <= 0x3fff
    && !(first === 0x2001 && (second < 0x0200 || second === 0x0db8))
    && !(first === 0x3fff && second < 0x1000);
}
