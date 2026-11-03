/**
 * `awaitKvHydration` — the boot gate that holds the startup chain until every
 * async-persisted startup store has loaded. Driven through a REAL store's real
 * `persist` API rather than a stub, because the whole point is the timing:
 * `rehydrate()` flips `hasHydrated` false synchronously and resolves a microtask
 * later, which is the window the gate exists to cover.
 */
import { equalizerSettingsStore } from '../../equalizerSettingsStore';
import { genreStore } from '../../genreStore';
import { awaitKvHydration } from '../rehydrate';

describe('awaitKvHydration', () => {
  it('resolves immediately once every store has already hydrated', async () => {
    await awaitKvHydration();
    expect(genreStore.persist.hasHydrated()).toBe(true);
    await expect(awaitKvHydration()).resolves.toBeUndefined();
  });

  it('waits for a store that is still hydrating', async () => {
    await awaitKvHydration(); // settle whatever the import kicked off
    void genreStore.persist.rehydrate();
    expect(genreStore.persist.hasHydrated()).toBe(false);

    await awaitKvHydration();

    expect(genreStore.persist.hasHydrated()).toBe(true);
  });

  it('waits for the equalizer settings, which the player applies as soon as it resolves', async () => {
    await awaitKvHydration();
    void equalizerSettingsStore.persist.rehydrate();
    expect(equalizerSettingsStore.persist.hasHydrated()).toBe(false);

    await awaitKvHydration();

    expect(equalizerSettingsStore.persist.hasHydrated()).toBe(true);
  });
});
