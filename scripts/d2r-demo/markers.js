'use strict';

import { background } from 'gui';
import { UnitTypes } from 'nyx:d2r';

// color format: 0xAABBGGRR  (AA=alpha, BB=blue, GG=green, RR=red)
const COLOR_PLAYER            = 0xFF00FF00; // green
const COLOR_ME                = 0xFF00FFFF; // yellow  (local player)

// Monster colors
const COLOR_MONSTER_NORMAL    = 0xFF0000FF; // red    - regular monsters
const COLOR_MONSTER_MINION    = 0xCC0000CC; // dim red - minions of uniques
const COLOR_MONSTER_CHAMPION  = 0xFFFF6600; // blue   - champion packs  (B=0xFF, G=0x66, R=0x00)
const COLOR_MONSTER_UNIQUE    = 0xFF00A5FF; // gold   - unique / super-unique  (B=0x00, G=0xA5, R=0xFF)

// Monster dot sizes (enlarged for visibility)
const RADIUS_PLAYER   = 4;
const RADIUS_NORMAL   = 4;
const RADIUS_MINION   = 3;
const RADIUS_CHAMPION = 6;
const RADIUS_UNIQUE   = 7;

// D2 monster typeFlag values from MonsterData struct (matches PrimeMH MonsterFlag)
const FLAG_UNIQUE       = 8;
const FLAG_SUPER_UNIQUE = 10;
const FLAG_CHAMPION     = 12;
const FLAG_MINION       = 16;

// Only show Players and Monsters (no missiles — they clutter the map)
const MARKER_TYPES = new Set([UnitTypes.Player, UnitTypes.Monster]);

// -----------------------------------------------------------------------
// Monster classId filter tables — skip non-enemy units.
// These are derived from PrimeMH's NPC classification (npc.rs get_type()).
// Any monster whose classId appears in these sets is NOT an enemy.
// -----------------------------------------------------------------------

// Town NPCs (quest givers, vendors, static characters)
const TOWN_NPC_IDS = new Set([
  146, 147, 148, 150, 154, 155,  // Act 1: Cain, Gheed, Akara, Kashya, Charsi, Warriv
  175, 176, 177, 178, 198, 199,  // Act 2: Warriv2, Atma, Drognan, Fara, Greiz, Elzix
  200, 201, 202, 210, 244,       // Act 2: Geglash, Jerhyn, Lysander, Meshif, Cain2
  245, 246, 251, 252, 253, 254,  // Act 3-4: Cain3, Cain4, Tyrael, Asheara, Hratli, Alkor
  255, 257, 264, 265, 266, 297,  // Act 3-5: Ormus, Halbu, Meshif2, Cain5, Navi, Natalya
  331, 367, 405, 406, 408,       // Kaelan, Tyrael2, Jamella, Izual2, Hadriel
  511, 512, 513, 514, 515,       // Act 5: Larzuk, Drehya, Malah, NihlathakTown, QualKehk
  520, 521, 527,                 // Act 5: Cain6, Tyrael3, Drehya2
]);

// Pets, hirelings, summons (player-controlled)
const PET_IDS = new Set([
  271,                           // Rogue2 (Act 1 hireling)
  289, 290, 291, 292,            // Golems: Clay, Blood, Iron, Fire
  338,                           // Guard (Act 2 hireling)
  351, 352, 353,                 // Hydra variants
  357,                           // Valkyrie
  359,                           // IronWolf (Act 3 hireling)
  363, 364,                      // NecroSkeleton, NecroMage
  417, 418,                      // ShadowWarrior, ShadowMaster
  419, 420, 421, 423, 424, 428,  // Druid summons: Hawk, SpiritWolf, Fenris, HoW, OakSage, Bear
  560, 561,                      // Act 5 hirelings
]);

// Dummies, critters, traps, non-interactive objects
const DUMMY_IDS = new Set([
  149, 151, 152, 153,            // Chicken, Rat, Rogue, HellMeteor
  157, 158, 159,                 // Bird, Bird2, Bat
  179, 185,                      // Cow, Camel
  195, 196, 197, 203, 204, 205,  // Act 2 ambient townsfolk / guards / vendors
  227, 268, 269, 272, 283,       // Maggot, Bug, Scorpion, Rogue3, Larva
  293, 294, 296,                 // Familiar, Act3Male, Act3Female
  318, 319, 320,                 // Snake, Parrot, Fish
  321, 322, 323, 324, 325,       // EvilHoles (spawners)
  326, 327, 328, 329, 330,       // Traps: Firebolt, HorzMissile, VertMissile, PoisonCloud, Lightning
  332, 339, 344,                 // InvisoSpawner, MiniSpider, BoneWall
  355, 356, 366, 370,            // SevenTombs, Decoy, CompellingOrb, SpiritMummy
  377, 378, 392, 393,            // Act2Guards, Windows
  401,                           // MephistoSpirit
  410, 411, 412, 413, 414,       // Assassin traps: WakeOfDest, ChargedBolt, Lightning, BladeCreeper, InvisiblePet
  415, 416,                      // InfernoSentry, DeathSentry
  543,                           // BaalThrone (pre-fight form)
  567, 568, 569,                 // InjuredBarbarians (quest)
  711,                           // DemonHole (spawner)
]);

