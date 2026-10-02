# PVO language v0.1

**Status:** The Rust Structure, Style, and Logic compiler in [`packages/pvo-language/`](../../packages/pvo-language/) is wired into the editor preview, interactive export, and player. [`SPEC.md`](../../SPEC.md) remains authoritative for the `.pvo` container, manifest, and playback semantics. PVO language authors one component; it is not a new video-package format.

## Two authoring routes, one component

New components start in **Content · Look · Action**. Content holds wording, controls and timing; Look holds presets and visual properties; Action configures supported playback outcomes. These settings generate the component's initial PVO source. The internal structured data is still named `fields`; it is not a separate tab in the current editor.

Forms start with a local Continue action. Continue, Jump to a point and Go to a scene need no destination or network request. The **Advanced** switch reveals editable PVO **Structure**, **Style** and **Logic** source. Authors write network requests directly in Logic using `request({...})`; there is no visual request setup. Existing request actions stay intact when Advanced is hidden, with an explicit replacement option in Action. This UI separation does not extend the Logic grammar: each event still has one fixed outcome, without conditional expressions or action sequences.

Enable **More → Advanced editing** to add the Advanced tab. This device preference is off by default, while choosing a starter template turns it on so that template's sample is ready to inspect. The preference remains independent of project history. Advanced shows editable Structure, Style and Logic for the same component; opening or hiding it preserves its behaviour and appearance. The first source edit starts from the current visual settings.

Valid source is automatically arranged into readable lines and indentation when opened, after AI changes, and when leaving a changed code field. There is no formatting button, and source stays still while you type. Formatting preserves text, values and compiler output; unfinished or invalid drafts remain untouched. Formatting after typing shares that edit's Undo step. Existing compact source formatted on opening can also be undone.

Valid source and AI proposals remain editable through **Content · Look · Action**. Wording and action edits synchronize with Structure and Logic while retaining unrelated source and control identifiers. Look reflects the current Style and changes only the property you choose. Exact sizes, weights, corners or colours outside the visual presets appear as **Custom** values; changing another property preserves them. Choosing a full look or **Reset appearance** replaces appearance while retaining wording and actions. Component timing stays independent of source.

Pending source edits briefly show **Checking your changes…**. An invalid draft remains intact and temporarily pauses Content and Look editing. Its local status offers **Open Advanced** and, when available, **Restore previous version**. Restore explicitly returns to the last validated source as an undoable edit. Invalid source blocks export; an older working compilation is never silently exported. Hiding Advanced does not discard the draft, and its recovery button can reopen Advanced. Unsupported legacy component formats have a separate confirmed recovery action that archives their original source.

A Message (the `card` type), Choice or Form has starter Logic for its controls. A Message without buttons has no rule yet. A Note (the `tooltip` type) is display-only, so its Logic tab is empty and read-only. Switching between component tabs does not cancel source validation. Forms retain their heading, field identities and types, waiting label and configured requests across visual and source edits. A visual label change does not silently change a request's field reference.

## What the compiler accepts

The Rust API parses Structure into a typed component, checks its root and direct children, checks Style against that component's own elements, and checks Logic against its actual controls. The same core is built to WebAssembly for browser use. Successful compilation returns semantic structure plus scoped CSS and renderer markup. It does **not** turn creator Logic into unrestricted JavaScript (`js` is empty). Failures report the section and a line/column diagnostic.

Each source section is capped at 20,000 bytes. Structure allows one root, direct children only, and at most 64 elements. IDs and field names start with a letter, contain only letters, numbers, `_` or `-`, and are at most 64 characters; prototype-sensitive names are rejected. Plain text is data; XML-style `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, and the numeric apostrophe `&#39;` are supported. Unknown tags, attributes, entities, and malformed closing tags are errors.

### Structure

| Root | Direct children | Rule |
| --- | --- | --- |
| `<tooltip>` | Exactly one `<text>` | Display-only. No button, link, or Logic event. |
| `<card>` | Optional `<title>` and `<body>`; up to two `<button id="…">` | At least a title or body. Button IDs are distinct. |
| `<choice>` | One `<prompt>` and 2–4 `<option id="…">` | Option IDs are distinct. Choosing does not inherently create a branch. |
| `<form>` | Optional `<heading>`, 1–20 self-closing `<field name="…" kind="…" />` and one `<submit>` | Field names are distinct. Kinds: `name`, `email`, `phone`, `short`, `number`, `yesno`. Optional field `label` supplies viewer wording; optional submit `waiting` supplies pending-request wording. |

Existing forms without these optional additions retain their default field labels. Numeric fields accept decimals; labels and heading text are escaped as text. For example:

```xml
<form>
  <heading>Reserve a place</heading>
  <field name="seats" kind="number" label="How many seats?" />
  <field name="contact" kind="email" label="Email address" />
  <submit waiting="Reserving…">Reserve</submit>
</form>
```

The `heading` selector styles a form's heading. The trusted host displays the waiting label only while the submit request is pending; setting it never initiates a request.

The root must match the component's kind. No arbitrary HTML nesting or attributes are accepted: `onclick`, `href`, `<script>`, `<style>`, `<iframe>`, generic `<div>`, and a button inside a Tooltip all fail. A visible `<text>` is not a click target.

```pvo
<choice>
  <prompt>Which look?</prompt>
  <option id="street">Streetwear</option>
  <option id="formal">Formal</option>
</choice>
```

The language core accepts two to four Choice options, but the current Restyle editor/player path authors and loads **exactly two**. Supporting three or four there is separate integration work; do not offer them in that UI yet.

### Style

