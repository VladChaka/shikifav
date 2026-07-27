import { createApp } from 'vue';
import './style.scss';
import SearchPage from './SearchPage.vue';
import { parseSearchQuery } from '@/src/lib/search-url';
import { initTheme } from '@/src/lib/theme';

// The only place that touches window: SearchPage takes the query as a prop,
// which keeps the page mountable without a DOM (component tests, Ф5-8).
// Theme is applied before the mount so the first frame already carries the
// chosen theme instead of flashing the system one (cost: one storage read).
const initialQuery = parseSearchQuery(window.location.search);
void initTheme().then(() => {
    createApp(SearchPage, { initialQuery }).mount('#app');
});
