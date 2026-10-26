"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAdminLocale } from "../_components/admin-locale";

export default function RequestsError({ reset }: { reset: () => void }) {
  const { tr } = useAdminLocale();
  return <Alert tone="error" title={tr("No se pudieron cargar las solicitudes", "Requests could not be loaded")}>
    <p>{tr("Comprueba la conexión con la base de datos y vuelve a intentarlo.", "Check the database connection and try again.")}</p>
    <Button className="mt-3" size="sm" variant="secondary" onClick={reset}>{tr("Reintentar", "Try again")}</Button>
  </Alert>;
}
