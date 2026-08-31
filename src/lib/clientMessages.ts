export type ClientMessageCatalog = Record<string, unknown>;

export const rootClientMessageNamespaces = ["common", "nativeApp", "pwaStatus"] as const;

export const pickClientMessageNamespaces = <Catalog extends ClientMessageCatalog>(
  messages: Catalog,
  namespaces: readonly string[],
) =>
  Object.fromEntries(
    namespaces.flatMap((namespace) =>
      Object.hasOwn(messages, namespace) ? [[namespace, messages[namespace]]] : [],
    ),
  ) as Catalog;
