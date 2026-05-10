import { unsubscribeCustomerFromEmailMarketing } from "@/server/services/emailMarketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const renderHtml = (input: { title: string; body: string; status?: number }) =>
  new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
    <style>
      body { margin: 0; background: #f3f4f6; color: #111827; font-family: Inter, Segoe UI, Arial, sans-serif; }
      main { max-width: 560px; margin: 72px auto; background: #ffffff; border: 1px solid #e5e7eb; padding: 28px; }
      h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; }
      p { margin: 0; color: #4b5563; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>${input.title}</h1>
      <p>${input.body}</p>
    </main>
  </body>
</html>`,
    {
      status: input.status ?? 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );

const handleUnsubscribe = async (request: Request) => {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId")?.trim() ?? "";
  const email = url.searchParams.get("email")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!customerId || !email || !token) {
    return renderHtml({
      title: "Invalid unsubscribe link",
      body: "The unsubscribe link is missing required information.",
      status: 400,
    });
  }

  try {
    const result = await unsubscribeCustomerFromEmailMarketing({ customerId, email, token });
    return renderHtml({
      title: result.status === "already_unsubscribed" ? "Already unsubscribed" : "Unsubscribed",
      body:
        result.status === "already_unsubscribed"
          ? "This email address is already removed from future marketing campaigns."
          : "This email address has been removed from future marketing campaigns.",
    });
  } catch {
    return renderHtml({
      title: "Invalid unsubscribe link",
      body: "The unsubscribe link is invalid or expired.",
      status: 400,
    });
  }
};

export const GET = handleUnsubscribe;
export const POST = handleUnsubscribe;
