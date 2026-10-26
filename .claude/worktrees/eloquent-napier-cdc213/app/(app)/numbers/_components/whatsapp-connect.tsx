"use client";

import { useEffect, useState } from "react";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConnectButton } from "@/components/connections/connect-button";
import { useT } from "@/lib/i18n/provider";
import { fetchJson, uiErrorMessage } from "@/lib/api-error-message";
import { notifyCredentialsChanged } from "@/lib/credentials-changed";
import { WhatsAppConnect as EmbeddedConnect } from "./whatsapp-embedded-connect";

type Props = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConnected: () => void;
};
const empty = { accessToken: "", phoneNumberId: "", appSecret: "", verifyToken: "" };

export function WhatsAppConnect(props: Props) {
  const t = useT();
  const [values, setValues] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [embeddedAvailable, setEmbeddedAvailable] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [webhook, setWebhook] = useState("");

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setValues(empty); setDone(false); setError(null); setEmbedded(false);
    setEmbeddedAvailable(false);
    setWebhook(`${window.location.origin}/eve/v1/whatsapp`);
    void fetchJson<{ phoneNumberId: string; embeddedAvailable: boolean }>("/api/channels/whatsapp/manual", t).then((result) => {
      if (cancelled) return;
      if (!result.ok) { setError(uiErrorMessage(t, result.error)); return; }
      setValues((current) => ({ ...current, phoneNumberId: result.data.phoneNumberId }));
      setEmbeddedAvailable(result.data.embeddedAvailable);
    });
    return () => { cancelled = true; };
  }, [props.open, t]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(null);
    const result = await fetchJson("/api/channels/whatsapp/manual", t, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
    });
    setSaving(false);
    if (!result.ok) { setError(uiErrorMessage(t, result.error)); return; }
    setValues(empty); setDone(true);
    notifyCredentialsChanged(); props.onConnected();
  };

  if (embedded) return <EmbeddedConnect {...props} />;

  return (
    <Drawer open={props.open} onOpenChange={props.onOpenChange}>
      <DrawerContent className="max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>{t("numbers.apiTitle")}</DrawerTitle>
          <DrawerDescription>{t("numbers.apiDescription")}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <div className="space-y-5">
            {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
            {done ? <Alert tone="success">{t("numbers.apiSaved")}</Alert> : (
              <form id="whatsapp-api-form" onSubmit={save} className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("numbers.apiSetup")}</p>
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-2">{t("numbers.apiOpenMeta")}</a>
                {(["accessToken", "phoneNumberId", "appSecret", "verifyToken"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <label htmlFor={`wa-api-${key}`} className="text-xs font-medium">{t(`numbers.api.${key}`)}</label>
                    <Input id={`wa-api-${key}`} type={key === "phoneNumberId" ? "text" : "password"}
                      value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                      required autoComplete="off" disabled={saving}
                      minLength={key === "verifyToken" ? 8 : key === "accessToken" ? 10 : undefined}
                      pattern={key === "phoneNumberId" ? "[0-9]{5,30}" : key === "appSecret" ? "[a-fA-F0-9]{32}" : key === "verifyToken" ? "[A-Za-z0-9_-]{8,256}" : undefined}
                    />
                  </div>
                ))}
              </form>
            )}
            <div className="space-y-1.5">
              <label htmlFor="wa-api-webhook" className="text-xs font-medium">{t("numbers.apiWebhook")}</label>
              <Input id="wa-api-webhook" value={webhook} readOnly />
              <p className="text-xs text-muted-foreground">{t("numbers.apiWebhookHint")}</p>
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">{t("numbers.apiGuidedTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("numbers.apiGuidedDescription")}</p>
              <Button type="button" variant="outline" size="sm" disabled={!embeddedAvailable || saving} onClick={() => setEmbedded(true)}>
                {t(embeddedAvailable ? "numbers.metaConnect" : "numbers.apiInDevelopment")}
              </Button>
            </div>
          </div>
        </DrawerBody>
        <DrawerFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={saving}>{t(done ? "numbers.metaClose" : "common.cancel")}</Button>
          {!done ? <ConnectButton tone="whatsapp" type="submit" form="whatsapp-api-form" disabled={saving}>
            {saving ? <Spinner size={14} /> : null}{t("numbers.apiSave")}
          </ConnectButton> : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
