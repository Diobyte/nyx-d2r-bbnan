'use strict';

/**
 * exit-markers.js — draws diamond markers + text labels at level exits,
 * waypoints, and special POIs on the D2R automap.
 *
 * Exit detection uses two complementary sources:
 *
 * 1. Type 5 (RoomTile) game units — dungeon entrances, stairs, portals and
 *    doorway warps (e.g. Forgotten Tower entrance inside Black Marsh).
 *    Destination level read via pointer chain:
 *      tile.data → pTileData[0] → D2DrlgRoomStrc* → +0x90 → ptLevel → +0x1F8
 *
 * 2. DRLG room walk — walk-across map-edge transitions between outdoor
 *    areas (e.g. Dark Wood ↔ Black Marsh, River of Flame → Chaos Sanctuary).
 *    Walk the level's DrlgRoom linked list, check each room's ptRoomsNear
 *    vector for rooms that belong to a different level.
 *
 * Other POIs use Type 2 (GameObject) units identified by classId:
 *   - Waypoints: known classId set
 *   - Quest items: known classId → label mapping
 *
 * Features:
 *   - Magenta diamonds + labels for level exits
 *   - Yellow diamonds for waypoints
 *   - Green diamonds for Tal Rasha's real tomb (Canyon of the Magi)
 *   - Green diamonds for quest items (tomes, altars, etc.)
 *   - Lines from player to all POIs
 */

import { background } from 'gui';
import { tryWithGameLock } from 'nyx:memory';
import { appendFileSync, writeFileSync } from 'fs';

const _d2r = internalBinding('d2r');
const _mem = internalBinding('memory');
const worldToAutomap = _d2r.worldToAutomap.bind(_d2r);
const readMemoryFast = _mem.readMemoryFast.bind(_mem);

// Coordinate conversions
// worldToAutomap expects isometric client-coords:
//   clientX = (subtileX - subtileY) * 16
//   clientY = (subtileX + subtileY) * 8
const TILE_TO_SUBTILE = 5;

function subtileToClient(subX, subY) {
  return { x: (subX - subY) * 16, y: (subX + subY) * 8 };
}

// DRLG struct offsets (from d2r_structs.h)
const LVL_OFF_LEVEL_ID   = 0x01F8;  // DrlgLevelStrc → eLevelId
const LVL_OFF_WARP_X     = 0x0208;  // DrlgLevelStrc → nRoom_Center_Warp_X[9]
const LVL_OFF_WARP_Y     = 0x022C;  // DrlgLevelStrc → nRoom_Center_Warp_Y[9]
const LVL_OFF_NUM_WARPS  = 0x0250;  // DrlgLevelStrc → dwNumCenterWarps

// Diamond marker geometry (half-widths in pixels)
const DIAMOND_W = 10;
const DIAMOND_H = 7;

// Text label offset from diamond centre
const TEXT_OFFSET_X = 14;
const TEXT_OFFSET_Y = -10;

// POI types
const POI_EXIT      = 'exit';
const POI_GOOD_EXIT = 'good_exit';  // real Tal Rasha's tomb
const POI_WAYPOINT  = 'waypoint';
const POI_QUEST     = 'quest';
const POI_NPC       = 'npc';

// Colors — 0xAABBGGRR
const COLOR_EXIT        = 0xFFFF00FF; // magenta (diamond outline)
const COLOR_EXIT_FILL   = 0xAAFF00FF; // magenta semi-transparent (diamond fill)
const COLOR_LINE        = 0x80FF00FF; // magenta 50% alpha (line to exit)
const COLOR_WP          = 0xFF00FFFF; // yellow (waypoint diamond)
const COLOR_WP_LINE     = 0x8000FFFF; // yellow 50% alpha (waypoint line)
const COLOR_GOOD_EXIT   = 0xFF00FF00; // green (real tomb exit)
const COLOR_GOOD_LINE   = 0x8000FF00; // green 50% alpha
const COLOR_QUEST       = 0xFF00FF00; // green (quest item)
const COLOR_QUEST_LINE  = 0x8000FF00; // green 50% alpha
const COLOR_NPC         = 0xFF0000FF; // red (NPC/boss spawn)
const COLOR_NPC_LINE    = 0x800000FF; // red 50% alpha
const COLOR_LINE_LABEL  = 0xFF800080; // dark purple (mid-line label text)
const COLOR_TEXT        = 0xFFFFFFFF; // white
const COLOR_TEXT_SHADOW = 0xFF000000; // black (text shadow)
const COLOR_DIAG        = 0xFF00FFFF; // yellow (diagnostic)
const LINE_THICK        = 2.0;
const EXIT_LINE_THICK   = 1.5;       // line from player to exit
const MAX_LEVELS        = 50;
const REDRAW_INTERVAL_MS = 40;      // redraw cap to reduce canvas churn
const SCREEN_COORD_MAX   = 100000;  // guard against invalid automap projections

// Font sizes for overlay text (0 = ImGui default, ~13px)
const FONT_SIZE_MARKER  = 18;        // diamond label text
const FONT_SIZE_LINE    = 22;        // mid-line label text (larger for readability)
const FONT_SIZE_DIAG    = 0;         // diagnostic text (default size)

// Waypoint object classIds (from objects.txt)
const WAYPOINT_CLASS_IDS = new Set([
  119,  // WaypointPortal
  145,  // InnerHellWaypoint
  156,  // Act2Waypoint
  157,  // Act1WildernessWaypoint
  237,  // Act3TownWaypoint
  238,  // WaypointH
  288,  // Act2CellerWaypoint
  323,  // Act2SewerWaypoint
  324,  // Act3TravincalWaypoint
  398,  // PandamoniumFortressWaypoint
  402,  // ValleyWaypoint
  429,  // ExpansionWaypoint
  494,  // WorldstoneWaypoint
  496,  // ExpansionWildernessWaypoint
  511,  // IceCaveWaypoint
  539,  // TempleWaypoint
]);

// Quest-relevant object classIds → display name
const QUEST_OBJECT_IDS = new Map([
  [8,   'Tome'],              // Tower Tome
  [21,  'Cairn Stones'],      // StoneLambda (Tristram portal)
  [30,  'Inifuss Tree'],      // Tree of Inifuss
  [149, 'Tainted Sun Altar'], // taintedsunaltar
  [152, 'Horadric Orifice'],  // orifice (staff socket)
  [193, "Lam Esen's Tome"],   // LamTome
  [251, 'Gidbinn Altar'],     // gidbinn altar
  [376, 'Hellforge'],         // Hellforge
  [473, 'Caged Barbarians'],  // cagedwussie1
]);

// Cairn Stone object classIds (Stony Field → Tristram portal).
// Any of these presets marks the portal-to-Tristram location.
const CAIRN_STONE_CLASS_IDS = new Set([17, 18, 19, 20, 21, 22]);

// Boss monsters to mark with a line per level.
// Key = levelId, value = Map(classId → label)
const BOSS_MONSTERS = {
  74: new Map([[250, 'The Summoner']]),   // Arcane Sanctuary
  124: new Map([[526, 'Nihlathak']]),     // Halls of Vaught
};

// Nihlathak position flip table: the preset NPC in level 124 spawns on the
// OPPOSITE side of the map from Nihlathak.  Key = "presetX,presetY" (level-
// relative subtiles), value = [nihlX, nihlY] (level-relative subtiles).
// Source: PrimeMH pois.rs
const NIHLATHAK_FLIP = {
  '30,208':  [395, 210],   // bottom right → top left
  '206,32':  [210, 395],   // bottom left → top right
  '207,393': [210, 25],    // top right → bottom left
  '388,216': [25, 210],    // top left → bottom right
};

// "Next exits" — which exits are progression-relevant per level
// (only these get lines drawn from the player; all exits still get markers)
const NEXT_EXITS = {
  2:  [8, 3],        // Blood Moor → Den of Evil, Cold Plains
  3:  [4, 17],       // Cold Plains → Stony Field, Burial Grounds
  4:  [10],          // Stony Field → Underground Passage L1
  5:  [6],           // Dark Wood → Black Marsh
  6:  [7, 20],       // Black Marsh → Tamoe Highland, Forgotten Tower
  7:  [12],          // Tamoe Highland → Pit L1
  8:  [2],           // Den of Evil → Blood Moor
  9:  [13],          // Cave L1 → Cave L2
  10: [5],           // Underground Passage L1 → Dark Wood
  11: [15],          // Hole L1 → Hole L2
  12: [16],          // Pit L1 → Pit L2
  21: [22], 22: [23], 23: [24], 24: [25],
  27: [28],          // Outer Cloister → Barracks
  28: [29],          // Barracks → Jail L1
  29: [30], 30: [31],
  31: [32],          // Jail L3 → Inner Cloister
  32: [33],          // Inner Cloister → Cathedral
  33: [34],          // Cathedral → Catacombs L1
  34: [35], 35: [36], 36: [37],
  41: [42],          // Rocky Waste → Dry Hills
  42: [43, 56],      // Dry Hills → Far Oasis, Halls of Dead L1
  43: [44, 62],      // Far Oasis → Lost City, Maggot Lair L1
  44: [45, 65],      // Lost City → Valley of Snakes, Ancient Tunnels
  45: [58],          // Valley of Snakes → Claw Viper Temple L1
  47: [48], 48: [49],
  55: [59],          // Stony Tomb L1 → L2
  56: [57],          // Halls of Dead L1 → L2
  57: [60],          // Halls of Dead L2 → L3
  58: [61],          // Claw Viper Temple L1 → L2
  62: [63], 63: [64],
  76: [85],          // Spider Forest → Spider Cavern
  78: [88],          // Flayer Jungle → Flayer Dungeon L1
  79: [80],          // Lower Kurast → Kurast Bazaar
  80: [81],          // Kurast Bazaar → Upper Kurast
  81: [82],          // Upper Kurast → Kurast Causeway
  83: [100],         // Travincal → Durance of Hate L1
  86: [87], 87: [90],
  88: [89], 89: [91],
  92: [93],
  100: [101], 101: [102],
  104: [105],        // Outer Steppes → Plains of Despair
  105: [106],        // Plains of Despair → City of the Damned
  106: [107],        // City of the Damned → River of Flame
  107: [108],        // River of Flame → Chaos Sanctuary
  113: [114],        // Crystalline Passage → Frozen River
  115: [117],        // Glacial Trail → Frozen Tundra
  118: [120],        // Ancients' Way → Arreat Summit
  122: [123], 123: [124],
  128: [129], 129: [130], 130: [131],
};

