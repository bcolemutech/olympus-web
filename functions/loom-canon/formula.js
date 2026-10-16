'use strict';

/**
 * The formula language (planning/game-systems.md §3 DC1, FX1–FX3, §4.3;
 * L-802 / #628): a small, safe expression language for a game system's dice
 * and maths. Parsed to a tree and checked when a system is saved, evaluated
 * on the server with a dice source it is given, never run as code. Pure: no
 * I/O. The page never evaluates formulas; it shows the breakdowns the server
 * sends.
 *
 * Grammar:
 *
 *   formula    := comparison
 *   comparison := sum ( ("<=" | ">=" | "<" | ">" | "=") sum )?
 *   sum        := product ( ("+" | "-") product )*
 *   product    := unary ( ("*" | "/" | "×" | "÷") unary )*
 *   unary      := "-" unary | atom
 *   atom       := number | dice | name | call | "(" sum ")" [dice tail]
 *   dice       := [count] "d" sides [ ("kh" | "kl") keep ]       2d6, d20, 2d20kh1
 *                 a bracket before "d" is the count: (DEX + Athletics)d10
 *   call       := min(a, b, ...) | max(a, b, ...) | floor(a) | ceil(a)
 *               | mod(attribute) | table(name, value) | count(dice, op number)
 *   name       := a sheet field (STR, Stealth, level) or one the caller allows
 *                 (attribute, rank, result, ...)
 *
 * Types: a dice term is a pool where `count` wants one, and its kept dice's
 * sum anywhere else; a comparison is true or false (1 or 0), for rolling
 * under (`d100 <= Stealth`). `mod(STR)` is STR's modifier, by the system's
 * modifier formula for it. `table(name, value)` looks a value up in one of
 * the system's tables.
 *
 *   parse(text)                          → tree, or throws FormulaError
 *   check(text, { names, system })       → { errors, warnings, tree, names }
 *   evaluate(text, { values, system, dice }) → { total, type, breakdown }
 *   seeded(seed)                         → a reproducible dice source
 *
 * The breakdown lists each term (dice with every die rolled, kept and
 * dropped; fields; lookups) and `shown`, the formula with each term replaced
 * by its value, which evaluates to the total: the roll card's line (DC6).
 */

const MAX_LENGTH = 500;
const MAX_NODES = 120;
const MAX_DICE = 100;
const MAX_SIDES = 1000;
const FUNCTIONS = ['min', 'max', 'floor', 'ceil', 'mod', 'table', 'count'];
const COMPARE = ['<=', '>=', '<', '>', '='];

class FormulaError extends Error {}

// ── Reading ────────────────────────────────────────────────────────────

const OPERATORS = {
  '×': '*',
  '÷': '/',
  '−': '-',
  '≤': '<=',
  '≥': '>=',
};

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '<=' || two === '>=') {
      tokens.push({ t: 'op', v: two, at: i });
      i += 2;
      continue;
    }
    if (OPERATORS[c]) {
      tokens.push({ t: 'op', v: OPERATORS[c], at: i });
      i += 1;
      continue;
    }
    if ('+-*/<>=(),'.includes(c)) {
      tokens.push({ t: c === '(' || c === ')' || c === ',' ? c : 'op', v: c, at: i });
      i += 1;
      continue;
    }
    // Dice: [N]dX[kh|klN], read whole so "d20" isn't a name.
    const dice = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?(?![A-Za-z0-9_])/.exec(text.slice(i));
    if (dice) {
      tokens.push({
        t: 'dice',
        count: dice[1] ? Number(dice[1]) : null,
        sides: Number(dice[2]),
        keep: dice[3] ? { how: dice[3], n: Number(dice[4]) } : null,
        text: dice[0],
        at: i,
      });
      i += dice[0].length;
      continue;
    }
    // After a bracket, "d10" (with its keep) makes the bracket a dice count.
    const number = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (number) {
      tokens.push({ t: 'num', v: Number(number[0]), at: i });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (name) {
      tokens.push({ t: 'name', v: name[0], at: i });
      i += name[0].length;
      continue;
    }
    throw new FormulaError(`Unexpected "${c}" at ${i + 1}.`);
  }
  return tokens;
}

