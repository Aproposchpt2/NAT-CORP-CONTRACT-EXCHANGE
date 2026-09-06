// Command Center publisher scope registry -- ported from APROPOS-CONTRACT-BRIEF's
// cbrief-discovery-registry.mjs (natcorp execution path, traced 2026-09-05; see
// natcorp-clone-trace.md at the repo root for the full trace). Content is carried
// over as-is: these are the base per-publisher scopes (CAL eProcure, the CA_SRCS /
// CA_PID single-agency entries, the Las Vegas / Clark County metro roster, and the
// Phoenix / Maricopa County metro roster) plus the two metro MARKET scopes.
//
// This site only ever runs the OpenAI Publisher Defined engine (see
// command-center-publisher-runner.mjs), so unlike the source file there is no
// per-scope platform-routing concern here -- these definitions exist purely to
// describe WHO the assigned publisher is and WHERE its official site is.
export const DISCOVERY_TARGET = 50;
export const MIN_CLOSING_DAYS = 10;
export const DISCOVERY_LEDGER_PUBLISHER_ID = 'ncce0000-0000-4000-8000-000000000001';

export const STATE_NAME_TO_CODE = Object.freeze({ California: 'CA', Arizona: 'AZ', Nevada: 'NV' });
export const STATE_CODE_TO_NAME = Object.freeze(
  Object.fromEntries(Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name])),
);
export function stateCodeFor(stateName) {
  return STATE_NAME_TO_CODE[stateName] || null;
}

