"use client";
import { useEffect, useState } from "react";
import type { EveMessage, EveMessagePart } from "eve/react";
import { AgentMessage } from "@/app/_components/agent-message";
import { Button } from "@/components/ui/button";

const STRIPE_URL = "https://buy.stripe.com/test_preview";
const MERCADO_URL = "https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=preview";

function tool(
  id: string,
  state: "input-available" | "output-available" | "output-error",
  url?: string,
  provider?: "stripe" | "mercadopago",
  input = { amount: "1", currency: "usd", productName: "Verificación del agente Oruka" },
): EveMessagePart {
  return {
    type: "dynamic-tool",
    toolName: "send_payment_link",
    toolCallId: id,
    state,
    input,
    ...(state === "output-available" ? { output: { created: true, url, provider } } : {}),
    ...(state === "output-error" ? { errorText: "preview" } : {}),
  } as EveMessagePart;
}

const MESSAGES: EveMessage[] = [
  {
    id: "stripe",
    role: "assistant",
    parts: [tool("stripe", "output-available", STRIPE_URL, "stripe"), { type: "text", text: `Tu cobro está listo: [Abrir pago](${STRIPE_URL})` }],
  },
  {
    id: "mercado",
    role: "assistant",
    parts: [
      tool("mercado", "output-available", MERCADO_URL, "mercadopago", {
        amount: "180000",
        currency: "cop",
        productName: "Lentes progresivos",
      }),
    ],
  },
  { id: "preparing", role: "assistant", parts: [tool("preparing", "input-available")] },
  { id: "failed", role: "assistant", parts: [tool("failed", "output-error")] },
];

/** Answers the cards' status checks the way /api/payments/checkout would. */
function useCheckoutSimulator(paid: ReadonlySet<string>) {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("/api/payments/checkout")) return original(input, init);
      const checkoutUrl =
        init?.method === "POST"
          ? (JSON.parse(String(init.body)) as { checkoutUrl: string }).checkoutUrl
          : new URL(url, window.location.origin).searchParams.get("checkoutUrl") ?? "";
      return Response.json({
        status: paid.has(checkoutUrl) ? "paid" : init?.method === "POST" ? "processing" : "pending",
        productName: "Verificación del agente Oruka",
        amount: "1",
        currency: "usd",
      });
    };
    return () => {
      window.fetch = original;
    };
  }, [paid]);
}

export function PaymentPreview() {
  const [paid, setPaid] = useState<ReadonlySet<string>>(() => new Set());
  useCheckoutSimulator(paid);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setPaid((set) => new Set([...set, STRIPE_URL]))}>
          Simular pago Stripe
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPaid((set) => new Set([...set, MERCADO_URL]))}>
          Simular pago Mercado Pago
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            try {
              for (const key of Object.keys(window.localStorage))
                if (key.startsWith("oruka:payment-announced:")) window.localStorage.removeItem(key);
            } catch {}
            window.location.reload();
          }}
        >
          Reiniciar
        </Button>
      </div>
      {MESSAGES.map((message) => (
        <AgentMessage
          key={message.id}
          message={message}
          answers={{}}
          canRespond={false}
          isLast
          isStreaming={false}
          onInputResponses={() => {}}
        />
      ))}
    </div>
  );
}
