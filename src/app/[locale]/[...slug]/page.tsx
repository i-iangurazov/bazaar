import { redirect } from "next/navigation";

type LegacyLocaleRedirectProps = {
  params: Promise<{ locale: string; slug?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

const LegacyLocaleRedirectPage = async ({ params: paramsPromise, searchParams: searchParamsPromise }: LegacyLocaleRedirectProps) => {
  const params = await paramsPromise;
  const searchParams = await searchParamsPromise;

  const path = params.slug?.join("/") ?? "";
  const query = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value)) {
        value.forEach((item) => query.append(key, item));
      } else if (value) {
        query.set(key, value);
      }
    }
  }
  const suffix = query.toString();
  const destination = path ? `/${path}` : "/";
  redirect(suffix ? `${destination}?${suffix}` : destination);
};

export default LegacyLocaleRedirectPage;
