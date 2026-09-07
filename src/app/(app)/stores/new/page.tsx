import { appLinks } from "@/lib/appRoutes";
import { redirect } from "next/navigation";

const StoreCreateRedirectPage = () => {
  redirect(appLinks.newStore());
};

export default StoreCreateRedirectPage;
