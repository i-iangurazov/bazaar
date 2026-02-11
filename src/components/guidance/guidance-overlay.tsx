"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GuidanceCloseButton,
  GuidanceTourNavButtons,
} from "@/components/guidance/GuidanceButtons";
import { useGuidance } from "@/components/guidance/guidance-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GuidanceTipDefinition, GuidanceTourStep, TipPlacement } from "@/lib/guidance";

const CARD_WIDTH = 340;
const CARD_HEIGHT = 248;
const CARD_GAP = 12;
const EDGE_PADDING = 12;
const MOBILE_BREAKPOINT = 640;
const VIEWPORT_SAFE_MARGIN = 84;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const resolveTarget = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    return null;
  }
  return { element, rect: element.getBoundingClientRect() };
};

const ensureSelectorVisible = (selector: string) => {
  const target = resolveTarget(selector);
  if (!target) {
    return;
  }
  const { element, rect } = target;
  const viewportHeight = window.innerHeight;
  if (rect.top >= VIEWPORT_SAFE_MARGIN && rect.bottom <= viewportHeight - VIEWPORT_SAFE_MARGIN) {
    return;
  }
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center",
  });
};

const getAutoPlacement = (
  rect: DOMRect,
  preferred: TipPlacement,
  cardWidth: number,
  cardHeight: number,
) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const canTop = rect.top - CARD_GAP - cardHeight >= EDGE_PADDING;
  const canBottom = rect.bottom + CARD_GAP + cardHeight <= viewportHeight - EDGE_PADDING;
  const canLeft = rect.left - CARD_GAP - cardWidth >= EDGE_PADDING;
  const canRight = rect.right + CARD_GAP + cardWidth <= viewportWidth - EDGE_PADDING;

  if (preferred === "top") {
    if (canTop) {
      return "top";
    }
    if (canBottom) {
      return "bottom";
    }
  }

  if (preferred === "bottom") {
    if (canBottom) {
      return "bottom";
    }
    if (canTop) {
      return "top";
    }
  }

  if (preferred === "left") {
    if (canLeft) {
      return "left";
    }
    if (canRight) {
      return "right";
    }
  }

  if (preferred === "right") {
    if (canRight) {
      return "right";
    }
    if (canLeft) {
      return "left";
    }
  }

  if (canBottom) {
    return "bottom";
  }
  if (canTop) {
    return "top";
  }
  if (canRight) {
    return "right";
  }
  if (canLeft) {
    return "left";
  }

  return "bottom";
};

const buildCardPosition = (rect: DOMRect | null, placement: TipPlacement = "bottom") => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (viewportWidth < MOBILE_BREAKPOINT) {
    return {
      left: EDGE_PADDING,
      top: clamp(
        viewportHeight - CARD_HEIGHT - EDGE_PADDING,
        EDGE_PADDING,
        Math.max(EDGE_PADDING, viewportHeight - CARD_HEIGHT - EDGE_PADDING),
      ),
      width: Math.max(280, viewportWidth - EDGE_PADDING * 2),
    };
  }

  if (!rect) {
    return {
      left: clamp(
        (viewportWidth - CARD_WIDTH) / 2,
        EDGE_PADDING,
        Math.max(EDGE_PADDING, viewportWidth - CARD_WIDTH - EDGE_PADDING),
      ),
      top: clamp(
        viewportHeight * 0.2,
        EDGE_PADDING,
        Math.max(EDGE_PADDING, viewportHeight - CARD_HEIGHT - EDGE_PADDING),
      ),
      width: CARD_WIDTH,
    };
  }

  const resolvedPlacement = getAutoPlacement(rect, placement, CARD_WIDTH, CARD_HEIGHT);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let left = centerX - CARD_WIDTH / 2;
  let top = rect.bottom + CARD_GAP;

  if (resolvedPlacement === "top") {
    top = rect.top - CARD_HEIGHT - CARD_GAP;
  } else if (resolvedPlacement === "left") {
    left = rect.left - CARD_WIDTH - CARD_GAP;
    top = centerY - CARD_HEIGHT / 2;
  } else if (resolvedPlacement === "right") {
    left = rect.right + CARD_GAP;
    top = centerY - CARD_HEIGHT / 2;
  }

  return {
    left: clamp(left, EDGE_PADDING, Math.max(EDGE_PADDING, viewportWidth - CARD_WIDTH - EDGE_PADDING)),
    top: clamp(top, EDGE_PADDING, Math.max(EDGE_PADDING, viewportHeight - CARD_HEIGHT - EDGE_PADDING)),
    width: CARD_WIDTH,
  };
};

