/**
 * A stand-in for PostgREST: turns the requests supabase-js makes to /rest/v1
 * into SQL for the demo's in-browser database (demo mode only, src/demo).
 *
 * It covers what this app uses — embedded resources (`orders(*, order_items(*))`,
 * `!inner`), the filter operators, ordering, paging, exact counts, inserts,
 * updates, upserts, deletes and RPC calls by argument name — and answers in
 * PostgREST's shapes, error bodies included, because the app reads those
 * (`PGRST116`, `PGRST202`, `P0001` with DETAIL …).
 *
 * Identifiers are checked against the schema and quoted; every value travels
 * as a parameter (`$1` is a JSON array of them, see demo.run in sql/post.sql).
 */
import type { ForeignKey, FunctionInfo, SchemaCache } from './schema-cache';
import type { BackendRequest, PgError } from './types';

export class RestError extends Error {
  constructor(public status: number, public body: PgError) {
    super(body.message);
  }
}

const bad = (message: string, code = 'PGRST100', status = 400, details: string | null = null): RestError =>
  new RestError(status, { code, message, details, hint: null });

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---------------------------------------------------------------- select=

export type SelectNode =
  | { kind: 'star' }
  | { kind: 'column'; name: string; alias?: string; cast?: string }
  | { kind: 'embed'; relation: string; alias?: string; hint?: string; inner: boolean; children: SelectNode[] };

/** Splits on `sep` outside parentheses, braces and double quotes. */
export function splitTop(input: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      current += ch;
      if (ch === '\\' && i + 1 < input.length) { current += input[i + 1]; i += 1; } else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; current += ch; continue; }
    if (ch === '(' || ch === '{') depth += 1;
    if (ch === ')' || ch === '}') depth -= 1;
    if (ch === sep && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim() !== '' || out.length > 0) out.push(current);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

export function parseSelect(input: string): SelectNode[] {
  const text = input.trim();
  if (text === '') return [{ kind: 'star' }];
  return splitTop(text).map((part): SelectNode => {
    const open = part.indexOf('(');
    if (open !== -1 && part.endsWith(')')) {
      let head = part.slice(0, open).trim();
      let alias: string | undefined;
      const colon = head.indexOf(':');
      if (colon !== -1) { alias = head.slice(0, colon).trim(); head = head.slice(colon + 1).trim(); }
      const [relation, ...modifiers] = head.split('!');
      const inner = modifiers.includes('inner');
      const hint = modifiers.find((m) => m !== 'inner' && m !== 'left');
      return { kind: 'embed', relation, alias, hint, inner, children: parseSelect(part.slice(open + 1, -1)) };
    }
    if (part === '*') return { kind: 'star' };
    let name = part;
    let alias: string | undefined;
    let cast: string | undefined;
    const colon = name.indexOf(':');
    if (colon !== -1 && name[colon + 1] !== ':') { alias = name.slice(0, colon).trim(); name = name.slice(colon + 1).trim(); }
    const castAt = name.indexOf('::');
    if (castAt !== -1) { cast = name.slice(castAt + 2).trim(); name = name.slice(0, castAt).trim(); }
    return { kind: 'column', name, alias, cast };
  });
}

// ---------------------------------------------------------------- filters

type Condition =
  | { kind: 'cmp'; column: string; negate: boolean; op: string; value: string }
  | { kind: 'logic'; op: 'and' | 'or'; negate: boolean; items: Condition[] };

const OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'cs', 'cd', 'ov', 'match', 'imatch']);

function parseCondition(column: string, expr: string): Condition {
  let rest = expr;
  let negate = false;
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
  const dot = rest.indexOf('.');
  const op = dot === -1 ? rest : rest.slice(0, dot);
  if (!OPERATORS.has(op)) throw bad(`"${expr}" is not a filter this demo database understands`);
  return { kind: 'cmp', column, negate, op, value: dot === -1 ? '' : rest.slice(dot + 1) };
}

