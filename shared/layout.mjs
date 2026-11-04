export function layoutTimeline(trajectory) {
  const nodes = trajectory.nodes;
  const ids = new Set(nodes.map(n => n.id));
  const parent = new Map(nodes.map(n => [n.id, n.id]));
  const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const parallel = trajectory.relations.filter(e => e.kind === 'parallel' && ids.has(e.from) && ids.has(e.to));
  for (const e of parallel) parent.set(find(e.to), find(e.from));
  const groups = new Map();
  for (const n of nodes) { const id = find(n.id); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(n); }
  const edges = trajectory.relations.filter(e => e.kind === 'precedes' && ids.has(e.from) && ids.has(e.to));
  const temporalIds = new Set([...edges.flatMap(e => [find(e.from), find(e.to)]), ...parallel.flatMap(e => [find(e.from), find(e.to)])]);
  const pending = new Set(temporalIds), emitted = new Set(), layers = [];
  while (pending.size) {
    const ready = [...pending].filter(id => !edges.some(e => find(e.to) === id && !emitted.has(find(e.from))));
    if (!ready.length) break;
    layers.push(ready.map(id => ({ id, nodes: groups.get(id), parallel: groups.get(id).length > 1 })));
    for (const id of ready) { pending.delete(id); emitted.add(id); }
  }
  const unknown = nodes.filter(n => !temporalIds.has(find(n.id)) || pending.has(find(n.id)));
  return { layers, unknown, temporalEdges: edges };
}