/** Parses a formula to its tree, or throws FormulaError saying where it went wrong. */
function parse(text) {
  if (typeof text === 'number' && Number.isFinite(text)) return { k: 'num', v: text };
  if (typeof text !== 'string' || !text.trim()) throw new FormulaError('A formula is required.');
  if (text.length > MAX_LENGTH) {
    throw new FormulaError(`The formula is longer than ${MAX_LENGTH} characters.`);
  }
  const tokens = tokenize(text);
  let p = 0;
  let nodes = 0;
  const peek = () => tokens[p];
  const node = (n) => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new FormulaError(`The formula has more than ${MAX_NODES} terms.`);
    return n;
  };
  const expect = (t, v) => {
    const tok = tokens[p];
    if (!tok || tok.t !== t || (v !== undefined && tok.v !== v)) {
      const want = v || t;
      throw new FormulaError(
        tok ? `Expected "${want}" at ${tok.at + 1}.` : `Expected "${want}" at the end.`
      );
    }
    p += 1;
    return tok;
  };
  const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);

  function comparison() {
    const left = sum();
    if (isOp(...COMPARE)) {
      const op = tokens[p++].v;
      return node({ k: 'cmp', op, a: left, b: sum() });
    }
    return left;
  }
  function sum() {
    let left = product();
    while (isOp('+', '-')) {
      const op = tokens[p++].v;
      left = node({ k: 'bin', op, a: left, b: product() });
    }
    return left;
  }
  function product() {
    let left = unary();
    while (isOp('*', '/')) {
      const op = tokens[p++].v;
      left = node({ k: 'bin', op, a: left, b: unary() });
    }
    return left;
  }
  function unary() {
    if (isOp('-')) {
      p += 1;
      return node({ k: 'neg', a: unary() });
    }
    return atom();
  }
  function diceTail(count, closedAt) {
    // "(expr)d10": a dice token with no count of its own, right after the bracket.
    const tok = peek();
    if (tok && tok.t === 'dice' && tok.count === null && tok.at === closedAt + 1) {
      p += 1;
      return node({ k: 'dice', count, sides: tok.sides, keep: tok.keep });
    }
    return count;
  }
  function atom() {
    const tok = peek();
    if (!tok) throw new FormulaError('The formula ends too soon.');
    if (tok.t === 'num') {
      p += 1;
      return node({ k: 'num', v: tok.v });
    }
    if (tok.t === 'dice') {
      p += 1;
      return node({
        k: 'dice',
        count: node({ k: 'num', v: tok.count === null ? 1 : tok.count }),
        sides: tok.sides,
        keep: tok.keep,
      });
    }
    if (tok.t === '(') {
      p += 1;
      const inner = sum();
      const close = expect(')');
      return diceTail(inner, close.at);
    }
    if (tok.t === 'name') {
      p += 1;
      if (peek() && peek().t === '(') {
        if (!FUNCTIONS.includes(tok.v)) {
          throw new FormulaError(`"${tok.v}" isn't a function (${FUNCTIONS.join(', ')}).`);
        }
        p += 1;
        const args = [];
        if (tok.v === 'count') {
          // count(pool, >= 7): the dice, then a comparison and what to beat.
          const pool = sum();
          expect(',');
          if (!isOp(...COMPARE)) {
            throw new FormulaError('count needs a comparison: count(dice, >= 7).');
          }
          const op = tokens[p++].v;
          const than = sum();
          expect(')');
          return node({ k: 'count', pool, op, than });
        }
        if (peek() && peek().t !== ')') {
          args.push(sum());
          while (peek() && peek().t === ',') {
            p += 1;
            args.push(sum());
          }
        }
        expect(')');
        return node({ k: 'call', fn: tok.v, args });
      }
      return node({ k: 'name', v: tok.v });
    }
    throw new FormulaError(`Unexpected "${tok.v || tok.t}" at ${tok.at + 1}.`);
  }

  const tree = comparison();
  if (p < tokens.length) {
    throw new FormulaError(`Unexpected "${tokens[p].v || tokens[p].t}" at ${tokens[p].at + 1}.`);
  }
  return tree;
}