/** `(a.eq.1,and(b.gt.2,c.is.null))`, the value of an `or=` / `and=` parameter. */
function parseLogic(op: 'and' | 'or', negate: boolean, value: string): Condition {
  const inner = value.trim().replace(/^\(/, '').replace(/\)$/, '');
  const items = splitTop(inner).map((part): Condition => {
    const nested = /^(not\.)?(and|or)\((.*)\)$/s.exec(part);
    if (nested) return parseLogic(nested[2] as 'and' | 'or', !!nested[1], nested[3]);
    const dot = part.indexOf('.');
    if (dot === -1) throw bad(`"${part}" is not a filter`);
    return parseCondition(part.slice(0, dot), part.slice(dot + 1));
  });
  return { kind: 'logic', op, negate, items };
}

/** `(a,"b c",d)` → the values. */
function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\(/, '').replace(/\)$/, '');
  return splitTop(inner).map((item) => (item.startsWith('"') && item.endsWith('"') ? item.slice(1, -1).replace(/\\(.)/g, '$1') : item));
}

// ---------------------------------------------------------------- compiling

export interface Compiled {
  sql: string;
  params: unknown[];
  /** What the response wants: rows as an array, one object, or nothing. */
  single: boolean;
  returnBody: boolean;
  successStatus: number;
  wantsCount: boolean;
  head: boolean;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

class Builder {
  params: unknown[] = [];
  private aliases = 0;
  /** path ('' = the top table, 'order_items', 'table_sessions.tables' …) → its conditions, order and limit. */
  private scoped = new Map<string, { conditions: Condition[]; order?: string; limit?: string; offset?: string }>();

  constructor(private schema: SchemaCache, query: URLSearchParams) {
    for (const [key, value] of query.entries()) {
      if (key === 'select' || key === 'on_conflict' || key === 'columns') continue;
      const logic = /^((?:[^.]+\.)*?)(not\.)?(and|or)$/.exec(key);
      if (logic) {
        this.scope(logic[1].replace(/\.$/, '')).conditions.push(parseLogic(logic[3] as 'and' | 'or', !!logic[2], value));
        continue;
      }
      const dot = key.lastIndexOf('.');
      const path = dot === -1 ? '' : key.slice(0, dot);
      const name = dot === -1 ? key : key.slice(dot + 1);
      if (name === 'order') this.scope(path).order = value;
      else if (name === 'limit') this.scope(path).limit = value;
      else if (name === 'offset') this.scope(path).offset = value;
      else if (!RESERVED.has(name)) this.scope(path).conditions.push(parseCondition(name, value));
    }
  }

  private scope(path: string) {
    if (!this.scoped.has(path)) this.scoped.set(path, { conditions: [] });
    return this.scoped.get(path)!;
  }

  alias() {
    this.aliases += 1;
    return `t${this.aliases}`;
  }

  /** Adds a value and returns how SQL reads it as text. */
  text(value: unknown): string {
    this.params.push(value);
    return `($1->>${this.params.length - 1})`;
  }

  /** Adds a value and returns how SQL reads it as JSON. */
  jsonb(value: unknown): string {
    this.params.push(value);
    return `($1->${this.params.length - 1})`;
  }

  columns(table: string): Map<string, string> {
    const cols = this.schema.tables.get(table);
    if (!cols) {
      throw new RestError(404, {
        code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null,
      });
    }
    return cols;
  }

  columnType(table: string, column: string): string {
    const type = this.columns(table).get(column);
    if (!type) {
      throw new RestError(400, { code: '42703', message: `column ${table}.${column} does not exist`, details: null, hint: null });
    }
    return type;
  }