// D2R level ID → human-readable name (matches PrimeMH LevelName enum)
const LEVEL_NAMES = {
  1: 'Rogue Encampment',
  2: 'Blood Moor',
  3: 'Cold Plains',
  4: 'Stony Field',
  5: 'Dark Wood',
  6: 'Black Marsh',
  7: 'Tamoe Highland',
  8: 'Den of Evil',
  9: 'Cave Level 1',
  10: 'Underground Passage Level 1',
  11: 'Hole Level 1',
  12: 'Pit Level 1',
  13: 'Cave Level 2',
  14: 'Underground Passage Level 2',
  15: 'Hole Level 2',
  16: 'Pit Level 2',
  17: 'Burial Grounds',
  18: 'Crypt',
  19: 'Mausoleum',
  20: 'Forgotten Tower',
  21: 'Tower Cellar Level 1',
  22: 'Tower Cellar Level 2',
  23: 'Tower Cellar Level 3',
  24: 'Tower Cellar Level 4',
  25: 'Tower Cellar Level 5',
  26: 'Monastery Gate',
  27: 'Outer Cloister',
  28: 'Barracks',
  29: 'Jail Level 1',
  30: 'Jail Level 2',
  31: 'Jail Level 3',
  32: 'Inner Cloister',
  33: 'Cathedral',
  34: 'Catacombs Level 1',
  35: 'Catacombs Level 2',
  36: 'Catacombs Level 3',
  37: 'Catacombs Level 4',
  38: 'Tristram',
  39: 'Secret Cow Level',
  40: 'Lut Gholein',
  41: 'Rocky Waste',
  42: 'Dry Hills',
  43: 'Far Oasis',
  44: 'Lost City',
  45: 'Valley of Snakes',
  46: 'Canyon of the Magi',
  47: 'Sewers Level 1',
  48: 'Sewers Level 2',
  49: 'Sewers Level 3',
  50: 'Harem Level 1',
  51: 'Harem Level 2',
  52: 'Palace Cellar Level 1',
  53: 'Palace Cellar Level 2',
  54: 'Palace Cellar Level 3',
  55: 'Stony Tomb Level 1',
  56: 'Halls of the Dead Level 1',
  57: 'Halls of the Dead Level 2',
  58: 'Claw Viper Temple Level 1',
  59: 'Stony Tomb Level 2',
  60: 'Halls of the Dead Level 3',
  61: 'Claw Viper Temple Level 2',
  62: 'Maggot Lair Level 1',
  63: 'Maggot Lair Level 2',
  64: 'Maggot Lair Level 3',
  65: 'Ancient Tunnels',
  66: "Tal Rasha's Tomb",
  67: "Tal Rasha's Tomb",
  68: "Tal Rasha's Tomb",
  69: "Tal Rasha's Tomb",
  70: "Tal Rasha's Tomb",
  71: "Tal Rasha's Tomb",
  72: "Tal Rasha's Tomb",
  73: "Duriel's Lair",
  74: 'Arcane Sanctuary',
  75: 'Kurast Docks',
  76: 'Spider Forest',
  77: 'Great Marsh',
  78: 'Flayer Jungle',
  79: 'Lower Kurast',
  80: 'Kurast Bazaar',
  81: 'Upper Kurast',
  82: 'Kurast Causeway',
  83: 'Travincal',
  84: 'Arachnid Lair',
  85: 'Spider Cavern',
  86: 'Swampy Pit Level 1',
  87: 'Swampy Pit Level 2',
  88: 'Flayer Dungeon Level 1',
  89: 'Flayer Dungeon Level 2',
  90: 'Swampy Pit Level 3',
  91: 'Flayer Dungeon Level 3',
  92: 'Sewers Level 1',
  93: 'Sewers Level 2',
  94: 'Ruined Temple',
  95: 'Disused Fane',
  96: 'Forgotten Reliquary',
  97: 'Forgotten Temple',
  98: 'Ruined Fane',
  99: 'Disused Reliquary',
  100: 'Durance of Hate Level 1',
  101: 'Durance of Hate Level 2',
  102: 'Durance of Hate Level 3',
  103: 'Pandemonium Fortress',
  104: 'Outer Steppes',
  105: 'Plains of Despair',
  106: 'City of the Damned',
  107: 'River of Flame',
  108: 'Chaos Sanctuary',
  109: 'Harrogath',
  110: 'Bloody Foothills',
  111: 'Frigid Highlands',
  112: 'Arreat Plateau',
  113: 'Crystalline Passage',
  114: 'Frozen River',
  115: 'Glacial Trail',
  116: 'Drifter Cavern',
  117: 'Frozen Tundra',
  118: "Ancients' Way",
  119: 'Icy Cellar',
  120: 'Arreat Summit',
  121: "Nihlathak's Temple",
  122: 'Halls of Anguish',
  123: 'Halls of Pain',
  124: 'Halls of Vaught',
  125: 'Abaddon',
  126: 'Pit of Acheron',
  127: 'Infernal Pit',
  128: 'Worldstone Keep Level 1',
  129: 'Worldstone Keep Level 2',
  130: 'Worldstone Keep Level 3',
  131: 'Throne of Destruction',
  132: 'Worldstone Chamber',
  133: "Matron's Den",
  134: 'Forgotten Sands',
  135: 'Furnace of Pain',
  136: 'Uber Tristram',
};

// Map-edge (walk-across) adjacency: ONLY outdoor/stitched level connections.
// Dungeon entrances are handled by tile exits (Type 5) which carry dest IDs.
// This table is used to assign destination labels to center warps that
// represent seamless map-edge transitions (no tile unit).
const MAP_EDGE_ADJACENCY = {
  // Act 1 outdoor
  1:  [2],            // Rogue Encampment → Blood Moor
  2:  [1, 3],         // Blood Moor → Rogue Enc, Cold Plains
  3:  [2, 4, 17],     // Cold Plains → Blood Moor, Stony Field, Burial Grounds
  4:  [3, 5],         // Stony Field → Cold Plains, Dark Wood
  5:  [4, 6],         // Dark Wood → Stony Field, Black Marsh
  6:  [5, 7],         // Black Marsh → Dark Wood, Tamoe Highland
  7:  [6, 26],        // Tamoe Highland → Black Marsh, Monastery Gate
  17: [3],            // Burial Grounds → Cold Plains
  26: [7, 27],        // Monastery Gate → Tamoe Highland, Outer Cloister
  27: [26, 28],       // Outer Cloister → Monastery Gate, Barracks
  28: [27],           // Barracks → Outer Cloister
  // Act 2 outdoor
  40: [41],           // Lut Gholein → Rocky Waste
  41: [40, 42],       // Rocky Waste → Lut Gholein, Dry Hills
  42: [41, 43],       // Dry Hills → Rocky Waste, Far Oasis
  43: [42, 44],       // Far Oasis → Dry Hills, Lost City
  44: [43, 45],       // Lost City → Far Oasis, Valley of Snakes
  45: [44],           // Valley of Snakes → Lost City
  // Act 3 outdoor
  75: [76],           // Kurast Docks → Spider Forest
  76: [75, 77, 78],   // Spider Forest → Docks, Great Marsh, Flayer Jungle
  77: [76, 78],       // Great Marsh → Spider Forest, Flayer Jungle
  78: [76, 77, 79],   // Flayer Jungle → Spider Forest, Great Marsh, Lower Kurast
  79: [78, 80],       // Lower Kurast → Flayer Jungle, Kurast Bazaar
  80: [79, 81],       // Kurast Bazaar → Lower Kurast, Upper Kurast
  81: [80, 82],       // Upper Kurast → Bazaar, Causeway
  82: [81, 83],       // Kurast Causeway → Upper Kurast, Travincal
  83: [82],           // Travincal → Causeway
  // Act 4
  103: [104],         // Pandemonium Fortress → Outer Steppes
  104: [103, 105],    // Outer Steppes → Fortress, Plains of Despair
  105: [104, 106],    // Plains of Despair → Outer Steppes, City of Damned
  106: [105, 107],    // City of the Damned → Plains, River of Flame
  107: [106, 108],    // River of Flame → City of Damned, Chaos Sanctuary
  108: [107],         // Chaos Sanctuary → River of Flame
  // Act 5 outdoor
  109: [110],         // Harrogath → Bloody Foothills
  110: [109, 111],    // Bloody Foothills → Harrogath, Frigid Highlands
  111: [110, 112],    // Frigid Highlands → Bloody Foothills, Arreat Plateau
  112: [111, 113, 117], // Arreat Plateau → Frigid, Crystalline, Frozen Tundra
  113: [112, 115],    // Crystalline Passage → Arreat Plateau, Glacial Trail
  115: [113, 117],    // Glacial Trail → Crystalline, Frozen Tundra
  117: [112, 115, 118], // Frozen Tundra → Arreat, Glacial, Ancients' Way
  118: [117, 120],    // Ancients' Way → Frozen Tundra, Arreat Summit
  120: [118],         // Arreat Summit → Ancients' Way
};

