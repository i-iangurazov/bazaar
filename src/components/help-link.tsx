"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { HelpIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const HelpLink = ({ articleId }: { articleId: string }) => {
  const tCommon = useTranslations("common");
  const tHelp = useTranslations("help");
  const articleTitle = tHelp(`articles.${articleId}.title`);
  const ariaLabel = tCommon("openHelpArticle", { article: articleTitle });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild type="button" variant="ghost" size="icon" aria-label={ariaLabel}>
            <Link href={`/help#${articleId}`} target="_blank" rel="noopener noreferrer">
              <HelpIcon className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{articleTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