  private condition(table: string, alias: string, c: Condition): string {
    if (c.kind === 'logic') {
      const joined = c.items.map((item) => this.condition(table, alias, item)).join(c.op === 'and' ? ' AND ' : ' OR ');
      return `${c.negate ? 'NOT ' : ''}(${joined || 'true'})`;
    }
    const type = this.columnType(table, c.column);
    const col = `${alias}.${ident(c.column)}`;
    let sql: string;
    switch (c.op) {
      case 'eq': sql = `${col} = ${this.text(c.value)}::${type}`; break;
      case 'neq': sql = `${col} <> ${this.text(c.value)}::${type}`; break;
      case 'gt': sql = `${col} > ${this.text(c.value)}::${type}`; break;
      case 'gte': sql = `${col} >= ${this.text(c.value)}::${type}`; break;
      case 'lt': sql = `${col} < ${this.text(c.value)}::${type}`; break;
      case 'lte': sql = `${col} <= ${this.text(c.value)}::${type}`; break;
      case 'like': sql = `${col}::text LIKE ${this.text(c.value.replace(/\*/g, '%'))}`; break;
      case 'ilike': sql = `${col}::text ILIKE ${this.text(c.value.replace(/\*/g, '%'))}`; break;
      case 'match': sql = `${col}::text ~ ${this.text(c.value)}`; break;
      case 'imatch': sql = `${col}::text ~* ${this.text(c.value)}`; break;
      case 'is': {
        const word = c.value.toLowerCase();
        if (!['null', 'true', 'false', 'unknown'].includes(word)) throw bad(`"is.${c.value}" is not a filter`);
        sql = `${col} IS ${word.toUpperCase()}`;
        break;
      }
      case 'in':
        sql = `${col} = ANY(ARRAY(SELECT jsonb_array_elements_text(${this.jsonb(parseList(c.value))}))::${type}[])`;
        break;
      case 'cs': sql = `${col} @> ${this.text(c.value)}::${type}`; break;
      case 'cd': sql = `${col} <@ ${this.text(c.value)}::${type}`; break;
      case 'ov': sql = `${col} && ${this.text(c.value)}::${type}`; break;
      default: throw bad(`"${c.op}" is not a filter this demo database understands`);
    }
    return c.negate ? `NOT (${sql})` : sql;
  }

  where(table: string, alias: string, path: string, extra: string[] = []): string {
    const own = (this.scoped.get(path)?.conditions ?? []).map((c) => this.condition(table, alias, c));
    const all = [...extra, ...own];
    return all.length ? ` WHERE ${all.join(' AND ')}` : '';
  }

  orderAndPage(table: string, alias: string, path: string): string {
    const scope = this.scoped.get(path);
    let sql = '';
    if (scope?.order) {
      const terms = splitTop(scope.order).map((term) => {
        const [column, ...flags] = term.split('.');
        this.columnType(table, column);
        const direction = flags.includes('desc') ? 'DESC' : 'ASC';
        const nulls = flags.includes('nullsfirst') ? ' NULLS FIRST' : flags.includes('nullslast') ? ' NULLS LAST' : '';
        return `${alias}.${ident(column)} ${direction}${nulls}`;
      });
      if (terms.length) sql += ` ORDER BY ${terms.join(', ')}`;
    }
    const wholeNumber = (value: string | undefined) => (value !== undefined && /^\d+$/.test(value) ? value : null);
    const limit = wholeNumber(scope?.limit);
    const offset = wholeNumber(scope?.offset);
    if (limit !== null) sql += ` LIMIT ${limit}`;
    if (offset !== null) sql += ` OFFSET ${offset}`;
    return sql;
  }