// Full level adjacency table: level ID → array of ALL adjacent level IDs
// (including dungeon sub-levels). Used for Tal Rasha tomb detection etc.
const LEVEL_ADJACENCY = {
  // === Act 1 ===
  1:  [2],            // Rogue Encampment → Blood Moor
  2:  [1, 3, 8],      // Blood Moor → Rogue Enc, Cold Plains, Den of Evil
  3:  [2, 4, 9, 17],  // Cold Plains → Blood Moor, Stony Field, Cave L1, Burial Grounds
  4:  [3, 5, 10, 38], // Stony Field → Cold Plains, Dark Wood, Underground Passage L1, Tristram
  5:  [4, 6],         // Dark Wood → Stony Field, Black Marsh
  6:  [5, 7, 11, 20], // Black Marsh → Dark Wood, Tamoe Highland, Hole L1, Forgotten Tower
  7:  [6, 12, 26],    // Tamoe Highland → Black Marsh, Pit L1, Monastery Gate
  8:  [2],            // Den of Evil → Blood Moor
  9:  [3, 13],        // Cave L1 → Cold Plains, Cave L2
  10: [4, 14],        // Underground Passage L1 → Stony Field, L2
  11: [6, 15],        // Hole L1 → Black Marsh, Hole L2
  12: [7, 16],        // Pit L1 → Tamoe Highland, Pit L2
  13: [9],            // Cave L2
  14: [10],           // Underground Passage L2
  15: [11],           // Hole L2
  16: [12],           // Pit L2
  17: [3, 18, 19],    // Burial Grounds → Cold Plains, Crypt, Mausoleum
  18: [17],           // Crypt
  19: [17],           // Mausoleum
  20: [6, 21],        // Forgotten Tower → Black Marsh, Tower Cellar L1
  21: [20, 22], 22: [21, 23], 23: [22, 24], 24: [23, 25], 25: [24],
  26: [7, 27],        // Monastery Gate → Tamoe Highland, Outer Cloister
  27: [26, 28],       // Outer Cloister → Monastery Gate, Barracks
  28: [27, 29],       // Barracks → Outer Cloister, Jail L1
  29: [28, 30], 30: [29, 31], 31: [30, 32],
  32: [31, 33],       // Inner Cloister → Jail L3, Cathedral
  33: [32, 34],       // Cathedral → Inner Cloister, Catacombs L1
  34: [33, 35], 35: [34, 36], 36: [35, 37], 37: [36],
  38: [4],            // Tristram

  // === Act 2 ===
  40: [41, 47, 50],   // Lut Gholein → Rocky Waste, Sewers L1, Harem L1
  41: [40, 42, 55],   // Rocky Waste → Lut Gholein, Dry Hills, Stony Tomb L1
  42: [41, 43, 56],   // Dry Hills → Rocky Waste, Far Oasis, Halls of Dead L1
  43: [42, 44, 62],   // Far Oasis → Dry Hills, Lost City, Maggot Lair L1
  44: [43, 45, 65],   // Lost City → Far Oasis, Valley of Snakes, Ancient Tunnels
  45: [44, 58],       // Valley of Snakes → Lost City, Claw Viper Temple L1
  46: [66,67,68,69,70,71,72], // Canyon of the Magi → Tal Rasha Tombs
  47: [40, 48], 48: [47, 49], 49: [48],
  50: [40, 51], 51: [50, 52],
  52: [51, 53], 53: [52, 54], 54: [53, 74],
  55: [41, 59], 56: [42, 57], 57: [56, 60],
  58: [45, 61], 59: [55], 60: [57], 61: [58],
  62: [43, 63], 63: [62, 64], 64: [63],
  65: [44],           // Ancient Tunnels
  66: [46, 73], 67: [46], 68: [46], 69: [46], 70: [46], 71: [46], 72: [46],
  73: [66],           // Duriel's Lair
  74: [54, 46],       // Arcane Sanctuary → Palace Cellar L3, Canyon of Magi

  // === Act 3 ===
  75: [76],           // Kurast Docks
  76: [75, 77, 78, 84, 85], // Spider Forest
  77: [76, 78],       // Great Marsh
  78: [76, 77, 79, 86, 88], // Flayer Jungle
  79: [78, 80, 92],   // Lower Kurast
  80: [79, 81, 94, 95, 96], // Kurast Bazaar
  81: [80, 82, 97, 98, 99], // Upper Kurast
  82: [81, 83],       // Kurast Causeway
  83: [82, 100],      // Travincal → Causeway, Durance L1
  84: [76], 85: [76], // Arachnid Lair, Spider Cavern
  86: [78, 87], 87: [86, 90], 90: [87],
  88: [78, 89], 89: [88, 91], 91: [89],
  92: [79, 93], 93: [92],
  94: [80], 95: [80], 96: [80], 97: [81], 98: [81], 99: [81],
  100: [83, 101], 101: [100, 102], 102: [101],

  // === Act 4 ===
  103: [104],         // Pandemonium Fortress
  104: [103, 105],    // Outer Steppes
  105: [104, 106],    // Plains of Despair
  106: [105, 107],    // City of the Damned
  107: [106, 108],    // River of Flame → City of Damned, Chaos Sanctuary
  108: [107],         // Chaos Sanctuary

  // === Act 5 ===
  109: [110],         // Harrogath
  110: [109, 111],    // Bloody Foothills
  111: [110, 112, 125], // Frigid Highlands → BF, Arreat Plateau, Abaddon
  112: [111, 113, 117, 126], // Arreat Plateau
  113: [112, 114, 115], // Crystalline Passage
  114: [113],         // Frozen River
  115: [113, 116, 117], // Glacial Trail
  116: [115],         // Drifter Cavern
  117: [112, 115, 118, 127], // Frozen Tundra
  118: [117, 119, 120], // Ancients' Way
  119: [118],         // Icy Cellar
  120: [118, 128],    // Arreat Summit → Ancients' Way, WSK L1
  121: [109, 122],    // Nihlathak's Temple
  122: [121, 123], 123: [122, 124], 124: [123],
  125: [111], 126: [112], 127: [117],
  128: [120, 129], 129: [128, 130], 130: [129, 131],
  131: [130, 132], 132: [131],
};

export class ExitMarkers {
  constructor(objMgr) {
    this._objMgr   = objMgr;
    this._exitKeys = new Set();
    this._levelId  = -1;    // sentinel (never matches a real level)
    // Cached POI data: [{ clientX, clientY, subX, subY, destLevelId, poiType, label }]
    this._pois     = [];
    this._diagMsg  = '';      // per-tick chain info
    this._rebuildDiag = '';   // persists from last rebuild
    this._lastRebuild = 0;   // timestamp of last rebuild
    this._lastTileCount = 0; // track tile unit count changes
    this._realTombLevel = 0; // real Tal Rasha tomb level (66-72), from DRLG
    this._levelChangeTime = 0; // timestamp of last level change
    this._adjExpected = 0;     // expected adjacent levels from LEVEL_ADJACENCY
    this._adjFound = 0;        // actual adjacent levels found with Room2 data
    this._lastRedraw = 0;      // redraw throttle timestamp
  }

  // -- main loop (call from setInterval AFTER objMgr.tick()) ----------------

  tick() {
    try {
      const me = this._objMgr.me;
      if (!me) { this._clearAll(); return; }

      // --- read level ID via snapshot chain ---
      const path = me.path;
      const room = path?.room;
      const drlgRoom = room?.drlgRoom;
      const level = drlgRoom?.level;
      const levelId = level?.id;

      // Show chain diagnostic
      this._diagMsg = `chain: path=${!!path} room=${!!room} ` +
        `drlg=${!!drlgRoom} lvl=${!!level} id=${levelId}`;

      // Rebuild POI list when level changes or tile count changes
      if (levelId !== undefined && levelId !== this._levelId) {
        this._levelId = levelId;
        this._pois = [];
        this._lastTileCount = 0;
        this._levelChangeTime = Date.now();
        this._adjExpected = (LEVEL_ADJACENCY[levelId] || []).length;
        this._adjFound = 0;
        this._rebuild(me, levelId);
      } else if (levelId !== undefined) {
        // Re-scan when new tile units appear (exits load as player explores)
        const tiles = this._objMgr.getUnits(5);
        const tc = tiles ? tiles.size : 0;
        const now = Date.now();
        const sinceLevelChange = now - this._levelChangeTime;
        // Keep rebuilding every ~2s for 10s after entering a level, if
        // adjacent level data is still incomplete (Room2 lists load async).
        const adjIncomplete = this._adjFound < this._adjExpected
          && sinceLevelChange < 10000
          && now - this._lastRebuild > 2000;
        if (tc !== this._lastTileCount || (now - this._lastRebuild > 3000 && this._pois.length === 0)
            || (this._needsBossRescan && now - this._lastRebuild > 2000)
            || adjIncomplete) {
          this._lastTileCount = tc;
          this._pois = [];
          this._rebuild(me, levelId);
        }
      }

      if (me.automapX < 0) {
        this._clearExits();
        return;
      }

      const redrawNow = Date.now();
      if (redrawNow - this._lastRedraw >= REDRAW_INTERVAL_MS) {
        this._redraw(me);
        this._lastRedraw = redrawNow;
      }
    } catch (e) {
      try {
        // background.addText('exit-err', [20, 80], 0xFF0000FF, `ERR: ${e.message}`);
      } catch (_) {}
    }
  }

