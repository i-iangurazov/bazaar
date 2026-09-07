import { appLinks } from "@/lib/appRoutes";
import { redirect } from "next/navigation";

const SupplierCreateRedirectPage = () => {
  redirect(appLinks.newSupplier());
};

export default SupplierCreateRedirectPage;
