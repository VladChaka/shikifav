<template>
    <main class="hello">
        <h1 class="hello__name">Shikimori Quick</h1>
        <p class="hello__greeting">Hello</p>
    </main>
</template>

<style scoped lang="scss">
.hello {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 4px;
}

.hello__name {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
}

.hello__greeting {
    margin: 0;
    color: var(--color-fg-muted);
}
</style>