const useTargetRect = (selector?: string) => {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    let frame = 0;
    let observedElement: HTMLElement | null = null;

    const update = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        const target = resolveTarget(selector);
        setRect(target?.rect ?? null);
      });
    };

    ensureSelectorVisible(selector);
    update();
    observedElement = document.querySelector<HTMLElement>(selector);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            update();
          })
        : null;

    if (resizeObserver && observedElement) {
      resizeObserver.observe(observedElement);
    }

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      resizeObserver?.disconnect();
    };
  }, [selector]);

  return rect;
};

const useTourFocusTrap = ({
  enabled,
  containerRef,
  onEscape,
}: {
  enabled: boolean;
  containerRef: { current: HTMLElement | null };
  onEscape: () => void;
}) => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const focusFirst = () => {
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
      const first = nodes.find((node) => !node.hasAttribute("disabled"));
      first?.focus();
    };

    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (node) => !node.hasAttribute("disabled"),
      );

      if (!nodes.length) {
        event.preventDefault();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, containerRef, onEscape]);
};

const TourOverlay = ({
  step,
  stepIndex,
  stepCount,
  onBack,
  onNext,
  onSkip,
  isLast,
}: {
  step: GuidanceTourStep;
  stepIndex: number;
  stepCount: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  isLast: boolean;
}) => {
  const t = useTranslations("guidance");
  const tCommon = useTranslations("common");
  const rect = useTargetRect(step.selector);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cardPosition = useMemo(() => buildCardPosition(rect, step.placement), [rect, step.placement]);

  useTourFocusTrap({
    enabled: true,
    containerRef: panelRef,
    onEscape: onSkip,
  });

  return (
    <div className="fixed inset-0 z-[46]" aria-live="polite">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onSkip} />
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-md border border-white/90 shadow-[0_0_0_9999px_rgba(17,24,39,0.45)]"
          style={{
            left: Math.max(rect.left - 6, 0),
            top: Math.max(rect.top - 6, 0),
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="fixed z-[47] max-w-[calc(100vw-24px)]"
        style={cardPosition}
      >
        <Card className="border-gray-200 shadow-2xl">
          <CardHeader className="space-y-2 pb-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("tourProgress", { current: stepIndex + 1, total: stepCount })}
              </p>
              <GuidanceCloseButton label={tCommon("close")} onClick={onSkip} />
            </div>
            <CardTitle className="text-base">{t(step.titleKey)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">{t(step.bodyKey)}</p>
            <GuidanceTourNavButtons
              canGoBack={stepIndex > 0}
              onBack={onBack}
              onNext={onNext}
              onSkip={onSkip}
              nextLabel={isLast ? t("finish") : t("next")}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const TipsOverlay = ({
  tip,
  nextTip,
  onDismiss,
  onNext,
  onOpenTour,
}: {
  tip: GuidanceTipDefinition;
  nextTip: GuidanceTipDefinition | null;
  onDismiss: () => void;
  onNext: () => void;
  onOpenTour: (() => void) | null;
}) => {
  const t = useTranslations("guidance");
  const tCommon = useTranslations("common");
  const rect = useTargetRect(tip.selector);
  const cardPosition = useMemo(() => buildCardPosition(rect, tip.placement), [rect, tip.placement]);

  return (
    <Card
      role="dialog"
      aria-label={t(tip.titleKey)}
      className="fixed z-[45] max-w-[calc(100vw-24px)] border-gray-200 shadow-xl"
      style={cardPosition}
    >
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("tipsBadge")}</p>
          <GuidanceCloseButton label={tCommon("close")} onClick={onDismiss} />
        </div>
        <CardTitle className="text-base">{t(tip.titleKey)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">{t(tip.bodyKey)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="default" className="h-10 px-4 text-sm" onClick={onDismiss}>
            {t("dismiss")}
          </Button>
          {nextTip ? (
            <Button type="button" variant="secondary" size="default" className="h-10 px-4 text-sm" onClick={onNext}>
              {t("nextTip")}
            </Button>
          ) : null}
          {onOpenTour ? (
            <Button type="button" size="default" className="h-10 px-4 text-sm" onClick={onOpenTour}>
              {t("startTour")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

export const GuidanceOverlay = () => {
  const {
    pageTips,
    pageTours,
    toursDisabled,
    activeTourId,
    focusedTipId,
    startTour,
    stopTour,
    completeTour,
    skipTour,
    focusTip,
  } = useGuidance();

  const activeTip = useMemo(() => {
    if (activeTourId) {
      return null;
    }
    if (!focusedTipId) {
      return null;
    }
    return pageTips.find((tip) => tip.id === focusedTipId) ?? null;
  }, [activeTourId, focusedTipId, pageTips]);

  const nextTip = useMemo(() => {
    if (!activeTip) {
      return null;
    }
    const index = pageTips.findIndex((tip) => tip.id === activeTip.id);
    if (index < 0) {
      return null;
    }
    return pageTips[index + 1] ?? null;
  }, [activeTip, pageTips]);

  const activeTour = useMemo(
    () => pageTours.find((tour) => tour.id === activeTourId) ?? null,
    [pageTours, activeTourId],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [availableStepIndexes, setAvailableStepIndexes] = useState<number[]>([]);

  useEffect(() => {
    setStepIndex(0);
    setAvailableStepIndexes([]);
  }, [activeTourId]);

  useEffect(() => {
    if (!activeTour) {
      setAvailableStepIndexes([]);
      return;
    }

    if (!activeTour.steps.length) {
      stopTour();
      return;
    }

    const mountedIndexes = activeTour.steps.reduce<number[]>((acc, step, index) => {
      if (resolveTarget(step.selector)?.rect) {
        acc.push(index);
      }
      return acc;
    }, []);

    if (!mountedIndexes.length) {
      return;
    }

    setAvailableStepIndexes(mountedIndexes);
    if (stepIndex > mountedIndexes.length - 1) {
      setStepIndex(mountedIndexes.length - 1);
      return;
    }
  }, [activeTour, stepIndex, stopTour]);

  const currentStepIndex = availableStepIndexes[stepIndex] ?? null;
  const currentStep =
    activeTour && currentStepIndex !== null ? (activeTour.steps[currentStepIndex] ?? null) : null;

  if (currentStep && activeTour) {
    const onNext = () => {
      if (stepIndex >= availableStepIndexes.length - 1) {
        void completeTour(activeTour.id);
        stopTour();
        return;
      }
      setStepIndex((prev) => prev + 1);
    };

    return (
      <TourOverlay
        step={currentStep}
        stepIndex={stepIndex}
        stepCount={availableStepIndexes.length}
        onBack={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
        onNext={onNext}
        onSkip={() => {
          void skipTour(activeTour.id);
          stopTour();
        }}
        isLast={stepIndex >= availableStepIndexes.length - 1}
      />
    );
  }

  if (!activeTip) {
    return null;
  }

  const openPageTour = toursDisabled ? null : (pageTours[0] ?? null);

  return (
    <TipsOverlay
      tip={activeTip}
      nextTip={nextTip}
      onDismiss={() => {
        focusTip(null);
      }}
      onNext={() => {
        if (!nextTip) {
          focusTip(null);
          return;
        }
        focusTip(nextTip.id);
      }}
      onOpenTour={openPageTour ? () => startTour(openPageTour.id) : null}
    />
  );
};
