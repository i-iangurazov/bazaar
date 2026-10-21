// Shared by the full-page assistant and header drawer. A chat command must not
// execute an older server form while either view still has a debounced edit.
const forms = new Map<string, Set<() => Promise<void>>>();
export function registerBaamWorkflowFlush(conversationId: string, flush: () => Promise<void>) {
  const callbacks = forms.get(conversationId) ?? new Set();
  callbacks.add(flush);
  forms.set(conversationId, callbacks);
  return () => {
    callbacks.delete(flush);
    if (!callbacks.size && forms.get(conversationId) === callbacks) forms.delete(conversationId);
  };
}
export async function flushBaamWorkflowForms(conversationId: string) {
  for (const flush of [...(forms.get(conversationId) ?? [])]) await flush();
}
