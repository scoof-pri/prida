// Persistent entity deltas. LiftSystem snapshots are atomic {revision, states} envelopes:
// splitting their rows without their revision would stop syncLifts or resurrect stale cabins.
const FIELDS = Object.freeze(['vehicles', 'doors', 'lifts', 'constructions', 'labItems']);
const LIFT_ENVELOPE_ID = '@prida/lift-snapshot';
const isLiftSnapshot = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.states);
const idOf = (value, name) => name === 'lifts' && isLiftSnapshot(value)
  ? LIFT_ENVELOPE_ID : Array.isArray(value) ? value[0] : value?.id;
const validID = id => typeof id === 'string' || (typeof id === 'number' && Number.isSafeInteger(id));
const keyOf = id => typeof id + ':' + id;
function records(name, value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (name === 'lifts' && isLiftSnapshot(value)) return [value];
  throw new TypeError('Invalid ' + name + ' snapshot: expected ' +
    (name === 'lifts' ? '{revision, states} or a legacy array' : 'an array'));
}
export function prepareEntities(snapshot, seq, replacer) {
  const fields = Object.create(null);
  // Validate before consuming the snapshot; never silently discard malformed live state.
  for (const name of FIELDS) records(name, snapshot[name]);
  for (const name of FIELDS) {
    const m = new Map();
    for (const value of records(name, snapshot[name])) {
      const id = idOf(value, name); if (!validID(id)) continue;
      m.set(keyOf(id), { id, json: JSON.stringify(value, replacer) });
    }
    fields[name] = m; delete snapshot[name];
  }
  return { seq, fields };
}
export function entityDeltaPacket(frame, previous) {
  const full = !previous, next = Object.create(null), fragments = [];
  let changed = full;
  for (const name of FIELDS) {
    const now = frame.fields[name], before = previous?.[name] || new Map(), values = [], gone = [];
    next[name] = now;
    for (const [key, value] of now) if (before.get(key)?.json !== value.json) values.push(value.json);
    for (const [key, value] of before) if (!now.has(key)) gone.push(value.id);
    if (full || values.length) fragments.push(JSON.stringify(name) + ':[' + values.join(',') + ']');
    if (gone.length) fragments.push(JSON.stringify(name + 'Gone') + ':' + JSON.stringify(gone));
    if (values.length || gone.length) changed = true;
  }
  const json = changed ? '{"seq":' + frame.seq + (full ? ',"full":true' : '') +
    (fragments.length ? ',' + fragments.join(',') : '') + '}' : null;
  return { json, next, changed };
}
export class EntityDeltaMirror {
  constructor() { this.reset(); }
  reset() {
    this.fields = Object.fromEntries(FIELDS.map(k => [k, new Map()]));
    this.versions = Object.fromEntries(FIELDS.map(k => [k, new Map()])); this.floor = 0;
  }
  apply(state) {
    const d = state.entityDelta;
    if (d && Number.isSafeInteger(d.seq) && d.seq > 0 && d.seq >= this.floor) {
      for (const name of FIELDS) {
        const map = this.fields[name], versions = this.versions[name], incoming = Array.isArray(d[name]) ? d[name] : [];
        const present = new Set();
        for (const value of incoming) {
          const id = idOf(value, name); if (!validID(id)) continue;
          const key = keyOf(id); present.add(key);
          if ((versions.get(key) || 0) > d.seq) continue;
          map.set(key, value); versions.set(key, d.seq);
        }
        for (const id of Array.isArray(d[name + 'Gone']) ? d[name + 'Gone'] : []) {
          if (!validID(id)) continue; const key = keyOf(id);
          if ((versions.get(key) || 0) > d.seq) continue;
          map.delete(key); versions.set(key, d.seq);
        }
        if (d.full) {
          for (const [key, version] of versions) if (version <= d.seq && !present.has(key)) {
            map.delete(key); versions.delete(key);
          }
        }
      }
      if (d.full) this.floor = d.seq;
    } else if (!d) {
      // Direct/local captures retain the same native shape as the authoritative simulation.
      for (const name of FIELDS) if (state[name] !== undefined && state[name] !== null) {
        const values = records(name, state[name]);
        this.fields[name] = new Map(values.filter(v => validID(idOf(v, name))).map(v => [keyOf(idOf(v, name)), v]));
      }
    }
    for (const name of FIELDS) {
      const values = [...this.fields[name].values()];
      const lift = name === 'lifts' && values.find(isLiftSnapshot);
      state[name] = lift || values;
    }
    delete state.entityDelta; return state;
  }
}