const LAS_VEGAS_MARKET_PUBLISHERS = Object.freeze([
  { id: 'CLARK_COUNTY', name: 'Clark County Purchasing & Contracts', site_url: 'https://www.clarkcountynv.gov/business/business_opportunities/current-opportunities', aliases: ['Clark County', 'Clark County Nevada'] },
  { id: 'CITY_LAS_VEGAS', name: 'City of Las Vegas', site_url: 'https://www.lasvegasnevada.gov/Business/Purchasing', aliases: ['City of Las Vegas', 'Las Vegas'] },
  { id: 'CITY_HENDERSON', name: 'City of Henderson', site_url: 'https://www.cityofhenderson.com/government/departments/finance/purchasing', aliases: ['City of Henderson', 'Henderson'] },
  { id: 'CITY_NORTH_LAS_VEGAS', name: 'City of North Las Vegas', site_url: 'https://www.cityofnorthlasvegas.com/business/purchasing/purchasing-bid-advertisements', aliases: ['City of North Las Vegas', 'North Las Vegas'] },
  { id: 'BOULDER_CITY', name: 'Boulder City', site_url: 'https://www.bcnv.org/626/Bids-RFPs-and-RFQs', aliases: ['Boulder City', 'City of Boulder City'] },
  { id: 'CITY_MESQUITE', name: 'City of Mesquite', site_url: 'https://www.mesquitenv.gov/resources/bid-opportunities', aliases: ['City of Mesquite', 'Mesquite'] },
  { id: 'EIGHTH_JUDICIAL', name: 'Eighth Judicial District Court', site_url: 'https://www.clarkcountycourts.us/departments/purchasing/', aliases: ['Eighth Judicial District Court', 'Clark County Courts'] },
  { id: 'LVMPD', name: 'Las Vegas Metropolitan Police Department', site_url: 'https://www.lvmpd.com/about/purchasing/bid-opportunities', aliases: ['Las Vegas Metropolitan Police Department', 'LVMPD'] },
  { id: 'HARRY_REID_AIRPORT', name: 'Harry Reid International Airport / Clark County Department of Aviation', site_url: 'https://www.harryreidairport.com/business/business-development/purchasing-opportunities', aliases: ['Harry Reid International Airport', 'Clark County Department of Aviation', 'Department of Aviation'] },
  { id: 'RTC_SOUTHERN_NEVADA', name: 'Regional Transportation Commission of Southern Nevada', site_url: 'https://www.rtcsnv.com/about/doing-business-with-us/', aliases: ['Regional Transportation Commission of Southern Nevada', 'RTC of Southern Nevada', 'RTC Southern Nevada'] },
  { id: 'LVCVA', name: 'Las Vegas Convention and Visitors Authority', site_url: 'https://www.lvcva.com/bidding-and-contracts/', aliases: ['Las Vegas Convention and Visitors Authority', 'LVCVA'] },
  { id: 'CCSD', name: 'Clark County School District', site_url: 'https://www.ccsd.net/resources/purchasing-and-warehousing', aliases: ['Clark County School District', 'CCSD'] },
  { id: 'UNLV', name: 'University of Nevada, Las Vegas', site_url: 'https://www.unlv.edu/purchasing/solicitations', aliases: ['University of Nevada Las Vegas', 'University of Nevada, Las Vegas', 'UNLV'] },
  { id: 'CSN', name: 'College of Southern Nevada', site_url: 'https://www.csn.edu/purchasing', aliases: ['College of Southern Nevada', 'CSN'] },
  { id: 'DRI', name: 'Desert Research Institute', site_url: 'https://www.bcnpurchasing.nevada.edu/', aliases: ['Desert Research Institute', 'DRI'] },
  { id: 'LVVWD', name: 'Las Vegas Valley Water District', site_url: 'https://www.lvvwd.com/suppliers-bidders/doing-business-with-water-district/index.html', aliases: ['Las Vegas Valley Water District', 'LVVWD'] },
  { id: 'SNWA', name: 'Southern Nevada Water Authority', site_url: 'https://www.lvvwd.com/suppliers-bidders/doing-business-with-water-district/index.html', aliases: ['Southern Nevada Water Authority', 'SNWA'] },
  { id: 'CCWRD', name: 'Clark County Water Reclamation District', site_url: 'https://www.cleanwaterteam.com/doing-business/procurement/bid-opportunities', aliases: ['Clark County Water Reclamation District', 'CCWRD'] },
  { id: 'SNHD', name: 'Southern Nevada Health District', site_url: 'https://www.southernnevadahealthdistrict.org/news-info/public-notices/', aliases: ['Southern Nevada Health District', 'SNHD'] },
  { id: 'SNRHA', name: 'Southern Nevada Regional Housing Authority', site_url: 'https://www.snvrha.org/working-with-us/procurement/open-solicitations', aliases: ['Southern Nevada Regional Housing Authority', 'SNRHA'] },
  { id: 'UMC', name: 'University Medical Center of Southern Nevada', site_url: 'https://www.umcsn.com/vendors', aliases: ['University Medical Center of Southern Nevada', 'University Medical Center', 'UMC'] },
  { id: 'LVCCLD', name: 'Las Vegas-Clark County Library District', site_url: 'https://thelibrarydistrict.org/bid-opportunities/', aliases: ['Las Vegas-Clark County Library District', 'Library District'] },
  { id: 'HENDERSON_LIBRARIES', name: 'Henderson Libraries', site_url: 'https://hendersonlibraries.com/rfp', aliases: ['Henderson Libraries', 'Henderson District Public Libraries'] },
  { id: 'CCRFCD', name: 'Clark County Regional Flood Control District', site_url: 'https://www.regionalflood.org/', aliases: ['Clark County Regional Flood Control District', 'Regional Flood Control District'] },
]);

