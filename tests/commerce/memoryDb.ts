// Sombrey commerce tests — an in-memory stand-in for Convex's ctx.db (not a test file).
// Enough of the API for the commerce stores: query().withIndex(eq…).unique/first/collect/take,
// insert, patch (undefined removes a field, as in Convex), get. `serial` runs
// mutations one at a time, as Convex's serializable transactions do.

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

export class MemoryDb {
  tables = new Map<string, Row[]>();
  private n = 0;
  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  query(table: string) {
    const all = () => this.rows(table);
    return {
      withIndex: (_name: string, f: (q: unknown) => unknown) => {
        const eqs: Array<[string, unknown]> = [];
        const ranges: Array<(r: Row) => boolean> = [];
        const cmp = (field: string, test: (a: number, b: number) => boolean, value: number) => { ranges.push((r) => typeof r[field] === "number" && test(r[field] as number, value)); return q; };
        const q = {
          eq: (field: string, value: unknown) => { eqs.push([field, value]); return q; },
          gt: (field: string, value: number) => cmp(field, (a, b) => a > b, value),
          gte: (field: string, value: number) => cmp(field, (a, b) => a >= b, value),
          lt: (field: string, value: number) => cmp(field, (a, b) => a < b, value),
          lte: (field: string, value: number) => cmp(field, (a, b) => a <= b, value),
        };
        f(q);
        const match = () => all().filter((r) => eqs.every(([k, v]) => r[k] === v) && ranges.every((t) => t(r)));
        return {
          unique: async () => {
            const m = match();
            if (m.length > 1) throw new Error(`unique() matched ${m.length} rows in ${table}`);
            return m[0] ?? null;
          },
          first: async () => match()[0] ?? null,
          collect: async () => match(),
          take: async (k: number) => match().slice(0, k),
        };
      },
    };
  }
  async insert(table: string, doc: Record<string, unknown>) {
    const id = `${table}:${++this.n}`;
    this.rows(table).push({ ...structuredClone(doc), _id: id, _creationTime: Date.now() });
    return id;
  }
  async patch(id: string, fields: Record<string, unknown>) {
    const row = this.get(id);
    if (!row) throw new Error(`no row ${id}`);
    for (const [k, v] of Object.entries(fields)) if (v === undefined) delete row[k]; else row[k] = structuredClone(v);
  }
  async delete(id: string) {
    const table = id.split(":")[0];
    this.tables.set(table, this.rows(table).filter((r) => r._id !== id));
  }
  get(id: string): Row | null {
    const table = id.split(":")[0];
    return this.rows(table).find((r) => r._id === id) ?? null;
  }
  /** Runs mutations one at a time, as Convex's serializable transactions do. */
  private chain: Promise<unknown> = Promise.resolve();
  serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
