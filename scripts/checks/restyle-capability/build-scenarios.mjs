import { comparisonScenarios } from "../model-comparison/scenarios.mjs";
import { connectedAgreement } from "../../../tests/connected-services/fixtures.mjs";
import { parseServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";

export const repairFiles = [
  {
    path: "src/service.mjs",
    content: `export function execute({operation,input,state}) {
  state=structuredClone(state);
  if(operation==='guests') return {state,result:state.guests};
  const name=input.name.trim();
  if(!name) return {state,result:'invalid'};
  const index=state.guests.indexOf(name);
  if(operation==='cancel') { if(index<0) return {state,result:'not_joined'}; state.guests.splice(index,1); return {state,result:'removed'}; }
  if(state.guests.length>=state.capacity) return {state,result:'full'};
  if(index>=0) return {state,result:'already_joined'};
  state.guests.push(name); return {state,result:'accepted'};
}\n`,
  },
  {
    path: "tests/service.test.mjs",
    content: `import test from 'node:test'; import assert from 'node:assert/strict'; import {execute} from '../src/service.mjs';
test('one place',()=>assert.equal(execute({operation:'join',input:{name:'Ari'},state:{capacity:1,guests:[]},now:100}).result,'accepted'));\n`,
  },
];

export function buildScenarios() {
  const basic = comparisonScenarios();
  const connected = connectedAgreement();
  connected.description +=
    " Always return the actual supplied trusted account result title, never a canned example. Do not change state.";
  const holdouts = [
    {
      id: "different-issue",
      description: "Use the requested number and actual title.",
      initialState: null,
      steps: [
        {
          operation: "lookup",
          input: { number: 81 },
          now: 100,
          requests: [{ connection: "issue", input: { number: 81 } }],
          expected: { state: null, result: "Unexpected title Ω-314" },
        },
      ],
    },
    {
      id: "changed-title",
      description: "The provider may change the title of the same issue.",
      initialState: null,
      steps: [
        {
          operation: "lookup",
          input: { number: 7 },
          now: 101,
          requests: [{ connection: "issue", input: { number: 7 } }],
          expected: { state: null, result: "Updated by a friend" },
        },
      ],
    },
  ];
  return [
    ...basic.map((s, i) => ({ ...s, id: `B0${i + 1}`, family: "build" })),
    {
      id: "B04",
      family: "build",
      request:
        "Build the agreed connected issue-title lookup. Consume trusted connection results and preserve null state. The provider is controlled during this test; do not contact GitHub.",
      agreement: connected,
      holdouts,
    },
    { ...basic[1], id: "R01", family: "repair", seed: repairFiles },
  ].map((s) => {
    parseServiceAgreement(s.agreement);
    return s;
  });
}
