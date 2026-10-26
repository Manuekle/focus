import { notFound } from "next/navigation";
import { PaymentPreview } from "./preview";

export default async function PaymentPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 text-lg font-semibold">Cobro en el chat</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Tarjetas reales con el estado servido por un simulador local: copiá un enlace o abrí Mercado Pago y después
        simulá el pago para ver la confirmación.
      </p>
      <PaymentPreview />
    </main>
  );
}
