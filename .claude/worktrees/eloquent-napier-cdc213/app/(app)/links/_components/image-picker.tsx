"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  CheckIcon,
  Image01Icon,
  SearchIcon,
  Upload01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { useSound } from "@/components/sound-provider";
import { useToast } from "@/components/toast-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  failureMessage,
  fetchJson,
  uiErrorMessage,
  type UploadFailure,
} from "@/lib/api-error-message";
import { useT } from "@/lib/i18n/provider";
import { IMAGE_ACCEPT_ATTRIBUTE, MAX_BYTES_BY_KIND } from "@/lib/media-formats";
import type { MediaAsset } from "@/lib/media-store";
import { cn } from "@/lib/utils";
import { uploadInit } from "@/lib/upload-client";

/**
 * Picks the picture for one slot of the link page — the background, or the
 * face at the top — from the business's own library, or from the operator's
 * desktop.
 *
 * Both ways end in the same place. The upload posts to `/api/media`, the one
 * route the knowledge library uses, so a photo dropped here is stored, capped,
 * kind-checked and embedded exactly like one added from the knowledge screen,
 * and is in the grid the next time either screen opens. A second uploader with
 * its own storage would have made the link page's pictures invisible to the
 * agent, which is the opposite of what a media library is for.
 */
export function ImagePicker({
  onOpenChange,
  onPick,
  open,
  purpose,
  selectedId,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (asset: MediaAsset) => void;
  readonly open: boolean;
  /** Which slot is being filled. Only the wording changes — a picture is a
   *  picture — but "Background image" tells you what you are choosing. */
  readonly purpose: "background" | "avatar";
  readonly selectedId?: string;
}) {
  const t = useT();
  const { cue } = useSound();
  const { toast } = useToast();
  const descriptionId = useId();
  const [assets, setAssets] = useState<readonly MediaAsset[] | null>(null);
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  // A file chosen from the desktop waits here, previewed, until the operator
  // confirms it. The description used to be a second text box sitting above
  // the library grid, asked for before any file was picked — it read as a
  // second search field, and nobody fills in a caption for a photo they have
  // not chosen yet. Asking once the photo is on screen is when it makes sense.
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await fetchJson<{ assets: MediaAsset[] }>("/api/media", t);
      if (cancelled) return;
      setAssets(result.ok ? result.data.assets.filter((asset) => asset.kind === "image") : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  // The preview is an object URL, which holds the file's bytes until revoked.
  // Swapping or dropping the pending file revokes the old one here, and the
  // unmount below catches the one still held when the editor goes away.
  const stage = useCallback((file: File | null) => {
    if (pendingUrl.current) URL.revokeObjectURL(pendingUrl.current);
    const url = file ? URL.createObjectURL(file) : null;
    pendingUrl.current = url;
    setPending(file && url ? { file, url } : null);
  }, []);

  useEffect(
    () => () => {
      if (pendingUrl.current) URL.revokeObjectURL(pendingUrl.current);
    },
    [],
  );

  // A dialog that reopens holding the last attempt's error, a half-finished
  // upload, or the search typed last time, is lying about the state it is in.
  // Cleared on the way out rather than in an effect on `open`, so it happens
  // once per close instead of on every render that follows one.
  const close = useCallback(() => {
    setError(null);
    setDescription("");
    setQuery("");
    setDragging(false);
    stage(null);
    onOpenChange(false);
  }, [onOpenChange, stage]);

  const choose = useCallback(
    (files: readonly File[]) => {
      const file = files.find((candidate) => candidate.type.startsWith("image/"));
      if (!file) {
        setError(t("links.uploadNotImage"));
        return;
      }

      // The route checks this too; catching it here saves sending five
      // megabytes up the wire to be told no.
      if (file.size > MAX_BYTES_BY_KIND.image) {
        setError(t("links.uploadTooLarge", { mb: Math.round(MAX_BYTES_BY_KIND.image / (1024 * 1024)) }));
        return;
      }

      setError(null);
      stage(file);
    },
    [stage, t],
  );

  const upload = useCallback(async () => {
    if (!pending) return;
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append("file", pending.file);
    form.append("folderId", "root");
    // What the agent searches when a customer asks for a photo of something.
    // Optional here, because a background nobody will ever ask for by name
    // is still worth uploading.
    if (description.trim()) form.append("description", description.trim());

    // Staged straight to the bucket when there is one (see lib/upload-client.ts).
    let init: RequestInit;
    try {
      init = await uploadInit(form);
    } catch {
      setUploading(false);
      setError(t("knowledge.uploadFailed"));
      return;
    }
    const result = await fetchJson<{ assets?: MediaAsset[]; failed?: UploadFailure[] }>("/api/media", t, init);
    setUploading(false);

    if (!result.ok) {
      setError(uiErrorMessage(t, result.error));
      return;
    }

    const stored = result.data.assets?.[0];
    if (!stored) {
      const failure = result.data.failed?.[0];
      setError(failure ? failureMessage(t, failure) : t("knowledge.uploadFailed"));
      return;
    }

    cue("success");
    setAssets((current) => [stored, ...(current ?? [])]);
    toast({
      title: t("links.uploadSaved"),
      description: t("links.uploadSavedHint"),
      status: "success",
    });
    onPick(stored);
    close();
  }, [close, cue, description, onPick, pending, t, toast]);

  const needle = query.trim().toLowerCase();
  const shown = (assets ?? []).filter((asset) => !needle || asset.name.toLowerCase().includes(needle));
  const browse = () => fileInput.current?.click();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl"
        // The grid is the one scroll region, so the search stays in reach
        // while the library scrolls under it, and the dialog never nests a
        // second scrollbar inside its own.
        scrollBody={false}
        // The whole panel takes a dropped file, not just the grid — the old
        // target was a box nothing on screen said you could drop onto.
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          // Without this the browser opens the file instead of dropping it.
          event.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(false);
          if (uploading) return;
          const files = [...event.dataTransfer.files];
          if (files.length > 0) choose(files);
        }}
      >
        <DialogHeader>
          <DialogTitle
            icon={
              <HugeiconsIcon
                icon={purpose === "avatar" ? UserCircleIcon : Image01Icon}
                size={18}
                strokeWidth={1.75}
              />
            }
          >
            {t(purpose === "background" ? "links.pickBackground" : "links.pickAvatar")}
          </DialogTitle>
          <DialogDescription>{t("links.pickImageHint")}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // Cleared so choosing the same file twice in a row still fires.
            event.target.value = "";
            if (files.length > 0) choose(files);
          }}
        />

        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

        {pending ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="mx-auto aspect-square w-40 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border sm:mx-0">
              {/* A local object URL — nothing for next/image to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pending.url} alt={pending.file.name} className="size-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="truncate text-sm font-medium" title={pending.file.name}>
                {pending.file.name}
              </p>
              <label htmlFor={descriptionId} className="mt-2 text-xs font-medium text-muted-foreground">
                {t("links.uploadDescriptionLabel")} {t("common.optional")}
              </label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("links.uploadDescriptionPlaceholder")}
                maxLength={280}
                rows={3}
                disabled={uploading}
                // The step exists to ask this one question.
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">{t("links.uploadDescriptionHint")}</p>
            </div>
          </div>
        ) : (
          <>
            {assets && assets.length > 0 ? (
              <div className="relative">
                <HugeiconsIcon
                  icon={SearchIcon}
                  size={15}
                  strokeWidth={1.75}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("links.pickImageSearch")}
                  aria-label={t("links.pickImageSearch")}
                  className="pl-9"
                />
              </div>
            ) : null}

            {assets === null ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-busy="true">
                {Array.from({ length: 8 }, (_, index) => (
                  <div key={index} className="aspect-square rounded-xl bg-muted motion-safe:animate-pulse" />
                ))}
              </div>
            ) : assets.length === 0 ? (
              <button
                type="button"
                onClick={browse}
                className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input px-6 text-center transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/40"
              >
                <HugeiconsIcon icon={Upload01Icon} size={20} strokeWidth={1.6} className="text-muted-foreground" />
                <span className="text-sm font-medium">{t("links.pickImageEmpty")}</span>
                <span className="max-w-xs text-xs text-muted-foreground">{t("links.uploadEmptyHint")}</span>
              </button>
            ) : (
              // `-mx-1 p-1` gives the selected tile's ring room to draw without
              // the scroll container clipping it, and keeps the tiles flush
              // with the search field above.
              <div className="y-fade -mx-1 max-h-[26rem] min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={browse}
                    className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-input p-2 text-center transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/40"
                  >
                    <HugeiconsIcon icon={Upload01Icon} size={18} strokeWidth={1.6} className="text-muted-foreground" />
                    <span className="text-xs font-medium">{t("links.uploadImage")}</span>
                    <span className="hidden text-[11px] leading-4 text-muted-foreground sm:block">
                      {t("links.uploadDropHint")}
                    </span>
                  </button>

                  {shown.map((asset) => {
                    const selected = asset.id === selectedId;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          onPick(asset);
                          close();
                        }}
                        aria-pressed={selected}
                        title={asset.name}
                        className="group flex min-w-0 flex-col gap-1.5 rounded-xl text-left"
                      >
                        <span
                          className={cn(
                            "relative block aspect-square overflow-hidden rounded-xl bg-muted transition-shadow duration-150",
                            selected
                              ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                              : "ring-1 ring-border group-hover:ring-foreground/30",
                          )}
                        >
                          {/* Library bytes are served by id, never from /public. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/media/${asset.id}/file`}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                          {selected ? (
                            <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-[var(--shadow-soft)]">
                              <HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2.5} />
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "truncate px-0.5 text-xs",
                            selected ? "font-medium text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {asset.name}
                        </span>
                      </button>
                    );
                  })}

                  {shown.length === 0 ? (
                    <p className="col-span-2 self-center px-2 text-sm text-muted-foreground sm:col-span-3">
                      {t("links.pickImageNoMatch")}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </>
        )}

        {dragging ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-foreground/40 bg-card/95 text-sm font-medium"
          >
            <HugeiconsIcon icon={Upload01Icon} size={20} strokeWidth={1.6} className="text-muted-foreground" />
            {t("links.uploadDropNow")}
          </div>
        ) : null}

        <DialogFooter>
          {pending ? (
            <>
              <Button disabled={uploading} onClick={() => stage(null)} type="button" variant="outline">
                {t("links.uploadBack")}
              </Button>
              <Button disabled={uploading} onClick={() => void upload()} type="button">
                {uploading ? <Spinner size={14} strokeWidth={2} /> : null}
                {t("links.uploadConfirm")}
              </Button>
            </>
          ) : (
            <Button onClick={close} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