// ── Checking ───────────────────────────────────────────────────────────

const sheetOf = (system) => (system && system.sheet) || {};
const attributeOf = (system, id) => (sheetOf(system).attributes || []).find((a) => a.id === id);

/**
 * The names a system's formulas may use: its attributes, resources, skills
 * and derived values, and level.
 */
function fieldNames(system) {
  const sheet = sheetOf(system);
  const on = new Set(sheet.optional || []);
  return ['level'].concat(
    (sheet.attributes || []).map((a) => a.id),
    (sheet.resources || []).map((r) => r.id),
    on.has('skills') ? (sheet.skills || []).map((k) => k.id) : [],
    on.has('derived') ? (sheet.derived || []).map((d) => d.id) : []
  );
}

/**
 * Checks a formula against a system (FX3): `names` are the extra names the
 * place it is used in allows (a check's `attribute` and `rank`, say). Returns
 * `{ errors, warnings, tree, type, names }`: `type` is 'number', 'pool' or
 * 'bool', and `names` every name it reads.
 */
function check(text, { names = [], system = null } = {}) {
  const errors = [];
  const used = new Set();
  let tree;
  try {
    tree = parse(text);
  } catch (err) {
    if (!(err instanceof FormulaError)) throw err;
    return { errors: [err.message], warnings: [], tree: null, type: null, names: [] };
  }
  const known = new Set(fieldNames(system).concat(names));
  const tables = (system && system.tables) || {};
  const numeric = (type, what) => {
    if (type === 'bool')
      errors.push(`${what}: a true-or-false comparison can't be used as a number.`);
  };

  function type(n) {
    switch (n.k) {
      case 'num':
        return 'number';
      case 'name':
        used.add(n.v);
        if (!known.has(n.v)) errors.push(`Unknown name "${n.v}".`);
        return 'number';
      case 'dice': {
        numeric(type(n.count), 'A dice count');
        if (n.sides < 2 || n.sides > MAX_SIDES) {
          errors.push(`d${n.sides}: dice need 2 to ${MAX_SIDES} sides.`);
        }
        const fixed = n.count.k === 'num' ? n.count.v : null;
        if (fixed !== null && (fixed < 1 || fixed > MAX_DICE || !Number.isInteger(fixed))) {
          errors.push(`${fixed}d${n.sides}: roll 1 to ${MAX_DICE} dice.`);
        }
        if (n.keep && (n.keep.n < 1 || (fixed !== null && n.keep.n > fixed))) {
          errors.push(
            `${fixed === null ? '' : fixed}d${n.sides}${n.keep.how}${n.keep.n}: ` +
              'keep at least one die, and no more than are rolled.'
          );
        }
        return 'pool';
      }
      case 'neg':
        numeric(type(n.a), 'A minus sign');
        return 'number';
      case 'bin':
        numeric(type(n.a), `"${n.op}"`);
        numeric(type(n.b), `"${n.op}"`);
        return 'number';
      case 'cmp':
        numeric(type(n.a), `"${n.op}"`);
        numeric(type(n.b), `"${n.op}"`);
        return 'bool';
      case 'count':
        if (n.pool.k !== 'dice') errors.push('count needs dice to count: count(4d10, >= 7).');
        else type(n.pool);
        numeric(type(n.than), 'count');
        return 'number';
      case 'call':
        return callType(n);
      default:
        throw new Error('formula: unknown node ' + n.k);
    }
  }

  function callType(n) {
    const args = n.args;
    if ((n.fn === 'min' || n.fn === 'max') && !args.length) {
      errors.push(`${n.fn} needs at least one value.`);
    }
    if ((n.fn === 'floor' || n.fn === 'ceil') && args.length !== 1) {
      errors.push(`${n.fn} takes one value.`);
    }
    if (n.fn === 'mod') {
      const target = args[0];
      if (args.length !== 1 || target.k !== 'name') {
        errors.push('mod takes one attribute: mod(STR).');
      } else {
        used.add(target.v);
        if (!attributeOf(system, target.v)) {
          errors.push(`mod(${target.v}): "${target.v}" isn't one of the system's attributes.`);
        }
      }
      return 'number';
    }
    if (n.fn === 'table') {
      const named = args[0];
      if (args.length !== 2 || named.k !== 'name') {
        errors.push('table takes a table and a value: table(damage, size).');
      } else if (!Object.prototype.hasOwnProperty.call(tables, named.v)) {
        errors.push(`table(${named.v}, …): the system has no table "${named.v}".`);
      }
      if (args[1]) numeric(type(args[1]), 'table');
      return 'number';
    }
    args.forEach((arg) => numeric(type(arg), n.fn));
    return 'number';
  }

  const result = type(tree);
  return { errors, warnings: [], tree, type: errors.length ? null : result, names: [...used] };
}

