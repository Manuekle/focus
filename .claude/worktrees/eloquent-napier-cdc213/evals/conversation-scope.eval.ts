import { defineEval } from "eve/evals";
import { equals, satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Continues greetings, remembers business context and redirects unrelated arithmetic/trivia.",
  tags: ["live", "conversation", "scope"],
  async test(t) {
    const first = await t.send("Hola. Mi tienda se llama Brisa Norte; hoy hablamos de su campaña. No crees ni modifiques nada.");
    const hello = await t.send("hola");
    await t.require(hello.sessionId, equals(first.sessionId));
    t.check(hello.message, satisfies((text) => !/soy oruka|bienvenid|ciudad.*presupuesto/i.test(String(text)), "no repeated introduction or lead onboarding"));
    hello.usedNoTools();
    const follow = await t.send("¿Cómo se llama la tienda de la campaña que mencioné?");
    follow.messageIncludes("Brisa Norte");
    for (const question of ["¿Cuánto es 1+1?", "Dime el número pi"]) {
      const reply = await t.send(question);
      reply.usedNoTools();
      t.check(reply.message, satisfies((text) => !/(?:1\s*\+\s*1\s*=\s*2|(?:es|son|igual a)\s+(?:2|dos)|3[.,]14)/i.test(String(text)), "no off-topic numerical answer"));
      reply.messageIncludes(/negocio|Oruka|ventas|campaña|tienda|ayud/i);
    }
    t.succeeded();
  },
});
