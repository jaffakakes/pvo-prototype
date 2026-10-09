import assert from "node:assert/strict";

/** Matches the pinned Wrangler named-image repository; every proof uses a unique class. */
export function proofImageRepository(id) {
  assert.match(id, /^[a-f0-9]{24}$/);
  return `restyle-workspace-proof-${id}-restylenode${id}-runtime`;
}

export async function listProofImages(resource, run) {
  const repository = resource.imageRepository;
  if (!repository) return [];
  const { stdout } = await run(resource, [
    "containers",
    "images",
    "list",
    "--json",
    "--filter",
    repository,
  ]);
  const rows = JSON.parse(stdout);
  assert.ok(Array.isArray(rows), "Invalid image inventory");
  return rows
    .filter((row) => row.name === repository)
    .flatMap((row) => {
      assert.ok(Array.isArray(row.tags), "Invalid image tags");
      return row.tags.map((tag) => {
        assert.match(tag, /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/);
        return `${repository}:${tag}`;
      });
    });
}

export async function removeProofImages(resource, run, save) {
  if (!resource.imageRepository) return;
  assert.equal(
    resource.imageOwnershipVerified,
    true,
    "Image ownership was not established before upload",
  );
  const images = await listProofImages(resource, run);
  resource.imageTags = [...new Set([...(resource.imageTags ?? []), ...images])];
  await save();
  for (const image of images)
    await run(resource, [
      "containers",
      "images",
      "delete",
      image,
      "--skip-confirmation",
    ]);
  assert.deepEqual(
    await listProofImages(resource, run),
    [],
    "Proof image remains in registry",
  );
  resource.imagesRemoved = true;
  await save();
}
