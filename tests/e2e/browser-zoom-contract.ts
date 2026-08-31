/**
 * Chrome's headless page keyboard API cannot address browser-chrome zoom controls. These
 * profiles reproduce browser zoom at the renderer boundary instead: the layout viewport is
 * divided by the zoom factor, DPR is multiplied by it, the physical screen stays unchanged,
 * and pinch/page scale remains 1. That is the reflow behavior exercised by desktop Chrome at
 * 200% browser zoom, rather than CSS `zoom` or a visual-only transform.
 */
export const browserZoomPercent = 200 as const;
export const browserZoomFactor = browserZoomPercent / 100;

export const browserZoomProfiles = {
  desktop: {
    name: "1280x900 desktop at 200%",
    cssWidth: 640,
    cssHeight: 450,
    physicalWidth: 1280,
    physicalHeight: 900,
  },
  wideTable: {
    name: "1920x1080 desktop at 200%",
    cssWidth: 960,
    cssHeight: 540,
    physicalWidth: 1920,
    physicalHeight: 1080,
  },
  narrow: {
    name: "640x1136 narrow window at 200%",
    cssWidth: 320,
    cssHeight: 568,
    physicalWidth: 640,
    physicalHeight: 1136,
  },
} as const;

export type BrowserZoomProfile = (typeof browserZoomProfiles)[keyof typeof browserZoomProfiles];

export const browserZoomMetricsOverride = (profile: BrowserZoomProfile) => ({
  width: profile.cssWidth,
  height: profile.cssHeight,
  deviceScaleFactor: browserZoomFactor,
  mobile: false,
  screenWidth: profile.physicalWidth,
  screenHeight: profile.physicalHeight,
  positionX: 0,
  positionY: 0,
  dontSetVisibleSize: false,
});