const LAS_VEGAS_PATHWAYS = Object.freeze([
  {
    id: 'NGEM_IONWAVE_SHARED',
    name: 'NGEM / IonWave shared metropolitan opportunity index',
    mode: 'SHARED_PLATFORM',
    entry_url: 'https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1',
    publisher_ids: ['CLARK_COUNTY','CITY_LAS_VEGAS','CITY_HENDERSON','CITY_NORTH_LAS_VEGAS','BOULDER_CITY','LVMPD','HARRY_REID_AIRPORT','RTC_SOUTHERN_NEVADA','UNLV','SNRHA','UMC'],
  },
  {
    id: 'CCWRD_DIRECT',
    name: 'Clark County Water Reclamation District direct procurement',
    mode: 'DIRECT_OFFICIAL',
    entry_url: 'https://www.cleanwaterteam.com/doing-business/procurement/bid-opportunities',
    publisher_ids: ['CCWRD'],
  },
  {
    id: 'OFFICIAL_PUBLISHER_FALLBACKS',
    name: 'Remaining approved publisher-specific official pathways',
    mode: 'OFFICIAL_FALLBACK',
    entry_url: null,
    publisher_ids: LAS_VEGAS_MARKET_PUBLISHERS.map((publisher) => publisher.id),
  },
]);

const MARICOPA_MARKET_PUBLISHERS = Object.freeze([
  { id: 'MARICOPA_COUNTY', name: 'Maricopa County Office of Procurement Services', site_url: 'https://www.maricopa.gov/2087/Procurement-Services', aliases: ['Maricopa County', 'Maricopa County Office of Procurement Services'] },
  { id: 'FCD_MARICOPA', name: 'Flood Control District of Maricopa County', site_url: 'https://www.fcd.maricopa.gov/2087/Procurement-Services', aliases: ['Flood Control District of Maricopa County', 'Maricopa County Flood Control District'] },
  { id: 'CITY_PHOENIX', name: 'City of Phoenix', site_url: 'https://www.phoenix.gov/administration/departments/finance/procurement.html', aliases: ['City of Phoenix', 'Phoenix'] },
  { id: 'CITY_MESA_AZ', name: 'City of Mesa', site_url: 'https://www.mesaaz.gov/Business-Development/Procurement-Services', aliases: ['City of Mesa', 'Mesa'] },
  { id: 'CITY_TEMPE', name: 'City of Tempe', site_url: 'https://www.tempe.gov/government/financial-services/procurement', aliases: ['City of Tempe', 'Tempe'] },
  { id: 'CITY_SCOTTSDALE', name: 'City of Scottsdale', site_url: 'https://www.scottsdaleaz.gov/purchasing/procurement', aliases: ['City of Scottsdale', 'Scottsdale'] },
  { id: 'CITY_CHANDLER', name: 'City of Chandler', site_url: 'https://www.chandleraz.gov/business/vendor-services/purchasing/requests-for-bids-and-proposals', aliases: ['City of Chandler', 'Chandler'] },
  { id: 'TOWN_GILBERT', name: 'Town of Gilbert', site_url: 'https://www.gilbertaz.gov/departments/finance-mgmt-services/purchasing-division/rfp-cip-open-bids', aliases: ['Town of Gilbert', 'Gilbert'] },
  { id: 'CITY_GLENDALE_AZ', name: 'City of Glendale', site_url: 'https://www.glendaleaz.com/your_government/city_finances/procurement/vendor_self_service___v_s_s_', aliases: ['City of Glendale', 'Glendale Arizona', 'Glendale'] },
  { id: 'CITY_AVONDALE', name: 'City of Avondale', site_url: 'https://www.avondaleaz.gov/government/departments/finance-budget/procurement', aliases: ['City of Avondale', 'Avondale'] },
  { id: 'CITY_GOODYEAR', name: 'City of Goodyear', site_url: 'https://www.goodyearaz.gov/business/vendor-services-procurement', aliases: ['City of Goodyear', 'Goodyear'] },
  { id: 'CITY_BUCKEYE', name: 'City of Buckeye', site_url: 'https://www.buckeyeaz.gov/business/construction-contracting/contracting-purchasing', aliases: ['City of Buckeye', 'Buckeye'] },
  { id: 'TOWN_QUEEN_CREEK', name: 'Town of Queen Creek', site_url: 'https://www.queencreekaz.gov/government/finance/procurement', aliases: ['Town of Queen Creek', 'Queen Creek'] },
  { id: 'VALLEY_METRO', name: 'Valley Metro', site_url: 'https://www.valleymetro.org/procurement', aliases: ['Valley Metro', 'Valley Metro Regional Public Transportation Authority', 'RPTA'] },
  { id: 'PHX_MESA_GATEWAY', name: 'Phoenix-Mesa Gateway Airport Authority', site_url: 'https://gatewayairport.com/procurement/solicitations', aliases: ['Phoenix-Mesa Gateway Airport Authority', 'Phoenix Mesa Gateway Airport Authority', 'Gateway Airport'] },
  { id: 'MCCCD', name: 'Maricopa County Community College District', site_url: 'https://procurement.maricopa.edu/bid-opportunities', aliases: ['Maricopa County Community College District', 'MCCCD', 'Maricopa Community Colleges'] },
  { id: 'VALLEYWISE', name: 'Maricopa County Special Health Care District dba Valleywise Health', site_url: 'https://valleywisehealth.org/about/procurement/open-solicitations/', aliases: ['Valleywise Health', 'Maricopa County Special Health Care District', 'Valleywise'] },
  { id: 'ASU', name: 'Arizona State University', site_url: 'https://cfo.asu.edu/bid-boards', aliases: ['Arizona State University', 'ASU'] },
  { id: 'MESA_PUBLIC_SCHOOLS', name: 'Mesa Public Schools', site_url: 'https://departments.mpsaz.org/o/departments/page/purchasing', aliases: ['Mesa Public Schools', 'Mesa Unified School District', 'MPS'] },
  { id: 'CHANDLER_USD', name: 'Chandler Unified School District', site_url: 'https://www.cusd80.com/departments/business-services/purchasing', aliases: ['Chandler Unified School District', 'CUSD', 'CUSD80'] },
  { id: 'SCOTTSDALE_USD', name: 'Scottsdale Unified School District', site_url: 'https://www.susd.org/departments/purchasing', aliases: ['Scottsdale Unified School District', 'SUSD'] },
  { id: 'MAG', name: 'Maricopa Association of Governments', site_url: 'https://azmag.gov/Jobs-RFPs-RFQs/RFPs-RFQs', aliases: ['Maricopa Association of Governments', 'MAG'] },
]);

