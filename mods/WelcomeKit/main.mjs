// WelcomeKit — a starter kit for players joining for the first time.
//
// Two server-side facts keep this short: the join event arrives with
// `firstEver` already decided (the panel's database outlives reboots), and the
// claimed flag is a tag on the player rather than state in here, so a crash
// between the hand-out and the next boot cannot produce a second kit.
//
// `pal.give` reads the inventory back, because the engine accepts a grant of an
// unknown item id and reports success having added nothing. That is why the
// claim tag is only written once every item has actually landed.

export const on = {
  'player.join': async ({ subject, data }, pal) => {
    const claimed = await pal.tag(subject.id, 'claimed');

    if (!data.firstEver || claimed !== null) {
      await pal.message(subject.id, `Welcome back, ${subject.name}.`);
      console.log(`${subject.name}: greeted (${claimed !== null ? 'kit already claimed' : `join #${data.joins ?? '?'}`})`);
      return;
    }

    const allowed = await pal.can(subject.id, 'welcomekit.kit');
    await pal.message(
      subject.id,
      allowed
        ? `Welcome to the server, ${subject.name}! Here is a starter kit to get you going.`
        : `Welcome to the server, ${subject.name}!`,
    );
    if (pal.settings.announce !== false) {
      await pal.announce(`${subject.name} just joined for the first time — say hi!`);
    }
    if (!allowed) {
      console.log(`${subject.name}: first join, no welcomekit.kit — greeted without a kit`);
      return;
    }

    let delivered = true;
    for (const { item, count } of pal.settings.items ?? []) {
      const ok = await pal.give(subject.id, item, count);
      console.log(`${subject.name}: ${item} x${count}${ok ? '' : ' — did not arrive'}`);
      delivered &&= ok;
    }

    if (!delivered) {
      await pal.message(subject.id, 'Part of your starter kit could not be handed over — ask an admin for it.');
      console.error(`${subject.name}: kit incomplete — unknown item id, or no room for it`);
      return;
    }

    await pal.setTag(subject.id, 'claimed', Math.floor(Date.now() / 1000));
    console.log(`${subject.name}: kit delivered`);
  },
};
