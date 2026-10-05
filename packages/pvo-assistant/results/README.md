# Prepared cloud task results

This facade is the immutable artifact contract consumed by owned task storage and the editor. It depends on the public native operation and saved-task contracts; neither package imports it back.

`prepareTaskResult(task, operations)` derives the account, project, task and starting fingerprint from an actual saved task. `parsePreparedTaskResult` rejects extra fields, empty batches, more than 24 operations, unsupported operations, and artifacts over 1 MiB. The only operation kinds are component add/update/content/style/source/delete. There are no provider effects, playback, export, credentials or model-selected result URLs.

`serializePreparedTaskResult` validates then sorts object keys recursively to produce canonical JSON. The storage adapter hashes its UTF-8 bytes. The editor verifies actual downloaded byte length and SHA-256 before `matchPreparedTaskResult` checks all ownership and starting-project fields. Source compilation and request/advanced-editing policies remain in native preparation and commit validation; a parsed artifact alone is not a successful build or authorization to apply.

`parseTaskApplication` validates local `{ownerId, projectId, taskId, artifact}` replay metadata. The editor saves it atomically beside the project, outside Undo history and exported PVO content. The local metadata grants no server access. See the [owned adapter and editor lifecycle](../../../server/assistant/tasks/README.md#prepared-results-and-application-1b07).
