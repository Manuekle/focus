"use client";

import { useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@/components/icons/icon";
import {
  Add01Icon,
  Delete02Icon,
  Folder01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export type FolderSummary = {
  id: string;
  name: string;
  description: string;
  documents: number;
  assets: number;
};

/** The folder illustration, from public/frames. Rendered as an image rather
 *  than inlined: the file carries `<defs>` with fixed gradient ids, and a
 *  grid of inlined copies would collide on them and paint the wrong fill.
 *  `unoptimized`: an SVG gains nothing from the optimizer, and this keeps it
 *  off the `localPatterns` allowlist in next.config.ts. */
const FOLDER_ART = "/frames/folder_blue.svg";

function FolderArt({ className }: { readonly className?: string }) {
  return (
    <Image
      src={FOLDER_ART}
      alt=""
      aria-hidden
      width={1004}
      height={841}
      unoptimized
      draggable={false}
      className={cn(
        "h-auto w-full select-none transition-transform duration-200 ease-out group-hover:-translate-y-1",
        className,
      )}
    />
  );
}

function FolderCard({
  folder,
  onOpen,
  onRename,
  onDelete,
}: {
  readonly folder: FolderSummary;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useI18n();
  const total = folder.documents + folder.assets;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={folder.description || folder.name}
        className="flex w-full flex-col items-center rounded-2xl p-2 text-center transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <FolderArt />
        <span className="mt-1 line-clamp-1 w-full text-sm font-medium">{folder.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total === 0 ? t("knowledge.folderEmpty") : t("knowledge.folderCount", { count: String(total) })}
        </span>
      </button>

      {/* Kept out of the button so the whole card stays one click target. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("knowledge.folderActions")}
            className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg bg-background/80 text-muted-foreground opacity-0 shadow-[var(--shadow-soft)] backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={15} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <HugeiconsIcon icon={PencilEdit02Icon} size={15} strokeWidth={1.75} />
            {t("knowledge.folderRename")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.75} />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function FolderGrid({
  folders,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  readonly folders: readonly FolderSummary[];
  readonly onOpen: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (folder: FolderSummary) => void;
  readonly onDelete: (folder: FolderSummary) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {folders.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          onOpen={() => onOpen(folder.id)}
          onRename={() => onRename(folder)}
          onDelete={() => onDelete(folder)}
        />
      ))}

      {/* Same footprint as a folder card so the grid keeps one rhythm — the
          new-folder slot reads as an empty shelf, not as a button bolted on. */}
      <button
        type="button"
        onClick={onCreate}
        className="group flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-2 text-center transition-colors hover:border-input hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-[var(--shadow-inset)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
          <HugeiconsIcon icon={Add01Icon} size={18} strokeWidth={1.75} />
        </span>
        <span className="text-sm font-medium">{t("knowledge.folderNew")}</span>
      </button>
    </div>
  );
}

/** The folder art on its own, for the breadcrumb and empty states. */
export { FolderArt };

/**
 * Create/rename dialog. One component for both because the fields are the
 * same and the only difference is which request the page fires on save.
 */
export function FolderDialog({
  open,
  folder,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  /** The folder being renamed, or `null` when creating a new one. */
  readonly folder: FolderSummary | null;
  readonly onClose: () => void;
  readonly onSave: (values: { name: string; description: string }) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");

  if (!open) return null;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle icon={<HugeiconsIcon icon={Folder01Icon} size={18} strokeWidth={1.75} />}>
            {folder ? t("knowledge.folderRename") : t("knowledge.folderNew")}
          </DialogTitle>
          <DialogDescription>{t("knowledge.folderDialogDescription")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onSave({ name: name.trim(), description: description.trim() });
          }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("knowledge.folderFieldName")}
            </label>
            <Input
              aria-label={t("knowledge.folderFieldNamePlaceholder")}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("knowledge.folderFieldNamePlaceholder")}
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("knowledge.folderFieldDescription")}
            </label>
            <Textarea
              aria-label={t("knowledge.folderFieldDescriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder={t("knowledge.folderFieldDescriptionPlaceholder")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {folder ? t("common.save") : t("knowledge.folderCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
