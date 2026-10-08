export type RepairStage = "component_input" | "gateway_validation" | "backend_rule" | "external_account" | "provider" | "result_display" | "unknown";
export interface MaintenanceIssue { key:string; stage:RepairStage; code:string; message:string; recovery:string }
export interface RepairReport { stage:RepairStage; summary:string; baseline:string; checkedRevision:number|null; published:false; outcome:string; dependencies:{message:string;recovery:string}[]; observedAt:number }
export interface MaintenanceSnapshot { ownerId:string;serviceId:string;projectId:string;serviceRevision:number;draftRevision:number|null;observedAt:number;issues:MaintenanceIssue[] }
export const REPAIR_STAGES: readonly RepairStage[];
export function parseMaintenanceSnapshot(value:unknown, ownerId:string, serviceId:string):MaintenanceSnapshot;
export function parseRepairReport(value:unknown):RepairReport|null;
