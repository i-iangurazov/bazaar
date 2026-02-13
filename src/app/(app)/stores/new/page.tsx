import { redirect } from "next/navigation";

const StoreCreateRedirectPage = () => {
  redirect("/stores?create=1");
};

export default StoreCreateRedirectPage;
