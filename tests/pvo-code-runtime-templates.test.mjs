import assert from "node:assert/strict";
import test from "node:test";
import { substituteRuntimeTokens } from "../packages/pvo-code-runtime/field-tokens.js";

test("runtime state templates are optional, escaped and resolved only once", () => {
  const source = "<p>{{heading}}: {state.responses.component-1.answer}</p>";
  assert.equal(
    substituteRuntimeTokens(source, { heading: "Result" }),
    "<p>Result: {state.responses.component-1.answer}</p>",
    "An omitted state keeps authored state tokens visible while editing",
  );
  assert.equal(
    substituteRuntimeTokens(source, { heading: "Result" }, {}),
    "<p>Result: </p>",
    "An active runtime with no value renders a blank",
  );
  assert.equal(
    substituteRuntimeTokens(source, { heading: "<Result>" }, {
      responses: { "component-1": { answer: '<button onclick="bad()">Dublin & Cork</button>' } },
    }),
    "<p>&lt;Result&gt;: &lt;button onclick=&quot;bad()&quot;&gt;Dublin &amp; Cork&lt;/button&gt;</p>",
  );
  assert.equal(
    substituteRuntimeTokens("{state.first} / {state.second}", {}, {
      first: "{state.second}",
      second: "{{heading}}",
    }),
    "{state.second} / {{heading}}",
    "Inserted response text must not become another template pass",
  );
});

test("runtime state templates reject missing, non-scalar and unsafe paths", () => {
  const state = {
    scalar: false,
    missingParent: {},
    object: { value: "hidden" },
    list: ["first"],
  };
  assert.equal(
    substituteRuntimeTokens(
      "{state.scalar}|{state.missingParent.value}|{state.object}|{state.list.0}|{state.constructor.name}",
      {},
      state,
    ),
    "false|||first|",
  );
});
