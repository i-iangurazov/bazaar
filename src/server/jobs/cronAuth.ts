import { timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET_LENGTH = 16;

export const isAuthorizedCronRequest = (request: Request, secret: string) => {
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    return false;
  }
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
};
