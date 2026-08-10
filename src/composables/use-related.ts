import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { sendMessage } from '../lib/messaging';
import { applyMixedPosters, fetchMissingMixedPosters } from '../lib/poster-backfill';
import { apiErrorMessage } from '../lib/i18n';
import { dedupeRelated, groupRelated } from '../lib/related';
import { cardKey } from '../lib/title-card';
import { useRates } from './use-rates';
import { useSettings } from './use-settings';
import type { CardKey } from '../lib/title-card';
import type {
    RateTargetType,
    RelatedItem,
    RelationKind,
    TitleCard,
    UserRateStatus,
} from '../lib/api/types';

// «Связанные» — an overlay inside the popup over one title's links (US-11,
// phase 12). Not a tab: it is entered from a search card or a list row, shows
// what else there is of that story and returns exactly one step back. Data flows
// only through background messages (docs/02, ADR-1); ordering, grouping and
// dedup are the pure layer in src/lib/related.ts, and the screen renders
// whatever comes out of here — the portion counter included, so no component
// keeps a slice of its own.
export type RelatedStatus = 'skeleton' | 'data' | 'empty' | 'error';

// The title whose links are on screen: what the request needs plus what the
// return bar prints. `name`/`russian` travel as the pair (structurally a
// TitleNames, src/lib/title-name.ts) instead of one ready string, so the bar
// applies the «ромадзи»/«русские» setting at render time like every other row.
// Both entry points can fill it: a TitleCard has `id`, a RateRow has `targetId`.
export interface RelatedTarget {
    targetId: string;
    targetType: RateTargetType;
    name: string;
    russian: string | null;
}

// One relation group as the screen draws it.
export interface RelatedPortion {
    kind: RelationKind;
    // Rows visible right now. The portion cuts ROWS, not groups (design card
    // screens/related): a group longer than one portion («Побочные истории», 35
    // rows of One Piece) gets its tail on the next click, under the same sticky
    // heading.
    items: RelatedItem[];
    // The WHOLE group. The heading counter prints its length before the group is
    // scrolled, and relationGroupLabel() is documented to read the whole group:
    // a book left in the unrendered tail would otherwise flip «Экранизации» to
    // «Первоисточник» on the next «Показать ещё» (i18n.ts).
    all: readonly RelatedItem[];
}

export interface UseRelated {
    // null = the overlay is closed. Also the return-bar title and the cache key.
    target: Ref<RelatedTarget | null>;
    // Named `screenStatus`, not `status`, for the calendar's reason: a row here
    // carries its own status (my list badge), and one word for both in a
    // template is a guaranteed misread.
    screenStatus: Ref<RelatedStatus>;
    errorText: Ref<string | undefined>;
    // Groups to render, already cut to the current portion.
    groups: ComputedRef<RelatedPortion[]>;
    // «Показано {shown} из {total}» (i18n.shownOfMessage).
    shown: ComputedRef<number>;
    total: ComputedRef<number>;
    hasMore: ComputedRef<boolean>;
    // rateKey(card) values with a write in flight / an inline warning, exactly
    // as in the search results — the row controls read them by the same key.
    busyIds: Ref<Set<string>>;
    warnings: Ref<Map<string, string>>;
    open: (target: RelatedTarget) => void;
    close: () => void;
    loadMore: () => void;
    retry: () => void;
    onSetStatus: (card: TitleCard, status: UserRateStatus) => void;
    onQuickAdd: (card: TitleCard) => void;
    onRemove: (card: TitleCard) => void;
}

// Rows per portion (design card screens/related). There is no virtualisation in
// this project and none is allowed in this phase, so 92 rows of One Piece would
// mean 92 posters in the DOM at once. The data arrives in ONE answer — only the
// rendering is portioned, which is why the button is instant and has no
// «загружаю ещё» state, unlike «Ещё» in «Мои списки».
export const RELATED_PORTION = 30;

// Which link a card arrived by. Immutable half of an entry: the card underneath
// is patched by rate writes and the poster backfill, the relation never is.
type RelationMeta = Omit<RelatedItem, 'card'>;

interface RelatedEntry {
    // The mutable half. useRates patches cards in place, and screen and cache
    // share this one array — so a status changed here is still on the row when
    // the same title is opened again in this popup session.
    cards: TitleCard[];
    relations: ReadonlyMap<CardKey, RelationMeta>;
}

