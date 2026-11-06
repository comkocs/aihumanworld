// The 16 verbs (动词表 §1), all registered. Owners edit their verb file only.

import type { Verb } from "../facts/enums.ts";
import { def as attack } from "./attack.ts";
import { def as bounty } from "./bounty.ts";
import { def as breakthrough } from "./breakthrough.ts";
import { def as build } from "./build.ts";
import { def as enter } from "./enter.ts";
import { def as events } from "./events.ts";
import { def as give } from "./give.ts";
import { def as go } from "./go.ts";
import { def as learn } from "./learn.ts";
import { def as look } from "./look.ts";
import { def as say } from "./say.ts";
import { def as take } from "./take.ts";
import { def as task } from "./task.ts";
import { def as train } from "./train.ts";
import { def as use } from "./use.ts";
import { def as whoami } from "./whoami.ts";
import type { AnyVerbDef } from "./types.ts";

export const REGISTRY: Readonly<Record<Verb, AnyVerbDef>> = {
  enter,
  look,
  events,
  whoami,
  go,
  say,
  take,
  give,
  use,
  attack,
  train,
  learn,
  task,
  bounty,
  build,
  breakthrough,
};

export function findVerb(name: string): AnyVerbDef | null {
  return Object.hasOwn(REGISTRY, name) ? (REGISTRY[name as Verb] ?? null) : null;
}