  /** The key between a table and one it embeds, and which side holds it. */
  private relationship(table: string, node: Extract<SelectNode, { kind: 'embed' }>): { fk: ForeignKey; toParent: boolean; target: string } {
    const candidates: { fk: ForeignKey; toParent: boolean; target: string }[] = [];
    for (const fk of this.schema.foreignKeys) {
      // `orders(table_sessions(...))`: orders holds the key — at most one related row.
      if (fk.child === table && fk.parent === node.relation) candidates.push({ fk, toParent: true, target: fk.parent });
      // `orders(order_items(...))`: the other table holds the key — a list of rows.
      if (fk.parent === table && fk.child === node.relation && !(fk.child === fk.parent)) candidates.push({ fk, toParent: false, target: fk.child });
      // `waiter:assigned_waiter_id(...)`: named by the key column or the constraint.
      if (fk.child === table && (fk.name === node.relation || (fk.childCols.length === 1 && fk.childCols[0] === node.relation))) {
        candidates.push({ fk, toParent: true, target: fk.parent });
      }
    }
    const hinted = node.hint
      ? candidates.filter((c) => c.fk.name === node.hint || c.fk.childCols.includes(node.hint!) || c.target === node.hint)
      : candidates;
    const found = hinted[0] ?? null;
    if (!found) {
      throw new RestError(400, {
        code: 'PGRST200',
        message: `Could not find a relationship between '${table}' and '${node.relation}' in the schema cache`,
        details: null, hint: null,
      });
    }
    return found;
  }

  private embedJoin(parentAlias: string, childAlias: string, rel: { fk: ForeignKey; toParent: boolean }): string {
    const { fk, toParent } = rel;
    return fk.childCols
      .map((col, i) => (toParent
        ? `${childAlias}.${ident(fk.parentCols[i])} = ${parentAlias}.${ident(col)}`
        : `${childAlias}.${ident(col)} = ${parentAlias}.${ident(fk.parentCols[i])}`))
      .join(' AND ');
  }

  /** `EXISTS (…)` for every `!inner` embed of a table: its row must have a match. */
  private innerRequirements(table: string, alias: string, nodes: SelectNode[], path: string): string[] {
    const out: string[] = [];
    for (const node of nodes) {
      if (node.kind !== 'embed' || !node.inner) continue;
      const rel = this.relationship(table, node);
      const childAlias = this.alias();
      const childPath = path ? `${path}.${node.alias ?? node.relation}` : node.alias ?? node.relation;
      const nested = this.innerRequirements(rel.target, childAlias, node.children, childPath);
      out.push(`EXISTS (SELECT 1 FROM public.${ident(rel.target)} ${childAlias}${this.where(rel.target, childAlias, childPath, [this.embedJoin(alias, childAlias, rel), ...nested])})`);
    }
    return out;
  }

  projection(table: string, alias: string, nodes: SelectNode[], path: string): string {
    const parts = nodes.map((node) => {
      if (node.kind === 'star') return `${alias}.*`;
      if (node.kind === 'column') {
        this.columnType(table, node.name);
        const value = node.cast ? `${alias}.${ident(node.name)}::${node.cast.replace(/[^a-z0-9_ ]/gi, '')}` : `${alias}.${ident(node.name)}`;
        return `${value} AS ${ident(node.alias ?? node.name)}`;
      }
      const rel = this.relationship(table, node);
      const childAlias = this.alias();
      const name = node.alias ?? node.relation;
      const childPath = path ? `${path}.${name}` : name;
      const inner = this.innerRequirements(rel.target, childAlias, node.children, childPath);
      const body = `SELECT ${this.projection(rel.target, childAlias, node.children, childPath)} FROM public.${ident(rel.target)} ${childAlias}`
        + this.where(rel.target, childAlias, childPath, [this.embedJoin(alias, childAlias, rel), ...inner]);
      const one = rel.toParent || rel.fk.childUnique;
      return one
        ? `(SELECT row_to_json(_e) FROM (${body} LIMIT 1) _e) AS ${ident(name)}`
        : `COALESCE((SELECT json_agg(row_to_json(_e)) FROM (${body}${this.orderAndPage(rel.target, childAlias, childPath)}) _e), '[]'::json) AS ${ident(name)}`;
    });
    return parts.join(', ');
  }