  // -----------------------------------------------------------------------
  // Rebuild POI list from multiple data sources:
  //
  // Source 1 — Type 5 (RoomTile) units: These represent dungeon entrances,
  //   stairs, portals, and doorway warps (e.g. Forgotten Tower entrance,
  //   Hole entrance).  We chase the data pointer to get the exact
  //   destination level ID.  NOT available for outdoor walk-across exits.
  //
  // Source 2 — Center warps + level-coordinate matching: Read center warp
  //   positions from the DrlgLevel struct, then walk the DrlgLevel linked
  //   list to get coordinates of adjacent levels.  Distance-based matching
  //   assigns each unmatched warp to the closest adjacent level, correctly
  //   labeling walk-across map-edge transitions (e.g. Dark Wood ↔ Black
  //   Marsh, River of Flame → Chaos Sanctuary).
  //
  // Source 3 — Type 2 (GameObject) units: Waypoints and quest items
  //   identified by classId.
  // -----------------------------------------------------------------------
  _rebuild(me, currentLevelId) {
    if (!currentLevelId) return;

    let rd = '';

    // ===== All memory reads happen inside a single game lock =====
    const tileExits = [];          // { posX, posY, destLevelId, classId }
    const allTileDiag = [];        // raw diagnostic for ALL tile units
    const tileUnits = [];          // { posX, posY, classId } — ALL tiles with valid positions
    const centerWarps = [];        // { subX, subY }
    const adjLevelCoords = new Map(); // levelId → { centerSubX, centerSubY, backX, backY, sizeX, sizeY }
    let curLevelBounds = null;     // { minX, minY, maxX, maxY } in subtile coords
    const roomExits = [];          // { subX, subY, destLevelId } — outdoor exits via direction matching
    const roomTileExits = [];      // { subX, subY, destLevelId } — from Room2.ptRoomTiles walk
    const presetBosses = [];        // { subX, subY, classId, label } — from Room2.ptPresetUnits
    const presetWaypoints = [];     // { subX, subY } — waypoints from Room2 presets
    const presetNPCs = [];          // { classId, levelRelX, levelRelY } — raw NPC presets for special handling
    const presetCairnStones = [];   // { subX, subY } — Cairn Stones in Stony Field (Tristram portal)

    const locked = tryWithGameLock(() => {
      // ----- Read tile units (Source 1) -----
      const tiles = this._objMgr.getUnits(5);
      rd += `t5=${tiles ? tiles.size : 0}`;

      if (tiles && tiles.size > 0) {
        for (const [, tile] of tiles) {
          // Tile units (type 5) use a static path — posX/posY on the unit
          // struct (0xD4/0xD6) are typically zero.  Read position from
          // pStaticPath (+0x38) → +0x10 (posX dword) / +0x14 (posY dword).
          let px = 0, py = 0;
          let roomPtr = 0n; // Room2 pointer for this tile
          try {
            const unitAddr = tile._address;
            if (unitAddr && unitAddr !== 0n) {
              const pathBuf = readMemoryFast(unitAddr + 0x38n, 8);
              const pathPtr = new DataView(pathBuf.buffer, pathBuf.byteOffset)
                .getBigUint64(0, true);
              if (pathPtr && pathPtr !== 0n) {
                const posBuf = readMemoryFast(pathPtr + 0x10n, 8);
                const pdv = new DataView(posBuf.buffer, posBuf.byteOffset);
                px = pdv.getUint32(0, true);  // subtile X
                py = pdv.getUint32(4, true);  // subtile Y

                // Also read Room1 → Room2 from static path
                // Tile units use D2StaticPathStrc where Room1 (ActiveRoom)
                // is at offset +0x00 (not +0x20 like DynamicPath).
                // Then ActiveRoom+0x18 → ptDrlgRoom (Room2).
                try {
                  const r1Buf = readMemoryFast(pathPtr + 0x00n, 8);
                  const r1Ptr = new DataView(r1Buf.buffer, r1Buf.byteOffset)
                    .getBigUint64(0, true);
                  if (r1Ptr && r1Ptr !== 0n && r1Ptr > 0x10000n) {
                    const r2Buf = readMemoryFast(r1Ptr + 0x18n, 8);
                    roomPtr = new DataView(r2Buf.buffer, r2Buf.byteOffset)
                      .getBigUint64(0, true);
                  }
                } catch (_) {}
              }
            }
          } catch (_) {}

          // Fall back to unit-level position if static path failed
          if (px === 0 && py === 0) {
            px = tile.posX;
            py = tile.posY;
          }
          if (px === 0 && py === 0) continue;

          let destLevelId = 0;
          let chainInfo = '';

          // --- Strategy A: Read ptRoomsNear on the tile's Room2 ---
          // Room2+0x10 = ptRoomsNear (MSVC vector: begin ptr, end ptr)
          // Each nearby room → ptLevel(+0x90) → eLevelId(+0x1F8)
          // A nearby room in a DIFFERENT level = destination.
          if (roomPtr && roomPtr !== 0n) {
            try {
              // Read vector begin/end pointers at Room2+0x10 and +0x18
              const vecBuf = readMemoryFast(roomPtr + 0x10n, 16);
              const vecDv = new DataView(vecBuf.buffer, vecBuf.byteOffset);
              const vecBegin = vecDv.getBigUint64(0, true);
              const vecEnd = vecDv.getBigUint64(8, true);

              if (vecBegin && vecEnd && vecEnd > vecBegin && vecBegin > 0x10000n) {
                const count = Number((vecEnd - vecBegin) / 8n);
                const maxCount = Math.min(count, 32); // sanity limit
                if (maxCount > 0) {
                  const nearBuf = readMemoryFast(vecBegin, maxCount * 8);
                  const nearDv = new DataView(nearBuf.buffer, nearBuf.byteOffset);
                  const nearLevels = [];

                  for (let ni = 0; ni < maxCount; ni++) {
                    const nearRoom = nearDv.getBigUint64(ni * 8, true);
                    if (!nearRoom || nearRoom === 0n || nearRoom < 0x10000n) continue;
                    try {
                      const nlBuf = readMemoryFast(nearRoom + 0x90n, 8);
                      const nlPtr = new DataView(nlBuf.buffer, nlBuf.byteOffset)
                        .getBigUint64(0, true);
                      if (nlPtr && nlPtr !== 0n && nlPtr > 0x10000n) {
                        const nlIdBuf = readMemoryFast(nlPtr + 0x1F8n, 4);
                        const nlId = new DataView(nlIdBuf.buffer, nlIdBuf.byteOffset)
                          .getInt32(0, true);
                        if (nlId > 0 && nlId <= 150) {
                          nearLevels.push(nlId);
                          if (destLevelId === 0 && nlId !== currentLevelId) {
                            destLevelId = nlId;
                          }
                        }
                      }
                    } catch (_) {}
                  }
                  chainInfo = `near=${count}[${nearLevels.join(',')}]`;
                }
              } else {
                chainInfo = 'vec=0';
              }
            } catch (e) { chainInfo = `nearExc:${e.message}`; }
          }

          // --- Strategy B: Read ptRoomTiles at Room2+0x78 ---
          // In classic D2, this is a linked list of warp tiles with
          // destination room pointers. Try walking it.
          if (destLevelId === 0 && roomPtr && roomPtr !== 0n) {
            try {
              const rtBuf = readMemoryFast(roomPtr + 0x78n, 8);
              const rtPtr = new DataView(rtBuf.buffer, rtBuf.byteOffset)
                .getBigUint64(0, true);
              if (rtPtr && rtPtr !== 0n && rtPtr > 0x10000n) {
                chainInfo += ` rt=${rtPtr.toString(16).slice(-6)}`;
                // Try reading first qword as destination Room2 pointer
                // Classic layout: [pDestRoom*, pNext*, nNum]
                let walkPtr = rtPtr;
                for (let wi = 0; wi < 8 && walkPtr && walkPtr !== 0n; wi++) {
                  try {
                    const wBuf = readMemoryFast(walkPtr, 24);
                    const wDv = new DataView(wBuf.buffer, wBuf.byteOffset);
                    const destRoom = wDv.getBigUint64(0, true);
                    const nextTile = wDv.getBigUint64(8, true);

                    if (destRoom && destRoom !== 0n && destRoom > 0x10000n) {
                      try {
                        const dlBuf = readMemoryFast(destRoom + 0x90n, 8);
                        const dlPtr = new DataView(dlBuf.buffer, dlBuf.byteOffset)
                          .getBigUint64(0, true);
                        if (dlPtr && dlPtr !== 0n && dlPtr > 0x10000n) {
                          const dlIdBuf = readMemoryFast(dlPtr + 0x1F8n, 4);
                          const dlId = new DataView(dlIdBuf.buffer, dlIdBuf.byteOffset)
                            .getInt32(0, true);
                          if (dlId > 0 && dlId <= 150) {
                            chainInfo += ` rt${wi}->L${dlId}`;
                            if (destLevelId === 0 && dlId !== currentLevelId) {
                              destLevelId = dlId;
                            }
                          }
                        }
                      } catch (_) {}
                    }
                    walkPtr = nextTile;
                  } catch (_) { break; }
                }
              } else {
                chainInfo += ' rt=0';
              }
            } catch (_) {}
          }

          // --- Strategy C: unit data pointer (pUnitData at unit+0x10) ---
          if (destLevelId === 0) {
            try {
              const unitAddr = tile._address;
              if (unitAddr && unitAddr !== 0n) {
                const dataBuf = readMemoryFast(unitAddr + 0x10n, 8);
                const dataPtr = new DataView(dataBuf.buffer, dataBuf.byteOffset)
                  .getBigUint64(0, true);
                if (dataPtr && dataPtr !== 0n) {
                  chainInfo += ` dp=${dataPtr.toString(16).slice(-6)}`;
                } else {
                  chainInfo += ' dp=0';
                }
              }
            } catch (_) {}
          }

          // Always collect raw diagnostic for ALL tile units
          allTileDiag.push(`c${tile.classId}:d${destLevelId}@${px},${py}[${chainInfo}]`);

          // Store tile position for edge/interior classification later
          tileUnits.push({ posX: px, posY: py, classId: tile.classId, destLevelId });

          if (destLevelId > 0 && destLevelId !== currentLevelId) {
            tileExits.push({ posX: px, posY: py, destLevelId,
                             classId: tile.classId });
          }
        }
      }

      // Raw tile diagnostic: show ALL tile units regardless of filter
      if (allTileDiag.length > 0) {
        rd += ` tRaw=[${allTileDiag.join(' ')}]`;
      }
      // Good tile exits
      if (tileExits.length > 0) {
        const teDiag = tileExits.map(t => `c${t.classId}->${t.destLevelId}`).join(' ');
        rd += ` te=[${teDiag}]`;
      }

      // ----- Read center warps + adjacent level coords (Source 2) -----
      // Center warps give us exit positions within the current level.
      // Walking the DrlgLevel linked list gives us adjacent level bounding
      // boxes, which we use to assign the correct destination to each warp.
      //
      // Pointer chain to get level struct address:
      //   unit+0x38 → path → +0x20 → room → +0x18 → drlgRoom → +0x90 → level
      //
      // DrlgLevelStrc offsets used:
      //   +0x28  tCoords { backCornerTileX/Y, sizeTileX/Y } (16 bytes)
      //   +0x1B8 ptNextLevel (linked list)
      //   +0x1C8 ptDrlg → +0x868 ptLevel (head of level list)
      //   +0x1F8 eLevelId
      //   +0x208 nRoom_Center_Warp_X[9]
      //   +0x22C nRoom_Center_Warp_Y[9]
      //   +0x250 dwNumCenterWarps
      try {
        const meAddr = me._address;
        let lvlAddr = 0n;
        if (meAddr && meAddr !== 0n) {
          const b1 = readMemoryFast(meAddr + 0x38n, 8);            // path ptr
          const pathPtr = new DataView(b1.buffer, b1.byteOffset).getBigUint64(0, true);
          if (pathPtr && pathPtr !== 0n) {
            const b2 = readMemoryFast(pathPtr + 0x20n, 8);          // room ptr
            const roomPtr = new DataView(b2.buffer, b2.byteOffset).getBigUint64(0, true);
            if (roomPtr && roomPtr !== 0n) {
              const b3 = readMemoryFast(roomPtr + 0x18n, 8);        // drlgRoom ptr
              const drlgPtr = new DataView(b3.buffer, b3.byteOffset).getBigUint64(0, true);
              if (drlgPtr && drlgPtr !== 0n) {
                const b4 = readMemoryFast(drlgPtr + 0x90n, 8);      // level ptr
                lvlAddr = new DataView(b4.buffer, b4.byteOffset).getBigUint64(0, true);
              }
            }
          }
        }

        if (lvlAddr && lvlAddr !== 0n) {
          // Read center warps from current level
          const buf = readMemoryFast(lvlAddr + BigInt(LVL_OFF_LEVEL_ID),
            LVL_OFF_NUM_WARPS - LVL_OFF_LEVEL_ID + 4);
          const dv = new DataView(buf.buffer, buf.byteOffset);
          const id = dv.getInt32(0, true);

          if (id === currentLevelId) {
            // curLevelBounds will be set properly by the Room2 walk below
            // (using ActiveRoom subtile coords instead of tile*5 which is wrong)

            const warpXOff = LVL_OFF_WARP_X - LVL_OFF_LEVEL_ID;
            const warpYOff = LVL_OFF_WARP_Y - LVL_OFF_LEVEL_ID;
            const numWarpsOff = LVL_OFF_NUM_WARPS - LVL_OFF_LEVEL_ID;
            const numWarps = dv.getUint32(numWarpsOff, true);
            rd += ` nw=${numWarps}`;
            for (let i = 0; i < Math.min(numWarps, 9); i++) {
              const wx = dv.getInt32(warpXOff + i * 4, true);
              const wy = dv.getInt32(warpYOff + i * 4, true);
              if (wx !== 0 || wy !== 0) {
                centerWarps.push({ subX: wx, subY: wy });
              }
            }

            // Walk the DrlgLevel linked list to get adjacent level coords.
            // Collect coords for ALL adjacent levels (both outdoor and dungeon).
            const drlgBuf = readMemoryFast(lvlAddr + 0x1C8n, 8);
            const drlgStructPtr = new DataView(drlgBuf.buffer, drlgBuf.byteOffset)
              .getBigUint64(0, true);

            // Read staffLevelOffset from D2DrlgStrc+0x120 to detect real tomb
            if (drlgStructPtr && drlgStructPtr !== 0n) {
              try {
                const staffBuf = readMemoryFast(drlgStructPtr + 0x120n, 4);
                const staffOff = new DataView(staffBuf.buffer, staffBuf.byteOffset)
                  .getUint32(0, true);
                rd += ` staffOff=${staffOff}`;
                if (staffOff >= 66 && staffOff <= 72) {
                  // Value is the actual level ID of the real tomb
                  this._realTombLevel = staffOff;
                  rd += ` realTomb=L${this._realTombLevel}`;
                } else if (staffOff <= 6) {
                  // Fallback: value is an offset (0-6) added to 66
                  this._realTombLevel = 66 + staffOff;
                  rd += ` realTomb=L${this._realTombLevel}(offset)`;
                }
              } catch (ex) { rd += ` staffErr=${ex.message}`; }
            } else {
              rd += ` drlgNULL`;
            }

            let startLvl = 0n;
            if (drlgStructPtr && drlgStructPtr !== 0n) {
              const headBuf = readMemoryFast(drlgStructPtr + 0x868n, 8);
              startLvl = new DataView(headBuf.buffer, headBuf.byteOffset)
                .getBigUint64(0, true);
            }
            if (!startLvl || startLvl === 0n) startLvl = lvlAddr;

            // Collect ALL adjacent levels from LEVEL_ADJACENCY
            const allAdj = LEVEL_ADJACENCY[currentLevelId] || [];
            const allAdjSet = new Set(allAdj);
            let lp = startLvl;
            let lvlCount = 0;
            const visited = new Set();
            while (lp && lp !== 0n && lvlCount < MAX_LEVELS && !visited.has(lp)) {
              visited.add(lp);
              lvlCount++;

              const coordBuf = readMemoryFast(lp + 0x28n, 16);
              const cDV = new DataView(coordBuf.buffer, coordBuf.byteOffset);
              const backTileX = cDV.getUint32(0, true);
              const backTileY = cDV.getUint32(4, true);
              const sizeTileX = cDV.getUint32(8, true);
              const sizeTileY = cDV.getUint32(12, true);

              const metaBuf = readMemoryFast(lp + 0x1B8n, 0x44);
              const mDV = new DataView(metaBuf.buffer, metaBuf.byteOffset);
              const nextLvl = mDV.getBigUint64(0x00, true);
              const thisLvlId = mDV.getInt32(0x40, true);

              if (thisLvlId > 0 && allAdjSet.has(thisLvlId)) {
                // Walk this adj level's Room2 list for actual absolute tile bounds.
                // DrlgLevel.tCoords uses DRLG-relative tiles (different coord system
                // from Room2.tRoomCoords absolute tiles), so we bypass it entirely.
                const adjRFBuf = readMemoryFast(lp + 0x10n, 8);
                const adjRoomFirst = new DataView(adjRFBuf.buffer, adjRFBuf.byteOffset)
                  .getBigUint64(0, true);

                if (adjRoomFirst && adjRoomFirst !== 0n && adjRoomFirst > 0x10000n) {
                  let aMinX = Infinity, aMinY = Infinity;
                  let aMaxX = -Infinity, aMaxY = -Infinity;
                  let aRoom = adjRoomFirst;
                  let aCount = 0;
                  const aVis = new Set();
                  while (aRoom && aRoom !== 0n && aRoom > 0x10000n
                         && aCount < 40 && !aVis.has(aRoom)) {
                    aVis.add(aRoom);
                    aCount++;
                    try {
                      // Read ptDrlgRoomNext(+0x48, 8B) .. tRoomCoords(+0x60, 16B)
                      // in one read: 0x48 to 0x70 = 0x28 = 40 bytes
                      const arBuf = readMemoryFast(aRoom + 0x48n, 0x28);
                      const arDv = new DataView(arBuf.buffer, arBuf.byteOffset);
                      const abx = arDv.getInt32(0x18, true); // tRoomCoords.backX
                      const aby = arDv.getInt32(0x1C, true); // tRoomCoords.backY
                      const asx = arDv.getInt32(0x20, true); // tRoomCoords.sizeX
                      const asy = arDv.getInt32(0x24, true); // tRoomCoords.sizeY
                      aMinX = Math.min(aMinX, abx);
                      aMinY = Math.min(aMinY, aby);
                      aMaxX = Math.max(aMaxX, abx + asx);
                      aMaxY = Math.max(aMaxY, aby + asy);
                      aRoom = arDv.getBigUint64(0, true); // ptDrlgRoomNext
                    } catch (_) { break; }
                  }
                  if (aMinX < Infinity) {
                    // Absolute tile * 5 = game-world subtile (verified by Room2 walk)
                    const centerSubX = Math.round(((aMinX + aMaxX) / 2) * 5);
                    const centerSubY = Math.round(((aMinY + aMaxY) / 2) * 5);
                    adjLevelCoords.set(thisLvlId, {
                      centerSubX, centerSubY,
                      backX: aMinX, backY: aMinY,
                      sizeX: aMaxX - aMinX, sizeY: aMaxY - aMinY,
                      rooms: aCount,
                    });
                  }
                }
                // If ptRoomFirst is null, adj level not loaded → skip
              }

              lp = nextLvl;
            }
            rd += ` lvls=${lvlCount} adjFound=${adjLevelCoords.size}`;
            this._adjFound = adjLevelCoords.size;
          } else {
            rd += ` idMismatch(${id})`;
          }
        } else {
          rd += ' noLvlAddr';
        }
      } catch (e) {
        rd += ` cwErr=${e.message}`;
      }

      // ----- Walk current level Room2 list for subtile bounds & match outdoor exits (Source 2b) -----
      // We need the current level's bounding box in game-world subtile coords
      // for the level center. adjLevelCoords already has correct subtile-space
      // centers from walking adj level Room2 lists above.
      try {
        const meAddr2 = me._address;
        let lvlAddr2 = 0n;
        if (meAddr2 && meAddr2 !== 0n) {
          const b1 = readMemoryFast(meAddr2 + 0x38n, 8);
          const pathPtr2 = new DataView(b1.buffer, b1.byteOffset).getBigUint64(0, true);
          if (pathPtr2 && pathPtr2 !== 0n) {
            const b2 = readMemoryFast(pathPtr2 + 0x20n, 8);
            const roomPtr2 = new DataView(b2.buffer, b2.byteOffset).getBigUint64(0, true);
            if (roomPtr2 && roomPtr2 !== 0n) {
              const b3 = readMemoryFast(roomPtr2 + 0x18n, 8);
              const drlgPtr = new DataView(b3.buffer, b3.byteOffset).getBigUint64(0, true);
              if (drlgPtr && drlgPtr !== 0n) {
                const b4 = readMemoryFast(drlgPtr + 0x90n, 8);
                lvlAddr2 = new DataView(b4.buffer, b4.byteOffset).getBigUint64(0, true);
              }
            }
          }
        }

        if (lvlAddr2 && lvlAddr2 !== 0n) {
          const rfBuf = readMemoryFast(lvlAddr2 + 0x10n, 8);
          let room2Ptr = new DataView(rfBuf.buffer, rfBuf.byteOffset).getBigUint64(0, true);

          // Bounding box from Room2.tRoomCoords (absolute tiles → *5 = subtiles)
          let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity;
          let roomCount = 0;
          const roomVisited = new Set();

          while (room2Ptr && room2Ptr !== 0n && room2Ptr > 0x10000n
                 && roomCount < 200 && !roomVisited.has(room2Ptr)) {
            roomVisited.add(room2Ptr);
            roomCount++;
            try {
              // Read ptDrlgRoomNext(+0x48), tRoomCoords(+0x60), ptRoomTiles(+0x78),
              // ptPresetUnits(+0x98) in one read
              const rBuf = readMemoryFast(room2Ptr + 0x48n, 0x58);
              const rDv = new DataView(rBuf.buffer, rBuf.byteOffset);
              const rtX = rDv.getInt32(0x18, true); // tRoomCoords.backX
              const rtY = rDv.getInt32(0x1C, true); // tRoomCoords.backY
              const rsX = rDv.getInt32(0x20, true); // tRoomCoords.sizeX
              const rsY = rDv.getInt32(0x24, true); // tRoomCoords.sizeY
              tMinX = Math.min(tMinX, rtX);
              tMinY = Math.min(tMinY, rtY);
              tMaxX = Math.max(tMaxX, rtX + rsX);
              tMaxY = Math.max(tMaxY, rtY + rsY);

              // Check ptRoomTiles (+0x78) for exit connections to other levels
              const rtilePtr = rDv.getBigUint64(0x30, true);
              if (rtilePtr && rtilePtr !== 0n && rtilePtr > 0x10000n) {
                let wPtr = rtilePtr;
                for (let wi = 0; wi < 8 && wPtr && wPtr !== 0n; wi++) {
                  try {
                    const wBuf = readMemoryFast(wPtr, 24);
                    const wDv = new DataView(wBuf.buffer, wBuf.byteOffset);
                    const destRoom = wDv.getBigUint64(0, true);
                    const nextTile = wDv.getBigUint64(8, true);
                    if (destRoom && destRoom !== 0n && destRoom > 0x10000n) {
                      try {
                        const dlBuf = readMemoryFast(destRoom + 0x90n, 8);
                        const dlPtr = new DataView(dlBuf.buffer, dlBuf.byteOffset)
                          .getBigUint64(0, true);
                        if (dlPtr && dlPtr !== 0n && dlPtr > 0x10000n) {
                          const dlIdBuf = readMemoryFast(dlPtr + 0x1F8n, 4);
                          const dlId = new DataView(dlIdBuf.buffer, dlIdBuf.byteOffset)
                            .getInt32(0, true);
                          if (dlId > 0 && dlId <= 150 && dlId !== currentLevelId) {
                            const cSubX = Math.round((rtX + rsX / 2) * 5);
                            const cSubY = Math.round((rtY + rsY / 2) * 5);
                            roomTileExits.push({ subX: cSubX, subY: cSubY, destLevelId: dlId });
                          }
                        }
                      } catch (_) {}
                    }
                    wPtr = nextTile;
                  } catch (_) { break; }
                }
              }

              // Check ptPresetUnits (+0x98) for boss spawns and waypoints
              const presetPtr = rDv.getBigUint64(0x50, true); // +0x98 - 0x48 = 0x50
              if (presetPtr && presetPtr !== 0n && presetPtr > 0x10000n) {
                const bossMap2 = BOSS_MONSTERS[currentLevelId];
                let pPtr = presetPtr;
                for (let pi = 0; pi < 50 && pPtr && pPtr !== 0n && pPtr > 0x10000n; pi++) {
                  try {
                    // D2PresetUnitStrc (x64): type(+0), classId(+4),
                    // posX(+0x08, room-relative subtiles), pNext(+0x10, ptr),
                    // posY(+0x24, room-relative subtiles)
                    const pBuf = readMemoryFast(pPtr, 0x28);
                    const pDv = new DataView(pBuf.buffer, pBuf.byteOffset);
                    const pType = pDv.getUint32(0, true);
                    const pClassId = pDv.getUint32(4, true);
                    const pPosX = pDv.getUint32(0x08, true); // room-relative subtiles
                    const pPosY = pDv.getUint32(0x24, true); // room-relative subtiles
                    const pNext = pDv.getBigUint64(0x10, true);

                    // Convert to absolute subtiles: roomBackTile * 5 + presetSubtile
                    const absSubX = rtX * 5 + pPosX;
                    const absSubY = rtY * 5 + pPosY;

                    // type 1 = monster — check for boss spawns
                    if (pType === 1 && bossMap2) {
                      const lbl = bossMap2.get(pClassId);
                      if (lbl) {
                        presetBosses.push({ subX: absSubX, subY: absSubY, classId: pClassId, label: lbl });
                      }
                      // Also collect raw NPC for special handling (Nihlathak flip)
                      presetNPCs.push({ classId: pClassId, absSubX, absSubY });
                    }

                    // type 0 = object — check for waypoints
                    // (D2PresetUnitStrc uses type 0 for objects, 1 for monsters)
                    if (pType === 0 && WAYPOINT_CLASS_IDS.has(pClassId)) {
                      presetWaypoints.push({ subX: absSubX, subY: absSubY });
                    }

                    // type 0 = object — check for Cairn Stones (Tristram portal)
                    if (pType === 0 && currentLevelId === 4 &&
                        CAIRN_STONE_CLASS_IDS.has(pClassId)) {
                      presetCairnStones.push({ subX: absSubX, subY: absSubY });
                    }

                    pPtr = pNext;
                  } catch (_) { break; }
                }
              }

              room2Ptr = rDv.getBigUint64(0, true); // ptDrlgRoomNext
            } catch (_) { break; }
          }

          rd += ` rWalk=${roomCount}`;
          rd += ` tBB=${tMinX},${tMinY}-${tMaxX},${tMaxY}`;

          if (roomTileExits.length > 0) {
            rd += ` rtExits=[${roomTileExits.map(r =>
              `L${r.destLevelId}@${r.subX},${r.subY}`).join(' ')}]`;
          }
          if (presetBosses.length > 0) {
            rd += ` presets=[${presetBosses.map(p =>
              `c${p.classId}@${p.subX},${p.subY}`).join(' ')}]`;
          }
          if (presetWaypoints.length > 0) {
            rd += ` pWP=[${presetWaypoints.map(p =>
              `${p.subX},${p.subY}`).join(' ')}]`;
          }
          if (presetNPCs.length > 0) {
            rd += ` pNPC=[${presetNPCs.map(p =>
              `c${p.classId}@${p.absSubX},${p.absSubY}`).join(' ')}]`;
          }
          if (presetCairnStones.length > 0) {
            rd += ` pCS=[${presetCairnStones.map(p =>
              `${p.subX},${p.subY}`).join(' ')}]`;
          }

          // Convert absolute tile bounds to subtile space and match outdoor exits
          if (tMinX < Infinity) {
            const sMinX = tMinX * 5, sMinY = tMinY * 5;
            const sMaxX = tMaxX * 5, sMaxY = tMaxY * 5;
            rd += ` sBB=${sMinX},${sMinY}-${sMaxX},${sMaxY}`;

            curLevelBounds = {
              minX: sMinX, minY: sMinY,
              maxX: sMaxX, maxY: sMaxY,
            };

            // Match outdoor exits by finding shared tile borders.
            // Each outdoor adj level's Room2 bounding box should share an
            // edge with the current level's Room2 bounding box.  The exit
            // marker is placed at the center of that shared edge.
            const mapAdj2 = MAP_EDGE_ADJACENCY[currentLevelId] || [];
            const TOL = 2; // tolerance in tiles for border alignment

            for (const adjId of mapAdj2) {
              const coords = adjLevelCoords.get(adjId);
              if (!coords) continue;

              const aBX = coords.backX;
              const aBY = coords.backY;
              const aEX = aBX + coords.sizeX;
              const aEY = aBY + coords.sizeY;

              let exitSubX = 0, exitSubY = 0;
              let found = false;
              let side = '';

              // East border: adj starts where current ends in X
              if (Math.abs(aBX - tMaxX) <= TOL) {
                const oMinY = Math.max(aBY, tMinY);
                const oMaxY = Math.min(aEY, tMaxY);
                if (oMinY < oMaxY) {
                  exitSubX = tMaxX * 5;
                  exitSubY = Math.round((oMinY + oMaxY) / 2) * 5;
                  found = true; side = 'E';
                }
              }
              // West border: adj ends where current starts in X
              if (!found && Math.abs(aEX - tMinX) <= TOL) {
                const oMinY = Math.max(aBY, tMinY);
                const oMaxY = Math.min(aEY, tMaxY);
                if (oMinY < oMaxY) {
                  exitSubX = tMinX * 5;
                  exitSubY = Math.round((oMinY + oMaxY) / 2) * 5;
                  found = true; side = 'W';
                }
              }
              // South border: adj starts where current ends in Y
              if (!found && Math.abs(aBY - tMaxY) <= TOL) {
                const oMinX = Math.max(aBX, tMinX);
                const oMaxX = Math.min(aEX, tMaxX);
                if (oMinX < oMaxX) {
                  exitSubX = Math.round((oMinX + oMaxX) / 2) * 5;
                  exitSubY = tMaxY * 5;
                  found = true; side = 'S';
                }
              }
              // North border: adj ends where current starts in Y
              if (!found && Math.abs(aEY - tMinY) <= TOL) {
                const oMinX = Math.max(aBX, tMinX);
                const oMaxX = Math.min(aEX, tMaxX);
                if (oMinX < oMaxX) {
                  exitSubX = Math.round((oMinX + oMaxX) / 2) * 5;
                  exitSubY = tMinY * 5;
                  found = true; side = 'N';
                }
              }

              if (found) {
                roomExits.push({
                  subX: exitSubX, subY: exitSubY,
                  destLevelId: adjId,
                });
                // rd += ` border:L${adjId}@${exitSubX},${exitSubY}(${side})`;
              } else {
                // rd += ` noBorder:L${adjId}`
                //     + `(cur=${tMinX},${tMinY}-${tMaxX},${tMaxY}`
                //     + ` adj=${aBX},${aBY}-${aEX},${aEY})`;
              }
            }
          }

          if (roomExits.length > 0) {
            // rd += ` rExits=[${roomExits.map(r =>
            //   `L${r.destLevelId}@${r.subX},${r.subY}`).join(' ')}]`;
          }
        }
      } catch (e) {
        rd += ` rwErr=${e.message}`;
      }

      return true; // signal success
    }, 500);

    if (locked !== true) {
      this._rebuildDiag = rd + ' LOCK';
      return;
    }

    // Filter tile units: only keep tiles within current level bounds.
    // This excludes tiles from adjacent dungeon levels loaded in memory
    // whose positions are in a different part of the game world grid.
    if (curLevelBounds) {
      const margin = 10; // small margin for edge tiles
      const lb = curLevelBounds;
      for (let i = tileUnits.length - 1; i >= 0; i--) {
        const t = tileUnits[i];
        if (t.posX < lb.minX - margin || t.posX > lb.maxX + margin ||
            t.posY < lb.minY - margin || t.posY > lb.maxY + margin) {
          rd += ` tOOB:c${t.classId}@${t.posX},${t.posY}`;
          tileUnits.splice(i, 1);
        }
      }
    }
    rd += ` cw=${centerWarps.length}`;

    // ===== Scan game objects (Source 3) =====
    // Objects (type 2) also use static paths — posX/posY on the unit struct
    // may be zero.  Read position from pStaticPath+0x10/+0x14 under a lock.
    const objCandidates = []; // { cid, px, py }
    const objects = this._objMgr.getUnits(2);
    if (objects) {
      tryWithGameLock(() => {
        for (const [, obj] of objects) {
          const cid = obj.classId;
          // Also pick up Cairn Stone classIds in Stony Field for Tristram portal
          const isCairnStone = currentLevelId === 4 && CAIRN_STONE_CLASS_IDS.has(cid);
          if (!isCairnStone && !WAYPOINT_CLASS_IDS.has(cid) &&
              !(QUEST_OBJECT_IDS.has(cid) && currentLevelId !== 75)) continue;

          let px = obj.posX;
          let py = obj.posY;

          // Read from static path if unit-level position is zero
          if (px === 0 && py === 0) {
            try {
              const addr = obj._address;
              if (addr && addr !== 0n) {
                const pathBuf = readMemoryFast(addr + 0x38n, 8);
                const pathPtr = new DataView(pathBuf.buffer, pathBuf.byteOffset)
                  .getBigUint64(0, true);
                if (pathPtr && pathPtr !== 0n) {
                  const posBuf = readMemoryFast(pathPtr + 0x10n, 8);
                  const pdv = new DataView(posBuf.buffer, posBuf.byteOffset);
                  px = pdv.getUint32(0, true);
                  py = pdv.getUint32(4, true);
                }
              }
            } catch (_) {}
          }
          if (px === 0 && py === 0) continue;
          objCandidates.push({ cid, px, py });
        }
        return true;
      }, 200);
    }

    let wpCount = 0;
    let questCount = 0;
    for (const { cid, px, py } of objCandidates) {
      if (WAYPOINT_CLASS_IDS.has(cid)) {
        const c = subtileToClient(px, py);
        this._pois.push({
          subX: px, subY: py,
          clientX: c.x, clientY: c.y,
          destLevelId: 0, poiType: POI_WAYPOINT, label: 'Waypoint',
          showLine: true,
        });
        wpCount++;
      } else if (currentLevelId === 4 && CAIRN_STONE_CLASS_IDS.has(cid)) {
        // Cairn Stones collected for Tristram portal centroid — skip as quest POI
        continue;
      } else if (QUEST_OBJECT_IDS.has(cid) && currentLevelId !== 75) {
        // In Stony Field, skip the Tome marker (user doesn't need it)
        if (currentLevelId === 4 && cid === 8) continue;
        const c = subtileToClient(px, py);
        this._pois.push({
          subX: px, subY: py,
          clientX: c.x, clientY: c.y,
          destLevelId: 0, poiType: POI_QUEST,
          label: QUEST_OBJECT_IDS.get(cid) || 'Quest',
          showLine: true,
        });
        questCount++;
      }
    }

    // --- Tristram portal from ObjectManager Cairn Stones (fallback) ---
    // If preset-based detection found nothing, try using Cairn Stone
    // objects from the ObjectManager (only works when player is nearby).
    if (currentLevelId === 4 && presetCairnStones.length === 0) {
      const cairnObjs = objCandidates.filter(o => CAIRN_STONE_CLASS_IDS.has(o.cid));
      if (cairnObjs.length > 0) {
        let sumX = 0, sumY = 0;
        for (const co of cairnObjs) { sumX += co.px; sumY += co.py; }
        const cx = Math.round(sumX / cairnObjs.length);
        const cy = Math.round(sumY / cairnObjs.length);
        const sc = subtileToClient(cx, cy);
        this._pois.push({
          subX: cx, subY: cy,
          clientX: sc.x, clientY: sc.y,
          destLevelId: 38, poiType: POI_GOOD_EXIT,
          label: '\u2605 Tristram',
          showLine: true,
        });
        rd += ` tristramObj=${cx},${cy}(${cairnObjs.length}stones)`;
      }
    }
    // Add preset-discovered waypoints not already found via ObjectManager.
    // Preset waypoints come from Room2.ptPresetUnits and are available
    // at any distance, unlike ObjectManager which only has nearby objects.
    if (presetWaypoints.length > 0) {
      // Check if we already have a waypoint POI within ~50 subtiles of a preset
      const existingWPs = this._pois.filter(p => p.poiType === POI_WAYPOINT);
      for (const pw of presetWaypoints) {
        const alreadyCovered = existingWPs.some(wp =>
          Math.abs(wp.subX - pw.subX) < 50 && Math.abs(wp.subY - pw.subY) < 50);
        if (!alreadyCovered) {
          const c = subtileToClient(pw.subX, pw.subY);
          this._pois.push({
            subX: pw.subX, subY: pw.subY,
            clientX: c.x, clientY: c.y,
            destLevelId: 0, poiType: POI_WAYPOINT, label: 'Waypoint',
            showLine: true,
          });
          wpCount++;
          rd += ` presetWP@${pw.subX},${pw.subY}`;
        }
      }
    }
    rd += ` wp=${wpCount} q=${questCount}`;

    // ===== Boss monster POIs =====
    // Prefer preset data (from Room2.ptPresetUnits) — always available
    // regardless of distance.  Fall back to live monster scan if no presets.
    const bossMap = BOSS_MONSTERS[currentLevelId];
    let bossCount = 0;
    if (bossMap) {
      // Special handling for Nihlathak (level 124): the preset NPC spawns
      // on the OPPOSITE side from Nihlathak's actual position.  Use the
      // flip table to compute his real location from the NPC preset.
      if (currentLevelId === 124 && presetBosses.length === 0 && presetNPCs.length > 0 && curLevelBounds) {
        // curLevelBounds is in subtiles; preset positions are also subtiles
        const lvlOrigX = curLevelBounds.minX;
        const lvlOrigY = curLevelBounds.minY;
        for (const npc of presetNPCs) {
          // Level-relative subtile position
          const levelRelX = npc.absSubX - lvlOrigX;
          const levelRelY = npc.absSubY - lvlOrigY;
          const key = `${levelRelX},${levelRelY}`;
          const flip = NIHLATHAK_FLIP[key];
          if (flip) {
            // flip values are also level-relative subtiles
            const absSubX = lvlOrigX + flip[0];
            const absSubY = lvlOrigY + flip[1];
            presetBosses.push({ subX: absSubX, subY: absSubY, classId: 526, label: 'Nihlathak' });
            rd += ` nihlFlip:${key}->${flip[0]},${flip[1]}`;
            break;
          }
        }
      }

      if (presetBosses.length > 0) {
        for (const pb of presetBosses) {
          const c = subtileToClient(pb.subX, pb.subY);
          this._pois.push({
            subX: pb.subX, subY: pb.subY,
            clientX: c.x, clientY: c.y,
            destLevelId: 0, poiType: POI_NPC,
            label: pb.label, showLine: true,
          });
          bossCount++;
          rd += ` presetBoss:${pb.classId}(${pb.label})@${pb.subX},${pb.subY}`;
        }
      } else {
        // Fallback: scan live monsters (only works when nearby)
        const monsters = this._objMgr.getUnits(1);
        if (monsters) {
          tryWithGameLock(() => {
            for (const [, mon] of monsters) {
              const label = bossMap.get(mon.classId);
              if (!label) continue;

              const px = mon.posX;
              const py = mon.posY;
              if (px === 0 && py === 0) continue;

              const c = subtileToClient(px, py);
              this._pois.push({
                subX: px, subY: py,
                clientX: c.x, clientY: c.y,
                destLevelId: 0, poiType: POI_NPC,
                label, showLine: true,
              });
              bossCount++;
              rd += ` liveBoss:${mon.classId}(${label})@${px},${py}`;
            }
            return true;
          }, 200);
        }
      }
      this._needsBossRescan = (bossCount === 0);
    } else {
      this._needsBossRescan = false;
    }
    rd += ` boss=${bossCount}`;

    // ===== Build exit POIs =====
    // Strategy: Two-phase approach.
    //
    // Phase 1: Use tiles that have KNOWN destinations (from ptRoomTiles
    //          memory reads). These are authoritative.
    // Phase 2: Outdoor exits from shared tile border detection (roomExits).

    const mapAdj = MAP_EDGE_ADJACENCY[currentLevelId] || [];
    const allAdj = LEVEL_ADJACENCY[currentLevelId] || [];
    const mapAdjSet = new Set(mapAdj);
    const usedAdj = new Set();

    // Diagnostic: show adj level centers
    const adjDiag = [];
    for (const adjId of allAdj) {
      const coords = adjLevelCoords.get(adjId);
      if (coords) {
        const kind = mapAdjSet.has(adjId) ? 'O' : 'D';
        adjDiag.push(`${kind}:L${adjId}(${LEVEL_NAMES[adjId]||'?'})@${coords.centerSubX},${coords.centerSubY}`);
      } else {
        adjDiag.push(`L${adjId}(${LEVEL_NAMES[adjId]||'?'})=NOCOORDS`);
      }
    }
    rd += ` adj=[${adjDiag.join(' ')}]`;

    // --- Phase 1: Tiles with known destinations ---
    const usedTiles = new Set();
    const matchDiag = [];
    for (let i = 0; i < tileUnits.length; i++) {
      const t = tileUnits[i];
      if (!t.destLevelId || t.destLevelId === 0) continue;
      if (usedAdj.has(t.destLevelId)) continue; // already matched
      // Verify this dest is in the adj list
      if (!allAdj.includes(t.destLevelId)) continue;

      const c = subtileToClient(t.posX, t.posY);
      this._pois.push({
        subX: t.posX, subY: t.posY,
        clientX: c.x, clientY: c.y,
        destLevelId: t.destLevelId, poiType: POI_EXIT,
        label: LEVEL_NAMES[t.destLevelId] || `Level ${t.destLevelId}`,
        showLine: true,
      });
      usedAdj.add(t.destLevelId);
      usedTiles.add(i);
      matchDiag.push(`c${t.classId}→KNOWN:L${t.destLevelId}`);
    }
    rd += ` known=[${matchDiag.join(' ')}]`;

    // --- Phase 1.5: Room2 ptRoomTiles exits ---
    // Fills in destinations not yet covered by tile exits.  These come
    // from scanning ptRoomTiles on every Room2 in the current level,
    // giving ALL exit positions (including tombs in Canyon of the Magi
    // that aren't visible as tile units due to distance).
    const rtDiag = [];
    for (const rte of roomTileExits) {
      if (usedAdj.has(rte.destLevelId)) continue;
      if (!allAdj.includes(rte.destLevelId)) continue;
      const c = subtileToClient(rte.subX, rte.subY);
      this._pois.push({
        subX: rte.subX, subY: rte.subY,
        clientX: c.x, clientY: c.y,
        destLevelId: rte.destLevelId, poiType: POI_EXIT,
        label: LEVEL_NAMES[rte.destLevelId] || `Level ${rte.destLevelId}`,
        showLine: true,
      });
      usedAdj.add(rte.destLevelId);
      rtDiag.push(`rt→L${rte.destLevelId}@${rte.subX},${rte.subY}`);
    }
    if (rtDiag.length > 0) rd += ` rtMatch=[${rtDiag.join(' ')}]`;

    // --- Phase 2: Outdoor exits from shared tile border detection ---
    // roomExits has { subX, subY, destLevelId } placed at the center
    // of the shared border between current and adjacent level Room2 grids.
    const outdoorDiag = [];
    for (const re of roomExits) {
      if (usedAdj.has(re.destLevelId)) continue;
      const c = subtileToClient(re.subX, re.subY);
      this._pois.push({
        subX: re.subX, subY: re.subY,
        clientX: c.x, clientY: c.y,
        destLevelId: re.destLevelId, poiType: POI_EXIT,
        label: LEVEL_NAMES[re.destLevelId] || `Level ${re.destLevelId}`,
        showLine: true,
      });
      usedAdj.add(re.destLevelId);
      outdoorDiag.push(`room→O:L${re.destLevelId}@${re.subX},${re.subY}`);
    }
    // rd += ` outdoorMatch=[${outdoorDiag.join(' ')}]`;

    // --- Tal Rasha tomb detection ---
    // In Canyon of the Magi (level 46), mark the real tomb green with a
    // line and suppress lines for other tombs (marker only).
    for (const p of this._pois) {
      if (currentLevelId === 46 && p.destLevelId >= 66 && p.destLevelId <= 72) {
        if (this._isRealTalRashaTomb(p.destLevelId)) {
          p.poiType = POI_GOOD_EXIT;
          p.label = '\u2605 ' + (LEVEL_NAMES[p.destLevelId] || `Level ${p.destLevelId}`) + ' (Real)';
          p.showLine = true;
        } else {
          // Fake tomb: keep marker but suppress line
          p.showLine = false;
        }
      }
    }

    // --- Tristram portal detection ---
    // In Stony Field (level 4), the Cairn Stones mark the portal to
    // Tristram (level 38).  Use the centroid of all found Cairn Stone
    // presets as the portal location and mark it green with a line.
    if (currentLevelId === 4 && presetCairnStones.length > 0) {
      let sumX = 0, sumY = 0;
      for (const cs of presetCairnStones) { sumX += cs.subX; sumY += cs.subY; }
      const cx = Math.round(sumX / presetCairnStones.length);
      const cy = Math.round(sumY / presetCairnStones.length);
      const sc = subtileToClient(cx, cy);
      this._pois.push({
        subX: cx, subY: cy,
        clientX: sc.x, clientY: sc.y,
        destLevelId: 38, poiType: POI_GOOD_EXIT,
        label: '\u2605 Tristram',
        showLine: true,
      });
      // rd += ` tristram=${cx},${cy}(${presetCairnStones.length}stones)`;
    }

    // Keep exit lines focused on progression to reduce draw churn.
    // Markers still render for all exits; this only controls line drawing.
    const nextExitSet = new Set(NEXT_EXITS[currentLevelId] || []);
    for (const p of this._pois) {
      if (p.poiType === POI_EXIT) {
        if (p.showLine !== false) {
          p.showLine = nextExitSet.has(p.destLevelId);
        }
      } else if (p.showLine === undefined) {
        p.showLine = true;
      }
    }

    const exitCount = this._pois.filter(p =>
      p.poiType === POI_EXIT || p.poiType === POI_GOOD_EXIT).length;
    // rd += ` e=${exitCount} pois=${this._pois.length}`;
    // this._rebuildDiag = rd;
    // console.log(`[EXIT-DIAG] ${rd}`);
    // try { appendFileSync('exit-diag.log', `${new Date().toISOString()} ${rd}\n`); } catch(_) {}
    this._lastRebuild = Date.now();
  }

