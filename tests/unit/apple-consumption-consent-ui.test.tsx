// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ru from "../../messages/ru.json";
import kg from "../../messages/kg.json";
import en from "../../messages/en.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppleConsumptionConsent, AppleConsumptionRevocations, APPLE_CONSUMPTION_POLICY_VERSION, type AppleConsumptionConsentState } from "@/components/billing/apple-consumption-consent";

type PersonalData = { viewerUserId: string; policyVersion: string; consents: { consentId: string; policyVersion: string; consented: boolean; grantedAt: string | null; revokedAt: string | null }[] };
const mock = vi.hoisted(() => ({
  session: { user: { id: "buyer-a", organizationId: "org-a", role: "ADMIN" } },
  authStatus: "authenticated",
  consent: vi.fn(), updated: vi.fn(),
  personalData: undefined as PersonalData | undefined,
  personalLoading: false, personalError: null as null | Error,
  personalQuery: vi.fn(), refetchPersonal: vi.fn(),
  revokePersonal: vi.fn(), setPersonal: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: mock.session, status: mock.authStatus }) }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  billing: { apple: {
    consumptionConsent: { useMutation: () => ({ mutateAsync: mock.consent }) },
    personalConsumptionConsents: { useQuery: (input: unknown, options: unknown) => {
      mock.personalQuery(input, options);
      return { data: mock.personalData, isLoading: mock.personalLoading, isError: Boolean(mock.personalError), error: mock.personalError, refetch: mock.refetchPersonal };
    } },
    revokePersonalConsumptionConsent: { useMutation: () => ({ mutateAsync: mock.revokePersonal }) },
  } },
  useUtils: () => ({ billing: { apple: { personalConsumptionConsents: { setData: mock.setPersonal } } } }),
} }));

const copy = { ru, kg, en };
const transactionId = "9007199254740993001";
const state = (overrides: Partial<AppleConsumptionConsentState> = {}): AppleConsumptionConsentState => ({
  viewerUserId: "buyer-a", availableToViewer: true, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION,
  canManage: true, canRevoke: false, consented: false, valid: false,
  grantedAt: null, revokedAt: null, deliveryStatus: null, sampleContentProvided: null,
  invalidReason: "appleConsumptionConsentRequired", responseStatus: null, lastIssue: null,
  ...overrides,
});
const props = (value = state()) => ({ organizationId: "org-a", organizationName: "Synthetic organization A", transactionId, environment: "Sandbox", state: value, onUpdated: mock.updated });
const acknowledgement = (value = state({ consented: true, canRevoke: true, valid: true, grantedAt: "2026-11-13T12:00:00Z", deliveryStatus: "DELIVERED", sampleContentProvided: false, invalidReason: null })) => ({
  organizationId: "org-a", transactionId, environment: "Sandbox", consumptionConsent: value,
});
const personal = (overrides: Partial<PersonalData> = {}): PersonalData => ({
  viewerUserId: "buyer-a", policyVersion: APPLE_CONSUMPTION_POLICY_VERSION,
  consents: [{ consentId: "own-consent-a", policyVersion: APPLE_CONSUMPTION_POLICY_VERSION, consented: true, grantedAt: "2026-11-13T12:00:00Z", revokedAt: null }],
  ...overrides,
});
const wrap = (node: React.ReactNode, locale: keyof typeof copy = "ru") => <NextIntlClientProvider locale={locale} messages={copy[locale]} timeZone="Asia/Bishkek"><TooltipProvider>{node}</TooltipProvider></NextIntlClientProvider>;
const mount = (value = state(), locale: keyof typeof copy = "ru") => render(wrap(<AppleConsumptionConsent {...props(value)} />, locale));
const open = async (locale: keyof typeof copy = "ru") => {
  fireEvent.click(screen.getByRole("button", { name: copy[locale].appleConsumption.manage }));
  return within(await screen.findByRole("dialog"));
};
const choose = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
};
const answer = async (locale: keyof typeof copy = "ru", unknown = false) => {
  const t = copy[locale].appleConsumption;
  await choose(t.deliveryQuestion, unknown ? t.delivery.UNKNOWN : t.delivery.DELIVERED);
  await choose(t.sampleQuestion, unknown ? t.sample.unknown : t.sample.no);
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  vi.resetAllMocks();
  mock.session = { user: { id: "buyer-a", organizationId: "org-a", role: "ADMIN" } };
  mock.authStatus = "authenticated";
  mock.consent.mockResolvedValue(acknowledgement());
  mock.updated.mockResolvedValue(undefined);
  mock.personalData = personal(); mock.personalLoading = false; mock.personalError = null;
  mock.refetchPersonal.mockResolvedValue({ data: mock.personalData });
  mock.revokePersonal.mockResolvedValue(personal({ consents: [] }));
  mock.setPersonal.mockImplementation((_input, result: PersonalData) => { mock.personalData = result; });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Element.prototype.scrollIntoView = originalScrollIntoView; });

