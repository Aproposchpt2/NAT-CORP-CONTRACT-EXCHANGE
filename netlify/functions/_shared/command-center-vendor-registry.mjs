// Command Center vendor (platform-family) scope registry -- ported verbatim from
// APROPOS-CONTRACT-BRIEF's cbrief-vendor-registry.mjs (natcorp execution path,
// traced 2026-09-05; see natcorp-clone-trace.md at the repo root). Each entry is
// one procurement-platform family (OpenGov, PlanetBids, Bonfire/Euna, BidNet
// Direct, Periscope ePro, Public Purchase, JAGGAER, DemandStar, Ion Wave) with its
// own live-verified buyer list. This site only ever runs the OpenAI Publisher
// Defined engine (see command-center-publisher-runner.mjs) against these buyers --
// there is no platform-specific scraper here, unlike the source repo's cbrief mode.
import { DISCOVERY_LEDGER_PUBLISHER_ID } from './command-center-publisher-registry.mjs';

function buyer(id, name, metro, site_url, portal_url, relationship_status = 'SYSTEM_OF_RECORD', aliases = []) {
  return Object.freeze({ id, name, metro, site_url, portal_url, relationship_status, aliases });
}

function pathway(id, name, publisher_ids, entry_url = null, mode = 'VENDOR_PORTALS') {
  return Object.freeze({ id, name, publisher_ids, entry_url, mode });
}

function vendorScope({ id, state, vendor_name, platform, target_metros, publishers, pathways, allowed_host_suffixes, notes }) {
  return Object.freeze({
    id,
    publisher_id: DISCOVERY_LEDGER_PUBLISHER_ID,
    name: `${vendor_name} — ${state}`,
    state,
    market: target_metros.join(' | '),
    target_metros: Object.freeze(target_metros),
    vendor_name,
    platform,
    scope_type: 'VENDOR',
    site_url: pathways.find((p) => p.entry_url)?.entry_url || publishers[0]?.portal_url || publishers[0]?.site_url,
    publishers: Object.freeze(publishers),
    pathways: Object.freeze(pathways),
    allowed_host_suffixes: Object.freeze(allowed_host_suffixes),
    authority_policy: 'SYSTEM_OF_RECORD_ONLY',
    notes,
  });
}

const CA_OPENGOV_BUYERS = [
  buyer('CA_ALAMEDA_COUNTY','Alameda County','San Francisco Bay Area','https://gsa.acgov.org/do-business-with-us/contracting-opportunities/','https://procurement.opengov.com/portal/acgov','SYSTEM_OF_RECORD',['County of Alameda']),
  buyer('CA_SAN_MATEO_COUNTY','County of San Mateo','San Francisco Bay Area','https://www.smcgov.org/ceo/procurement','https://procurement.opengov.com/portal/smcgov','SYSTEM_OF_RECORD',['San Mateo County']),
  buyer('CA_SACRAMENTO_COUNTY','Sacramento County','Sacramento','https://generalservices.saccounty.gov/Purchasing/Pages/default.aspx','https://procurement.opengov.com/portal/saccounty','SYSTEM_OF_RECORD',['County of Sacramento']),
  buyer('CA_SACOG','Sacramento Area Council of Governments','Sacramento','https://www.sacog.org/','https://procurement.opengov.com/portal/sacog','SYSTEM_OF_RECORD',['SACOG']),
  buyer('CA_SAC_METRO_FIRE','Sacramento Metropolitan Fire District','Sacramento','https://metrofire.ca.gov/','https://procurement.opengov.com/portal/metrofire','SYSTEM_OF_RECORD',['Sacramento Metro Fire','Metro Fire']),
  buyer('CA_WEST_SAC','City of West Sacramento','Sacramento','https://www.cityofwestsacramento.org/government/departments/finance/purchasing','https://procurement.opengov.com/portal/cityofwestsacramento','SYSTEM_OF_RECORD',['West Sacramento']),
  buyer('CA_PACIFICA','City of Pacifica','San Francisco Bay Area','https://www.cityofpacifica.org/','https://procurement.opengov.com/portal/cityofpacifica','SYSTEM_OF_RECORD',['Pacifica']),
  buyer('CA_LVMWD','Las Virgenes Municipal Water District','Los Angeles','https://www.lvmwd.com/','https://procurement.opengov.com/portal/lvmwd','SYSTEM_OF_RECORD',['LVMWD']),
];

