import { redirect } from "next/navigation";

const SupplierCreateRedirectPage = () => {
  redirect("/suppliers?create=1");
};

export default SupplierCreateRedirectPage;
