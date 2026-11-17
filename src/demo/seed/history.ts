/**
 * Casa Demo's past (demo mode only): every table that sat down, ordered,
 * was served, paid and left, day by day — so the admin's dashboards, reports,
 * menu engineering, prep forecast and staff pages have a real trading history
 * to read from the first minute.
 *
 * A day is generated from its date alone (the random source is seeded with
 * it), so generating the same day twice gives the same visits. That is what
 * lets the demo fill in the hours it was closed for when it is reopened
 * (seed/index.ts, keepAlive) without duplicating anything.
 *
 * The rows go straight into the tables with their own timestamps; nothing
 * here runs through the ordering functions, which only know "now".
 */
import { RESTAURANT } from '../brand';
import { COMBO, COMPANIONS, ITEM, ITEMS, PAIRINGS, itemById, type DemoItem } from './menu';
import { TABLE_COUNT, tableId, waiterForTable } from './restaurant';
import { Random, atLocal, iso, localTime, minutes, money, plus } from './util';

const VENUE = RESTAURANT.dbId;

type Row = Record<string, unknown>;

export interface HistoryRows {
  table_sessions: Row[];
  orders: Row[];
  order_items: Row[];
  order_ticket_events: Row[];
  payment_transactions: Row[];
  order_refunds: Row[];
  ratings: Row[];
  server_ratings: Row[];
  waiter_calls: Row[];
  bill_requests: Row[];
  analytics_events: Row[];
  recommendation_decisions: Row[];
  recommendation_impressions: Row[];
  suggestion_conversions: Row[];
  session_experiment_assignment: Row[];
}

export const emptyHistory = (): HistoryRows => ({
  table_sessions: [], orders: [], order_items: [], order_ticket_events: [], payment_transactions: [], order_refunds: [],
  ratings: [], server_ratings: [], waiter_calls: [], bill_requests: [], analytics_events: [],
  recommendation_decisions: [], recommendation_impressions: [], suggestion_conversions: [], session_experiment_assignment: [],
});

/** The order they are inserted in: a row's parents first. */
export const HISTORY_TABLES: (keyof HistoryRows)[] = [
  'table_sessions', 'orders', 'order_items', 'order_ticket_events', 'payment_transactions', 'order_refunds',
  'ratings', 'server_ratings', 'waiter_calls', 'bill_requests', 'analytics_events',
  'recommendation_decisions', 'recommendation_impressions', 'suggestion_conversions', 'session_experiment_assignment',
];

const GUEST_NAMES = [
  'Amina', 'Haris', 'Lejla', 'Adnan', 'Emina', 'Mirza', 'Selma', 'Kenan', 'Ajla', 'Nermin', 'Dženana', 'Tarik', 'Maja', 'Ivan', 'Ana',
  'Marko', 'Sara', 'Luka', 'Elma', 'Dino', 'Jasmin', 'Lamija', 'Vedad', 'Nina', 'Faruk', 'Iman', 'Omar', 'Layla', 'Yusuf', 'Noor',
  'Sophie', 'Lukas', 'Emma', 'Thomas', 'Giulia', 'Marco', 'Elif', 'Can', 'Petra', 'Stefan', 'Hana', 'Tea', 'Benjamin', 'Lana', 'Alen',
];

const COMMENTS = [
  'Very attentive, thank you!', 'Brza i ljubazna usluga.', 'Great recommendations.', 'Sve pohvale!', 'Friendly and quick.',
  'Hrana je stigla topla i na vrijeme.', 'Lovely evening, we will be back.', 'خدمة ممتازة', 'Odlična preporuka za desert.', 'Made our lunch easy.',
];

const NOTES = ['No onions, please', 'Bez luka', 'Sauce on the side', 'Extra hot', 'Well done', 'Bez leda', 'Oat milk', 'No sugar'];

const CANCEL_REASONS = ['Guest changed their mind', 'Ordered twice by mistake', 'Dish no longer available'];