  // -----------------------------------------------------------------------
  // Detect the "real" Tal Rasha's Tomb: uses dwStaffLevelOffset read from
  // D2DrlgStrc+0x120 during _rebuild.  The offset (0-6) added to 66 gives
  // the real tomb level ID.
  // -----------------------------------------------------------------------
  _isRealTalRashaTomb(tombLevelId) {
    return this._realTombLevel > 0 && tombLevelId === this._realTombLevel;
  }

  // -----------------------------------------------------------------------
  // Convert POI positions to screen coords and draw markers.
  // -----------------------------------------------------------------------
  _redraw(me) {
    this._clearExits();

    if (this._pois.length === 0) {
      const diag = this._rebuildDiag || 'rebuilding...';
      // Suppress onscreen diagnostic during normal use. Use logs if needed.
      // background.addText('exit-diag', [20, 40], COLOR_DIAG,
      //   `Level ${this._levelId}: ${diag}`);
      // this._exitKeys.add('exit-diag');
      return;
    }

    // Convert client coords → screen coords under game lock.
    // worldToAutomap returns (-1,-1) sentinel when automap is unavailable.
    // Off-screen POIs may have negative screen coords but should still be
    // included so lines from the player to distant POIs remain visible
    // (ImGui clips the invisible portion automatically).
    const results = [];
    const playerSX = me.automapX;
    const playerSY = me.automapY;
    tryWithGameLock(() => {
      for (let i = 0; i < this._pois.length; i++) {
        const p = this._pois[i];
        const screen = worldToAutomap(p.clientX, p.clientY);
        // Skip only the (-1,-1) sentinel (automap unavailable);
        // allow negative screen coords (off-screen but line still visible)
        if (screen.x === -1 && screen.y === -1) continue;
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
        if (Math.abs(screen.x) > SCREEN_COORD_MAX ||
            Math.abs(screen.y) > SCREEN_COORD_MAX) continue;
        results.push({
          idx: i, cx: screen.x, cy: screen.y,
          destId: p.destLevelId, poiType: p.poiType, label: p.label,
          showLine: p.showLine !== false,
        });
      }
    }, 100);

    // Draw outside lock — lines from player to all POIs
    for (const r of results) {
      this._drawPoi(r.idx, r.cx, r.cy, r.poiType, r.label, playerSX, playerSY, r.showLine);
    }

    // Minimal diagnostic (top-left)
    const exitCount = results.filter(r =>
      r.poiType === POI_EXIT || r.poiType === POI_GOOD_EXIT).length;
    const wpCount = results.filter(r => r.poiType === POI_WAYPOINT).length;
    let diagParts = [];
    if (exitCount > 0) diagParts.push(`${exitCount} exit${exitCount > 1 ? 's' : ''}`);
    if (wpCount > 0) diagParts.push(`${wpCount} WP`);
    const diagText = `Lv${this._levelId}: ${exitCount}E ${wpCount}WP | ${this._rebuildDiag || ''}`;
    // background.addText('exit-diag', [20, 40], COLOR_DIAG, diagText);
    // this._exitKeys.add('exit-diag');
  }

