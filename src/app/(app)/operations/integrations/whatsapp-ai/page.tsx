"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { DeleteIcon } from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { WHATSAPP_STYLES } from "@/lib/whatsapp-ai";
import { Conversations, Costs } from "./workspace-panels";
import { Choice, Field, useFeedback, type Workspace } from "./workspace-ui";

function Editor({
  storeId,
  data,
  reload,
}: {
  storeId: string;
  data: Workspace;
  reload: () => Promise<unknown>;
}) {
  const t = useTranslations("whatsappAi"),
    locale = useLocale(),
    feedback = useFeedback();
  const platformOwner = useSession().data?.user?.isPlatformOwner === true;
  const params = useSearchParams();
  const [tab, setTab] = useState(
      /^wa_[a-f0-9]{32}$/.test(params.get("invoice") ?? "") ? "costs" : "connection",
    ),
    [profile, setProfile] = useState(data.profile),
    [knowledge, setKnowledge] = useState(data.knowledge);
  const [version, setVersion] = useState(data.connection?.configVersion ?? null),
    [confirmed, setConfirmed] = useState(data.connection?.knowledgePublished ?? false);
  const [dirty, setDirty] = useState(false),
    [link, setLink] = useState(""),
    [nonce, setNonce] = useState("");
  const [preview, setPreview] = useState(""),
    [previewResult, setPreviewResult] = useState("");
  useEffect(() => {
    setNonce(sessionStorage.getItem(`wa-onboarding:${storeId}`) ?? "");
  }, [storeId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = trpc.whatsappAi.save.useMutation({ onError: feedback.error });
  const begin = trpc.whatsappAi.begin.useMutation({ onError: feedback.error });
  const finish = trpc.whatsappAi.finish.useMutation({ onError: feedback.error });
  const enable = trpc.whatsappAi.enable.useMutation({ onError: feedback.error });
  const test = trpc.whatsappAi.preview.useMutation({ onError: feedback.error });
  const updateProfile = <K extends keyof typeof profile>(key: K, value: (typeof profile)[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };
  const updateKnowledge = <K extends keyof typeof knowledge>(
    key: K,
    value: (typeof knowledge)[K],
  ) => {
    setKnowledge((k) => ({ ...k, [key]: value }));
    setConfirmed(false);
    setDirty(true);
  };
  const editable = data.entitled && data.active;
  const saveAll = async () => {
    try {
      await save.mutateAsync({
        storeId,
        expectedVersion: version,
        profile,
        knowledge,
        knowledgeConfirmed: confirmed,
      });
      await syncFresh();
      feedback.success();
    } catch {
      /* Mutation exposes the localized error; the draft stays intact. */
    }
  };
  const utils = trpc.useUtils();
  const trpcClientRefetch = async () => {
    await utils.whatsappAi.workspace.invalidate({ storeId });
    await reload();
    return utils.whatsappAi.workspace.getData({ storeId });
  };
  const syncFresh = async () => {
    const fresh = await trpcClientRefetch();
    if (fresh) {
      setVersion(fresh.connection?.configVersion ?? null);
      setProfile(fresh.profile);
      setKnowledge(fresh.knowledge);
      setConfirmed(fresh.connection?.knowledgePublished ?? false);
    }
    setDirty(false);
  };
  return (
    <div className="space-y-4">
      {!editable && (
        <Card>
          <CardContent className="p-4 text-sm">{t("planRequired")}</CardContent>
        </Card>
      )}
      <Tabs>
        <TabsList className="overflow-x-auto" aria-label={t("title")}>
          {["connection", "assistant", "conversations", "knowledge", "costs"].map((value) => (
            <TabsTrigger
              id={`wa-tab-${value}`}
              aria-controls={`wa-panel-${value}`}
              key={value}
              active={tab === value}
              onClick={() => setTab(value)}
            >
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsPanel
          hidden={tab === "conversations"}
          id={`wa-panel-${tab === "conversations" ? "inactive" : tab}`}
          aria-labelledby={`wa-tab-${tab}`}
        >
          {tab === "connection" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t("connectionTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Badge variant={data.connection?.state === "CONNECTED" ? "success" : "muted"}>
                    {t(`states.${data.connection?.state ?? "DRAFT"}`)}
                  </Badge>
                  {data.connection?.phone && (
                    <p className="font-medium">+{data.connection.phone}</p>
                  )}
                  <p className="text-sm text-muted-foreground">{t("connectHelp")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        !editable ||
                        !data.canConnect ||
                        !data.readiness.onboardingReady ||
                        begin.isLoading ||
                        dirty
                      }
                      onClick={async () => {
                        try {
                          const result = await begin.mutateAsync({
                            storeId,
                            locale: locale as "ru" | "kg" | "en",
                          });
                          setLink(result.link);
                          setNonce(result.state);
                          sessionStorage.setItem(`wa-onboarding:${storeId}`, result.state);
                          await reload();
                        } catch {
                          /* Keep retry available. */
                        }
                      }}
                    >
                      {t("connect")}
                    </Button>
                    {link && (
                      <Button asChild variant="secondary">
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          {t("openSetup")}
                        </a>
                      </Button>
                    )}
                    {nonce && (
                      <Button
                        variant="secondary"
                        disabled={finish.isLoading || dirty}
                        onClick={async () => {
                          try {
                            await finish.mutateAsync({ storeId, state: nonce });
                            sessionStorage.removeItem(`wa-onboarding:${storeId}`);
                            setNonce("");
                            setLink("");
                            await syncFresh();
                            feedback.success();
                          } catch {
                            /* Do not consume local state after an unsuccessful check. */
                          }
                        }}
                      >
                        {t("finishSetup")}
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-md bg-secondary p-3">
                    <Label htmlFor="wa-enabled">{t("enabled")}</Label>
                    <Switch
                      id="wa-enabled"
                      checked={data.connection?.aiEnabled ?? false}
                      disabled={
                        dirty ||
                        enable.isLoading ||
                        (!data.connection?.aiEnabled &&
                          (!editable ||
                            !data.readiness.ready ||
                            !data.readiness.workerReady ||
                            !data.connection?.knowledgePublished ||
                            !data.connection.lastWebhookAt))
                      }
                      onCheckedChange={async (enabled) => {
                        try {
                          await enable.mutateAsync({ storeId, enabled });
                          await syncFresh();
                        } catch {
                          /* Keep actual server state. */
                        }
                      }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">{t("switchHelp")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("readiness")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>{data.readiness.workerReady ? t("workerReady") : t("workerMissing")}</p>
                  {platformOwner
                    ? data.readiness.reasons.map((reason) => (
                        <p key={reason} className="rounded-md bg-secondary p-3">
                          {t(`reasons.${reason}`)}
                        </p>
                      ))
                    : !data.readiness.ready && (
                        <p className="rounded-md bg-secondary p-3">{t("platformPreparing")}</p>
                      )}
                  {data.readiness.ready && <p>{t("pilotReady")}</p>}
                  <p className="text-muted-foreground">{t("scope")}</p>
                </CardContent>
              </Card>
            </div>
          )}
          {(tab === "assistant" || tab === "knowledge") && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>{t(`tabs.${tab}`)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {tab === "assistant" ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Choice
                          label={t("style")}
                          value={profile.style}
                          onChange={(v) => updateProfile("style", v as typeof profile.style)}
                          options={WHATSAPP_STYLES.map((value) => ({
                            value,
                            label: t(`styles.${value}`),
                          }))}
                          disabled={!editable}
                        />
                        <Choice
                          label={t("language")}
                          value={profile.language}
                          onChange={(v) => updateProfile("language", v as typeof profile.language)}
                          options={["auto", "ru", "kg", "en"].map((value) => ({
                            value,
                            label: t(`languages.${value}`),
                          }))}
                          disabled={!editable}
                        />
                        <Choice
                          label={t("addressForm")}
                          value={profile.addressForm}
                          onChange={(v) =>
                            updateProfile("addressForm", v as typeof profile.addressForm)
                          }
                          options={["formal", "informal"].map((value) => ({
                            value,
                            label: t(value),
                          }))}
                          disabled={!editable}
                        />
                        <Choice
                          label={t("length")}
                          value={profile.length}
                          onChange={(v) => updateProfile("length", v as typeof profile.length)}
                          options={["short", "normal", "detailed"].map((value) => ({
                            value,
                            label: t(value),
                          }))}
                          disabled={!editable}
                        />
                      </div>
                      <Field label={t("assistantName")}>
                        <Input
                          value={profile.assistantName}
                          maxLength={60}
                          disabled={!editable}
                          onChange={(e) => updateProfile("assistantName", e.target.value)}
                        />
                      </Field>
                      <Field label={t("instructions")}>
                        <Textarea
                          value={profile.instructions}
                          maxLength={1000}
                          disabled={!editable}
                          onChange={(e) => updateProfile("instructions", e.target.value)}
                        />
                      </Field>
                      <Field label={t("greeting")}>
                        <Input
                          value={profile.greeting}
                          maxLength={300}
                          disabled={!editable}
                          onChange={(e) => updateProfile("greeting", e.target.value)}
                        />
                      </Field>
                      <Field label={t("farewell")}>
                        <Input
                          value={profile.farewell}
                          maxLength={200}
                          disabled={!editable}
                          onChange={(e) => updateProfile("farewell", e.target.value)}
                        />
                      </Field>
                      <div className="flex items-center gap-3">
                        <Switch
                          id="wa-emoji"
                          checked={profile.emoji}
                          disabled={!editable}
                          onCheckedChange={(v) => updateProfile("emoji", v)}
                        />
                        <Label htmlFor="wa-emoji">{t("emoji")}</Label>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t("knowledgeHelp")}</p>
                      {(
                        [
                          "storeName",
                          "address",
                          "hours",
                          "contacts",
                          "payments",
                          "delivery",
                          "returns",
                        ] as const
                      ).map((key) => (
                        <Field key={key} label={t(`knowledge.${key}`)}>
                          <Textarea
                            value={knowledge[key]}
                            maxLength={
                              key === "storeName"
                                ? 120
                                : key === "address" || key === "hours" || key === "contacts"
                                  ? 500
                                  : key === "payments"
                                    ? 600
                                    : 800
                            }
                            disabled={!editable}
                            onChange={(e) => updateKnowledge(key, e.target.value)}
                          />
                        </Field>
                      ))}
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">{t("faq")}</h3>
                        {knowledge.faq.map((row, index) => (
                          <div key={index} className="space-y-2 rounded-md border p-3">
                            <Field label={t("question")}>
                              <Input
                                value={row.question}
                                maxLength={200}
                                disabled={!editable}
                                onChange={(e) =>
                                  updateKnowledge(
                                    "faq",
                                    knowledge.faq.map((v, i) =>
                                      i === index ? { ...v, question: e.target.value } : v,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Field label={t("answer")}>
                              <Textarea
                                value={row.answer}
                                maxLength={800}
                                disabled={!editable}
                                onChange={(e) =>
                                  updateKnowledge(
                                    "faq",
                                    knowledge.faq.map((v, i) =>
                                      i === index ? { ...v, answer: e.target.value } : v,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <IconButton
                              icon={DeleteIcon}
                              label={t("removeFaq")}
                              variant="ghost"
                              disabled={!editable}
                              onClick={() =>
                                updateKnowledge(
                                  "faq",
                                  knowledge.faq.filter((_, i) => i !== index),
                                )
                              }
                            />
                          </div>
                        ))}
                        <Button
                          variant="secondary"
                          disabled={!editable || knowledge.faq.length >= 20}
                          onClick={() =>
                            updateKnowledge("faq", [...knowledge.faq, { question: "", answer: "" }])
                          }
                        >
                          {t("addFaq")}
                        </Button>
                      </div>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="wa-confirm"
                          checked={confirmed}
                          disabled={!editable}
                          onCheckedChange={(v) => {
                            setConfirmed(v === true);
                            setDirty(true);
                          }}
                        />
                        <Label htmlFor="wa-confirm" className="leading-5">
                          {t("confirmKnowledge")}
                        </Label>
                      </div>
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={
                        !editable ||
                        !dirty ||
                        save.isLoading ||
                        !knowledge.storeName.trim() ||
                        !profile.assistantName.trim() ||
                        knowledge.faq.some((row) => !row.question.trim() || !row.answer.trim())
                      }
                      onClick={() => void saveAll()}
                    >
                      {save.isLoading ? t("saving") : t("save")}
                    </Button>
                    {dirty && <span className="text-sm text-muted-foreground">{t("unsaved")}</span>}
                  </div>
                </CardContent>
              </Card>
              <Card className="self-start">
                <CardHeader>
                  <CardTitle>{t("preview")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{t("previewHelp")}</p>
                  {!data.readiness.previewReady && (
                    <p className="text-sm text-muted-foreground">{t("previewUnavailable")}</p>
                  )}
                  <Field label={t("testMessage")}>
                    <Textarea
                      value={preview}
                      maxLength={1000}
                      onChange={(e) => setPreview(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={
                      dirty ||
                      !confirmed ||
                      !editable ||
                      !data.readiness.previewReady ||
                      !preview.trim() ||
                      test.isLoading
                    }
                    onClick={async () => {
                      try {
                        const result = await test.mutateAsync({ storeId, message: preview });
                        setPreviewResult(result.body);
                      } catch {
                        setPreviewResult("");
                      }
                    }}
                  >
                    {test.isLoading ? t("thinking") : t("test")}
                  </Button>
                  {previewResult && (
                    <div
                      role="status"
                      className="whitespace-pre-wrap break-words rounded-md bg-secondary p-4 text-sm leading-6"
                    >
                      {previewResult}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          {tab === "costs" && <Costs storeId={storeId} data={data} reload={reload} />}
        </TabsPanel>
        <TabsPanel
          hidden={tab !== "conversations"}
          id="wa-panel-conversations"
          aria-labelledby="wa-tab-conversations"
        >
          <Conversations storeId={storeId} data={data} active={tab === "conversations"} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}

export default function WhatsAppAiPage() {
  const t = useTranslations("whatsappAi"),
    { data: session } = useSession();
  const allowed = session?.user?.role === "ADMIN" || session?.user?.role === "MANAGER";
  const stores = trpc.whatsappAi.stores.useQuery(undefined, { enabled: allowed });
  const [selected, setSelected] = useState(""),
    [pendingStore, setPendingStore] = useState("");
  const storeId = selected || stores.data?.[0]?.id || "";
  const workspace = trpc.whatsappAi.workspace.useQuery(
    { storeId },
    { enabled: allowed && Boolean(storeId), refetchInterval: 15_000 },
  );
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t("accessDenied")}</p>
      ) : (
        <>
          {stores.error && (
            <QueryErrorState error={stores.error} onRetry={() => void stores.refetch()} />
          )}
          {stores.isLoading && <p>{t("loading")}</p>}
          {stores.data?.length === 0 && <p>{t("noStores")}</p>}
          {Boolean(stores.data?.length) && (
            <div className="max-w-md">
              <Choice
                label={t("store")}
                value={storeId}
                options={stores.data!.map((s) => ({ value: s.id, label: s.name }))}
                onChange={setPendingStore}
              />
            </div>
          )}
          {workspace.error && (
            <QueryErrorState error={workspace.error} onRetry={() => void workspace.refetch()} />
          )}
          {workspace.isLoading && Boolean(storeId) && <p>{t("loading")}</p>}
          {workspace.data && !workspace.error && (
            <Editor
              key={storeId}
              storeId={storeId}
              data={workspace.data}
              reload={() => workspace.refetch()}
            />
          )}
          <Dialog
            open={Boolean(pendingStore)}
            onOpenChange={(open) => {
              if (!open) setPendingStore("");
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("changeStore")}</DialogTitle>
              </DialogHeader>
              <p className="text-sm">{t("changeStoreHelp")}</p>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setPendingStore("")}>
                  {t("cancel")}
                </Button>
                <Button
                  onClick={() => {
                    setSelected(pendingStore);
                    setPendingStore("");
                  }}
                >
                  {t("continue")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
