'use strict';

/* Resolve Cal eProcure Business Units without guessing. The resolver uses:
   1. an explicit Business Unit already present on the record;
   2. an official event URL;
   3. an approved exact department alias;
   4. a snapshot-derived department mapping only when every verified event for
      that normalized department points to one and only one Business Unit. */

const fs = require('fs');
const path = require('path');
const {
  normalizeSpace,
  parseEventIdentity,
  buildSourceRecordId,
} = require('./lib/caleprocure-normalize');

const SNAPSHOT_PATH = path.join(__dirname, '..', 'caleprocure.json');

const DEPARTMENT_BUSINESS_UNITS = new Map([
  ['department of justice', '0820'],
  ['california department of justice', '0820'],
  ['department of justice office of the attorney general', '0820'],
  ['california department of justice office of the attorney general', '0820'],
]);

function normalizeDepartmentName(value) {
  return normalizeSpace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function inferBusinessUnitFromDepartment(department) {
  return DEPARTMENT_BUSINESS_UNITS.get(normalizeDepartmentName(department)) || null;
}

function deriveUniqueDepartmentMap(opportunities) {
  const candidates = new Map();

  (opportunities || []).forEach(opportunity => {
    const department = normalizeDepartmentName(opportunity.department);
    if (!department) return;
    const identity = parseEventIdentity(opportunity.official_url || opportunity.url, opportunity.id);
    const businessUnit = opportunity.business_unit || identity.business_unit || null;
    if (!businessUnit) return;
    if (!candidates.has(department)) candidates.set(department, new Set());
    candidates.get(department).add(String(businessUnit));
  });

  const unique = new Map();
  candidates.forEach((businessUnits, department) => {
    if (businessUnits.size === 1) unique.set(department, Array.from(businessUnits)[0]);
  });
  return unique;
}

function resolveOpportunity(opportunity, snapshotDepartmentMap) {
  const identity = parseEventIdentity(opportunity.official_url || opportunity.url, opportunity.id);
  const department = normalizeDepartmentName(opportunity.department);
  const staticBusinessUnit = inferBusinessUnitFromDepartment(opportunity.department);
  const snapshotBusinessUnit = snapshotDepartmentMap && department
    ? snapshotDepartmentMap.get(department) || null
    : null;
  const businessUnit = opportunity.business_unit
    || identity.business_unit
    || staticBusinessUnit
    || snapshotBusinessUnit;
  const eventId = opportunity.id || identity.event_id || null;

  if (businessUnit) opportunity.business_unit = String(businessUnit);
  if (eventId) opportunity.id = String(eventId);
  opportunity.source_record_id = buildSourceRecordId(opportunity.business_unit, opportunity.id);
  return opportunity;
}

function resolveSnapshot(payload) {
  const opportunities = Array.isArray(payload.opportunities) ? payload.opportunities : [];
  const snapshotDepartmentMap = deriveUniqueDepartmentMap(opportunities);
  let resolved = 0;
  let unresolved = 0;
  let dojResolved = 0;
  let snapshotMapped = 0;

  opportunities.forEach(opportunity => {
    const before = opportunity.source_record_id || null;
    const beforeBusinessUnit = opportunity.business_unit || parseEventIdentity(
      opportunity.official_url || opportunity.url,
      opportunity.id,
    ).business_unit;
    const staticBusinessUnit = inferBusinessUnitFromDepartment(opportunity.department);
    resolveOpportunity(opportunity, snapshotDepartmentMap);
    if (opportunity.source_record_id) resolved += 1;
    else unresolved += 1;
    if (!before && opportunity.business_unit === '0820' && staticBusinessUnit === '0820') dojResolved += 1;
    if (!beforeBusinessUnit && !staticBusinessUnit && opportunity.business_unit) snapshotMapped += 1;
  });

  payload.business_unit_resolved_count = resolved;
  payload.business_unit_unresolved_count = unresolved;
  payload.department_mapping_resolved_count = dojResolved + snapshotMapped;
  payload.static_department_mapping_resolved_count = dojResolved;
  payload.snapshot_department_mapping_resolved_count = snapshotMapped;
  payload.department_mapping_resolved_at = new Date().toISOString();
  return { payload, resolved, unresolved, dojResolved, snapshotMapped, snapshotDepartmentMap };
}

function main() {
  const payload = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const result = resolveSnapshot(payload);
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(result.payload, null, 2));
  console.log('[resolve-caleprocure-business-units] resolved=' + result.resolved
    + ' unresolved=' + result.unresolved
    + ' static_mapped=' + result.dojResolved
    + ' snapshot_mapped=' + result.snapshotMapped);
}

if (require.main === module) main();

module.exports = {
  normalizeDepartmentName,
  inferBusinessUnitFromDepartment,
  deriveUniqueDepartmentMap,
  resolveOpportunity,
  resolveSnapshot,
};