/** How busy each hour of the day is, relative to the others (restaurant-local hours). */
const HOURLY: Record<number, number> = {
  8: 0.5, 9: 0.9, 10: 1.0, 11: 0.9, 12: 1.5, 13: 1.9, 14: 1.4, 15: 0.7, 16: 0.6, 17: 0.8, 18: 1.3, 19: 1.9, 20: 2.0, 21: 1.2, 22: 0.4,
};
/** Visits on a usual day, Sunday first. */
const VISITS_BY_WEEKDAY = [58, 42, 44, 48, 52, 66, 74];

const byWhen = (when: DemoItem['when'][], roles?: DemoItem['role'][]) =>
  ITEMS.filter((i) => when.includes(i.when) && (!roles || roles.includes(i.role)) && i.id !== ITEM.burgerCombo);

const BRUNCH = byWhen(['morning']);
const STARTERS = byWhen(['meal'], ['starter']);
const MAINS = byWhen(['meal'], ['main']);
const DESSERTS = byWhen(['sweet']);
const HOT = ITEMS.filter((i) => i.role === 'hot_drink');
const COLD = ITEMS.filter((i) => i.role === 'cold_drink');
const BURGERS: string[] = COMBO.slots[0].options.map(([id]) => id);

/** A visit is history once its first order has had this long to be cooked and served. */
const SERVED_AFTER_MINUTES = 25;

export interface DayOptions {
  /** Only visits that became history after this moment (see `until`). */
  from?: Date;
  /**
   * History is written up to this moment. A visit counts once its first order
   * was placed 25 minutes before it; one still at the table then is closed
   * there, with only the orders it had already placed.
   */
  until: Date;
  /** The business day the demo is being shown on: a slightly better day than usual. */
  today?: string;
  /** The first day of the whole history, for the slow growth across it. */
  historyStart: string;
  historyDays: number;
  /** Phone events and suggestion records: only recent days carry them. */
  detail: boolean;
  /** Printed kitchen tickets: only the last days carry them. */
  tickets: boolean;
  /** What the suggestion engine calls its current rules (reco_policy_version()). */
  policyVersion: string;
  /** A dish that ran out: not ordered from that moment on. */
  soldOut?: { item: string; since: Date };
  /** Sale prices in force: item → price and when it began. */
  sales?: { item: string; price: number; since: Date }[];
  /** A day when trade was unusually slow (the dashboard's alert has something to say). */
  slowDay?: string;
  /**
   * Suggestions were measured for a while: some tables, chosen at random,
   * were shown none (Admin → What the app earned compares the two groups).
   */
  experiment?: { id: string; from: Date; until: Date; holdoutPct: number };
}