// The whole screen, cached in memory only, keyed by the host title. Deliberately
// NOT a SessionState key (docs/06, Ф12-7): One Piece answers 92 links / 57 KB,
// and a key like that sits on the popup's first-frame path, where the budget is
// FMR < 150 ms (docs/05) — paid on every open, including the majority that never
// go near this screen. Memory costs exactly one thing: a second popup open
// refetches. It buys the rule that matters — the same title twice in one popup
// session is zero requests.
const cache = new Map<string, RelatedEntry>();

// Identity of the HOST title, and the cache key. The same (targetType, id) pair
// as cardKey() and for the same reason — anime 21 and manga 21 are different
// works — but spelled out here because the host is not a TitleCard: the entry
// points hand over an id and a type, nothing else.
function targetKey(target: RelatedTarget): string {
    return `${target.targetType}:${target.targetId}`;
}

// Module-level state: the popup is a single short-lived instance and both entry
// points plus the overlay itself must see one screen (same pattern as
// use-search/use-lists).
const target = ref<RelatedTarget | null>(null);
const screenStatus = ref<RelatedStatus>('skeleton');
const errorText = ref<string | undefined>(undefined);
// THE reason the store is a flat card array and not RelatedItem[]: useRates is
// typed over Ref<TitleCard[]> and patches `items.value[i]` in place. A computed
// unwrapping RelatedItem.card would hand it a fresh array on every recompute,
// and the patch would land in a value nobody reads.
const cards = ref<TitleCard[]>([]);
// The relation halves, keyed by cardKey. shallowRef because the map is replaced
// whole and never mutated: deep-proxying 92 immutable meta objects buys nothing.
// Always assigned together with `cards` — the derived rows read both.
const relations = shallowRef<ReadonlyMap<CardKey, RelationMeta>>(new Map());
// Rows the user has asked to see. Reset to one portion on every open: entering
// the screen starts at the top, and a tail unrolled last time would be a
// scrollbar with no story behind it.
const shownRows = ref(RELATED_PORTION);

// Keys with a request in flight. A key, not the neighbours' monotonic
// requestSeq: here the target IS state, so "is this answer still wanted" is
// answered by comparing it — and the same key twice additionally coalesces into
// the running request instead of paying for a second one (re-entering a screen
// whose first load has not landed yet).
const inFlight = new Set<string>();

// Provided by the owner (App): failed writes surface as toasts (as in use-lists).
let showToastFn: (text: string) => void = () => {};

// One rates instance for the whole screen, created next to the state it patches:
// useRelated() may be called from more than one component, and two instances
// would keep two busy sets over one list. Its watch(items) also clears
// busy/warning state whenever the array is replaced — which is exactly what a
// switch to another title must do.
const { busyIds, warnings, performAction } = useRates(cards, (text) => showToastFn(text));

// Same shared snapshot the row control reads for its label, so the button cannot
// say «+ Запланировано» and write something else (Ф6-20).
const { settings } = useSettings();

function currentKey(): string | null {
    return target.value === null ? null : targetKey(target.value);
}

// Server list -> the two halves of an entry. Deduped here rather than at render
// time: the relation map is keyed by cardKey, so a title linked twice would keep
// one meta anyway, and doing it up front keeps cards and relations 1:1 — which
// is what makes `total` the number of rows the screen actually draws.
function buildEntry(items: readonly RelatedItem[]): RelatedEntry {
    const relationMap = new Map<CardKey, RelationMeta>();
    const entryCards: TitleCard[] = [];
    for (const item of dedupeRelated(items)) {
        entryCards.push(item.card);
        relationMap.set(cardKey(item.card), {
            relationKind: item.relationKind,
            relationText: item.relationText,
        });
    }
    return { cards: entryCards, relations: relationMap };
}

// The rows back in the shape the pure layer and the template speak: cards come
// from the reactive store, relations from the map they were split into.
const items = computed<RelatedItem[]>(() =>
    cards.value.map((card) => {
        const meta = relations.value.get(cardKey(card));
        // Unreachable by construction — both halves are built together and
        // neither a rate write nor a poster patch touches id/targetType. Kept as
        // a fallback rather than a filter for the reason «Прочее» exists at all
        // (related.ts): a lost row reads as a bug, a row under the bucket that
        // promises nothing does not.
        return {
            relationKind: meta?.relationKind ?? 'other',
            relationText: meta?.relationText ?? '',
            card,
        };
    }),
);

const allGroups = computed(() => groupRelated(items.value));

const total = computed(() => cards.value.length);
const shown = computed(() => Math.min(shownRows.value, total.value));
const hasMore = computed(() => total.value > shown.value);

