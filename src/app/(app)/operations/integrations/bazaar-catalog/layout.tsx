import { bazaarCatalogFontStylesheetHref } from "@/lib/catalogFonts";

const BazaarCatalogSettingsLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <link rel="stylesheet" href={bazaarCatalogFontStylesheetHref} />
    {children}
  </>
);

export default BazaarCatalogSettingsLayout;