  topWhere(table: string, alias: string, nodes: SelectNode[]): string {
    return this.where(table, alias, '', this.innerRequirements(table, alias, nodes, ''));
  }
}

function preferences(req: BackendRequest) {
  const prefer = (req.headers.prefer ?? '').split(',').map((p) => p.trim());
  return {
    representation: prefer.includes('return=representation'),
    count: prefer.some((p) => p.startsWith('count=')),
    merge: prefer.includes('resolution=merge-duplicates'),
    ignore: prefer.includes('resolution=ignore-duplicates'),
    single: (req.headers.accept ?? '').includes('vnd.pgrst.object'),
  };
}

/** `{"b": <rows>, "c": <count or null>}` — the one value demo.run hands back. */
const envelope = (rowsSql: string, countSql: string | null) =>
  `SELECT json_build_object('b', (SELECT COALESCE(json_agg(_r), '[]'::json) FROM (${rowsSql}) _r), 'c', ${countSql ? `(${countSql})` : 'NULL'})::text`;

export function compileTable(schema: SchemaCache, table: string, req: BackendRequest): Compiled {
  const b = new Builder(schema, req.query);
  b.columns(table);
  const prefs = preferences(req);
  const method = req.method.toUpperCase();
  const nodes = parseSelect(req.query.get('select') ?? '*');
  const base = { params: b.params, single: prefs.single, wantsCount: prefs.count, head: method === 'HEAD' };

  if (method === 'GET' || method === 'HEAD') {
    const alias = b.alias();
    const where = b.topWhere(table, alias, nodes);
    const rows = method === 'HEAD'
      ? 'SELECT 1 WHERE false'
      : `SELECT ${b.projection(table, alias, nodes, '')} FROM public.${ident(table)} ${alias}${where}${b.orderAndPage(table, alias, '')}`;
    const count = prefs.count ? `SELECT count(*) FROM public.${ident(table)} ${alias}${where}` : null;
    return { ...base, sql: envelope(rows, count), returnBody: method === 'GET', successStatus: 200 };
  }

  const returning = b.alias();
  const select = `SELECT ${b.projection(table, returning, nodes, '')} FROM _w ${returning}`;
  const finish = (write: string, status: number): Compiled => ({
    ...base,
    sql: `WITH _w AS (${write} RETURNING *) ${envelope(prefs.representation ? select : 'SELECT 1 FROM _w', 'SELECT count(*) FROM _w')}`,
    returnBody: prefs.representation,
    successStatus: prefs.representation ? status : status === 200 ? 204 : status,
  });

  if (method === 'POST') {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    if (!rows.length || rows.some((r) => !r || typeof r !== 'object')) throw bad('The request body must be a JSON object or an array of them', 'PGRST102');
    const listed = req.query.get('columns');
    const keys = listed
      ? splitTop(listed).map((k) => k.replace(/^"|"$/g, ''))
      : [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
    keys.forEach((k) => b.columnType(table, k));
    const cols = keys.map(ident).join(', ');
    let write = keys.length
      ? `INSERT INTO public.${ident(table)} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::public.${ident(table)}, ${b.jsonb(rows)})`
      : `INSERT INTO public.${ident(table)} DEFAULT VALUES`;
    if (prefs.merge || prefs.ignore) {
      const target = (req.query.get('on_conflict') ? splitTop(req.query.get('on_conflict')!) : schema.primaryKeys.get(table) ?? []);
      target.forEach((k) => b.columnType(table, k));
      const updates = keys.filter((k) => !target.includes(k)).map((k) => `${ident(k)} = EXCLUDED.${ident(k)}`);
      write += ` ON CONFLICT (${target.map(ident).join(', ')}) ${prefs.merge && updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING'}`;
    }
    return finish(write, 201);
  }

  if (method === 'PATCH') {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw bad('The request body must be a JSON object', 'PGRST102');
    const keys = Object.keys(req.body);
    keys.forEach((k) => b.columnType(table, k));
    const alias = b.alias();
    if (!keys.length) return finish(`UPDATE public.${ident(table)} ${alias} SET ${ident([...b.columns(table).keys()][0])} = ${alias}.${ident([...b.columns(table).keys()][0])} WHERE false`, 200);
    const body = b.jsonb(req.body);
    const sets = keys.map((k) => `${ident(k)} = _b.${ident(k)}`).join(', ');
    const where = b.topWhere(table, alias, []);
    return finish(
      `UPDATE public.${ident(table)} ${alias} SET ${sets} FROM (SELECT * FROM jsonb_populate_record(NULL::public.${ident(table)}, ${body})) _b${where}`,
      200,
    );
  }

  if (method === 'DELETE') {
    const alias = b.alias();
    return finish(`DELETE FROM public.${ident(table)} ${alias}${b.topWhere(table, alias, [])}`, 200);
  }

  throw new RestError(405, { code: 'PGRST117', message: `Unsupported HTTP method: ${method}`, details: null, hint: null });
}

/** The function an RPC call means: named `name`, taking exactly these arguments (defaults may be left out). */
export function pickFunction(schema: SchemaCache, name: string, given: string[]): FunctionInfo {
  const fits = (schema.functions.get(name) ?? []).filter((fn) =>
    given.every((arg) => fn.args.some((a) => a.name === arg))
    && fn.args.every((a) => a.hasDefault || given.includes(a.name)));
  if (!fits.length) {
    const list = [...given].sort().join(', ');
    throw new RestError(404, {
      code: 'PGRST202',
      message: `Could not find the function public.${name}${given.length ? `(${list})` : ' without parameters'} in the schema cache`,
      details: `Searched for the function public.${name}${given.length ? ` with parameters ${list}` : ' without parameters'}, but no matches were found in the schema cache.`,
      hint: null,
    });
  }
  // The closest fit: the one with the fewest arguments left to their defaults.
  return fits.sort((a, z) => a.args.length - z.args.length)[0];
}

export function compileRpc(schema: SchemaCache, name: string, req: BackendRequest): Compiled {
  const b = new Builder(schema, new URLSearchParams());
  const prefs = preferences(req);
  const method = req.method.toUpperCase();
  const args: Record<string, unknown> = method === 'GET' || method === 'HEAD'
    ? Object.fromEntries([...req.query.entries()].filter(([k]) => !RESERVED.has(k)))
    : (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {});
  const given = Object.keys(args);
  const fn = pickFunction(schema, name, given);
  const typed = given.map((arg) => `${ident(arg)} ${fn.args.find((a) => a.name === arg)!.type}`);
  const source = given.length ? `jsonb_to_record(${b.jsonb(args)}) AS _a(${typed.join(', ')})` : '(SELECT 1) _a';
  const call = `public.${ident(name)}(${given.map((arg) => `${ident(arg)} := _a.${ident(arg)}`).join(', ')})`;
  const base = { params: b.params, single: prefs.single, wantsCount: false, head: method === 'HEAD' };

  if (fn.returnsVoid) {
    return { ...base, sql: `SELECT json_build_object('b', NULL, 'c', NULL)::text FROM (SELECT ${call} FROM ${source}) _v`, returnBody: false, successStatus: 204 };
  }
  const limit = /^\d+$/.test(req.query.get('limit') ?? '') ? ` LIMIT ${req.query.get('limit')}` : '';
  // A set of rows is an array of objects, a set of values an array of them; one row an object, one value itself.
  const value = fn.returnsSet
    ? fn.returnsRows
      ? `(SELECT COALESCE(json_agg(_g), '[]'::json) FROM (SELECT * FROM ${call} _f${limit}) _g)`
      : `(SELECT COALESCE(json_agg(_f), '[]'::json) FROM ${call} _f)`
    : `(SELECT to_json(_f) FROM ${call} _f)`;
  return { ...base, sql: `SELECT json_build_object('b', ${value}, 'c', NULL)::text FROM ${source}`, returnBody: method !== 'HEAD', successStatus: 200 };
}

/** The HTTP status PostgREST gives a database error. */
export function statusForPgError(code: string, anonymous: boolean): number {
  if (code === '42501') return anonymous ? 401 : 403;
  if (code === '23505' || code === '23503') return 409;
  if (code === '42883' || code === '42P01') return 404;
  if (code.startsWith('PGRST')) return 400;
  return 400;
}
