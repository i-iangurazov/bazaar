import { redirect } from "next/navigation";

import { getServerAuthToken } from "@/server/auth/token";

export const dynamic = "force-dynamic";

const HomePage = async () => {
  const token = await getServerAuthToken();
  redirect(token ? "/dashboard" : "/login");
};

export default HomePage;