  // -- drawing helpers -------------------------------------------------------

  _drawPoi(idx, cx, cy, poiType, label, playerSX, playerSY, showLine) {
    const k = `poi-${idx}`;

    // Pick colors based on POI type
    let diamondColor, lineColor;
    switch (poiType) {
      case POI_WAYPOINT:
        diamondColor = COLOR_WP;
        lineColor = COLOR_WP_LINE;
        break;
      case POI_GOOD_EXIT:
        diamondColor = COLOR_GOOD_EXIT;
        lineColor = COLOR_GOOD_LINE;
        break;
      case POI_QUEST:
        diamondColor = COLOR_QUEST;
        lineColor = COLOR_QUEST_LINE;
        break;
      case POI_NPC:
        diamondColor = COLOR_NPC;
        lineColor = COLOR_NPC_LINE;
        break;
      default: // POI_EXIT
        diamondColor = COLOR_EXIT;
        lineColor = COLOR_LINE;
        break;
    }

    // --- Line from player to POI (only for progression exits / waypoints) ---
    if (showLine &&
        Number.isFinite(playerSX) && Number.isFinite(playerSY) &&
        Number.isFinite(cx) && Number.isFinite(cy) &&
        playerSX >= 0 && playerSY >= 0 &&
        Math.abs(playerSX) <= SCREEN_COORD_MAX &&
        Math.abs(playerSY) <= SCREEN_COORD_MAX &&
        Math.abs(cx) <= SCREEN_COORD_MAX &&
        Math.abs(cy) <= SCREEN_COORD_MAX) {
      background.addLine(`${k}-line`, [playerSX, playerSY], [cx, cy],
        lineColor, EXIT_LINE_THICK);
      this._exitKeys.add(`${k}-line`);

      // Mid-line label: show destination name partway along the line
      // so the user can see where each line leads before reaching the diamond.
      const dx = cx - playerSX;
      const dy = cy - playerSY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 80 && dist < SCREEN_COORD_MAX) {
        // Place label at a fixed pixel distance from the player (70px along line)
        const t = Math.min(70 / dist, 0.45);
        const mlx = Math.round(playerSX + dx * t);
        const mly = Math.round(playerSY + dy * t);
        const displayMid = label || 'Exit';
        // Offset perpendicular to line direction for readability
        const perpX = Math.round((-dy / dist) * 8);
        const perpY = Math.round((dx / dist) * 8);
        background.addText(`${k}-ml-s`, [mlx + perpX + 1, mly + perpY + 1],
          COLOR_TEXT_SHADOW, displayMid, FONT_SIZE_LINE);
        background.addText(`${k}-ml`, [mlx + perpX, mly + perpY],
          COLOR_LINE_LABEL, displayMid, FONT_SIZE_LINE);
        this._exitKeys.add(`${k}-ml-s`);
        this._exitKeys.add(`${k}-ml`);
      }
    }