export interface Line {
  item: DemoItem;
  quantity: number;
  unitPrice: number;
  regularPrice: number | null;
  notes: string | null;
  components: Row[] | null;
  fromDecision?: string;
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** One business day of visits that have finished. Returns nothing for a day in the future. */
export function generateDay(day: string, options: DayOptions): { rows: HistoryRows; orderCount: number } {
  const rows = emptyHistory();
  const rng = new Random(`casa-demo:${day}`);
  const weekday = localTime(atLocal(day, 12)).weekday;
  const progress = Math.min(1, Math.max(0, (dayNumber(day) - dayNumber(options.historyStart)) / Math.max(1, options.historyDays)));
  // Trade grows a little over the weeks, wobbles day to day, and has one bad day.
  const scale = (0.84 + 0.2 * progress) * rng.between(0.92, 1.08) * (day === options.slowDay ? 0.5 : 1) * (day === options.today ? 1.14 : 1);
  const visitCount = Math.round(VISITS_BY_WEEKDAY[weekday] * scale);

  const hours = Object.keys(HOURLY).map(Number);
  const starts: Date[] = [];
  for (let i = 0; i < visitCount; i += 1) {
    const hour = rng.weighted(hours, (h) => HOURLY[h]);
    starts.push(atLocal(day, hour, rng.int(0, 59), rng.int(0, 59)));
  }
  starts.sort((a, b) => a.getTime() - b.getTime());

  const busyUntil = new Map<number, number>();
  const returning = Array.from({ length: 260 }, (_, i) => `guest-${String(i).padStart(4, '0')}`);
  let orderSeq = 0;

  for (const start of starts) {
    // Every visit draws the same amount of randomness whether or not it is kept,
    // so the visits of a day are the same whichever part of the day is asked for.
    const visit = new Random(`${day}:${start.getTime()}:${rng.token(8)}`);
    const length = minutes(visit.int(38, 96));
    const end = plus(start, length);
    const free = Array.from({ length: TABLE_COUNT }, (_, i) => i + 1).filter((n) => (busyUntil.get(n) ?? 0) <= start.getTime());
    const tableNumber = free.length ? visit.pick(free) : visit.int(1, TABLE_COUNT);
    busyUntil.set(tableNumber, end.getTime() + minutes(4));
    const ordersBefore = orderSeq;
    const made = buildVisit(visit, day, start, end, tableNumber, ordersBefore, returning, options);
    orderSeq += made.orderCount;
    if (!made.historyAt || made.historyAt > options.until || (options.from && made.historyAt <= options.from)) continue;
    for (const key of HISTORY_TABLES) rows[key].push(...made.rows[key]);
  }
  return { rows, orderCount: orderSeq };
}

export function chooseLines(rng: Random, at: Date, covers: number, round: number, options: DayOptions, addOns = 0.75): Line[] {
  const { hour, minute } = localTime(at);
  const clock = hour + minute / 60;
  const picks = new Map<string, number>();
  const add = (item: DemoItem | undefined, quantity = 1) => { if (item) picks.set(item.id, (picks.get(item.id) ?? 0) + quantity); };
  const available = (list: DemoItem[]) => list.filter((i) => !(options.soldOut && options.soldOut.item === i.id && at >= options.soldOut.since));
  const one = (list: DemoItem[]) => rng.weighted(available(list), (i) => i.weight);

  if (round > 0) {
    // A second round: something sweet, coffee, or more to drink.
    if (clock >= 11.5 && rng.chance(0.6)) for (let i = 0; i < Math.max(1, Math.round(covers * 0.6)); i += 1) add(one(DESSERTS));
    for (let i = 0; i < covers; i += 1) if (rng.chance(0.55)) add(one(rng.chance(0.55) ? HOT : COLD));
    if (!picks.size) add(one(COLD));
  } else if (clock < 11.5) {
    for (let i = 0; i < covers; i += 1) {
      if (rng.chance(0.8)) add(one(BRUNCH));
      if (rng.chance(0.85)) add(one(HOT));
      if (rng.chance(0.35)) add(one(COLD));
    }
  } else if (clock < 15.5 || clock >= 18) {
    if (rng.chance(0.5)) for (let i = 0; i < (covers > 2 ? 2 : 1); i += 1) add(one(STARTERS));
    for (let i = 0; i < covers; i += 1) {
      if (rng.chance(0.88)) add(one(MAINS));
      if (rng.chance(0.82)) add(one(rng.chance(0.82) ? COLD : HOT));
    }
  } else {
    for (let i = 0; i < covers; i += 1) add(one(rng.chance(0.68) ? HOT : COLD));
    if (rng.chance(0.5)) for (let i = 0; i < Math.max(1, Math.round(covers / 2)); i += 1) add(one(DESSERTS));
  }
  if (!picks.size) add(one(clock < 11.5 ? HOT : COLD));

  // What usually goes with what: fries with the burger, coffee with the cheesecake.
  for (const [id, quantity] of [...picks]) {
    for (const [companion, chance] of COMPANIONS[id] ?? []) {
      for (let i = 0; i < quantity; i += 1) if (rng.chance(chance * addOns)) add(itemById.get(companion));
    }
  }

  const lines: Line[] = [];
  for (const [id, quantity] of picks) {
    const item = itemById.get(id)!;
    const sale = options.sales?.find((s) => s.item === id && at >= s.since);
    let remaining = quantity;
    // Some burgers are ordered as the combo: burger, fries and a drink at one price.
    if (BURGERS.includes(id)) {
      while (remaining > 0 && rng.chance(0.22)) {
        const drink = rng.pick(COMBO.slots[2].options);
        const parts = [
          { slot: COMBO.slots[0], part: item },
          { slot: COMBO.slots[1], part: itemById.get(ITEM.fries)! },
          { slot: COMBO.slots[2], part: itemById.get(drink[0])! },
        ];
        const combo = itemById.get(ITEM.burgerCombo)!;
        lines.push({
          item: combo, quantity: 1, unitPrice: money(combo.price + drink[1]), regularPrice: null, notes: null,
          components: parts.map(({ slot, part }) => ({
            slot_label: slot.label, item_id: part.id, name: part.name, name_bs: part.name_bs, name_ar: part.name_ar, station: part.station,
          })),
        });
        remaining -= 1;
      }
    }
    if (remaining > 0) {
      lines.push({
        item, quantity: remaining, unitPrice: sale ? sale.price : item.price, regularPrice: sale ? item.price : null,
        notes: item.station === 'kitchen' && rng.chance(0.07) ? rng.pick(NOTES) : null, components: null,
      });
    }
  }
  return lines;
}

function buildVisit(
  rng: Random, day: string, start: Date, endsAt: Date, tableNumber: number, ordersBefore: number, returning: string[], options: DayOptions,
): { rows: HistoryRows; orderCount: number; historyAt: Date | null } {
  const rows = emptyHistory();
  let end = endsAt;
  const sessionId = rng.uuid();
  const covers = rng.weighted([1, 2, 3, 4, 5, 6], (n) => [0, 14, 42, 16, 20, 4, 4][n]);
  const waiter = waiterForTable(tableNumber, rng.int(0, 1));
  const guest = rng.pick(GUEST_NAMES);
  const clientId = rng.chance(0.34) ? rng.pick(returning) : `guest-${rng.token(10)}`;
  const method = rng.weighted(['cash', 'pos_terminal', 'card_online'] as const, (m) => ({ cash: 42, pos_terminal: 43, card_online: 15 })[m]);
  const { hour } = localTime(start);
  // The kitchen is slower when the room is full.
  const load = hour === 13 || hour === 19 || hour === 20 ? rng.between(1.05, 1.5) : rng.between(0.8, 1.15);

  // Which group of the suggestions experiment this table fell in, if it was running.
  const measured = options.experiment && start >= options.experiment.from && start < options.experiment.until ? options.experiment : null;
  const armDraw = rng.next();
  const holdout = !!measured && armDraw * 100 < measured.holdoutPct;
  // The after-meal prompt ("something sweet?") is a suggestion too: tables that see it order a second round more often.
  const secondRound = holdout ? 0.2 : 0.5;

  const orderTimes = [plus(start, minutes(rng.between(3, 9)))];
  if (rng.chance(secondRound)) orderTimes.push(plus(orderTimes[0], minutes(rng.between(22, 45))));
  if (rng.chance(0.08)) orderTimes.push(plus(orderTimes[orderTimes.length - 1], minutes(rng.between(15, 25))));
  // The moment this visit becomes history, and where it is cut off if it is still sitting then.
  const historyAt = plus(orderTimes[0], minutes(SERVED_AFTER_MINUTES));
  const cut = end > options.until;
  if (cut) end = plus(options.until, -minutes(1));
  const placed = orderTimes.filter((at) => at.getTime() < end.getTime() - minutes(12)
    && (!cut || at.getTime() <= options.until.getTime() - minutes(SERVED_AFTER_MINUTES)));

  let firstOrderAt: Date | null = null;
  let lastServedAt: Date | null = null;
  let visitTotal = 0;
  const viewed = new Set<string>();
  const added = new Set<string>();
  let orderCount = 0;

  placed.forEach((createdAt, round) => {
    // "Goes well with": tables that are shown pairings add the side or the drink more often.
    const lines = chooseLines(rng, createdAt, covers, round, options, holdout ? 0.45 : 0.8);
    const orderId = rng.uuid();
    orderCount += 1;
    const code = String(((ordersBefore + orderCount - 1) % 999) + 1).padStart(3, '0');
    const cancelled = rng.chance(0.015);

    // A suggestion shown in the cart, and whether it was taken.
    if (options.detail && !cancelled && !holdout && rng.chance(0.78)) {
      const sources = lines.map((l) => l.item.id);
      const offers = PAIRINGS.filter(([source, recommended]) => sources.includes(source) && !sources.includes(recommended));
      const fallback = itemById.get(rng.pick([ITEM.fries, ITEM.lemonMint, ITEM.cheesecake, ITEM.cappuccino]))!;
      const offer = offers.length ? rng.pick(offers) : null;
      const chosen = offer ? itemById.get(offer[1])! : fallback;
      if (!sources.includes(chosen.id)) {
        const decisionId = rng.uuid();
        const placement = rng.chance(0.74) ? 'cart' : 'item';
        const shownAt = plus(createdAt, -minutes(rng.between(0.4, 2)));
        const others = rng.chance(0.5) ? [itemById.get(rng.pick([ITEM.water, ITEM.orangeJuice, ITEM.churros]))!] : [];
        rows.recommendation_decisions.push({
          id: decisionId, session_id: sessionId, placement, policy_version: options.policyVersion,
          experiment_id: measured?.id ?? null, arm: measured ? 'treatment' : null,
          candidates: [chosen, ...others].map((c) => ({ item_id: c.id })), chosen_item_id: chosen.id,
          source_item_id: offer ? offer[0] : null, recommendation_type: offer ? offer[2] : 'frequently_bought_together',
          action_probability: 1, created_at: iso(shownAt), cart_value: money(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)),
          suggested_quantity: 1,
        });
        if (rng.chance(0.84)) {
          rows.recommendation_impressions.push({ decision_id: decisionId, seen_at: iso(plus(shownAt, 4000)) });
          const acceptance = placement === 'cart' ? 0.3 : 0.16;
          if (rng.chance(acceptance)) {
            rows.analytics_events.push({
              visit_id: `v-${sessionId.slice(0, 13)}`, event: 'suggestion_accepted', venue_id: VENUE,
              props: { decision_id: decisionId, item_id: chosen.id, placement }, occurred_at: iso(plus(shownAt, 9000)), created_at: iso(plus(shownAt, 9000)),
            });
            if (rng.chance(0.82)) {
              // "One for everyone?": a suggested side or drink is often taken for the table.
              const quantity = covers >= 3 && rng.chance(0.45) ? 2 : 1;
              lines.push({ item: chosen, quantity, unitPrice: chosen.price, regularPrice: null, notes: null, components: null, fromDecision: decisionId });
              rows.suggestion_conversions.push({
                order_id: orderId, source_item_id: offer ? offer[0] : null, recommended_item_id: chosen.id, placement,
                quantity, line_total: money(chosen.price * quantity), created_at: iso(createdAt), decision_id: decisionId,
              });
            }
          }
        }
      }
    }

    const itemsTotal = money(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
    const tip = method === 'card_online' && rng.chance(0.4) ? money(Math.round(itemsTotal * rng.pick([0.05, 0.1, 0.1, 0.15]) * 2) / 2) : 0;
    const total = money(itemsTotal + tip);

    const kitchenPrep = Math.max(0, ...lines.filter((l) => l.item.station === 'kitchen').map((l) => l.item.prep));
    const barPrep = Math.max(0, ...lines.filter((l) => l.item.station === 'bar').map((l) => l.item.prep));
    const confirmedAt = plus(createdAt, minutes(rng.between(0.3, 1.6)));
    const preparingAt = plus(confirmedAt, minutes(rng.between(0.4, 2)));
    const kitchenReady = plus(preparingAt, minutes(kitchenPrep * load * rng.between(0.85, 1.25)));
    const barReady = plus(confirmedAt, minutes(Math.max(1.5, barPrep * rng.between(0.9, 1.6))));
    const readyAt = kitchenPrep ? (kitchenReady > barReady ? kitchenReady : barReady) : barReady;
    const servedAt = plus(readyAt, minutes(rng.between(1, 4)));
    const paidAt = method === 'card_online' ? plus(createdAt, minutes(rng.between(0.5, 1.5))) : plus(end, -minutes(rng.between(1, 5)));
    const refunded = !cancelled && rng.chance(0.006) ? money(lines[0].unitPrice) : 0;

    firstOrderAt = firstOrderAt ?? createdAt;
    if (!cancelled) { lastServedAt = servedAt; visitTotal += total; }

    rows.orders.push({
      id: orderId, table_session_id: sessionId, venue_id: VENUE, order_code: code, guest_name: guest,
      status: cancelled ? 'cancelled' : 'served', total, tip_amount: tip, notes: null,
      created_at: iso(createdAt), updated_at: iso(cancelled ? plus(createdAt, minutes(3)) : paidAt > servedAt ? paidAt : servedAt),
      released_to_kitchen_at: iso(method === 'card_online' ? paidAt : createdAt),
      confirmed_at: cancelled ? null : iso(confirmedAt), preparing_at: cancelled ? null : iso(preparingAt),
      ready_at: cancelled ? null : iso(readyAt), served_at: cancelled ? null : iso(servedAt),
      assigned_waiter_id: waiter.id, payment_method: method,
      payment_status: cancelled ? 'unpaid' : refunded ? 'partially_refunded' : 'paid',
      paid_at: cancelled ? null : iso(paidAt), paid_by: cancelled || method === 'card_online' ? null : waiter.userId,
      cancelled_at: cancelled ? iso(plus(createdAt, minutes(3))) : null, cancelled_by: cancelled ? waiter.userId : null,
      cancel_reason: cancelled ? rng.pick(CANCEL_REASONS) : null, refunded_amount: refunded,
      fiscalized: !cancelled, fiscalized_at: cancelled ? null : iso(paidAt), fiscalization_status: cancelled ? 'not_fiscalized' : 'fiscalized',
      fiscal_receipt_number: cancelled ? null : `CD-${day.replace(/-/g, '').slice(2)}-${code}`,
      reco_holdout: measured ? holdout : null,
    });

    for (const line of lines) {
      const lineReady = line.item.station === 'kitchen'
        ? plus(preparingAt, minutes(line.item.prep * load * rng.between(0.8, 1.2)))
        : plus(confirmedAt, minutes(Math.max(1.2, line.item.prep * rng.between(0.8, 1.5))));
      rows.order_items.push({
        id: rng.uuid(), order_id: orderId, menu_item_id: line.item.id, quantity: line.quantity, unit_price: line.unitPrice,
        regular_unit_price: line.regularPrice, notes: line.notes, components: line.components, venue_id: VENUE,
        status: cancelled ? 'pending' : 'served', station: line.item.station, created_at: iso(createdAt),
        started_at: cancelled ? null : iso(line.item.station === 'kitchen' ? preparingAt : confirmedAt),
        ready_at: cancelled ? null : iso(lineReady > readyAt ? readyAt : lineReady), served_at: cancelled ? null : iso(servedAt),
      });
      viewed.add(line.item.id);
      added.add(line.item.id);
    }

    if (options.tickets && !cancelled) {
      for (const station of ['kitchen', 'bar'] as const) {
        if (!lines.some((l) => l.item.station === station || l.components?.some((c) => c.station === station))) continue;
        const printedAt = plus(createdAt, rng.int(3000, 14000));
        rows.order_ticket_events.push({
          order_id: orderId, ticket_type: station, status: 'printed', format: 'escpos', attempts: 1, venue_id: VENUE,
          created_at: iso(createdAt), updated_at: iso(printedAt), printed_at: iso(printedAt), original_printed_at: iso(printedAt),
          print_verified: true, claimed_by_device: station === 'kitchen' ? 'printer:Kitchen pass' : 'printer:Bar', claimed_at: iso(printedAt),
        });
      }
    }

    if (method === 'card_online' && !cancelled) {
      rows.payment_transactions.push({
        order_id: orderId, provider: 'monri', monri_order_number: `CD-${orderId.slice(0, 8)}`, monri_payment_id: `demo-${rng.token(10)}`,
        status: refunded ? 'refunded' : 'approved', amount_minor: Math.round(total * 100), currency: 'BAM', venue_id: VENUE,
        created_at: iso(createdAt), updated_at: iso(paidAt), approved_at: iso(paidAt), refunded_minor: Math.round(refunded * 100),
      });
    }
    if (refunded) {
      rows.order_refunds.push({
        order_id: orderId, amount: refunded, method, reason: rng.pick(['Dish arrived cold', 'Wrong item served', 'Long wait']),
        status: 'completed', requested_by: waiter.userId, completed_by: waiter.userId, venue_id: VENUE,
        created_at: iso(plus(servedAt, minutes(6))), completed_at: iso(plus(servedAt, minutes(8))),
      });
    }
  });

  if (!firstOrderAt && !options.detail) return { rows, orderCount, historyAt: null };

  if (firstOrderAt) {
    rows.table_sessions.push({
      id: sessionId, table_id: tableId(tableNumber), venue_id: VENUE, token: rng.token(64), is_active: false,
      opened_at: iso(start), closed_at: iso(end), guest_name: guest, assigned_waiter_id: waiter.id,
      first_order_at: iso(firstOrderAt), last_served_at: iso(lastServedAt), last_heartbeat_at: iso(end),
      host_client_id: clientId, covers: rng.chance(0.72) ? covers : null, staff_seen_at: iso(plus(start, minutes(rng.between(0.5, 3)))),
    });
    if (measured) {
      rows.session_experiment_assignment.push({ session_id: sessionId, experiment_id: measured.id, arm: holdout ? 'holdout' : 'treatment', assigned_at: iso(start) });
    }
    if (rng.chance(0.3)) {
      rows.ratings.push({ table_session_id: sessionId, rating: rng.weighted([5, 4, 3, 2], (r) => ({ 5: 62, 4: 27, 3: 8, 2: 3 })[r]), created_at: iso(plus(end, -minutes(2))), venue_id: VENUE });
    }
    if (rng.chance(0.24)) {
      const rating = Math.max(1, Math.min(5, Math.round(waiter.skill + rng.between(-1.1, 0.6))));
      rows.server_ratings.push({
        table_session_id: sessionId, waiter_id: waiter.id, rating, comment: rating >= 4 && rng.chance(0.3) ? rng.pick(COMMENTS) : null,
        created_at: iso(plus(end, -minutes(1))), venue_id: VENUE,
      });
    }
    if (rng.chance(0.14)) {
      const at = plus(start, minutes(rng.between(12, 30)));
      const wait = minutes(rng.between(0.6, 4.5) * (waiter.skill < 4.3 ? 1.6 : 1));
      rows.waiter_calls.push({
        table_session_id: sessionId, status: 'resolved', reason: 'assist', created_at: iso(at), venue_id: VENUE,
        acknowledged_by: waiter.userId, acknowledged_at: iso(plus(at, wait / 2)), resolved_by: waiter.userId, resolved_at: iso(plus(at, wait)),
      });
    }
    if (method !== 'card_online' && rng.chance(0.4) && visitTotal > 0) {
      const at = plus(end, -minutes(rng.between(6, 11)));
      rows.bill_requests.push({
        table_session_id: sessionId, status: 'resolved', created_at: iso(at), venue_id: VENUE,
        acknowledged_by: waiter.userId, acknowledged_at: iso(plus(at, minutes(1))), resolved_by: waiter.userId, resolved_at: iso(plus(at, minutes(rng.between(2, 5)))),
      });
    }
  }

  if (options.detail) {
    // What the guest's phone reported while they browsed (Admin → Analytics, the funnel).
    const visitId = `v-${sessionId.slice(0, 13)}`;
    let at = plus(start, 20_000);
    const event = (name: string, props: Row = {}) => {
      at = plus(at, rng.int(4000, 28000));
      rows.analytics_events.push({ visit_id: visitId, event: name, props, occurred_at: iso(at), created_at: iso(at), venue_id: VENUE });
    };
    event('menu_viewed', { has_session: true, entry: 'home' });
    for (let i = 0; i < rng.int(1, 3); i += 1) event('category_viewed', { category: rng.pick(['Mains', 'Starters & Salads', 'Cold Drinks', 'Desserts', 'Coffee & Tea', 'Brunch']) });
    // Dishes people open and then do not order: the photo sells, the price does not.
    for (const looked of [ITEM.chocolateDome, ITEM.mezzeForTwo]) if (rng.chance(0.16)) viewed.add(looked);
    // People look at three or four dishes for each one they order.
    // People open two or three dishes for each one they order, and what they open
    // is what a table like theirs orders at that hour: so every dish converts about alike.
    for (let i = 0; i < rng.int(2, 3); i += 1) {
      for (const line of chooseLines(rng, plus(start, minutes(5)), covers, i === 2 ? 1 : 0, options)) viewed.add(line.item.id);
    }
    for (const id of viewed) event('item_viewed', { item_id: id });
    if (firstOrderAt) {
      for (const id of added) event('item_added', { item_id: id });
      event('cart_viewed', { items: added.size });
      event('checkout_opened', {});
      event('order_placed', { payment_method: method });
    }
  }
  return { rows, orderCount, historyAt };
}

/** Phones that opened the menu and ordered nothing: the top of the funnel. */
export function generateBrowsers(day: string, until: Date): Record<string, unknown>[] {
  const rng = new Random(`casa-demo:browsers:${day}`);
  const events: Record<string, unknown>[] = [];
  const hours = Object.keys(HOURLY).map(Number);
  const count = rng.int(34, 52);
  for (let i = 0; i < count; i += 1) {
    let at = atLocal(day, rng.weighted(hours, (h) => HOURLY[h]), rng.int(0, 59));
    if (at > until) continue;
    const visitId = `b-${rng.token(12)}`;
    const push = (name: string, props: Record<string, unknown> = {}) => {
      at = plus(at, rng.int(5000, 30000));
      events.push({ visit_id: visitId, event: name, props, occurred_at: iso(at), created_at: iso(at), venue_id: VENUE });
    };
    // Each step loses some of them: the shape of the funnel in Admin → Analytics.
    push('menu_viewed', { has_session: rng.chance(0.5), entry: 'home' });
    if (!rng.chance(0.78)) continue;
    push('category_viewed', { category: rng.pick(['Mains', 'Desserts', 'Brunch', 'Cold Drinks']) });
    if (!rng.chance(0.74)) continue;
    const looked = rng.chance(0.12) ? rng.pick([ITEM.chocolateDome, ITEM.mezzeForTwo]) : rng.weighted(ITEMS, (item) => item.weight).id;
    push('item_viewed', { item_id: looked });
    if (rng.chance(0.5)) push('item_viewed', { item_id: rng.weighted(ITEMS, (item) => item.weight).id });
    if (!rng.chance(0.42)) continue;
    push('item_added', { item_id: looked });
    if (!rng.chance(0.7)) continue;
    push('cart_viewed', { items: 1 });
    if (rng.chance(0.55)) push('checkout_opened', {});
  }
  return events;
}

