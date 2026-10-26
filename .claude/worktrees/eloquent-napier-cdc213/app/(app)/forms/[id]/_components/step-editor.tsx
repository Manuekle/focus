"use client";

import { useMemo, useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { HugeiconsIcon } from "@/components/icons/icon";
import { Add01Icon, FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormIssue } from "@/lib/forms/schema";
import { useI18n } from "@/lib/i18n/provider";
import type { FormField, FormStep } from "@/lib/types";
import { QuestionEditor, REORDER_SPRING } from "./question-editor";
import { ToggleChip } from "@/components/ui/toggle-chip";

/** "Show this step always" needs a value the condition select can hold. */
const ALWAYS = "__always";

/**
 * The middle column: the one step you are actually editing.
 *
 * Everything on this screen that you type into lives here, and everything you
 * only look at — the preview, the thresholds, the link, the responses — lives
 * in the dock. That split is what the email and automation screens are built
 * on, and it is the reason a form no longer arrives as one very long page.
 */
export function StepEditor({
  step,
  index,
  total,
  sources,
  showPoints,
  issues,
  onChange,
  onAddField,
  onFieldChange,
  onFieldMove,
  onFieldRemove,
  onChoiceAdd,
  onChoiceChange,
  onChoiceMove,
  onChoiceRemove,
  onChoiceReorder,
  onFieldReorder,
}: {
  readonly step: FormStep;
  readonly index: number;
  readonly total: number;
  readonly sources: readonly FormField[];
  readonly showPoints: boolean;
  /** What is wrong with *this* step. Shown here rather than in one global
   *  list: "a question needs a label" is only useful next to the question
   *  missing one. */
  readonly issues: readonly FormIssue[];
  readonly onChange: (patch: Partial<FormStep>) => void;
  readonly onAddField: () => void;
  readonly onFieldChange: (fieldId: string, patch: Partial<FormField>) => void;
  readonly onFieldMove: (fieldId: string, direction: -1 | 1) => void;
  readonly onFieldRemove: (fieldId: string) => void;
  readonly onChoiceAdd: (fieldId: string) => void;
  readonly onChoiceChange: (
    fieldId: string,
    choiceId: string,
    patch: { label?: string; emoji?: string; points?: number },
  ) => void;
  readonly onChoiceMove: (fieldId: string, choiceId: string, direction: -1 | 1) => void;
  readonly onChoiceRemove: (fieldId: string, choiceId: string) => void;
  readonly onChoiceReorder: (fieldId: string, choiceIds: readonly string[]) => void;
  readonly onFieldReorder: (fieldIds: readonly string[]) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="y-fade h-full overflow-y-auto scrollbar-hide">
      <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {t("forms.builder.stepOf", { current: index + 1, total })}
        </p>

        {/* Borderless, document-sized: this is the heading a respondent reads,
            so it should look like a heading here too rather than like the
            twelfth field in a settings form. */}
        <input
          aria-label={t("forms.builder.stepTitle")}
          value={step.title ?? ""}
          placeholder={t("forms.builder.stepTitlePlaceholder")}
          onChange={(event) => onChange({ title: event.target.value || undefined })}
          className="mt-1 w-full rounded-sm bg-transparent text-2xl font-medium tracking-tight outline-none placeholder:text-muted-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]"
        />
        <input
          aria-label={t("forms.builder.stepDescription")}
          value={step.description ?? ""}
          placeholder={t("forms.builder.stepDescriptionPlaceholder")}
          onChange={(event) => onChange({ description: event.target.value || undefined })}
          className="mt-1.5 w-full rounded-sm bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)]"
        />

        {issues.length > 0 ? (
          <Alert tone="error" size="sm" role={null} className="mt-4">
            <ul className="space-y-1">
              {issues.map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>
                  {t(`forms.builder.issue.${issue.code}`, {}, issue.message)}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <ConditionEditor
          condition={step.showIf}
          sources={sources}
          onChange={(showIf) => onChange({ showIf })}
        />

        <QuestionList
          fields={step.fields}
          showPoints={showPoints}
          onFieldChange={onFieldChange}
          onFieldMove={onFieldMove}
          onFieldRemove={onFieldRemove}
          onChoiceAdd={onChoiceAdd}
          onChoiceChange={onChoiceChange}
          onChoiceMove={onChoiceMove}
          onChoiceRemove={onChoiceRemove}
          onChoiceReorder={onChoiceReorder}
          onReorder={onFieldReorder}
        />

        <button
          type="button"
          onClick={onAddField}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-[13px] font-medium text-muted-foreground transition-[background-color,border-color,color] duration-150 hover:border-input hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.75} />
          {t("forms.builder.addQuestion")}
        </button>
      </div>
    </div>
  );
}

/** The questions, as a draggable list. Handles rather than whole-row drags:
 *  every card here is full of inputs, and a card that is also a drag surface
 *  eats the click that puts the caret in one. */
function QuestionList({
  fields,
  showPoints,
  onFieldChange,
  onFieldMove,
  onFieldRemove,
  onChoiceAdd,
  onChoiceChange,
  onChoiceMove,
  onChoiceRemove,
  onChoiceReorder,
  onReorder,
}: {
  readonly fields: readonly FormField[];
  readonly showPoints: boolean;
  readonly onFieldChange: (fieldId: string, patch: Partial<FormField>) => void;
  readonly onFieldMove: (fieldId: string, direction: -1 | 1) => void;
  readonly onFieldRemove: (fieldId: string) => void;
  readonly onChoiceAdd: (fieldId: string) => void;
  readonly onChoiceChange: (
    fieldId: string,
    choiceId: string,
    patch: { label?: string; emoji?: string; points?: number },
  ) => void;
  readonly onChoiceMove: (fieldId: string, choiceId: string, direction: -1 | 1) => void;
  readonly onChoiceRemove: (fieldId: string, choiceId: string) => void;
  readonly onChoiceReorder: (fieldId: string, choiceIds: readonly string[]) => void;
  readonly onReorder: (fieldIds: readonly string[]) => void;
}) {
  const reduced = useReducedMotion();
  const [dragOrder, setDragOrder] = useState<readonly string[] | null>(null);

  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const committed = useMemo(() => fields.map((field) => field.id), [fields]);
  const order = dragOrder?.every((id) => byId.has(id)) ? dragOrder : committed;

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={order as string[]}
      onReorder={setDragOrder}
      className="mt-6 flex flex-col gap-3"
    >
      {order.map((fieldId) => {
        const field = byId.get(fieldId);
        if (!field) return null;
        return (
          <QuestionRow
            key={fieldId}
            field={field}
            index={order.indexOf(fieldId)}
            count={order.length}
            showPoints={showPoints}
            reduced={Boolean(reduced)}
            onChange={(patch) => onFieldChange(fieldId, patch)}
            onMove={(direction) => onFieldMove(fieldId, direction)}
            onRemove={() => onFieldRemove(fieldId)}
            onChoiceAdd={() => onChoiceAdd(fieldId)}
            onChoiceChange={(choiceId, patch) => onChoiceChange(fieldId, choiceId, patch)}
            onChoiceMove={(choiceId, direction) => onChoiceMove(fieldId, choiceId, direction)}
            onChoiceRemove={(choiceId) => onChoiceRemove(fieldId, choiceId)}
            onChoiceReorder={(choiceIds) => onChoiceReorder(fieldId, choiceIds)}
            onDragEnd={() => {
              const next = dragOrder;
              setDragOrder(null);
              if (!next || next.length !== fields.length) return;
              if (next.every((id, index) => id === committed[index])) return;
              onReorder(next);
            }}
          />
        );
      })}
    </Reorder.Group>
  );
}

function QuestionRow({
  field,
  index,
  count,
  showPoints,
  reduced,
  onChange,
  onMove,
  onRemove,
  onChoiceAdd,
  onChoiceChange,
  onChoiceMove,
  onChoiceRemove,
  onChoiceReorder,
  onDragEnd,
}: {
  readonly field: FormField;
  readonly index: number;
  readonly count: number;
  readonly showPoints: boolean;
  readonly reduced: boolean;
  readonly onChange: (patch: Partial<FormField>) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onChoiceAdd: () => void;
  readonly onChoiceChange: (
    choiceId: string,
    patch: { label?: string; emoji?: string; points?: number },
  ) => void;
  readonly onChoiceMove: (choiceId: string, direction: -1 | 1) => void;
  readonly onChoiceRemove: (choiceId: string) => void;
  readonly onChoiceReorder: (choiceIds: readonly string[]) => void;
  readonly onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);

  return (
    <Reorder.Item
      as="div"
      value={field.id}
      dragListener={false}
      dragControls={controls}
      dragElastic={0.06}
      transition={reduced ? { duration: 0 } : REORDER_SPRING}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
      style={{ position: "relative", zIndex: dragging ? 20 : undefined }}
    >
      <QuestionEditor
        field={field}
        index={index}
        count={count}
        showPoints={showPoints}
        dragging={dragging}
        onHandlePointerDown={(event) => {
          event.preventDefault();
          controls.start(event);
        }}
        onChange={onChange}
        onMove={onMove}
        onRemove={onRemove}
        onChoiceAdd={onChoiceAdd}
        onChoiceChange={onChoiceChange}
        onChoiceMove={onChoiceMove}
        onChoiceRemove={onChoiceRemove}
        onChoiceReorder={onChoiceReorder}
      />
    </Reorder.Item>
  );
}

/**
 * "Show this step only when…".
 *
 * The picker lists choice questions asked before this step and nothing else,
 * so the invalid conditions the validator can describe are ones this control
 * cannot produce in the first place.
 */
function ConditionEditor({
  condition,
  sources,
  onChange,
}: {
  readonly condition: FormStep["showIf"];
  readonly sources: readonly FormField[];
  readonly onChange: (showIf: FormStep["showIf"]) => void;
}) {
  const { t } = useI18n();
  if (sources.length === 0) return null;

  const source = sources.find((field) => field.id === condition?.fieldId);
  const picked = new Set(condition?.equals ?? []);

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <HugeiconsIcon icon={FilterHorizontalIcon} size={13} strokeWidth={1.75} />
          {t("forms.builder.showWhen")}
        </span>
        <Select
          value={condition?.fieldId ?? ALWAYS}
          onValueChange={(value) => {
            if (value === ALWAYS) {
              onChange(undefined);
              return;
            }
            const next = sources.find((field) => field.id === value);
            // A condition matching nothing hides the step forever, so a newly
            // chosen question starts with all of its options selected.
            onChange({ fieldId: value, equals: (next?.choices ?? []).map((c) => c.id) });
          }}
        >
          <SelectTrigger
            aria-label={t("forms.builder.showWhen")}
            className="h-8 min-w-0 flex-1 basis-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALWAYS}>{t("forms.builder.showAlways")}</SelectItem>
            {sources.map((field) => (
              <SelectItem key={field.id} value={field.id}>
                {field.label || t("forms.builder.untitledQuestion")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {source ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(source.choices ?? []).map((choice) => {
            const on = picked.has(choice.id);
            return (
              <ToggleChip
                key={choice.id}
                size="xs"
                selected={on}
                onClick={() => {
                  const next = on
                    ? [...picked].filter((id) => id !== choice.id)
                    : [...picked, choice.id];
                  // Unticking the last option would mean "show when nothing
                  // matches", which is a hidden step by another name.
                  onChange(next.length === 0 ? undefined : { fieldId: source.id, equals: next });
                }}
              >
                {choice.label || choice.id}
              </ToggleChip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Nothing selected — the rail has steps but none is open. */
export function NoStepSelected() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        {t("forms.builder.stepsTitle")}
      </span>
      <p className="max-w-[38ch] text-xs leading-relaxed text-muted-foreground">
        {t("forms.builder.noStepSelected")}
      </p>
    </div>
  );
}