    // --- Diamond marker ---
    const dw = poiType === POI_GOOD_EXIT ? DIAMOND_W + 2 : DIAMOND_W;
    const dh = poiType === POI_GOOD_EXIT ? DIAMOND_H + 2 : DIAMOND_H;
    const top    = [cx,      cy - dh];
    const right  = [cx + dw, cy     ];
    const bottom = [cx,      cy + dh];
    const left   = [cx - dw, cy     ];

    background.addLine(`${k}-tl`, top,    right,  diamondColor, LINE_THICK);
    background.addLine(`${k}-tr`, right,  bottom, diamondColor, LINE_THICK);
    background.addLine(`${k}-br`, bottom, left,   diamondColor, LINE_THICK);
    background.addLine(`${k}-bl`, left,   top,    diamondColor, LINE_THICK);

    // --- Text label (shadow + foreground) ---
    const displayName = label || 'Exit';
    background.addText(`${k}-shadow`, [cx + TEXT_OFFSET_X + 1, cy + TEXT_OFFSET_Y + 1],
      COLOR_TEXT_SHADOW, displayName, FONT_SIZE_MARKER);
    background.addText(`${k}-text`, [cx + TEXT_OFFSET_X, cy + TEXT_OFFSET_Y],
      COLOR_TEXT, displayName, FONT_SIZE_MARKER);

    for (const s of ['-line', '-ml-s', '-ml', '-tl', '-tr', '-br', '-bl', '-shadow', '-text']) {
      this._exitKeys.add(k + s);
    }
  }

  _clearExits() {
    // Remove any known diagnostic keys explicitly in case they were added
    // in a prior run and the set wasn't updated.
    try { background.remove('exit-diag'); } catch(_) {}
    try { background.remove('exit-err'); } catch(_) {}
    for (const key of this._exitKeys) background.remove(key);
    this._exitKeys.clear();
  }

  _clearAll() {
    this._clearExits();
    this._levelId = -1;
    this._pois = [];
    this._diagMsg = '';
    this._rebuildDiag = '';
    this._lastRedraw = 0;
  }

  destroy() {
    this._clearAll();
  }
}
