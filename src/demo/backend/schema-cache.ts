/**
 * What the database looks like, read once: PostgREST calls this its schema
 * cache. Tables and their column types (to cast request values), foreign keys
 * (to embed related rows) and functions (to call an RPC by its argument names).
 */
import type { SqlDb } from './types';

export interface ForeignKey {
  name: string;
  /** The table that holds the key columns. */
  child: string;
  childCols: string[];
  /** The table the key points at. */
  parent: string;
  parentCols: string[];
  /** The key columns are unique in the child: at most one child per parent. */
  childUnique: boolean;
}

export interface FunctionArg {
  name: string;
  type: string;
  hasDefault: boolean;
}

export interface FunctionInfo {
  name: string;
  args: FunctionArg[];
  returnsSet: boolean;
  returnsVoid: boolean;
  /** Returns rows of several columns (a table, a row type, OUT arguments) rather than one value. */
  returnsRows: boolean;
}

export interface SchemaCache {
  /** table → column → SQL type, as written in a cast. */
  tables: Map<string, Map<string, string>>;
  primaryKeys: Map<string, string[]>;
  foreignKeys: ForeignKey[];
  functions: Map<string, FunctionInfo[]>;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function loadSchemaCache(db: SqlDb): Promise<SchemaCache> {
  const columns = await db.query<{ t: string; c: string; ty: string }>(`
    SELECT c.relname AS t, a.attname AS c, format_type(a.atttypid, a.atttypmod) AS ty
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum`);
  const tables = new Map<string, Map<string, string>>();
  for (const row of columns.rows) {
    if (!tables.has(row.t)) tables.set(row.t, new Map());
    tables.get(row.t)!.set(row.c, row.ty);
  }

  const uniques = await db.query<{ t: string; cols: string[]; pk: boolean }>(`
    SELECT c.relname AS t, i.indisprimary AS pk,
           ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum ORDER BY k.ord) AS cols
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND i.indisunique AND i.indpred IS NULL`);
  const primaryKeys = new Map<string, string[]>();
  for (const row of uniques.rows) if (row.pk) primaryKeys.set(row.t, row.cols);

  const fks = await db.query<{ name: string; child: string; child_cols: string[]; parent: string; parent_cols: string[] }>(`
    SELECT con.conname AS name, c.relname AS child, p.relname AS parent,
           ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS child_cols,
           ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS parent_cols
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_class p ON p.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE con.contype = 'f' AND n.nspname = 'public' AND pn.nspname = 'public'
    ORDER BY con.conname`);
  const foreignKeys: ForeignKey[] = fks.rows.map((row) => ({
    name: row.name,
    child: row.child,
    childCols: row.child_cols,
    parent: row.parent,
    parentCols: row.parent_cols,
    childUnique: uniques.rows.some((u) => u.t === row.child && sameSet(u.cols, row.child_cols)),
  }));

  const procs = await db.query<{ name: string; arg_names: string[] | null; arg_modes: string[] | null; arg_types: string[]; n_defaults: number; retset: boolean; rettype: string; typtype: string }>(`
    SELECT p.proname AS name, p.proargnames::text[] AS arg_names, p.proargmodes::text[] AS arg_modes,
           ARRAY(SELECT format_type(t, NULL) FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) t) AS arg_types,
           p.pronargdefaults::int AS n_defaults, p.proretset AS retset, format_type(p.prorettype, NULL) AS rettype,
           t.typtype::text AS typtype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public' AND p.prokind = 'f'`);
  const functions = new Map<string, FunctionInfo[]>();
  for (const row of procs.rows) {
    const names = row.arg_names ?? [];
    const modes = row.arg_modes ?? row.arg_types.map(() => 'i');
    const inputs: FunctionArg[] = [];
    row.arg_types.forEach((type, i) => {
      const mode = modes[i] ?? 'i';
      if (mode === 'i' || mode === 'b' || mode === 'v') inputs.push({ name: names[i] ?? '', type, hasDefault: false });
    });
    // Defaults belong to the last input arguments.
    for (let i = inputs.length - row.n_defaults; i < inputs.length; i += 1) if (inputs[i]) inputs[i].hasDefault = true;
    const info: FunctionInfo = {
      name: row.name, args: inputs, returnsSet: row.retset, returnsVoid: row.rettype === 'void',
      returnsRows: row.typtype === 'c' || row.rettype === 'record',
    };
    if (!functions.has(row.name)) functions.set(row.name, []);
    functions.get(row.name)!.push(info);
  }

  return { tables, primaryKeys, foreignKeys, functions };
}