const CA_PLANETBIDS_BUYERS = [
  buyer('CA_SAN_DIEGO','City of San Diego','San Diego','https://www.sandiego.gov/purchasing/bids-contracts/vendorreg','https://pbsystem.planetbids.com/portal/17950/portal-home','SYSTEM_OF_RECORD',['San Diego']),
  buyer('CA_SD_SUPERIOR_COURT','Superior Court of California, County of San Diego','San Diego','https://www.sdcourt.ca.gov/sdcourt/generalinformation/rfps',null,'SYSTEM_OF_RECORD',['San Diego Superior Court']),
  buyer('CA_SD_HOUSING','San Diego Housing Commission','San Diego','https://sdhc.org/doing-business-with-us/contracting-and-procurement-services/',null,'SYSTEM_OF_RECORD',['SDHC']),
  buyer('CA_RIVERSIDE_CITY','City of Riverside','Inland Empire','https://www.riversideca.gov/finance/purchase.asp',null,'SYSTEM_OF_RECORD',['Riverside']),
  buyer('CA_SAN_BERNARDINO_CITY','City of San Bernardino','Inland Empire','https://www.sbcity.org/BIDS',null,'SYSTEM_OF_RECORD',['San Bernardino']),
  buyer('CA_IEUA','Inland Empire Utilities Agency','Inland Empire','https://www.ieua.org/rfps/',null,'SYSTEM_OF_RECORD',['IEUA']),
  buyer('CA_SUNNYVALE','City of Sunnyvale','San Francisco Bay Area','https://www.sunnyvale.ca.gov/business-and-development/doing-business-with-the-city/bids-and-proposals',null,'SYSTEM_OF_RECORD',['Sunnyvale']),
];

const CA_BONFIRE_BUYERS = [
  buyer('CA_LAWA','Los Angeles World Airports','Los Angeles','https://www.lawa.org/lawa-businesses/lawa-current-opportunities','https://lawa.bonfirehub.com/','SYSTEM_OF_RECORD',['LAWA']),
  buyer('CA_LA_SUPERIOR_COURT','Superior Court of California, County of Los Angeles','Los Angeles','https://www.lacourt.org/generalinfo/courtinfo/rfp.aspx','https://lacourt.bonfirehub.com/','SYSTEM_OF_RECORD',['Los Angeles Superior Court','LA Superior Court']),
  buyer('CA_LACCD','Los Angeles Community College District','Los Angeles','https://www.laccd.edu/offices/business-services/procurement','https://laccd.bonfirehub.com/','SYSTEM_OF_RECORD',['LACCD']),
  buyer('CA_WETA','San Francisco Bay Area Water Emergency Transportation Authority','San Francisco Bay Area','https://sanfranciscobayferry.com/about-us',null,'SYSTEM_OF_RECORD',['WETA','San Francisco Bay Ferry']),
];

const CA_BIDNET_BUYERS = [
  buyer('CA_CONTRA_COSTA','Contra Costa County','San Francisco Bay Area','https://www.contracosta.ca.gov/1578/Purchasing-Services','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['County of Contra Costa']),
  buyer('CA_ALAMEDA_PWA','Alameda County Public Works Agency','San Francisco Bay Area','https://www.acpwa.org/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Alameda County Public Works']),
  buyer('CA_MOUNTAIN_VIEW','City of Mountain View','San Francisco Bay Area','https://www.mountainview.gov/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Mountain View']),
  buyer('CA_SANTA_CLARA','City of Santa Clara','San Francisco Bay Area','https://www.santaclaraca.gov/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Santa Clara']),
  buyer('CA_SANTA_CLARITA','City of Santa Clarita','Los Angeles','https://santaclarita.gov/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Santa Clarita']),
  buyer('CA_OCEANSIDE','City of Oceanside','San Diego','https://www.ci.oceanside.ca.us/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Oceanside']),
  buyer('CA_POWAY','City of Poway','San Diego','https://poway.org/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Poway']),
  buyer('CA_COLTON','City of Colton','Inland Empire','https://www.coltonca.gov/','https://www.bidnetdirect.com/california','DIRECT_GROUP_PUBLISHER',['Colton']),
];

