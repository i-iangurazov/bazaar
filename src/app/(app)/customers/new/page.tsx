import { redirect } from "next/navigation";

const NewCustomerPage = () => {
  redirect("/customers?add=1");
};

export default NewCustomerPage;