/**
 * Return { color, radius, ring } for a monster based on its type flag.
 * Reads monsterData.typeFlag from the Monster's snapshot (populated by
 * Monster.on('update') via MonsterDataModel).
 * `ring` indicates whether an outline circle should be drawn around the dot.
 */
function getMonsterStyle(unit) {
  const flag = unit.monsterData?.typeFlag ?? 0;
  switch (flag) {
    case FLAG_UNIQUE:
    case FLAG_SUPER_UNIQUE:
      return { color: COLOR_MONSTER_UNIQUE, radius: RADIUS_UNIQUE, ring: true };
    case FLAG_CHAMPION:
      return { color: COLOR_MONSTER_CHAMPION, radius: RADIUS_CHAMPION, ring: true };
    case FLAG_MINION:
      return { color: COLOR_MONSTER_MINION, radius: RADIUS_MINION, ring: false };
    default:
      return { color: COLOR_MONSTER_NORMAL, radius: RADIUS_NORMAL, ring: false };
  }
}

/**
 * Returns true if this monster classId is an enemy that should be shown.
 * Filters out town NPCs, pets/hirelings/summons, and dummies/critters.
 */
function isEnemyMonster(unit) {
  const cid = unit.classId;
  if (TOWN_NPC_IDS.has(cid)) return false;
  if (PET_IDS.has(cid)) return false;
  if (DUMMY_IDS.has(cid)) return false;
  return true;
}

class Markers {
  constructor(objMgr) {
    this._objMgr = objMgr;
    this._keys = new Set();

    this._onUnitAdded   = (unit, type) => this._handleUnitAdded(unit, type);
    this._onUnitRemoved = (unit, type) => this._handleUnitRemoved(unit, type);

    objMgr.on('unitAdded',   this._onUnitAdded);
    objMgr.on('unitRemoved', this._onUnitRemoved);
  }

  _key(type, id) {
    return `marker-${type}-${id}`;
  }

  // Secondary key used for the outline ring drawn around elite/champion monsters
  _ringKey(type, id) {
    return `marker-${type}-${id}-ring`;
  }

  _handleUnitAdded(unit, type) {
    if (!MARKER_TYPES.has(type)) return;

    const key     = this._key(type, unit.id);
    const ringKey = this._ringKey(type, unit.id);
    this._keys.add(key);

    unit.on('update', () => {
      if (unit.automapX < 0) {
        background.remove(key);
        background.remove(ringKey);
        return;
      }

      if (type === UnitTypes.Player) {
        const color = (unit === this._objMgr.me) ? COLOR_ME : COLOR_PLAYER;
        background.addCircleFilled(key, [unit.automapX, unit.automapY], RADIUS_PLAYER, color);
      } else if (type === UnitTypes.Monster) {
        if (!unit.isAlive) {
          background.remove(key);
          background.remove(ringKey);
          return;
        }

        // Skip non-enemy monsters (NPCs, pets, dummies, critters)
        if (!isEnemyMonster(unit)) {
          background.remove(key);
          background.remove(ringKey);
          return;
        }

        const style = getMonsterStyle(unit);
        background.addCircleFilled(key, [unit.automapX, unit.automapY], style.radius, style.color);

        if (style.ring) {
          // Draw a slightly larger outline circle around elite/champion monsters
          this._keys.add(ringKey);
          background.addCircle(ringKey, [unit.automapX, unit.automapY], style.radius + 3, style.color);
        } else {
          background.remove(ringKey);
        }
      } else {
        // Other types (missiles removed from MARKER_TYPES, so this is a no-op fallback)
        background.remove(key);
      }
    });
  }

  _handleUnitRemoved(unit, type) {
    if (!MARKER_TYPES.has(type)) return;
    const key     = this._key(type, unit.id);
    const ringKey = this._ringKey(type, unit.id);
    this._keys.delete(key);
    this._keys.delete(ringKey);
    background.remove(key);
    background.remove(ringKey);
  }

  destroy() {
    this._objMgr.off('unitAdded',   this._onUnitAdded);
    this._objMgr.off('unitRemoved', this._onUnitRemoved);
    for (const key of this._keys) background.remove(key);
    this._keys.clear();
  }
}

export { Markers };