const CA_PERISCOPE_BUYERS = [
  buyer('CA_CONTRA_COSTA_EPRO','Contra Costa County','San Francisco Bay Area','https://www.contracosta.ca.gov/1578/Purchasing-Services','https://purchasing.cccounty.us/bso/','SYSTEM_OF_RECORD',['County of Contra Costa']),
];

const CA_PUBLIC_PURCHASE_BUYERS = [
  buyer('CA_ROSEVILLE','City of Roseville','Sacramento','https://www.roseville.ca.us/business/procurement_services/bids_rfps.php','https://www.publicpurchase.com/gems/roseville,ca/buyer/public/home','SYSTEM_OF_RECORD',['Roseville']),
];

const CA_JAGGAER_BUYERS = [
  buyer('CA_CSU_CSUBUY','California State University (CSUBUY)','California — Statewide','https://www.calstate.edu/csu-system/doing-business-with-the-csu/contract-services-and-procurement/supplier-resources','https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=CalState','SYSTEM_OF_RECORD',['CSU','CSUBUY','California State University']),
];

const CA_DEMANDSTAR_BUYERS = [
  buyer('CA_SANTA_CLARA_STADIUM_AUTHORITY','Santa Clara Stadium Authority','San Francisco Bay Area','https://www.santaclaraca.gov/our-city/santa-clara-stadium-authority/bid-opportunities','https://www.demandstar.com/app/agencies/california/santa-clara-stadium-authority/procurement-opportunities/998212a1-6619-4c91-980e-08eeab39552b/','SYSTEM_OF_RECORD',['Santa Clara Stadium Authority','Levi’s Stadium']),
];