Style is a restricted CSS-like sequence of rules, **without** a surrounding `style { … }` block. A selector is one typed element name present in this component (such as `prompt` or `option`) or one declared local ID (such as `#street`). The compiler scopes emitted CSS under `#pvo-root`. Combinators, selector lists, pseudo-selectors, page-wide selectors, and unknown IDs are rejected.

```pvo
prompt { color: #111; font-size: 18px; }
#street { background: #f2f0e9; }
```

The v0.1 property list is `color`, `background`, `background-color`, `border-color`, `border-radius`, `font-size`, `font-weight`, and `text-align`. Colours are bounded hex, `rgb()`, `rgba()`, `transparent`, or `currentColor`; font size is 8–72px and border radius is 0–64px. Weight and alignment have fixed choices. There are at most 64 rules and 256 declarations. Resource loads, `@import`, `url()`, arbitrary layout and positioning, `display`, `visibility`, `pointer-events`, and `opacity` are not supported. A rejected selector, property, or value is an error, not something silently ignored.

### Logic

Logic is event rules with approved actions. It is **not JavaScript**: no custom functions, loops, startup code, DOM access, direct `fetch`, or globals. Every declared control needs one rule; repeated handlers and references to controls that do not exist are errors.

| Component | Event | Actions currently accepted |
| --- | --- | --- |
| Tooltip | None | None; Logic must be empty. |
| Card | `on press(button-id)` | `continue()`, `jump_to(seconds)`, `go_to_scene("scene-id")`, `request({JSON})`. |
| Choice | `on choose(option-id)` | The same four outcome actions. |
| Form | `on submit` | The same four outcome actions. |

```pvo
on choose(street) { go_to_scene("street-scene"); }
on choose(formal) { continue(); }
```

These actions are the outcomes themselves, not calls to arbitrary functions. `jump_to` requires a finite, non-negative time; `go_to_scene` requires a nonempty scene ID. The editor/player host must additionally verify that the time is inside the scene and the named scene exists. A Choice does not implicitly split a scene. The component's manifest-level [`response_policy`](../../SPEC.md) decides when the host sends a response to Logic and whether unanswered playback waits; it does not change what any Logic action means.

`request({JSON})` takes exactly `url`, `method`, `body`, `onSuccess`, and `onError`. The URL must be absolute HTTP(S) with a fixed host; the method is `GET` or `POST`; the body is `""` or a string containing valid JSON. `onSuccess` is a route object: `{ "kind": "continue" }`, `{ "kind": "time", "t": 3 }`, or `{ "kind": "scene", "sceneId": "next" }`. `onError` is one of those routes or `null`. The compiler bounds the URL, body, and request size and rejects other keys or route kinds.

This is a **host-mediated** request, not direct `fetch` from component code. The player may send it only to an exact host in the PVO's `allowed_domains`. If the request fails or the viewer is offline, `onError` runs when present; `null` means no follow-up action. Nothing is queued for later. PVO Logic v0.1 still has no external-link opening, tracking, state expressions, or named custom functions.

## Compiler, player, and compatibility boundary

The public Rust API provides `parse_structure` and `compile_component`; the browser wrapper provides `compilePvoComponent`. It checks Structure, Logic, and Style together. Compiled markup reports only the control the viewer used: the trusted bridge emits `pvo.pick(index)` for a Card or Choice and `pvo.submit(fields)` for a Form. Creators do **not** write those bridge calls in PVO Logic. The host looks up that control's checked outcome rule and executes it; the renderer does not choose its own route. The player recompiles version-1 language source when loading a package and permits only the appropriate bridge event for its component kind. It must also validate request hosts, scene/time references, and action arguments. Compilation alone is not a security boundary: a `.pvo` package can be hand-edited.

The language reader uses `restyle_capture.code.language` with version 1 and three source-asset paths (`structure`, `style`, `logic`). The Restyle player rejects `restyle_capture.code` packages that have only legacy HTML/CSS/JavaScript assets and no language source. Generated HTML/CSS are internal renderer output, not packaged creator source. Generic SDK presentation HTML/CSS is a separate format capability and still needs host-side sanitization. The language path does not change the canonical `PVOPACK1` container or remove semantic component fields from the manifest.

## Verification and current limits

- Rust native checks: `npm run check:language`. Browser WASM output: `npm run build:language`.
- Browser checks after the language build: `node scripts/checks/language/compiler.mjs` and `node scripts/checks/language/player.mjs`; both need local Chrome or `CHROME_PATH`. The player check also verifies that legacy Restyle code-only packages are rejected. With an editor dev server running, `node scripts/checks/editor/pvo-language.mjs` checks the authoring workflow, `node scripts/checks/editor/pvo-export.mjs` checks a real rendered-media package, and `node scripts/checks/editor/pvo-requests.mjs` checks a Form request, offline hold, and retry. `node scripts/checks/runtime/isolation.mjs` checks the internal renderer's isolation; it is not an HTML/JavaScript authoring feature.
- The language core is intentionally small. It has no free-form HTML, CSS, or JavaScript escape hatch; requests are declarative and host-mediated. Legacy Restyle custom scripts are neither editable nor converted into PVO language.
- The current Restyle Choice route supports two options even though the core grammar supports up to four. Editor source authoring/export and player parity need an end-to-end check when that limit changes.
- `npm run check:browser -- editor no-code-components no-code-workspace component-sync` covers Content/Look/Action, presets and part styling, grouped undo, timing, direct Advanced edits and draft recovery, form destinations, responsive panels and Try restoration. The synchronization check exercises all four component types through immediate assistant edits and Undo, visual and PVO edits, save/reload and media export. Some older editor language checks still use the previous Fields/reset interface. Compiler/player fixtures and domain tests continue to cover source synchronization and request contracts; physical-device keyboard and broader cross-browser behaviour still need coverage.
