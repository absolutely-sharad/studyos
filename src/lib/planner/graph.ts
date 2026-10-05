export interface GraphTopic {
  id: string;
  priority: number;
  prerequisites: string[];
}

/** Map of topic id → ids of topics that depend on it (transitively). */
export function transitiveDependents(topics: GraphTopic[]): Map<string, Set<string>> {
  const ids = new Set(topics.map((t) => t.id));
  const direct = new Map<string, string[]>();
  for (const t of topics) {
    for (const p of t.prerequisites) {
      if (!ids.has(p)) continue;
      direct.set(p, [...(direct.get(p) ?? []), t.id]);
    }
  }
  const memo = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const visit = (id: string): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set(); // cycle guard
    visiting.add(id);
    const out = new Set<string>();
    for (const child of direct.get(id) ?? []) {
      out.add(child);
      for (const g of visit(child)) out.add(g);
    }
    visiting.delete(id);
    out.delete(id);
    memo.set(id, out);
    return out;
  };
  for (const t of topics) visit(t.id);
  return memo;
}

/**
 * Priority-aware topological order.
 * A prerequisite inherits the urgency of the most important topic that needs it,
 * so low-priority foundations are not left until the end.
 * Cycles are broken by dropping the prerequisites of the most urgent blocked topic.
 */
export function prioritizedOrder(topics: GraphTopic[]): { order: string[]; brokenCycles: string[] } {
  const ids = new Set(topics.map((t) => t.id));
  const index = new Map(topics.map((t, i) => [t.id, i]));
  const byId = new Map(topics.map((t) => [t.id, t]));
  const dependents = transitiveDependents(topics);

  const effective = new Map<string, number>();
  for (const t of topics) {
    let p = t.priority;
    for (const d of dependents.get(t.id) ?? []) p = Math.max(p, byId.get(d)!.priority);
    effective.set(t.id, p);
  }

  const pending = new Map<string, Set<string>>();
  for (const t of topics) pending.set(t.id, new Set(t.prerequisites.filter((p) => ids.has(p) && p !== t.id)));

  const compare = (a: string, b: string) =>
    effective.get(b)! - effective.get(a)! ||
    byId.get(b)!.priority - byId.get(a)!.priority ||
    index.get(a)! - index.get(b)!;

  const order: string[] = [];
  const done = new Set<string>();
  const brokenCycles: string[] = [];

  while (order.length < topics.length) {
    const ready = [...pending.entries()].filter(([id, pre]) => !done.has(id) && pre.size === 0).map(([id]) => id);
    let next: string;
    if (ready.length > 0) {
      next = ready.sort(compare)[0];
    } else {
      next = [...pending.keys()].filter((id) => !done.has(id)).sort(compare)[0];
      brokenCycles.push(next);
    }
    order.push(next);
    done.add(next);
    for (const pre of pending.values()) pre.delete(next);
  }
  return { order, brokenCycles };
}