describe("separate purchaser consent for Apple refund information", () => {
  it.each(["ru", "kg", "en"] as const)("requires explicit consent and answers in %s and binds the server choice to the exact purchase", async locale => {
    const t = copy[locale].appleConsumption;
    const pending = deferred<ReturnType<typeof acknowledgement>>();
    mock.consent.mockReturnValue(pending.promise);
    mount(state(), locale);
    const dialog = await open(locale);
    expect(dialog.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect((dialog.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(true);
    for (const key of ["optional", "disclosure", "classification", "choice"] as const) expect(dialog.getByText(t[key])).toBeTruthy();
    expect(dialog.getByRole("link", { name: t.privacy }).getAttribute("href")).toBe("/privacy#apple-refund-data");
    fireEvent.click(dialog.getByRole("checkbox"));
    expect((dialog.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(true);
    await answer(locale);
    fireEvent.click(dialog.getByRole("button", { name: t.save }));
    expect(mock.consent).toHaveBeenCalledTimes(1);
    expect(mock.consent).toHaveBeenCalledWith({ expectedOrganizationId: "org-a", transactionId, environment: "Sandbox", consented: true,
      policyVersion: APPLE_CONSUMPTION_POLICY_VERSION, deliveryStatus: "DELIVERED", sampleContentProvided: false });
    expect(screen.queryByText(t.granted)).toBeNull();
    expect(mock.updated).not.toHaveBeenCalled();
    await act(async () => pending.resolve(acknowledgement()));
    await screen.findByText(t.granted);
    expect(screen.getByText(t.saved)).toBeTruthy();
    expect(mock.updated).toHaveBeenCalledTimes(1);
    const reopened = await open(locale);
    expect(reopened.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps unknown purchaser answers explicit and never presents stored incomplete consent as valid", async () => {
    mock.consent.mockResolvedValue(acknowledgement(state({ consented: true, canRevoke: true, valid: false,
      invalidReason: "appleConsumptionEvidenceRequired", responseStatus: "WAITING_EVIDENCE" })));
    mount();
    const dialog = await open();
    await answer("ru", true);
    fireEvent.click(dialog.getByRole("checkbox"));
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.save }));
    await screen.findByText(ru.appleConsumption.needsEvidence);
    expect(mock.consent.mock.calls[0][0]).toMatchObject({ consented: true, deliveryStatus: null, sampleContentProvided: null });
    expect(screen.queryByText(ru.appleConsumption.granted)).toBeNull();
    expect(screen.getByText(ru.appleConsumption.savedWaiting)).toBeTruthy();
  });

  it("allows declining without selecting answers or checking consent", async () => {
    mock.consent.mockResolvedValue(acknowledgement(state({ revokedAt: "2026-11-13T12:00:00Z" })));
    mount();
    const dialog = await open();
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.decline }));
    await screen.findByText(ru.appleConsumption.withdrawn);
    expect(mock.consent).toHaveBeenCalledWith({ expectedOrganizationId: "org-a", transactionId, environment: "Sandbox", consented: false, policyVersion: APPLE_CONSUMPTION_POLICY_VERSION });
  });

  it("keeps rejected consent unsaved, localizes the failure, and supports an explicit retry", async () => {
    mock.consent.mockRejectedValueOnce(new Error("appleConsumptionDeliveryMismatch"));
    mount();
    const dialog = await open();
    await answer();
    fireEvent.click(dialog.getByRole("checkbox"));
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.save }));
    await screen.findByText(ru.errors.appleConsumptionDeliveryMismatch);
    expect(screen.queryByText(ru.appleConsumption.granted)).toBeNull();
    expect(mock.updated).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.save }));
    await screen.findByText(ru.appleConsumption.saved);
    expect(mock.consent).toHaveBeenCalledTimes(2);
  });

  it("does not trust an acknowledgement bound to another organization", async () => {
    mock.consent.mockResolvedValue({ ...acknowledgement(), organizationId: "org-b" });
    mount();
    const dialog = await open(); await answer(); fireEvent.click(dialog.getByRole("checkbox"));
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.save }));
    await screen.findByText(ru.errors.appleConsumptionConsentUnconfirmed);
    expect(screen.queryByText(ru.appleConsumption.granted)).toBeNull();
    expect(mock.updated).not.toHaveBeenCalled();
  });

  it.each(["organization", "viewer", "role"])("ignores an in-flight save after a %s change", async changed => {
    const pending = deferred<ReturnType<typeof acknowledgement>>(); mock.consent.mockReturnValue(pending.promise);
    const view = mount(); const dialog = await open(); await answer(); fireEvent.click(dialog.getByRole("checkbox"));
    fireEvent.click(dialog.getByRole("button", { name: ru.appleConsumption.save }));
    if (changed === "organization") mock.session.user.organizationId = "org-b";
    if (changed === "viewer") mock.session.user.id = "buyer-b";
    if (changed === "role") mock.session.user.role = "STAFF";
    view.rerender(wrap(<AppleConsumptionConsent {...props()} />));
    await act(async () => pending.resolve(acknowledgement()));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(ru.appleConsumption.granted)).toBeNull();
    expect(screen.queryByText(ru.appleConsumption.saved)).toBeNull();
    expect(screen.queryByRole("button", { name: ru.appleConsumption.manage })).toBeNull();
    expect(mock.updated).not.toHaveBeenCalled();
  });

  it("hides another purchaser’s consent entirely and does not reveal stale viewer dates or answers", () => {
    const secretDate = "2021-01-02T12:00:00Z";
    const view = mount(state({ availableToViewer: false }));
    expect(view.container.querySelector("[data-apple-consumption-consent]")).toBeNull();
    view.rerender(wrap(<AppleConsumptionConsent {...props(state({ viewerUserId: "buyer-b", consented: true, valid: true, grantedAt: secretDate, responseStatus: "SENT" }))} />));
    expect(screen.getByText(ru.appleConsumption.refreshIdentity)).toBeTruthy();
    expect(screen.queryByText(ru.appleConsumption.granted)).toBeNull();
    expect(screen.queryByText(ru.appleConsumption.responses.SENT)).toBeNull();
    expect(view.container.textContent).not.toContain("2021");
    expect(screen.queryByRole("button", { name: ru.appleConsumption.manage })).toBeNull();
  });

  it("allows the original active STAFF buyer to withdraw while keeping grants unavailable", async () => {
    mock.session.user.role = "STAFF";
    mock.consent.mockResolvedValue(acknowledgement(state({ canManage: false, revokedAt: "2026-11-13T12:00:00Z" })));
    mount(state({ canManage: false, canRevoke: true, consented: true, valid: false, invalidReason: "appleConsumptionConsentInactive" }));
    expect(screen.queryByRole("button", { name: ru.appleConsumption.manage })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ru.appleConsumption.revoke }));
    await screen.findByText(ru.appleConsumption.withdrawn);
    expect(mock.consent.mock.calls[0][0].consented).toBe(false);
  });

  it("does not expose controls on an unsupported policy/environment and does not display raw response codes", () => {
    const view = render(wrap(<AppleConsumptionConsent {...props(state({ policyVersion: "future-policy", responseStatus: "INTERNAL_UNRECOGNIZED_STATE" }))} environment="Unverified" />));
    expect(screen.queryByRole("button", { name: ru.appleConsumption.manage })).toBeNull();
    expect(screen.getByText(ru.appleConsumption.responseUnknown)).toBeTruthy();
    expect(view.container.textContent).not.toContain("INTERNAL_UNRECOGNIZED_STATE");
    expect(mock.consent).not.toHaveBeenCalled();
  });
});

