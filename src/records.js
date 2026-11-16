// Field records and simulated tags, kept in localStorage.
// A field record ({kind: 'field'}) overrides one metric's status in mergeResults: pass true -> met,
// false -> not_met, evidence 'observation', note 'field result'. A simulated tag ({kind: 'simulated_tag'})
// is a SIMULATED note on the map only; it never reaches mergeResults, so it never changes a status,
// a priority or a verdict.

import { mergeResults } from './status.js';

export const RECORDS_VERSION = 1;
export const KINDS = Object.freeze(['field', 'simulated_tag']);

const isStr = (x) => typeof x === 'string';
const optStr = (x) => x === undefined || x === null || isStr(x);
const optNum = (x) => x === undefined || x === null || Number.isFinite(x);

// True when one stored item has a known kind and the fields that kind needs.
export function validRecord(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.kind === 'field') {
    return isStr(r.siteId) && isStr(r.metricId) && (r.pass === true || r.pass === false)
      && optStr(r.stopId) && optNum(r.value) && optStr(r.note);
  }
  if (r.kind === 'simulated_tag') {
    return Number.isFinite(r.lon) && Number.isFinite(r.lat) && optStr(r.siteId) && optStr(r.note);
  }
  return false;
}

// Only the field records of one site (or of every site when siteId is omitted).
export function fieldRecordsFor(records, siteId) {
  return (records || []).filter((r) => r && r.kind === 'field' && (siteId === undefined || r.siteId === siteId));
}

// A new results Map with this site's field records applied. Simulated tags are dropped here, and
// mergeResults keeps not_applicable metrics as they are.
export function applyFieldRecords(results, records, siteId) {
  return mergeResults(results, null, fieldRecordsFor(records, siteId));
}

function readStored(storage, key) {
  try {
    const raw = storage && storage.getItem(key);
    if (!raw) return [];
    const doc = JSON.parse(raw);
    if (!doc || doc.version !== RECORDS_VERSION || !Array.isArray(doc.records)) return [];
    return doc.records.filter(validRecord);
  } catch (e) {
    return [];
  }
}

export function createRecords(storage = localStorage, key = 'martian-map.records.v1') {
  let records = readStored(storage, key);
  const listeners = new Set();

  function commit(next) {
    records = next;
    try { if (storage) storage.setItem(key, JSON.stringify({ version: RECORDS_VERSION, records })); } catch (e) { /* quota or private mode: keep in memory */ }
    const snapshot = records.slice();
    for (const cb of [...listeners]) cb(snapshot);
  }

  return {
    list: () => records.slice(),
    addField({ siteId, stopId, metricId, value, pass, note } = {}) {
      const rec = { kind: 'field', siteId, stopId: stopId ?? null, metricId, value: Number.isFinite(value) ? value : null, pass, note: note ?? '' };
      if (!validRecord(rec)) throw new Error('field record needs siteId, metricId and pass true/false');
      commit([...records, rec]);
      return rec;
    },
    addSimTag({ siteId, lon, lat, note } = {}) {
      const rec = { kind: 'simulated_tag', siteId: siteId ?? null, lon, lat, note: note ?? '' };
      if (!validRecord(rec)) throw new Error('simulated tag needs finite lon and lat');
      commit([...records, rec]);
      return rec;
    },
    exportJson: () => JSON.stringify({ version: RECORDS_VERSION, records }, null, 2),
    // Replaces every record. On any rejection the state stays as it was.
    importJson(text) {
      let doc;
      try { doc = JSON.parse(text); } catch (e) { return { ok: false, error: 'not valid JSON' }; }
      if (!doc || typeof doc !== 'object' || doc.version !== RECORDS_VERSION) return { ok: false, error: 'expected version ' + RECORDS_VERSION };
      if (!Array.isArray(doc.records)) return { ok: false, error: 'expected a records array' };
      const bad = doc.records.findIndex((r) => !validRecord(r));
      if (bad >= 0) return { ok: false, error: 'record ' + bad + ' has an unknown kind or missing fields' };
      commit(doc.records.map((r) => ({ ...r })));
      return { ok: true, error: null };
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
