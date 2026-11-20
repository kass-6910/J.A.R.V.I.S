import Anthropic from "@anthropic-ai/sdk";

/** Client partagé ; la clé vient de ANTHROPIC_API_KEY. */
export const claude = new Anthropic();