const MARICOPA_PATHWAYS = Object.freeze([
  {
    id: 'OPENGOV_FAMILY',
    name: 'OpenGov public procurement family',
    mode: 'PLATFORM_FAMILY',
    entry_url: null,
    publisher_ids: ['CITY_PHOENIX','CITY_AVONDALE','TOWN_QUEEN_CREEK','VALLEY_METRO','MESA_PUBLIC_SCHOOLS','CHANDLER_USD'],
  },
  {
    id: 'BONFIRE_EUNA_FAMILY',
    name: 'Bonfire / Euna procurement family',
    mode: 'PLATFORM_FAMILY',
    entry_url: null,
    publisher_ids: ['CITY_TEMPE','CITY_SCOTTSDALE','CITY_GOODYEAR','CITY_BUCKEYE','MCCCD','SCOTTSDALE_USD'],
  },
  {
    id: 'MARICOPA_BIDNET',
    name: 'Maricopa County BidNet Direct procurement pathway',
    mode: 'PLATFORM_FAMILY',
    entry_url: 'https://vendors.maricopa.gov/2190/Solicitations',
    publisher_ids: ['MARICOPA_COUNTY','FCD_MARICOPA'],
  },
  {
    id: 'DIRECT_OFFICIAL_SOURCES',
    name: 'Direct official public opportunity sources',
    mode: 'DIRECT_OFFICIAL',
    entry_url: null,
    publisher_ids: ['TOWN_GILBERT','VALLEYWISE','MAG','PHX_MESA_GATEWAY'],
  },
  {
    id: 'MULTIPATH_SPECIAL_HANDLERS',
    name: 'Verified multi-path and special procurement handlers',
    mode: 'MULTI_PATH',
    entry_url: null,
    publisher_ids: ['CITY_MESA_AZ','CITY_TEMPE','CITY_CHANDLER','CITY_GLENDALE_AZ','ASU'],
  },
]);

