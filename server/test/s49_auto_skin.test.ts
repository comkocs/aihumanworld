// S49: enter create without a skin lands in the least-populated living origin
// region (player + official, not buried). A tie is broken by this request's
// server seed, so two identical worlds pick the same region. An explicit skin
// is used as given. class stays meaningful only on fantasy: omitted skin is
// assigned first, then a class on any other region is refused.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { SKINS, type Skin } from "../src/facts/enums.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const SKIN_SET = new Set<string>(SKINS);

test("S49: omitted skin picks the least-populated region; explicit skin is kept", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  const app = await startApp(config);
  const call = async (verb: string, args: object): Promise<Json> =>
    (await app.dispatch({ verb, body: { args }, bearer: null, door: "api" })).body;
  const create = async (skin?: Skin, cls: string | null = null): Promise<Json> => {
    const args: Record<string, unknown> = { mode: "create", door: "api", class: cls };
    if (skin !== undefined) args.skin = skin;
    return call("enter", args);
  };
  try {
    for (let i = 0; i < 3; i += 1) {
      const made = await create("xiuxian");
      assert.equal(made.ok, true);
      assert.equal(made.result.char.skin, "xiuxian");
    }
    const fourth = await create();
    assert.equal(fourth.ok, true);
    assert.notEqual(fourth.result.char.skin, "xiuxian");
    assert.equal(SKIN_SET.has(fourth.result.char.skin), true);
    assert.equal(fourth.result.char.origin_region, fourth.result.char.skin);

    for (const skin of SKINS) {
      if (skin === "xiuxian" || skin === fourth.result.char.skin) continue;
      const made = await create(skin);
      assert.equal(made.ok, true);
      assert.equal(made.result.char.skin, skin);
    }
    const tied = await create();
    assert.equal(tied.ok, true);
    assert.equal(SKIN_SET.has(tied.result.char.skin), true);

    const explicit = await create("xiuxian");
    assert.equal(explicit.ok, true);
    assert.equal(explicit.result.char.skin, "xiuxian");

    const catalog = await (await fetch(`${app.url}/v1/verbs`)).json() as Json;
    const enter = (catalog.verbs as Json[]).find((v) => v.verb === "enter");
    const branch = (enter.branches as Json[]).find((b) => b.selector?.mode === "create");
    assert.equal((branch.args.required as string[]).includes("skin"), false);
    assert.equal(branch.args.properties.skin.enum.join(","), SKINS.join(","));

    const refused = await create(undefined, "mage");
    if (refused.ok === true) {
      assert.equal(refused.result.char.skin, "fantasy");
      assert.equal(refused.result.char.class, "mage");
    } else {
      assert.equal(refused.error.code, "INVALID_ARGUMENT");
      assert.equal(refused.error.field, "args.class");
    }
  } finally {
    await app.close();
  }
});