// ── Ranges, for what can never happen (FX3) ───────────────────────────

const ANY = [-Infinity, Infinity];
const finite = (r) => Number.isFinite(r[0]) && Number.isFinite(r[1]);

/**
 * The lowest and highest a formula can come to, given the range of each name
 * (`ranges`, [lo, hi]); a name with none can be anything. For warnings only:
 * a ladder rung no roll can reach, say.
 */
function range(text, { ranges = {}, system = null } = {}) {
  let tree;
  try {
    tree = typeof text === 'object' && text && text.k ? text : parse(text);
  } catch {
    return ANY;
  }
  const of = (n) => {
    switch (n.k) {
      case 'num':
        return [n.v, n.v];
      case 'name':
        return ranges[n.v] || ANY;
      case 'dice': {
        const [c0, c1] = of(n.count);
        const kept = (c) => (n.keep ? Math.min(n.keep.n, c) : c);
        return [Math.max(0, kept(c0)), Math.max(0, kept(c1)) * n.sides];
      }
      case 'neg': {
        const [a, b] = of(n.a);
        return [-b, -a];
      }
      case 'cmp':
        return [0, 1];
      case 'count':
        return [0, Math.max(0, of(n.pool.count || { k: 'num', v: 0 })[1])];
      case 'bin': {
        const a = of(n.a);
        const b = of(n.b);
        if (!finite(a) || !finite(b)) return ANY;
        if (n.op === '+') return [a[0] + b[0], a[1] + b[1]];
        if (n.op === '-') return [a[0] - b[1], a[1] - b[0]];
        if (n.op === '/' && b[0] <= 0 && b[1] >= 0) return ANY;
        const f = n.op === '*' ? (x, y) => x * y : (x, y) => x / y;
        const all = [f(a[0], b[0]), f(a[0], b[1]), f(a[1], b[0]), f(a[1], b[1])];
        return [Math.min(...all), Math.max(...all)];
      }
      case 'call': {
        if (n.fn === 'mod') {
          const attr = attributeOf(system, n.args[0] && n.args[0].v);
          if (!attr) return ANY;
          return range(attr.modifier, {
            ranges: { ...ranges, [attr.id]: [attr.min, attr.max] },
            system,
          });
        }
        if (n.fn === 'table') return ANY;
        const rs = n.args.map(of);
        if (!rs.length || !rs.every(finite)) return ANY;
        if (n.fn === 'min')
          return [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1]))];
        if (n.fn === 'max')
          return [Math.max(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1]))];
        const g = n.fn === 'floor' ? Math.floor : Math.ceil;
        return [g(rs[0][0]), g(rs[0][1])];
      }
      default:
        return ANY;
    }
  };
  return of(tree);
}