const BASE_PUBLISHER_LISTING = [
  ['CAL_EPROCURE', 'California State Contracts Register / CAL eProcure', 'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx', 'California — Statewide', 'California'],
  ['CA_SRCS', 'Santa Rosa City Schools', 'https://www.srcschools.org/departments/business-services/purchasing/bids', 'San Francisco Bay Area', 'California'],
  ['CA_PID', 'Paradise Irrigation District', 'https://pidwater.com/bids.aspx', 'California — Statewide', 'California'],

  ['CLARK_COUNTY', 'Clark County Purchasing & Contracts', 'https://www.clarkcountynv.gov/business/business_opportunities/current-opportunities', 'Las Vegas / Clark County', 'Nevada'],
  ['CITY_LAS_VEGAS', 'City of Las Vegas', 'https://www.lasvegasnevada.gov/Business/Purchasing', 'Las Vegas / Clark County', 'Nevada'],
  ['CITY_HENDERSON', 'City of Henderson', 'https://www.cityofhenderson.com/government/departments/finance/purchasing', 'Las Vegas / Clark County', 'Nevada'],
  ['CITY_NORTH_LAS_VEGAS', 'City of North Las Vegas', 'https://www.cityofnorthlasvegas.com/business/purchasing/purchasing-bid-advertisements', 'Las Vegas / Clark County', 'Nevada'],
  ['BOULDER_CITY', 'Boulder City', 'https://www.bcnv.org/626/Bids-RFPs-and-RFQs', 'Las Vegas / Clark County', 'Nevada'],
  ['CITY_MESQUITE', 'City of Mesquite', 'https://www.mesquitenv.gov/resources/bid-opportunities', 'Las Vegas / Clark County', 'Nevada'],
  ['EIGHTH_JUDICIAL', 'Eighth Judicial District Court', 'https://www.clarkcountycourts.us/departments/purchasing/', 'Las Vegas / Clark County', 'Nevada'],
  ['LVMPD', 'Las Vegas Metropolitan Police Department', 'https://www.lvmpd.com/about/purchasing/bid-opportunities', 'Las Vegas / Clark County', 'Nevada'],
  ['HARRY_REID_AIRPORT', 'Harry Reid International Airport / Clark County Department of Aviation', 'https://www.harryreidairport.com/business/business-development/purchasing-opportunities', 'Las Vegas / Clark County', 'Nevada'],
  ['RTC_SOUTHERN_NEVADA', 'Regional Transportation Commission of Southern Nevada', 'https://www.rtcsnv.com/about/doing-business-with-us/', 'Las Vegas / Clark County', 'Nevada'],
  ['LVCVA', 'Las Vegas Convention and Visitors Authority', 'https://www.lvcva.com/bidding-and-contracts/', 'Las Vegas / Clark County', 'Nevada'],
  ['CCSD', 'Clark County School District', 'https://www.ccsd.net/resources/purchasing-and-warehousing', 'Las Vegas / Clark County', 'Nevada'],
  ['UNLV', 'University of Nevada, Las Vegas', 'https://www.unlv.edu/purchasing/solicitations', 'Las Vegas / Clark County', 'Nevada'],
  ['CSN', 'College of Southern Nevada', 'https://www.csn.edu/purchasing', 'Las Vegas / Clark County', 'Nevada'],
  ['DRI', 'Desert Research Institute', 'https://www.bcnpurchasing.nevada.edu/', 'Las Vegas / Clark County', 'Nevada'],
  ['LVVWD', 'Las Vegas Valley Water District', 'https://www.lvvwd.com/suppliers-bidders/doing-business-with-water-district/index.html', 'Las Vegas / Clark County', 'Nevada'],
  ['SNWA', 'Southern Nevada Water Authority', 'https://www.lvvwd.com/suppliers-bidders/doing-business-with-water-district/index.html', 'Las Vegas / Clark County', 'Nevada'],
  ['CCWRD', 'Clark County Water Reclamation District', 'https://www.cleanwaterteam.com/doing-business/procurement/bid-opportunities', 'Las Vegas / Clark County', 'Nevada'],
  ['SNHD', 'Southern Nevada Health District', 'https://www.southernnevadahealthdistrict.org/news-info/public-notices/', 'Las Vegas / Clark County', 'Nevada'],
  ['SNRHA', 'Southern Nevada Regional Housing Authority', 'https://www.snvrha.org/working-with-us/procurement/open-solicitations', 'Las Vegas / Clark County', 'Nevada'],
  ['UMC', 'University Medical Center of Southern Nevada', 'https://www.umcsn.com/vendors', 'Las Vegas / Clark County', 'Nevada'],
  ['LVCCLD', 'Las Vegas-Clark County Library District', 'https://thelibrarydistrict.org/bid-opportunities/', 'Las Vegas / Clark County', 'Nevada'],
  ['HENDERSON_LIBRARIES', 'Henderson Libraries', 'https://hendersonlibraries.com/rfp', 'Las Vegas / Clark County', 'Nevada'],
  ['CCRFCD', 'Clark County Regional Flood Control District', 'https://www.regionalflood.org/', 'Las Vegas / Clark County', 'Nevada'],

  ['MARICOPA_COUNTY', 'Maricopa County', 'https://www.maricopa.gov/2190/Solicitations', 'Phoenix / Maricopa County', 'Arizona'],
  ['CITY_PHOENIX', 'City of Phoenix', 'https://www.phoenix.gov/administration/departments/finance/procurement.html', 'Phoenix / Maricopa County', 'Arizona'],
  ['CITY_MESA_AZ', 'City of Mesa', 'https://www.mesaaz.gov/Business-Development/Procurement-Services', 'Phoenix / Maricopa County', 'Arizona'],
  ['CITY_TEMPE', 'City of Tempe', 'https://www.tempe.gov/government/financial-services/procurement', 'Phoenix / Maricopa County', 'Arizona'],
  ['CITY_SCOTTSDALE', 'City of Scottsdale', 'https://www.scottsdaleaz.gov/purchasing/procurement', 'Phoenix / Maricopa County', 'Arizona'],
  ['VALLEY_METRO', 'Valley Metro', 'https://www.valleymetro.org/procurement', 'Phoenix / Maricopa County', 'Arizona'],
];

