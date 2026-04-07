"use client";

import { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { trpc } from "@/lib/trpc";

const applyHotQueryDefaults = (queryClient: QueryClient) => {
  queryClient.setQueryDefaults(getQueryKey(trpc.stores.list, undefined, "query"), {
    staleTime: 10 * 60_000,
    cacheTime: 30 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.productCategories.list, undefined, "query"), {
    staleTime: 10 * 60_000,
    cacheTime: 30 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.suppliers.list, undefined, "query"), {
    staleTime: 10 * 60_000,
    cacheTime: 30 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.dashboard.bootstrap, undefined, "query"), {
    staleTime: 20_000,
    cacheTime: 5 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.dashboard.activity, undefined, "query"), {
    staleTime: 20_000,
    cacheTime: 5 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.dashboard.summary, undefined, "query"), {
    staleTime: 20_000,
    cacheTime: 5 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.search.global, undefined, "query"), {
    staleTime: 30_000,
    cacheTime: 5 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.products.getById, undefined, "query"), {
    staleTime: 60_000,
    cacheTime: 10 * 60_000,
  });

  queryClient.setQueryDefaults(getQueryKey(trpc.products.bootstrap, undefined, "query"), {
    staleTime: 30_000,
    cacheTime: 10 * 60_000,
  });
};

export const createAppQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 15_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });

  applyHotQueryDefaults(queryClient);

  return queryClient;
};
