import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

// The owner asks for a phone agent. The agent draws the whole design as one
// propose_agent call and waits: nothing is built until the owner presses
// Build, and Discard ends it without a draft. The blueprint has to be a
// phone agent (voice channel, a first line for picking up) that can book,
// and the denial must not be read back as a system error.
export default defineEval({
  description: "Proposes a voice agent as a blueprint and builds nothing on Discard.",
  tags: ["live", "architect"],
  async test(t) {
    const proposal = await t.send(
      "Creame un agente de voz que atienda las llamadas de mi clínica dental, agende turnos y pase las urgencias a una persona.",
    );
    proposal.expectOk();
    const request = t.requireInputRequest({
      toolName: "propose_agent",
      optionIds: ["approve", "deny"],
      input: (input) => {
        const value = input as { channels?: string[]; voice?: { firstMessage?: string }; capabilities?: string[] };
        return Boolean(value.channels?.includes("voice") && value.voice?.firstMessage &&
          value.capabilities?.includes("calendar") && value.capabilities?.includes("handoff"));
      },
    });
    t.log(`proposal request ${request.requestId}`);

    const declined = await t.respondAll("deny");
    declined.expectOk();
    t.succeeded();
    // Discard builds nothing, and it is not an error to apologize for.
    t.check(declined.message, satisfies(
      (message) => !/error del sistema|no pude crear|falló/i.test(String(message ?? "")),
      "acknowledges the discard without calling it an error",
    ));
  },
});