const BASE_SCOPES = Object.fromEntries(BASE_PUBLISHER_LISTING.map(([id, name, site_url, market, state]) => [id, Object.freeze({
  id,
  publisher_id: DISCOVERY_LEDGER_PUBLISHER_ID,
  name,
  site_url,
  market,
  state,
  platform: 'Publisher-directed public acquisition',
  scope_type: 'PUBLISHER',
  generator_visible: state !== 'Nevada' && state !== 'Arizona',
  instructions: `Start at the approved publisher site ${site_url}. Remain within ${name} and any official procurement or transaction system that this publisher directly designates. Do not widen the run to another publisher. Individual candidate failure is not a stopping condition: reject or preserve the failure evidence and continue until ${DISCOVERY_TARGET} qualified opportunity records are acquired or the publisher's authoritative current inventory is exhausted.`,
})]));

const LAS_VEGAS_METRO_SCOPE = Object.freeze({
  id: 'LAS_VEGAS_METRO',
  publisher_id: DISCOVERY_LEDGER_PUBLISHER_ID,
  name: 'Las Vegas / Clark County Metropolitan Acquisition',
  site_url: 'https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1',
  market: 'Las Vegas / Clark County',
  state: 'Nevada',
  platform: 'Market-directed multi-pathway acquisition',
  scope_type: 'MARKET',
  generator_visible: true,
  publishers: LAS_VEGAS_MARKET_PUBLISHERS,
  pathways: LAS_VEGAS_PATHWAYS,
  allowed_host_suffixes: Object.freeze([
    'nevada.ionwave.net', 'clarkcountynv.gov', 'lasvegasnevada.gov', 'cityofhenderson.com',
    'cityofnorthlasvegas.com', 'bcnv.org', 'mesquitenv.gov', 'clarkcountycourts.us',
    'lvmpd.com', 'harryreidairport.com', 'rtcsnv.com', 'lvcva.com', 'ccsd.net', 'unlv.edu',
    'csn.edu', 'nevada.edu', 'lvvwd.com', 'cleanwaterteam.com', 'southernnevadahealthdistrict.org',
    'snvrha.org', 'umcsn.com', 'thelibrarydistrict.org', 'hendersonlibraries.com', 'regionalflood.org',
  ]),
  instructions: `Treat the Las Vegas / Clark County metropolitan procurement market as one controlled acquisition task. Begin with the shared NGEM / IonWave current-opportunity index, preserve the actual issuing publisher on every record, then inspect distinct approved official pathways for publishers not fully represented by the shared index. Do not leave the approved Las Vegas market publisher roster. Continue past individual candidate failures until ${DISCOVERY_TARGET} qualified records are acquired or all approved pathways are exhausted.`,
});

