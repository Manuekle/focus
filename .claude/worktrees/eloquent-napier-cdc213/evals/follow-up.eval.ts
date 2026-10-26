import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

export default defineEval({
  description: "Keeps the same durable session across a follow-up turn.",
  tags: ["live", "durability"],
  async test(t) {
    // The first turn writes into /workspace and the second reads it back, so
    // the assertion covers both halves of durability: the same session id, and
    // a sandbox filesystem that survived the turn boundary.
    const first = await t.send(
      "Para mi informe de ventas, guardá el total de 8.8 millones en /workspace/marker.txt con run_python y mostralo.",
    );
    first.calledTool("run_python");

    const second = await t.send(
      "Seguimos con el mismo informe de ventas: leé el total que guardamos en /workspace/marker.txt con run_python.",
    );
    await t.require(second.sessionId, equals(first.sessionId));
    second.calledTool("run_python");
    second.messageIncludes("8.8");
    t.succeeded();
  },
});
