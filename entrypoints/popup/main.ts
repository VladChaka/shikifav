import { createApp } from 'vue';
import './style.scss';
import App from './App.vue';
import { initTheme } from '@/src/lib/theme';

// Theme is applied before the mount so the first frame already carries the
// chosen theme instead of flashing the system one (cost: one storage read).
void initTheme().then(() => {
    createApp(App).mount('#app');
});