const CA_IONWAVE_BUYERS = [
  buyer('CA_SRJC','Santa Rosa Junior College (Sonoma County Junior College District)','San Francisco Bay Area','https://purchasing.santarosa.edu/current-solicitations','https://srjc.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['SRJC','Santa Rosa Junior College','Sonoma County Junior College District']),
];

const AZ_OPENGOV_BUYERS = [
  buyer('AZ_PHOENIX','City of Phoenix','Phoenix–Mesa–Chandler','https://www.phoenix.gov/administration/departments/finance/procurement.html','https://procurement.opengov.com/portal/phoenix','SYSTEM_OF_RECORD',['Phoenix']),
  buyer('AZ_AVONDALE','City of Avondale','Phoenix–Mesa–Chandler','https://www.avondaleaz.gov/government/departments/finance-budget/procurement','https://procurement.opengov.com/portal/avondaleaz','SYSTEM_OF_RECORD',['Avondale']),
  buyer('AZ_QUEEN_CREEK','Town of Queen Creek','Phoenix–Mesa–Chandler','https://www.queencreekaz.gov/government/finance/procurement','https://procurement.opengov.com/portal/queencreekaz','SYSTEM_OF_RECORD',['Queen Creek']),
  buyer('AZ_VALLEY_METRO','Valley Metro','Phoenix–Mesa–Chandler','https://www.valleymetro.org/procurement','https://procurement.opengov.com/portal/valleymetro','SYSTEM_OF_RECORD',['Valley Metro Regional Public Transportation Authority']),
  buyer('AZ_MPS','Mesa Public Schools','Phoenix–Mesa–Chandler','https://departments.mpsaz.org/o/departments/page/purchasing','https://procurement.opengov.com/portal/mpsaz','SYSTEM_OF_RECORD',['Mesa Unified School District','MPS']),
  buyer('AZ_CUSD','Chandler Unified School District','Phoenix–Mesa–Chandler','https://www.cusd80.com/departments/business-services/purchasing','https://procurement.opengov.com/portal/cusd80','SYSTEM_OF_RECORD',['CUSD80','CUSD']),
  buyer('AZ_TUCSON','City of Tucson','Tucson','https://www.tucsonaz.gov/Departments/Business-Services-Department/Procurement','https://procurement.opengov.com/portal/tucson-az','SYSTEM_OF_RECORD',['Tucson']),
];

const AZ_BONFIRE_BUYERS = [
  buyer('AZ_TEMPE','City of Tempe','Phoenix–Mesa–Chandler','https://www.tempe.gov/government/financial-services/procurement','https://tempe-gov.bonfirehub.com/','SYSTEM_OF_RECORD',['Tempe']),
  buyer('AZ_SCOTTSDALE','City of Scottsdale','Phoenix–Mesa–Chandler','https://www.scottsdaleaz.gov/purchasing/procurement','https://scottsdaleaz.bonfirehub.com/','SYSTEM_OF_RECORD',['Scottsdale']),
  buyer('AZ_GOODYEAR','City of Goodyear','Phoenix–Mesa–Chandler','https://www.goodyearaz.gov/business/vendor-services-procurement','https://goodyearaz.bonfirehub.com/','SYSTEM_OF_RECORD',['Goodyear']),
  buyer('AZ_BUCKEYE','City of Buckeye','Phoenix–Mesa–Chandler','https://www.buckeyeaz.gov/business/construction-contracting/contracting-purchasing','https://buckeyeaz.bonfirehub.com/','SYSTEM_OF_RECORD',['Buckeye']),
  buyer('AZ_MCCCD','Maricopa County Community College District','Phoenix–Mesa–Chandler','https://procurement.maricopa.edu/bid-opportunities','https://maricopa.bonfirehub.com/portal/?tab=openOpportunities','SYSTEM_OF_RECORD',['MCCCD','Maricopa Community Colleges']),
];

const AZ_BIDNET_BUYERS = [
  buyer('AZ_MARICOPA_COUNTY','Maricopa County','Phoenix–Mesa–Chandler','https://vendors.maricopa.gov/578/Apply-for-Contract','https://www.bidnetdirect.com/arizona/maricopacounty','SYSTEM_OF_RECORD',['Maricopa County Office of Procurement Services']),
];

const NV_NGEM_BUYERS = [
  buyer('NV_CLARK_COUNTY','Clark County','Las Vegas–Henderson','https://www.clarkcountynv.gov/business/business_opportunities/current-opportunities','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['Clark County Nevada']),
  buyer('NV_LAS_VEGAS','City of Las Vegas','Las Vegas–Henderson','https://www.lasvegasnevada.gov/Business/Purchasing/Purchasing-Resources','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['Las Vegas']),
  buyer('NV_HENDERSON','City of Henderson','Las Vegas–Henderson','https://www.cityofhenderson.com/government/departments/finance/purchasing','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['Henderson']),
  buyer('NV_NORTH_LAS_VEGAS','City of North Las Vegas','Las Vegas–Henderson','https://www.cityofnorthlasvegas.com/business/purchasing/purchasing-bid-advertisements','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['North Las Vegas']),
  buyer('NV_LVMPD','Las Vegas Metropolitan Police Department','Las Vegas–Henderson','https://www.lvmpd.com/about/purchasing/bid-opportunities','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['LVMPD']),
  buyer('NV_RTC','Regional Transportation Commission of Southern Nevada','Las Vegas–Henderson','https://www.rtcsnv.com/about/doing-business-with-us/','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['RTC Southern Nevada','RTC of Southern Nevada']),
  buyer('NV_UNLV','University of Nevada, Las Vegas','Las Vegas–Henderson','https://www.unlv.edu/purchasing/solicitations','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['UNLV']),
  buyer('NV_UNR','University of Nevada, Reno','Reno–Sparks','https://www.unr.edu/facilities/planning-and-construction/bid-opportunities','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['UNR','University of Nevada Reno']),
  buyer('NV_BCN','Business Center North','Reno–Sparks','https://www.bcnpurchasing.nevada.edu/','https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SYSTEM_OF_RECORD',['BCN']),
];

const NV_BONFIRE_BUYERS = [
  buyer('NV_CCSD','Clark County School District','Las Vegas–Henderson','https://www.ccsd.net/resources/purchasing-and-warehousing','https://ccsd.bonfirehub.com/portal','SYSTEM_OF_RECORD',['CCSD','Clark County School District - Purchasing & Warehousing Dept','Clark County School District - Purchasing/Warehousing Department']),
];

const NV_PLANETBIDS_BUYERS = [
  buyer('NV_RENO','City of Reno','Reno–Sparks','https://www.reno.gov/business-development/bids-rfps-rfqs/index.php',null,'SYSTEM_OF_RECORD',['Reno']),
];

const NV_PERISCOPE_BUYERS = [
  buyer('NV_STATE_EPRO','State of Nevada / NevadaEPro','Las Vegas–Henderson | Reno–Sparks','https://purchasing.nv.gov/','https://nevadaepro.com/bso/view/search/external/advancedSearchBid.xhtml?openBids=true','SYSTEM_OF_RECORD',['State of Nevada','Nevada State Purchasing','NevadaEPro']),
];

export const VENDOR_DISCOVERY_SCOPES = Object.freeze({
  CA_OPENGOV: vendorScope({ id:'CA_OPENGOV', state:'California', vendor_name:'OpenGov', platform:'OpenGov Procurement', target_metros:['Los Angeles','San Francisco Bay Area','Sacramento'], publishers:CA_OPENGOV_BUYERS, pathways:[pathway('CA_OPENGOV_PORTALS','Verified OpenGov buyer portals',CA_OPENGOV_BUYERS.map(b=>b.id),'https://procurement.opengov.com/')], allowed_host_suffixes:['procurement.opengov.com','acgov.org','smcgov.org','saccounty.gov','sacog.org','metrofire.ca.gov','cityofwestsacramento.org','cityofpacifica.org','lvmwd.com'], notes:'Acquire only from verified buyer portals; preserve buyer and metro.' }),
  CA_PLANETBIDS: vendorScope({ id:'CA_PLANETBIDS', state:'California', vendor_name:'PlanetBids', platform:'PlanetBids', target_metros:['San Diego','Inland Empire','San Francisco Bay Area'], publishers:CA_PLANETBIDS_BUYERS, pathways:[pathway('CA_PLANETBIDS_PORTALS','Verified PlanetBids buyer portals',CA_PLANETBIDS_BUYERS.map(b=>b.id),'https://pbsystem.planetbids.com/')], allowed_host_suffixes:['planetbids.com','sandiego.gov','sdcourt.ca.gov','sdhc.org','riversideca.gov','sbcity.org','ieua.org','sunnyvale.ca.gov'], notes:'PlanetBids is system of record only for buyers verified through current official agency evidence.' }),
  CA_BONFIRE_EUNA: vendorScope({ id:'CA_BONFIRE_EUNA', state:'California', vendor_name:'Bonfire / Euna Procurement', platform:'Bonfire / Euna Procurement', target_metros:['Los Angeles','San Francisco Bay Area'], publishers:CA_BONFIRE_BUYERS, pathways:[pathway('CA_BONFIRE_PORTALS','Verified Bonfire / Euna buyer portals',CA_BONFIRE_BUYERS.map(b=>b.id),'https://bonfirehub.com/')], allowed_host_suffixes:['bonfirehub.com','lawa.org','lacourt.org','laccd.edu','sanfranciscobayferry.com'], notes:'Supplier-facing Bonfire domains remain valid within the Euna Procurement family.' }),
  CA_BIDNET_DIRECT: vendorScope({ id:'CA_BIDNET_DIRECT', state:'California', vendor_name:'BidNet Direct / SOVRA', platform:'BidNet Direct', target_metros:['Los Angeles','San Francisco Bay Area','San Diego','Inland Empire'], publishers:CA_BIDNET_BUYERS, pathways:[pathway('CA_BIDNET_DIRECT_GROUP','California Purchasing Group direct-participating buyers only',CA_BIDNET_BUYERS.map(b=>b.id),'https://www.bidnetdirect.com/california','DIRECT_GROUP_ONLY')], allowed_host_suffixes:['bidnetdirect.com','contracosta.ca.gov','acpwa.org','mountainview.gov','santaclaraca.gov','santaclarita.gov','ci.oceanside.ca.us','poway.org','coltonca.gov'], notes:'Do not ingest statewide/federal syndicated BidNet listings. Only direct Group Bids from configured participating buyers are eligible.' }),
  CA_PERISCOPE_EPRO: vendorScope({ id:'CA_PERISCOPE_EPRO', state:'California', vendor_name:'Periscope ePro / S2G', platform:'Periscope ePro', target_metros:['San Francisco Bay Area'], publishers:CA_PERISCOPE_BUYERS, pathways:[pathway('CA_CONTRA_COSTA_EPRO','Contra Costa County ePro',CA_PERISCOPE_BUYERS.map(b=>b.id),'https://purchasing.cccounty.us/bso/')], allowed_host_suffixes:['purchasing.cccounty.us','contracosta.ca.gov'], notes:'Current confirmed Periscope system-of-record relationship only.' }),
  CA_PUBLIC_PURCHASE: vendorScope({ id:'CA_PUBLIC_PURCHASE', state:'California', vendor_name:'Public Purchase', platform:'Public Purchase', target_metros:['Sacramento'], publishers:CA_PUBLIC_PURCHASE_BUYERS, pathways:[pathway('CA_ROSEVILLE_PUBLIC_PURCHASE','City of Roseville Public Purchase',CA_PUBLIC_PURCHASE_BUYERS.map(b=>b.id),'https://www.publicpurchase.com/gems/roseville,ca/buyer/public/home')], allowed_host_suffixes:['publicpurchase.com','roseville.ca.us'], notes:'Public Purchase is frequently a syndication source. Only official-agency-confirmed system-of-record buyers are admitted.' }),
  CA_JAGGAER: vendorScope({ id:'CA_JAGGAER', state:'California', vendor_name:'JAGGAER', platform:'JAGGAER / CSUBUY', target_metros:['California — Statewide'], publishers:CA_JAGGAER_BUYERS, pathways:[pathway('CA_CSUBUY_PUBLIC_PORTAL','CSU systemwide public bid portal (CSUBUY)',CA_JAGGAER_BUYERS.map(b=>b.id),'https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=CalState')], allowed_host_suffixes:['sciquest.com','calstate.edu'], notes:'Public event index/detail only -- event-detail routes redirect to JAGGAER supplier login.' }),
  CA_DEMANDSTAR: vendorScope({ id:'CA_DEMANDSTAR', state:'California', vendor_name:'DemandStar', platform:'DemandStar', target_metros:['San Francisco Bay Area'], publishers:CA_DEMANDSTAR_BUYERS, pathways:[pathway('CA_SANTA_CLARA_STADIUM_DEMANDSTAR','Santa Clara Stadium Authority DemandStar agency page',CA_DEMANDSTAR_BUYERS.map(b=>b.id),'https://www.demandstar.com/app/agencies/california/santa-clara-stadium-authority/procurement-opportunities/998212a1-6619-4c91-980e-08eeab39552b/')], allowed_host_suffixes:['demandstar.com','santaclaraca.gov'], notes:'Public detail and document manifest visible without authentication; download opens a DemandStar login boundary.' }),
  CA_IONWAVE: vendorScope({ id:'CA_IONWAVE', state:'California', vendor_name:'Ion Wave (SRJC)', platform:'Ion Wave Procurement Portal', target_metros:['San Francisco Bay Area'], publishers:CA_IONWAVE_BUYERS, pathways:[pathway('CA_SRJC_ION_WAVE','Santa Rosa Junior College current-bids index',CA_IONWAVE_BUYERS.map(b=>b.id),'https://srjc.ionwave.net/SourcingEvents.aspx?SourceType=1')], allowed_host_suffixes:['ionwave.net','santarosa.edu'], notes:'Public current/closed/awarded index readable without authentication. A zero-result run is a valid current-state result, not a broken source.' }),

  AZ_OPENGOV: vendorScope({ id:'AZ_OPENGOV', state:'Arizona', vendor_name:'OpenGov', platform:'OpenGov Procurement', target_metros:['Phoenix–Mesa–Chandler','Tucson'], publishers:AZ_OPENGOV_BUYERS, pathways:[pathway('AZ_OPENGOV_PORTALS','Verified OpenGov buyer portals',AZ_OPENGOV_BUYERS.map(b=>b.id),'https://procurement.opengov.com/')], allowed_host_suffixes:['procurement.opengov.com','phoenix.gov','avondaleaz.gov','queencreekaz.gov','valleymetro.org','mpsaz.org','cusd80.com','tucsonaz.gov'], notes:'Primary shared Arizona vendor family identified during Maricopa acquisition experience.' }),
  AZ_BONFIRE_EUNA: vendorScope({ id:'AZ_BONFIRE_EUNA', state:'Arizona', vendor_name:'Bonfire / Euna Procurement', platform:'Bonfire / Euna Procurement', target_metros:['Phoenix–Mesa–Chandler'], publishers:AZ_BONFIRE_BUYERS, pathways:[pathway('AZ_BONFIRE_PORTALS','Verified Bonfire / Euna buyer portals',AZ_BONFIRE_BUYERS.map(b=>b.id),'https://bonfirehub.com/')], allowed_host_suffixes:['bonfirehub.com','tempe.gov','scottsdaleaz.gov','goodyearaz.gov','buckeyeaz.gov','maricopa.edu'], notes:'Second high-leverage Arizona vendor family.' }),
  AZ_BIDNET_DIRECT: vendorScope({ id:'AZ_BIDNET_DIRECT', state:'Arizona', vendor_name:'BidNet Direct / SOVRA', platform:'BidNet Direct', target_metros:['Phoenix–Mesa–Chandler'], publishers:AZ_BIDNET_BUYERS, pathways:[pathway('AZ_MARICOPA_BIDNET','Maricopa County BidNet Direct',AZ_BIDNET_BUYERS.map(b=>b.id),'https://www.bidnetdirect.com/arizona/maricopacounty')], allowed_host_suffixes:['bidnetdirect.com','maricopa.gov'], notes:'Maricopa County moved from Periscope S2G to BidNet effective May 1, 2025.' }),

  NV_IONWAVE_NGEM: vendorScope({ id:'NV_IONWAVE_NGEM', state:'Nevada', vendor_name:'IonWave / NGEM', platform:'IonWave Technologies / Nevada Government eMarketplace', target_metros:['Las Vegas–Henderson','Reno–Sparks'], publishers:NV_NGEM_BUYERS, pathways:[pathway('NV_NGEM_SHARED','NGEM shared current opportunity index',NV_NGEM_BUYERS.map(b=>b.id),'https://nevada.ionwave.net/SourcingEvents.aspx?SourceType=1','SHARED_PLATFORM')], allowed_host_suffixes:['nevada.ionwave.net','ngemnv.com','clarkcountynv.gov','lasvegasnevada.gov','cityofhenderson.com','cityofnorthlasvegas.com','lvmpd.com','rtcsnv.com','unlv.edu','unr.edu','nevada.edu'], notes:'Shared Nevada cooperative. Preserve actual issuer; do not collapse all records to NGEM.' }),
  NV_BONFIRE_EUNA: vendorScope({ id:'NV_BONFIRE_EUNA', state:'Nevada', vendor_name:'Bonfire / Euna Procurement', platform:'Bonfire / Euna Procurement', target_metros:['Las Vegas–Henderson'], publishers:NV_BONFIRE_BUYERS, pathways:[pathway('NV_CCSD_BONFIRE','Clark County School District Euna Procurement / Bonfire portal',NV_BONFIRE_BUYERS.map(b=>b.id),'https://ccsd.bonfirehub.com/portal')], allowed_host_suffixes:['bonfirehub.com','ccsd.net'], notes:'CCSD official purchasing page identifies DemandStar as bidder-list/notification service and Euna Procurement / Bonfire as the current download/submittal opportunity portal.' }),
  NV_PLANETBIDS: vendorScope({ id:'NV_PLANETBIDS', state:'Nevada', vendor_name:'PlanetBids', platform:'PlanetBids', target_metros:['Reno–Sparks'], publishers:NV_PLANETBIDS_BUYERS, pathways:[pathway('NV_RENO_PLANETBIDS','City of Reno PlanetBids',NV_PLANETBIDS_BUYERS.map(b=>b.id),'https://www.reno.gov/business-development/bids-rfps-rfqs/index.php')], allowed_host_suffixes:['planetbids.com','reno.gov'], notes:'City of Reno states PlanetBids manages all construction and non-construction Bids, RFPs and RFQs.' }),
  NV_PERISCOPE_EPRO: vendorScope({ id:'NV_PERISCOPE_EPRO', state:'Nevada', vendor_name:'Periscope ePro / NevadaEPro', platform:'Periscope S2G / NevadaEPro', target_metros:['Las Vegas–Henderson','Reno–Sparks'], publishers:NV_PERISCOPE_BUYERS, pathways:[pathway('NV_NEVADA_EPRO','NevadaEPro open bid index',NV_PERISCOPE_BUYERS.map(b=>b.id),'https://nevadaepro.com/bso/view/search/external/advancedSearchBid.xhtml?openBids=true')], allowed_host_suffixes:['nevadaepro.com','purchasing.nv.gov'], notes:'Statewide third-party eProcurement system. Metro targeting is applied through issuer/place-of-performance evidence when available.' }),
});

export function getVendorDiscoveryScope(id) {
  return VENDOR_DISCOVERY_SCOPES[String(id || '').toUpperCase()] || null;
}
