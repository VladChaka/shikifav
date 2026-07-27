import { createApp } from 'vue';
import { browser } from 'wxt/browser';
import './style.scss';
import OptionsPage from './OptionsPage.vue';
import { initTheme } from '@/src/lib/theme';

// The only place that touches the extension runtime: OptionsPage takes the
// version as a prop, which keeps the page mountable without one (component
// tests, same contract as the search page's initialQuery).
// Theme is applied before the mount so the first frame already carries the
// chosen theme instead of flashing the system one (cost: one storage read).
const version = browser.runtime.getManifest().version;
void initTheme().then(() => {
    createApp(OptionsPage, { version }).mount('#app');
});
