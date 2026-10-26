"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/app/_components/page-container";
import { AutomationTemplates } from "@/app/(app)/automations/_components/automation-templates";
import { N8nImportDialog } from "@/app/(app)/automations/_components/n8n-import-dialog";
import { n8nToAutomation, type N8nImport } from "@/lib/n8n-workflow";

/**
 * The automation template board and the n8n import preview, with no account
 * behind them.
 *
 * `/automations` is a signed-in screen, so this renders the same two
 * components against local state — the board with its level filter, and the
 * import dialog fed a sample n8n workflow that exercises a condition, a
 * credential warning and an unsupported node. Nothing here posts anywhere.
 *
 * Dev only, like everything under /dev — the layout 404s this in production.
 */

const SAMPLE_N8N = {
  name: "Leads de Typeform",
  nodes: [
    { name: "Typeform Trigger", type: "n8n-nodes-base.typeformTrigger", parameters: {} },
    {
      name: "¿Tiene email?",
      type: "n8n-nodes-base.if",
      parameters: {
        conditions: {
          conditions: [
            { leftValue: "={{ $json.email }}", rightValue: "", operator: { type: "string", operation: "exists", singleValue: true } },
          ],
        },
      },
    },
    { name: "Gmail", type: "n8n-nodes-base.gmail", parameters: { operation: "send", sendTo: "={{ $json.email }}", subject: "Gracias {{ $json.name }}", message: "Te escribimos pronto." } },
    { name: "Slack", type: "n8n-nodes-base.slack", parameters: { text: "=Lead sin email: {{ $json.phone }}" } },
    { name: "Code", type: "n8n-nodes-base.code", parameters: { jsCode: "return items" } },
    { name: "Wait", type: "n8n-nodes-base.wait", parameters: { amount: 1, unit: "days" } },
    { name: "Sheets", type: "n8n-nodes-base.googleSheets", parameters: { operation: "append", documentId: { value: "1AbC" }, sheetName: { value: "Leads" } } },
  ],
  connections: {
    "Typeform Trigger": { main: [[{ node: "¿Tiene email?", type: "main", index: 0 }]] },
    "¿Tiene email?": { main: [[{ node: "Gmail", type: "main", index: 0 }], [{ node: "Slack", type: "main", index: 0 }]] },
    Gmail: { main: [[{ node: "Code", type: "main", index: 0 }]] },
    Slack: { main: [[{ node: "Code", type: "main", index: 0 }]] },
    Code: { main: [[{ node: "Wait", type: "main", index: 0 }]] },
    Wait: { main: [[{ node: "Sheets", type: "main", index: 0 }]] },
  },
};

export default function AutomationTemplatesDevPage() {
  const [used, setUsed] = useState<string | null>(null);
  const [preview, setPreview] = useState<N8nImport | null>(null);

  const openImport = () => {
    const result = n8nToAutomation(SAMPLE_N8N);
    if (result.ok) setPreview(result.automation);
  };

  return (
    <PageContainer className="@container" maxWidth="max-w-6xl" pattern="grid">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={openImport}>
          Open n8n import preview
        </Button>
        <p className="text-xs text-muted-foreground" data-testid="last-used">
          {used ? `Used: ${used}` : "No template used yet"}
        </p>
      </div>
      <AutomationTemplates usingId={null} onUse={(template) => setUsed(template.id)} onImport={openImport} />
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        {preview ? (
          <N8nImportDialog fileName="leads-typeform.json" preview={preview} creating={false} onConfirm={() => setPreview(null)} />
        ) : null}
      </Dialog>
    </PageContainer>
  );
}
