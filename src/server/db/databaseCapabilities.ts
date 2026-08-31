import { Prisma, type PrismaClient } from "@prisma/client";

const unicodeCapabilityError = () =>
  new Error(
    [
      "Database collation does not provide Unicode-aware case folding.",
      "Bazaar requires a PostgreSQL database initialized with an ICU locale",
      '(for example: --locale-provider=icu --icu-locale="und").',
    ].join(" "),
  );

export const assertUnicodeCaseInsensitiveSearch = async (client: PrismaClient) => {
  const rows = await client.$queryRaw<Array<{ supported: boolean }>>(
    Prisma.sql`
      SELECT (
        lower('РЮКЗАК') = 'рюкзак'
        AND 'РЮКЗАК' ILIKE 'рюкзак'
      ) AS supported
    `,
  );

  if (rows[0]?.supported !== true) {
    throw unicodeCapabilityError();
  }
};
