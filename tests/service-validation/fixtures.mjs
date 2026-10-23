import {
  sourcePackage,
  dinnerAgreement,
  equipmentAgreement,
} from "../service-packages/fixtures.mjs";
export { dinnerAgreement, equipmentAgreement };
export const dinnerSource = `export function execute({operation,input,state}) {
  if(operation === 'guests') return {result:state.guests,state};
  if(state.guests.includes(input.name)) return {result:'already_joined',state};
  if(state.guests.length >= state.capacity) return {result:'full',state};
  return {result:'accepted',state:{...state,guests:[...state.guests,input.name]}};
}`;
export const equipmentSource = `export function execute({input,state}) {
  if(input.start >= input.end) return {result:'invalid_dates',state};
  if(state.bookings.some(item=>item.item===input.item && input.start<item.end && input.end>item.start)) return {result:'overlap',state};
  return {result:'reserved',state:{bookings:[...state.bookings,input]}};
}`;
export function packageFor(source = dinnerSource) {
  const value = sourcePackage();
  value.files[0].content = source;
  value.files[1].content =
    "throw new Error('Generated tests must never run as the trusted gate');";
  return value;
}
export const identity = () => ({
  agreementDigest: "a".repeat(64),
  packageDigest: "b".repeat(64),
  sourceDigest: "c".repeat(64),
});