const groups = computed<RelatedPortion[]>(() => {
    let budget = shownRows.value;
    const portions: RelatedPortion[] = [];
    for (const group of allGroups.value) {
        if (budget <= 0) {
            break; // an empty group would draw a heading with nothing under it
        }
        const portion = group.items.slice(0, budget);
        budget -= portion.length;
        portions.push({ kind: group.kind, items: portion, all: group.items });
    }
    return portions;
});

function applyEntry(entry: RelatedEntry): void {
    relations.value = entry.relations;
    cards.value = entry.cards;
    screenStatus.value = entry.cards.length > 0 ? 'data' : 'empty';
}

// Ф6-27 for a MIXED list: the rows are already on screen, the posters GraphQL
// left empty (every 18+ title among them) are fetched in up to three REST
// batches and patched in afterwards. Silent on failure — this is not a user
// action, so no toast and no error state, the rows keep the local fallback
// image (docs/05).
//
// Patched into the ENTRY, not into the screen: an answer that lands after the
// user left still fixes the cached rows, and the same title reopened later shows
// pictures without a request. Read off entry.cards, which is the array useRates
// patches in place, so a status written while the request was in flight survives.
async function fillPosters(key: string, entry: RelatedEntry): Promise<void> {
    const posters = await fetchMissingMixedPosters(entry.cards);
    const patched = applyMixedPosters(entry.cards, posters);
    if (patched === null) {
        return;
    }
    entry.cards = patched;
    if (currentKey() === key) {
        cards.value = patched;
    }
}

async function load(next: RelatedTarget): Promise<void> {
    const key = targetKey(next);
    if (inFlight.has(key)) {
        return; // a re-entered screen rides the request already running
    }
    inFlight.add(key);
    try {
        const response = await sendMessage('titles.related', {
            targetId: next.targetId,
            targetType: next.targetType,
        });
        if (response.ok) {
            const entry = buildEntry(response.data.items);
            // Cached even when the user has already left: the request is paid
            // for, and coming back must not spend a second one.
            cache.set(key, entry);
            if (currentKey() === key) {
                applyEntry(entry);
            }
            void fillPosters(key, entry);
            return;
        }
        if (currentKey() === key) {
            // apiErrorMessage, never error.message: a GraphQL refusal arrives as
            // {kind:'api'} carrying the server's English «Query has complexity
            // of…» (docs/03), and that must not reach the user.
            errorText.value = apiErrorMessage(response.error);
            screenStatus.value = 'error';
        }
        // A failure is deliberately NOT cached: re-entering the screen is a
        // legitimate second attempt, exactly like «Повторить».
    } finally {
        inFlight.delete(key);
    }
}

function open(next: RelatedTarget): void {
    target.value = next;
    shownRows.value = RELATED_PORTION;
    errorText.value = undefined;
    const cached = cache.get(targetKey(next));
    if (cached) {
        applyEntry(cached); // zero requests, posters included
        return;
    }
    // Another title's rows must not flash under this one's return bar, so the
    // skeleton rule here is stricter than in the search: nothing stays on screen
    // while the network runs.
    relations.value = new Map();
    cards.value = [];
    screenStatus.value = 'skeleton';
    void load(next);
}

function close(): void {
    // Rows are left where they are: the entry lives in the cache anyway, and the
    // next open() decides what to show — from the cache or from a skeleton.
    target.value = null;
}

function loadMore(): void {
    if (!hasMore.value) {
        return;
    }
    shownRows.value += RELATED_PORTION;
}

function retry(): void {
    const current = target.value;
    if (current === null) {
        return;
    }
    errorText.value = undefined;
    screenStatus.value = 'skeleton';
    void load(current);
}

// A card outside my list creates a rate, one inside updates its status (US-3),
// exactly as in the search results — the related screen adds no write of its
// own: no [+1] and no score (docs/06, decision 3).
function onSetStatus(card: TitleCard, status: UserRateStatus): void {
    void performAction(
        card,
        card.userRate === null ? { type: 'create', status } : { type: 'update', status },
    );
}

function onQuickAdd(card: TitleCard): void {
    onSetStatus(card, settings.value.quickStatus);
}

function onRemove(card: TitleCard): void {
    void performAction(card, { type: 'delete' });
}

export function useRelated(showToast: (text: string) => void): UseRelated {
    showToastFn = showToast;
    return {
        target,
        screenStatus,
        errorText,
        groups,
        shown,
        total,
        hasMore,
        busyIds,
        warnings,
        open,
        close,
        loadMore,
        retry,
        onSetStatus,
        onQuickAdd,
        onRemove,
    };
}
