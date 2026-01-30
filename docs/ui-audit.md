# UI Audit Checklist

- Login entrypoints: before missing secondary actions → after signup/request access + invite entry visible.
- Signup invite-only view: before no invite hint → after “Have an invite?” link to `/invite`.
- Form spacing: before large vertical gaps → after compact `gap-3/4` stacks and no empty FormMessage space.
- Table actions: before mixed text actions → after icon buttons with aria-labels + tooltips/title.
- Mobile (375px): before unverified → after auth and core list pages checked for wrapping and reachability.
