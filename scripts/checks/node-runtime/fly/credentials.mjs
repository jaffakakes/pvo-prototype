import assert from "node:assert/strict";
import { flyFetch } from "./connection.mjs";

/** Only the trusted, disposable image builder receives this short app-scoped registry credential. */
export function flyBuildCredentials(
  token,
  resources,
  { fetchImpl = fetch } = {},
) {
  const { report, save } = resources;
  const name = `restyle-image-${report.id}`;
  async function query(query, variables) {
    const response = await flyFetch(fetchImpl, "https://api.fly.io/graphql", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok)
      throw new Error(`Fly credential request failed (${response.status})`);
    const bytes = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 256 * 1024) throw new Error("Fly credential reply too large");
      bytes.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(bytes).toString("utf8"));
    if (value.errors?.length) {
      const reason = value.errors
        .map((item) => String(item.message))
        .join("; ")
        .replaceAll(token, "[redacted]")
        .slice(0, 600);
      throw new Error(`Fly credential request rejected: ${reason}`);
    }
    return value.data;
  }
  return {
    async create() {
      assert.equal(report.appVerified, true);
      assert.equal(
        report.buildCredential,
        undefined,
        "Credential creation is never retried",
      );
      report.buildCredential = { name, attempted: true, revoked: false };
      await save();
      const { organization, app } = await query(
        "query($slug:String!,$name:String!){organization(slug:$slug){id slug} app(name:$name){name organization{id}}}",
        { slug: report.org, name: report.app },
      );
      // Fly GraphQL can return the personal alias while Machines uses the account slug.
      // Verify the actual already-owned application's immutable organisation ID instead.
      assert.equal(app.name, report.app);
      assert.equal(organization.id, app.organization.id);
      report.buildCredential.organizationId = organization.id;
      await save();
      const { createLimitedAccessToken } = await query(
        "mutation($name:String!,$organizationId:ID!,$profile:String!,$profileParams:JSON,$expiry:String!){createLimitedAccessToken(input:{name:$name,organizationId:$organizationId,profile:$profile,profileParams:$profileParams,expiry:$expiry}){limitedAccessToken{id expiresAt tokenHeader}}}",
        {
          name,
          organizationId: organization.id,
          profile: "deploy",
          profileParams: { app_id: report.app },
          expiry: "15m",
        },
      );
      const result = createLimitedAccessToken.limitedAccessToken;
      assert.ok(result.id && result.tokenHeader && result.expiresAt);
      report.buildCredential.id = result.id;
      report.buildCredential.expiresAt = result.expiresAt;
      await save();
      return result.tokenHeader;
    },
    async revoke() {
      if (!report.buildCredential?.attempted || report.buildCredential.revoked)
        return;
      const { organization } = await query(
        "query($slug:String!){organization(slug:$slug){limitedAccessTokens{nodes{id name revokedAt}}}}",
        { slug: report.org },
      );
      const matches = organization.limitedAccessTokens.nodes.filter(
        (item) => item.name === name,
      );
      for (const item of matches) {
        if (report.buildCredential.id)
          assert.equal(item.id, report.buildCredential.id);
        if (!item.revokedAt)
          await query(
            "mutation($input:DeleteLimitedAccessTokenInput!){deleteLimitedAccessToken(input:$input){token}}",
            { input: { id: item.id } },
          );
      }
      report.buildCredential.revoked = true;
      await save();
    },
  };
}