const MARICOPA_METRO_SCOPE = Object.freeze({
  id: 'MARICOPA_METRO',
  publisher_id: DISCOVERY_LEDGER_PUBLISHER_ID,
  name: 'Phoenix / Maricopa County Metropolitan Acquisition',
  site_url: 'https://procurement.opengov.com/portal/phoenix',
  market: 'Phoenix / Maricopa County',
  state: 'Arizona',
  platform: 'Market-directed platform-family acquisition',
  scope_type: 'MARKET',
  generator_visible: true,
  publishers: MARICOPA_MARKET_PUBLISHERS,
  pathways: MARICOPA_PATHWAYS,
  allowed_host_suffixes: Object.freeze([
    'opengov.com', 'bonfirehub.com', 'eunasolutions.com', 'bidnetdirect.com', 'maricopa.gov',
    'phoenix.gov', 'mesaaz.gov', 'tempe.gov', 'scottsdaleaz.gov', 'chandleraz.gov',
    'gilbertaz.gov', 'glendaleaz.com', 'avondaleaz.gov', 'goodyearaz.gov', 'buckeyeaz.gov',
    'queencreekaz.gov', 'valleymetro.org', 'gatewayairport.com', 'maricopa.edu', 'valleywisehealth.org',
    'asu.edu', 'mpsaz.org', 'cusd80.com', 'susd.org', 'azmag.gov', 'az.gov', 'munisselfservice.com',
  ]),
  instructions: `Treat the Phoenix / Maricopa County metropolitan procurement market as one controlled acquisition task. Process the approved pathways by platform family: OpenGov, Bonfire / Euna, Maricopa County BidNet, direct official sources, then verified multi-path/special handlers. Preserve the actual issuing publisher and pathway on every opportunity. Do not admit unresolved publishers or leave the approved Maricopa market roster. A blocked publisher or candidate is not a run-level failure; record the failure and continue until ${DISCOVERY_TARGET} qualified records are acquired or every approved pathway is exhausted. Current authoritative source state controls over stale indexed or cached material.`,
});

export const DISCOVERY_SCOPES = Object.freeze({
  ...BASE_SCOPES,
  LAS_VEGAS_METRO: LAS_VEGAS_METRO_SCOPE,
  MARICOPA_METRO: MARICOPA_METRO_SCOPE,
});

export function getDiscoveryScope(id) {
  return DISCOVERY_SCOPES[String(id || '').toUpperCase()] || null;
}
