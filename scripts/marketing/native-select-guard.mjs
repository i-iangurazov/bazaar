import assert from "node:assert/strict";

// Radix renders this form mirror during SSR, before the trigger ref establishes
// that the Select is outside a form. It must never become a second user control.
export function isHiddenRadixSelect(profile) {
  return (
    profile.tagName === "SELECT" &&
    profile.ariaHidden === "true" &&
    profile.tabIndex === -1 &&
    profile.active === false &&
    profile.position === "absolute" &&
    profile.width === "1px" &&
    profile.height === "1px" &&
    profile.rectWidth === 1 &&
    profile.rectHeight === 1 &&
    profile.borderWidth === "0px" &&
    profile.padding === "0px" &&
    profile.margin === "-1px" &&
    profile.overflow === "hidden" &&
    ["rect(0px,0px,0px,0px)", "rect(0,0,0,0)"].includes(profile.clip.replace(/\s/g, "")) &&
    profile.whiteSpace === "nowrap"
  );
}

export function assertOnlyHiddenNativeSelects(profiles, label) {
  for (const profile of profiles) {
    assert(
      isHiddenRadixSelect(profile),
      `${label}: native select must be an inaccessible, clipped Radix form mirror: ${JSON.stringify(profile)}`,
    );
  }
}

// These controls also run before every landing browser matrix. A native select
// does not become acceptable merely by adding aria-hidden or shrinking to 1px.
export function verifyNativeSelectGuard() {
  const mirror = {
    tagName: "SELECT",
    ariaHidden: "true",
    tabIndex: -1,
    active: false,
    position: "absolute",
    width: "1px",
    height: "1px",
    rectWidth: 1,
    rectHeight: 1,
    borderWidth: "0px",
    padding: "0px",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0px, 0px, 0px, 0px)",
    whiteSpace: "nowrap",
  };
  assertOnlyHiddenNativeSelects([], "No native select");
  assertOnlyHiddenNativeSelects([mirror], "Radix form mirror");
  for (const [name, override] of [
    ["visible native select", { width: "96px", height: "40px", rectWidth: 96, rectHeight: 40, clip: "auto" }],
    ["tabbable mirror", { tabIndex: 0 }],
    ["focused mirror", { active: true }],
    ["exposed mirror", { ariaHidden: null }],
    ["unclipped 1px select", { clip: "auto" }],
    ["nonzero clipping", { clip: "rect(0px, 1px, 1px, 0px)" }],
    ["overflow-visible select", { overflow: "visible" }],
    ["layout-participating select", { position: "static" }],
    ["larger rendered select", { rectWidth: 96 }],
  ]) {
    assert.throws(
      () => assertOnlyHiddenNativeSelects([mirror, { ...mirror, ...override }], name),
      { code: "ERR_ASSERTION" },
      `Reject ${name}`,
    );
  }
}
