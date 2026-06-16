import { ProductMovementDocumentEditorPage } from "@/components/inventory/product-movement-document-editor";

const getParam = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);

const TransferEditPage = ({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) => {
  const documentId = decodeURIComponent(params.id);
  const documentKey = getParam(searchParams?.documentKey) ?? `TRANSFER:TRANSFER:${documentId}`;
  const backHref = getParam(searchParams?.returnTo) ?? "/inventory/movements";

  return <ProductMovementDocumentEditorPage documentKey={documentKey} backHref={backHref} />;
};

export default TransferEditPage;
