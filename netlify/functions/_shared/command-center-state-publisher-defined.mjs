// Builds the per-state STATE_PUBLISHER_DEFINED scope tree (CA/AZ/NV) by merging
// child scopes from the base publisher registry and the vendor (platform-family)
// registry. Ported from APROPOS-CONTRACT-BRIEF's cbrief-state-publisher-defined.mjs
// (natcorp execution path). No NV_NGEM_EXPANSION overlay is carried over here --
// that overlay lived in cbrief-vendor-registry.mjs guarded by manual verification
// notes specific to that repo's history; the base NV_IONWAVE_NGEM buyer list in
// command-center-vendor-registry.mjs already covers the same core buyers.
import { getDiscoveryScope, DISCOVERY_LEDGER_PUBLISHER_ID } from './command-center-publisher-registry.mjs';
import { getVendorDiscoveryScope } from './command-center-vendor-registry.mjs';

const DEFINITIONS = Object.freeze({
  CA_PUBLISHER_DEFINED: {
    id: 'CA_PUBLISHER_DEFINED', state: 'California', name: 'Publisher Defined — California', platform: 'State Publisher Defined Acquisition',
    child_scope_ids: ['CAL_EPROCURE','CA_OPENGOV','CA_PLANETBIDS','CA_BONFIRE_EUNA','CA_BIDNET_DIRECT','CA_PERISCOPE_EPRO','CA_PUBLIC_PURCHASE','CA_JAGGAER','CA_DEMANDSTAR','CA_IONWAVE','CA_SRCS','CA_PID'],
    site_url: 'https://caleprocure.ca.gov/',
  },
  AZ_PUBLISHER_DEFINED: {
    id: 'AZ_PUBLISHER_DEFINED', state: 'Arizona', name: 'Publisher Defined — Arizona', platform: 'State Publisher Defined Acquisition',
    child_scope_ids: ['AZ_OPENGOV','AZ_BONFIRE_EUNA','AZ_BIDNET_DIRECT'],
    site_url: 'https://spo.az.gov/',
  },
  NV_PUBLISHER_DEFINED: {
    id: 'NV_PUBLISHER_DEFINED', state: 'Nevada', name: 'Publisher Defined — Nevada', platform: 'State Publisher Defined Acquisition',
    child_scope_ids: ['NV_IONWAVE_NGEM','NV_BONFIRE_EUNA','NV_PLANETBIDS','NV_PERISCOPE_EPRO','CCWRD'],
    site_url: 'https://purchasing.nv.gov/',
  },
});

function resolveChildScope(id) {
  return getVendorDiscoveryScope(id) || getDiscoveryScope(id) || null;
}

export function getStatePublisherDefinedScope(id) {
  const def = DEFINITIONS[String(id || '').toUpperCase()];
  if (!def) return null;
  const child_scopes = def.child_scope_ids.map((childId) => resolveChildScope(childId)).filter(Boolean);
  const buyers = new Map();
  for (const child of child_scopes) {
    if (Array.isArray(child.publishers)) {
      for (const buyer of child.publishers) buyers.set(buyer.id, buyer);
    } else {
      buyers.set(child.id, { id: child.id, name: child.name, site_url: child.site_url });
    }
  }
  return Object.freeze({
    ...def,
    publisher_id: DISCOVERY_LEDGER_PUBLISHER_ID,
    scope_type: 'STATE_PUBLISHER_DEFINED',
    market: `${def.state} — all verified state/local publisher coverage`,
    target_metros: Object.freeze([...new Set(child_scopes.flatMap((s) => s.target_metros || (s.market ? [s.market] : [])))]),
    child_scopes: Object.freeze(child_scopes),
    buyer_count: buyers.size,
    publisher_family_count: child_scopes.length,
    authority_policy: 'SYSTEM_OF_RECORD_ONLY',
    acquisition_rule: 'EXHAUST_ALL_CONFIGURED_PUBLISHER_COVERAGE',
  });
}

export function listStatePublisherDefinedScopes() {
  return Object.keys(DEFINITIONS).map((id) => {
    const scope = getStatePublisherDefinedScope(id);
    return {
      id: scope.id,
      publisher_id: scope.publisher_id,
      name: scope.name,
      state: scope.state,
      market: scope.market,
      platform: scope.platform,
      scope_type: scope.scope_type,
      site_url: scope.site_url,
      buyer_count: scope.buyer_count,
      publisher_family_count: scope.publisher_family_count,
      target_metros: scope.target_metros,
      acquisition_rule: scope.acquisition_rule,
    };
  });
}
