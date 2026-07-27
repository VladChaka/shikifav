import { createApp } from 'vue';
import './style.scss';
import SearchPage from './SearchPage.vue';
import { parseSearchQuery } from '@/src/lib/search-url';

// The only place that touches window: SearchPage takes the query as a prop,
// which keeps the page mountable without a DOM (component tests, Ф5-8).
createApp(SearchPage, { initialQuery: parseSearchQuery(window.location.search) }).mount('#app');
