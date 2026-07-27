import { createRenderer } from 'vue';
import type { RendererOptions } from 'vue';

// Shared in-memory mount harness for component tests (extracted from
// XSelect.test.ts). The project deliberately has no component-test stack
// (@vue/test-utils, happy-dom/jsdom) — adding dependencies is out of scope for
// tests — so SFCs are mounted through Vue's public createRenderer() on top of
// a tiny fake node tree: DOM events are dispatched by invoking the listeners
// the template attached via patchProp. If a proper component-test stack is
// ever added, replace this harness with @vue/test-utils mounts.

export interface FakeNode {
    kind: 'element' | 'text' | 'comment';
    tag: string;
    text: string;
    parent: FakeElement | null;
    props: Record<string, unknown>;
    listeners: Record<string, unknown>;
    children: FakeNode[];
}

export interface FakeElement extends FakeNode {
    kind: 'element';
    // Mirrors Node.contains() — outside-click handlers call it.
    contains(other: unknown): boolean;
    // The built-in vShow directive assigns el.style.display directly, so every
    // element carries a mutable style bag (v-show is used by App.vue tabs).
    style: Record<string, string>;
    // HTMLElement.focus() stand-in: components reach for it through template
    // refs (SearchTab clear button, search-page autofocus). It only records the
    // call, and tests may still overwrite it with a spy.
    focus(): void;
    focused: boolean;
}

export function createFakeElement(tag: string): FakeElement {
    const el: FakeElement = {
        kind: 'element',
        tag,
        text: '',
        parent: null,
        props: {},
        listeners: {},
        children: [],
        style: {},
        focused: false,
        focus(): void {
            el.focused = true;
        },
        contains(other: unknown): boolean {
            let node = other as FakeNode | null;
            while (node) {
                if (node === el) {
                    return true;
                }
                node = node.parent;
            }
            return false;
        },
    };
    return el;
}

function createFakeText(kind: 'text' | 'comment', text: string): FakeNode {
    return { kind, tag: `#${kind}`, text, parent: null, props: {}, listeners: {}, children: [] };
}

function detach(node: FakeNode): void {
    const parent = node.parent;
    if (parent) {
        const index = parent.children.indexOf(node);
        if (index >= 0) {
            parent.children.splice(index, 1);
        }
    }
    node.parent = null;
}

const nodeOps: RendererOptions<FakeNode, FakeElement> = {
    createElement: (type) => createFakeElement(type),
    createText: (text) => createFakeText('text', text),
    createComment: (text) => createFakeText('comment', text),
    setText: (node, text) => {
        node.text = text;
    },
    setElementText: (el, text) => {
        for (const child of el.children) {
            child.parent = null;
        }
        el.children = [];
        if (text !== '') {
            const textNode = createFakeText('text', text);
            textNode.parent = el;
            el.children.push(textNode);
        }
    },
    insert: (child, parent, anchor) => {
        detach(child);
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        if (index >= 0) {
            parent.children.splice(index, 0, child);
        } else {
            parent.children.push(child);
        }
        child.parent = parent;
    },
    remove: (child) => {
        detach(child);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => {
        const siblings = node.parent?.children ?? [];
        const index = siblings.indexOf(node);
        return index >= 0 ? (siblings[index + 1] ?? null) : null;
    },
    patchProp: (el, key, _prevValue, nextValue) => {
        if (key.startsWith('on') && key.length > 2) {
            el.listeners[key.slice(2).toLowerCase()] = nextValue;
        } else {
            el.props[key] = nextValue;
        }
    },
    setScopeId: (el, id) => {
        el.props[id] = '';
    },
    // The SFC compiler stringifies large static subtrees (e.g. inline SVG) into
    // an HTML string mounted via this hook. Tests never assert inside static
    // content, so it lands as a single opaque leaf instead of a parsed tree.
    insertStaticContent: (content, parent, anchor) => {
        const node = createFakeElement('#static');
        node.text = content;
        const index = anchor ? parent.children.indexOf(anchor) : -1;
        if (index >= 0) {
            parent.children.splice(index, 0, node);
        } else {
            parent.children.push(node);
        }
        node.parent = parent;
        return [node, node];
    },
};

export const { createApp } = createRenderer<FakeNode, FakeElement>(nodeOps);

// --- query and event helpers ------------------------------------------------

export function findAll(root: FakeNode, className: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeNode): void => {
        if (node.kind === 'element') {
            const classes =
                typeof node.props.class === 'string' ? node.props.class.split(/\s+/) : [];
            if (classes.includes(className)) {
                found.push(node as FakeElement);
            }
        }
        for (const child of node.children) {
            visit(child);
        }
    };
    visit(root);
    return found;
}

export function find(root: FakeNode, className: string): FakeElement {
    const [first] = findAll(root, className);
    if (!first) {
        throw new Error(`element .${className} not found`);
    }
    return first;
}

export function textOf(node: FakeNode): string {
    if (node.kind !== 'element') {
        return node.kind === 'text' ? node.text : '';
    }
    return node.children.map(textOf).join('');
}

export function fire(el: FakeElement, type: string, event: object): void {
    const listener = el.listeners[type];
    if (!listener) {
        throw new Error(`no "${type}" listener on <${el.tag}>`);
    }
    const handlers = Array.isArray(listener) ? listener : [listener];
    for (const handler of handlers) {
        (handler as (e: unknown) => void)(event);
    }
}

export function clickOn(el: FakeElement): void {
    fire(el, 'click', { target: el });
}
