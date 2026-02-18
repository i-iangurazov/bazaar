import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type AuthBrandProps = {
  className?: string;
};

export const AuthBrand = ({ className }: AuthBrandProps) => {
  return (
    <Link href="/" className={cn("inline-flex items-center justify-center", className)}>
      <Image
        src="/brand/logo.png"
        alt="BAZAAR"
        width={172}
        height={44}
        priority
        className="h-9 w-auto sm:h-10"
      />
    </Link>
  );
};