// ── Evaluating ─────────────────────────────────────────────────────────

/** A reproducible dice source from a seed (mulberry32): the same seed, the same rolls. */
function seeded(seed) {
  let a = Number(seed) >>> 0;
  return function roll(sides) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return 1 + Math.floor(r * sides);
  };
}

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };
const tidy = (n) => Math.round(n * 1e9) / 1e9;

/**
 * Evaluates a formula: `values` gives each name's number, `system` its
 * modifier formulas and tables, `dice(sides)` each die (seeded(...) in
 * tests, the server's own source in play). Returns `{ total, type,
 * breakdown: { terms, shown, named } }`: a comparison's total is 1 or 0.
 * `shown` is the formula with each term's value; `named` names them too,
 * by `labels` where given ("d20 (14) + Dexterity (2) + Stealth (2)"; L-805).
 */
function evaluate(text, { values = {}, system = null, dice, labels = {} } = {}) {
  if (typeof dice !== 'function') throw new Error('formula.evaluate needs a dice source');
  const tree = typeof text === 'object' && text && text.k ? text : parse(text);
  const terms = [];
  const tables = (system && system.tables) || {};
  const nameValue = (name) => {
    const v = values[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new FormulaError(`No value for "${name}".`);
    }
    return v;
  };

  // Each node gives { value, shown, named, prec }: `shown` is the formula
  // with terms replaced by their values, `named` with each term named and its
  // value after it, as the roll card reads; `prec` places brackets in both.
  const label = (name) => labels[name] || name;
  const diceName = (expr) => expr.replace(/^1d/, 'd');
  function roll(n, counted = walk(n.count)) {
    const count = Math.floor(counted.value);
    if (count < 0 || count > MAX_DICE) {
      throw new FormulaError(`Can't roll ${count} dice (0 to ${MAX_DICE}).`);
    }
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push({ value: dice(n.sides), kept: true });
    if (n.keep) {
      const order = rolls
        .map((r, i) => ({ r, i }))
        .sort(
          (x, y) =>
            (n.keep.how === 'kh' ? y.r.value - x.r.value : x.r.value - y.r.value) || x.i - y.i
        );
      order.forEach(({ r }, rank) => {
        r.kept = rank < n.keep.n;
      });
    }
    const expr = `${count}d${n.sides}${n.keep ? n.keep.how + n.keep.n : ''}`;
    return { rolls, expr };
  }

  function walk(n) {
    switch (n.k) {
      case 'num':
        return { value: n.v, shown: String(n.v), named: String(n.v), prec: 3 };
      case 'name': {
        const value = nameValue(n.v);
        terms.push({ kind: 'field', name: n.v, value });
        return { value, shown: String(value), named: `${label(n.v)} (${value})`, prec: 3 };
      }
      case 'dice': {
        const { rolls, expr } = roll(n);
        const value = rolls.filter((r) => r.kept).reduce((sum, r) => sum + r.value, 0);
        terms.push({ kind: 'dice', expr, rolls, value });
        return { value, shown: String(value), named: `${diceName(expr)} (${value})`, prec: 3 };
      }
      case 'count': {
        // The pool's size, named where it is worked out: (Mind (3) + Tech (1))d10.
        const size = walk(n.pool.count);
        const { rolls, expr } = roll(n.pool, size);
        const than = walk(n.than).value;
        const meets = (v) => compare(v, n.op, than);
        const value = rolls.filter((r) => r.kept && meets(r.value)).length;
        terms.push({
          kind: 'count',
          expr,
          op: n.op,
          than,
          rolls: rolls.map((r) => ({ ...r, counted: r.kept && meets(r.value) })),
          value,
        });
        const pool = n.pool.count.k === 'num' ? diceName(expr) : `(${size.named})d${n.pool.sides}`;
        return {
          value,
          shown: String(value),
          named: `${pool} ${SIGNS[n.op] || n.op} ${than} (${value})`,
          prec: 3,
        };
      }
      case 'neg': {
        const a = walk(n.a);
        const wrap = (t) => '-' + (a.prec < 3 ? `(${t})` : t);
        return { value: -a.value, shown: wrap(a.shown), named: wrap(a.named), prec: 3 };
      }
      case 'bin': {
        const p = PRECEDENCE[n.op];
        const a = walk(n.a);
        const b = walk(n.b);
        const value =
          n.op === '+'
            ? a.value + b.value
            : n.op === '-'
              ? a.value - b.value
              : n.op === '*'
                ? a.value * b.value
                : b.value === 0
                  ? (() => {
                      throw new FormulaError('Division by zero.');
                    })()
                  : a.value / b.value;
        const left = (t) => (a.prec < p ? `(${t})` : t);
        const right = (t) => (b.prec <= p && b.prec < 3 ? `(${t})` : t);
        return {
          value: tidy(value),
          shown: `${left(a.shown)} ${n.op} ${right(b.shown)}`,
          named: `${left(a.named)} ${n.op} ${right(b.named)}`,
          prec: p,
        };
      }
      case 'cmp': {
        const a = walk(n.a);
        const b = walk(n.b);
        return {
          value: compare(a.value, n.op, b.value) ? 1 : 0,
          shown: `${a.shown} ${n.op} ${b.shown}`,
          named: `${a.named} ${n.op} ${b.named}`,
          prec: 0,
        };
      }
      case 'call':
        return call(n);
      default:
        throw new Error('formula: unknown node ' + n.k);
    }
  }

  function call(n) {
    if (n.fn === 'mod') {
      const attr = attributeOf(system, n.args[0].v);
      if (!attr) throw new FormulaError(`mod(${n.args[0].v}): no such attribute.`);
      const score = nameValue(attr.id);
      const value = tidy(
        evaluate(attr.modifier, { values: { ...values, [attr.id]: score }, system, dice }).total
      );
      terms.push({ kind: 'mod', name: attr.id, score, value });
      return {
        value,
        shown: String(value),
        named: `${label(attr.id)} (${value})`,
        prec: value < 0 ? 2.5 : 3,
      };
    }
    if (n.fn === 'table') {
      const name = n.args[0].v;
      const input = walk(n.args[1]).value;
      const row = (tables[name] || []).find(
        (r) => (r.min === undefined || input >= r.min) && (r.max === undefined || input <= r.max)
      );
      if (!row) throw new FormulaError(`table(${name}, ${input}): no row for ${input}.`);
      const inner =
        typeof row.value === 'number'
          ? { total: row.value, breakdown: { terms: [] } }
          : evaluate(row.value, { values, system, dice });
      terms.push({ kind: 'table', name, input, value: inner.total, terms: inner.breakdown.terms });
      return {
        value: inner.total,
        shown: String(inner.total),
        named: `${name} (${inner.total})`,
        prec: 3,
      };
    }
    const args = n.args.map(walk);
    const fn = { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil }[n.fn];
    const value = fn(...args.map((a) => a.value));
    return {
      value,
      shown: `${n.fn}(${args.map((a) => a.shown).join(', ')})`,
      named: `${n.fn}(${args.map((a) => a.named).join(', ')})`,
      prec: 3,
    };
  }

  const out = walk(tree);
  return {
    total: out.value,
    type: tree.k === 'cmp' ? 'bool' : 'number',
    breakdown: { terms, shown: out.shown, named: out.named },
  };
}

// How a pool's count reads on the roll card: "4d10 ≥ 7 (2)".
const SIGNS = { '>=': '≥', '<=': '≤' };

function compare(a, op, b) {
  if (op === '<=') return a <= b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  if (op === '>') return a > b;
  return a === b;
}

module.exports = {
  FormulaError,
  MAX_LENGTH,
  MAX_DICE,
  MAX_SIDES,
  FUNCTIONS,
  parse,
  check,
  range,
  evaluate,
  seeded,
  fieldNames,
};
