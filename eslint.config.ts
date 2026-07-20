import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default defineConfigWithVueTs(
    {
        name: 'app/files-to-lint',
        files: ['**/*.{ts,mts,vue}'],
    },

    {
        ignores: ['**/dist/**', '**/coverage/**', '.wxt/**', '.output/**'],
    },

    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommended,
    skipFormatting,

    {
        name: 'app/rules',
        rules: {
            'vue/block-order': ['error', { order: ['template', 'script', 'style'] }],
            'vue/html-indent': 0,
            'vue/no-shared-component-data': 'error',
            'vue/no-deprecated-destroyed-lifecycle': 'error',
            'vue/require-v-for-key': 2, //  обязательный key в директиве v-for
            'vue/no-use-v-if-with-v-for': 2, //  запрет применения v-for и v-if к одному элементу
            'vue/no-side-effects-in-computed-properties': 2, //  запрет кода, который приводит к побочным эффектам в выч. свойствах
            'vue/no-unused-components': 2, // запрет на добавление компонентов, которые не используются в шаблоне
            'vue/no-reserved-component-names': 2, //  предотвращение конфликтов имен между кастомными компонентами и html-элементами
            'vue/no-mutating-props': 2, //  запрет на мутирование props
            'vue/valid-v-bind-sync': 2, //  проверка валидности .sync на v-bind
            'vue/no-reserved-props': 2, //  запрет на использование зарезервированных имен в props
            'vue/singleline-html-element-content-newline': [
                0,
                {
                    //  перенос содержимого html-элемента на новую строку ('nэтибудет управлять prettier)
                    ignoreWhenNoAttributes: true,
                    ignoreWhenEmpty: true,
                    externalIgnores: [],
                },
            ],
            'no-useless-escape': 1, //  уведомления о ненужных escape "/" в строках и регулярных выражениях
            'no-case-declarations': 2, //  запрет на объявление переменных в switch case и default
            '@typescript-eslint/no-unused-vars': [
                'error',
                { varsIgnorePattern: '^(props|ref|emit)$' },
            ],
            '@typescript-eslint/no-unused-expressions': [
                'error',
                { allowShortCircuit: true, allowTernary: true },
            ],
            'vue/multi-word-component-names': 'off',
        },
    },
);
