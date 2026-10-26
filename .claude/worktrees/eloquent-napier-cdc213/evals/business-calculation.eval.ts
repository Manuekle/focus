import { defineEval } from "eve/evals";

export default defineEval({
  description: "Computes a business invoice through the sandboxed Python tool.",
  tags: ["live", "smoke"],
  async test(t) {
    await t.send(
      "Tengo una factura de 125000 pesos y acordé un descuento del 12%. Calculá el total a cobrar con run_python, sin guardar ni enviar nada.",
    );

    t.succeeded();
    t.calledTool("run_python");
    t.noFailedActions();
    t.messageIncludes(/110[., ]?000/);
  },
});
