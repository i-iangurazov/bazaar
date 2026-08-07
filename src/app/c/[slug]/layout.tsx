import { bazaarCatalogFontStylesheetHref } from "@/lib/catalogFonts";

const PublicCatalogLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <link rel="stylesheet" href={bazaarCatalogFontStylesheetHref} />
    {children}
  </>
);

export default PublicCatalogLayout;
