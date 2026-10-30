import {act, renderHook} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {useCatalogRefresh} from './useCatalogRefresh';
let update: () => Promise<void>;
vi.mock('./useCatalogUpdates', () => ({useCatalogUpdates: (callback: typeof update) => {update = callback;}}));

it('aguarda a operação corrente antes de atualizar e agrupa eventos pendentes', async () => {
 const {result, rerender} = renderHook(({busy}) => useCatalogRefresh('contexto', busy), {initialProps: {busy: true}});
 let first!: Promise<void>;
 let second!: Promise<void>;
 act(() => {first = update(); second = update();});
 expect(result.current.revision).toBe(0);
 act(() => {rerender({busy: false});});
 await act(async () => {await Promise.all([first, second]);});
 expect(result.current.revision).toBe(1);
 expect(result.current.refreshing).toBe(true);
});

it('descarta evento pendente de contexto antigo e libera carregamento do novo', async () => {
 const {result, rerender} = renderHook(({context, busy}) => useCatalogRefresh(context, busy), {initialProps: {context: 'antigo', busy: true}});
 let pending!: Promise<void>;
 act(() => {pending = update();});
 act(() => {rerender({context: 'novo', busy: false});});
 await act(async () => {await pending;});
 expect(result.current.revision).toBe(0);
 expect(result.current.refreshing).toBe(false);
 await act(async () => {await update();});
 expect(result.current.revision).toBe(1);
});