describe("personal consent withdrawal without financial permissions", () => {
  it("offers only personal withdrawal to STAFF after an organization change", async () => {
    mock.session.user.role = "STAFF"; mock.session.user.organizationId = "org-b";
    const view = render(wrap(<AppleConsumptionRevocations />));
    expect(mock.personalQuery).toHaveBeenCalledWith(undefined, expect.objectContaining({ enabled: true }));
    expect(screen.queryByRole("button", { name: ru.appleConsumption.manage })).toBeNull();
    expect(view.container.textContent).not.toContain(transactionId);
    expect(view.container.textContent).not.toContain("Synthetic organization A");
    fireEvent.click(screen.getByRole("button", { name: ru.appleConsumption.revoke }));
    await screen.findByText(ru.appleConsumption.withdrawn);
    expect(mock.revokePersonal).toHaveBeenCalledWith({ consentId: "own-consent-a" });
    expect(mock.setPersonal).toHaveBeenCalledWith(undefined, personal({ consents: [] }));
    expect(mock.consent).not.toHaveBeenCalled();
    view.rerender(wrap(<AppleConsumptionRevocations />));
    expect(screen.getByText(ru.appleConsumption.personalEmpty)).toBeTruthy();
  });

  it("hides cached consents from another viewer and ignores a stale withdrawal response", async () => {
    const pending = deferred<PersonalData>(); mock.revokePersonal.mockReturnValue(pending.promise);
    const view = render(wrap(<AppleConsumptionRevocations />));
    fireEvent.click(screen.getByRole("button", { name: ru.appleConsumption.revoke }));
    mock.session.user.id = "buyer-b";
    view.rerender(wrap(<AppleConsumptionRevocations />));
    expect(screen.getByText(ru.appleConsumption.refreshIdentity)).toBeTruthy();
    expect(screen.queryByRole("button", { name: ru.appleConsumption.revoke })).toBeNull();
    expect(view.container.textContent).not.toContain("2026");
    await act(async () => pending.resolve(personal({ consents: [] })));
    expect(mock.setPersonal).not.toHaveBeenCalled();
    expect(screen.queryByText(ru.appleConsumption.withdrawn)).toBeNull();
  });

  it("keeps withdrawal pending until the server confirms, then permits retry after a transport error", async () => {
    const pending = deferred<PersonalData>(); mock.revokePersonal.mockReturnValueOnce(pending.promise);
    render(wrap(<AppleConsumptionRevocations />));
    const button = screen.getByRole("button", { name: ru.appleConsumption.revoke }) as HTMLButtonElement;
    fireEvent.click(button); expect(button.disabled).toBe(true);
    expect(mock.setPersonal).not.toHaveBeenCalled(); expect(screen.queryByText(ru.appleConsumption.withdrawn)).toBeNull();
    await act(async () => pending.resolve(personal()));
    await screen.findByText(ru.errors.appleConsumptionConsentUnconfirmed);
    expect(mock.setPersonal).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    mock.revokePersonal.mockRejectedValueOnce(new Error("provider-private-diagnostic"));
    fireEvent.click(button); await screen.findByText(ru.appleConsumption.saveFailed);
    expect(screen.queryByText("provider-private-diagnostic")).toBeNull();
    fireEvent.click(button); await screen.findByText(ru.appleConsumption.withdrawn);
    expect(mock.revokePersonal).toHaveBeenCalledTimes(3);
  });

  it("renders loading, error with retry, empty and signed-out states without consent writes", async () => {
    mock.personalLoading = true; mock.personalData = undefined;
    const view = render(wrap(<AppleConsumptionRevocations />));
    expect(screen.getByText(ru.common.loading)).toBeTruthy();
    mock.personalLoading = false; mock.personalError = new Error("appleConsumptionOutcomeUnknown");
    view.rerender(wrap(<AppleConsumptionRevocations />));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ru.common.tryAgain }));
    expect(mock.refetchPersonal).toHaveBeenCalled();
    mock.personalError = null; mock.personalData = personal({ consents: [] });
    view.rerender(wrap(<AppleConsumptionRevocations />));
    expect(screen.getByText(ru.appleConsumption.personalEmpty)).toBeTruthy();
    mock.authStatus = "unauthenticated"; view.rerender(wrap(<AppleConsumptionRevocations />));
    await waitFor(() => expect(view.container.textContent).toBe(""));
    expect(mock.revokePersonal).not.toHaveBeenCalled(); expect(mock.consent).not.toHaveBeenCalled();
  });
});
