# Notes log

Brandon's drafting notes and what each became in the lab.

| Date | Note (short) | Became |
|---|---|---|
| 2026-11-05 | Fury Swipes and Anchor Smash are much worse on melee models. With 3 good ranged carry models in the pool, let the enemy take both abilities, then take the ranged models. | Scenario `fury-swipes-anchor-smash-ranged-models.json`. Judge already penalizes them on melee via the estimated model pairs (attack-type shift). |
| 2026-11-06 | Batch-001 verdict notes, drafts 1000-1007 (8 verdicts). | Judge rules in `judge/note-rules.json`: 4 pair edits (Feast + Blade Fury, Napalm + Rocket Barrage, Raptors + Rearm, Spirit Form + Keeper model), Juxtapose on melee without Doppelganger/Phantom Rush −6, Borrowed Time on ranged int −4, Huskar model −4, Weaver model +5, Viper Strike counters Berserker's Blood and Bristleback. 10 scenarios from "should have taken X" notes (`scenarios/batch-001-*.json`). |
| 2026-11-06 | Not turned into rules yet: wave clear for mids (Skywrath, Leshrac), supports need a laning spell (PL support), carry builds on support seats, mobility for carries (Timber Chain), lane matchups (Clockwork vs ranged), early vs late power spikes. | Need ability tags (wave clear, laning spell, mobility, power timing) that Brandon reviews. |
| 2026-11-06 | Carry vs carry, carries-001 (25 pairs, 24 decided, 1 can't tell). Saved in `judgments/carries-001.json`. The stand-in build judge agreed on 21/24; it missed pair 4 (TA Juxtapose/Psi Blades over Ringmaster Fury Swipes), 23 (Ogre Berserker's Blood + Feral Impulse + Sunder "raid boss" over Gyro) and 25 (Venge Swipes/Overpower over Naga with support spells). | Not turned into rules yet. Lessons to encode as carry needs (archetype → need → what covers it): see the carry notes below. |

### Carry notes (carries-001), grouped

- **Model is the first filter.** Ranged agility models are generally better carries, all else equal. A melee carry needs a gap close and survivability (PA without either loses). Good carry models named: Morphling, Shadow Fiend, Vengeful Spirit, Drow, Luna, Medusa (mobility late), Ogre (with Berserker's Blood). Bad: Puck, Huskar ("terrible for carry"), Riki, Slardar (bad for illusions), Elder Titan, Necrophos (worse clicker than Venge), Lone Druid with spell-damage passives. Melee Anchor Smash is bad.
- **Farming speed decides most pairs.** One real farming spell is enough (PL over a build that can't farm). Fast: TB with cleave + Conjure Image + Riptide; Psi Blades; Gunslinger. Retaliate is not a farming spell on a squishy model (Dark Willow).
- **A carry wants a steroid, a slow and a defensive spell.** Morph won on Waveform mobility + Magnetize steroid + slow + defensive spell; Sven had Take Aim (effectively ranged) but no mobility or slow. ET build lost for no steroid and no farming spell. A good defensive ult counts (Jakiro).
- **Combos named:** Luna Moon Glaives + Phantasm; Jakiro + Fury Swipes ("very op"); Jakiro + bash; Lifestealer Feast + Gunslinger; Atrophy Aura on a ranged agility model, better with Rage; Ogre Berserker's Blood + Feral Impulse + Sunder.
- **Mechanics that break a build:** Fiery Soul needs spells that deal damage (Lone Druid build useless). Mirror Image on a melee model without Rip Tide is weak. Medusa without Mystic Snake is weak early and farms slower. Void Spirit relying on Reverse Polarity to kill is unreliable. Juxtapose needs a lot of farm before it works.
- **Build coherence:** support spells on a carry make a "confused" build (Naga with Freezing Field / Crystal Nova). Three passives that help neither farming nor killing is bad (Kez). An Aghanim-reliant combo is weaker.
- **Timing:** early lane strength vs late scaling is weighed, not one or the other (Ringmaster strong early but single-target Swipes can't kill TA illusions late; Arc Warden farms slower early but scales with Chemical Rage on a good ranged model). When it hinges on reaching an Aghanim and items (Mirana Split Shot + Wukong), Brandon marks it can't tell.
- **Matchup, not baseline:** Corrosive Haze is bad against a Medusa model (Mana Shield). Gap close helps a melee carry against a ranged one.
