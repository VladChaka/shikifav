import { ref } from 'vue';
import type { Ref } from 'vue';
import { useRates } from './use-rates';
import { useSearch } from './use-search';
import type { UseSearch } from './use-search';
import { useSettings } from './use-settings';
import type { TitleCard, UserRateStatus } from '../lib/api/types';

// Search screen wiring shared by the popup and the full-screen search page
// (Ф6-5): the search session plus the optimistic user_rate writes over its
// results and the single-open status menu. What stays outside is what actually
// differs between the two screens — the toast placement, the shell/header and
// how the incoming query arrives (session.pendingSearch vs ?q=).
export interface UseSearchScreen extends UseSearch {
    // rateKeys with a write in flight; the acted-on card is locked.
    busyIds: Ref<Set<string>>;
    // rateKey -> inline warning text (revoked edit access).
    warnings: Ref<Map<string, string>>;
    // rateKey of the card whose status menu is open — at most one across the
    // list (id alone can collide between anime and manga of the same id).
    openMenuKey: Ref<string | null>;
    onSetStatus: (card: TitleCard, status: UserRateStatus) => void;
    // Primary part of the split button: adds with the `quickStatus` setting.
    onQuickAdd: (card: TitleCard) => void;
    onRemove: (card: TitleCard) => void;
}

export function useSearchScreen(showToast: (text: string) => void): UseSearchScreen {
    // useSearch is module-level state: it is proxied as-is, never copied into
    // local refs — the popup and the page must share one search session (and
    // one session-cache restore), exactly as before this composable existed.
    const search = useSearch();

    // useRates is instance-based and bound to the very same items ref, so its
    // watch() still clears busyIds/warnings when a new response replaces the
    // array. One instance per screen, as before.
    const { busyIds, warnings, performAction } = useRates(search.items, showToast);

    const openMenuKey = ref<string | null>(null);

    // A card outside my list creates a rate, one inside updates its status (US-3).
    function onSetStatus(card: TitleCard, status: UserRateStatus): void {
        void performAction(
            card,
            card.userRate === null ? { type: 'create', status } : { type: 'update', status },
        );
    }

    // One-click add (Ф6-20): the status is the `quickStatus` setting, not a
    // constant. The button label in TitleCard reads the same settings ref, so
    // the two cannot show and write different statuses.
    const { settings } = useSettings();

    function onQuickAdd(card: TitleCard): void {
        onSetStatus(card, settings.value.quickStatus);
    }

    function onRemove(card: TitleCard): void {
        void performAction(card, { type: 'delete' });
    }

    return { ...search, busyIds, warnings, openMenuKey, onSetStatus, onQuickAdd, onRemove };
}
