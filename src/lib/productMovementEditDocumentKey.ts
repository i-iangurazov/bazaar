type ResolveProductMovementEditDocumentKeyInput = {
  routeId: string;
  requestedDocumentKey?: string;
  fallbackDocumentType: string;
  fallbackReferenceType: string;
};

export const resolveProductMovementEditDocumentKey = ({
  routeId,
  requestedDocumentKey,
  fallbackDocumentType,
  fallbackReferenceType,
}: ResolveProductMovementEditDocumentKeyInput): string | null => {
  if (!requestedDocumentKey) {
    return `${fallbackDocumentType}:${fallbackReferenceType}:${routeId}`;
  }

  const [documentType, referenceType, ...referenceIdParts] = requestedDocumentKey.split(":");
  const referenceId = referenceIdParts.join(":");
  if (
    documentType !== fallbackDocumentType ||
    referenceType !== fallbackReferenceType ||
    referenceId !== routeId
  ) {
    return null;
  }

  return requestedDocumentKey;
};
