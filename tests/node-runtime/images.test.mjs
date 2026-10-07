import test from "node:test";
import assert from "node:assert/strict";
import {
  proofImageRepository,
  removeProofImages,
} from "../../scripts/checks/cloud-agent-infrastructure/proof-images.mjs";

test("registry ownership uses the deployed named image, not the local development cache", () => {
  assert.equal(
    proofImageRepository("6a0868727a1b5ab1fb09b420"),
    "restyle-workspace-proof-6a0868727a1b5ab1fb09b420-restylenode6a0868727a1b5ab1fb09b420-runtime",
  );
  assert.throws(() => proofImageRepository("../other"));
});

test("image cleanup removes only the recorded unique repository and verifies absence", async () => {
  const resource = {
    imageRepository: proofImageRepository("a".repeat(24)),
    imageOwnershipVerified: true,
  };
  let present = true,
    saves = 0;
  const deleted = [];
  const run = async (_, args) => {
    if (args[2] === "list")
      return {
        stdout: JSON.stringify([
          { name: "unrelated", tags: ["keep"] },
          ...(present
            ? [{ name: resource.imageRepository, tags: ["owned"] }]
            : []),
        ]),
      };
    assert.equal(args[2], "delete");
    deleted.push(args[3]);
    present = false;
    return {};
  };
  await removeProofImages(resource, run, async () => {
    saves++;
  });
  assert.deepEqual(deleted, [resource.imageRepository + ":owned"]);
  assert.equal(resource.imagesRemoved, true);
  assert.equal(saves, 2);
  await removeProofImages(resource, run, async () => {});
  assert.equal(
    deleted.length,
    1,
    "Recovery after deletion receipt loss is replay safe",
  );
  await assert.rejects(
    removeProofImages(
      { ...resource, imageOwnershipVerified: false },
      run,
      async () => {},
    ),
    /ownership/,
  );
});
