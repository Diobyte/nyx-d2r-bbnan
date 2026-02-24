# D2R Overlay Development Guide

> **Purpose**: Reference document for developing and maintaining the nyx-d2r overlay
> system. Documents what works, what doesn't, critical gotchas, and the memory
> structures that power the overlay. Written from hard-won experience across
> multiple debugging sessions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Build & Deploy Workflow](#build--deploy-workflow)
3. [Memory Structure Reference](#memory-structure-reference)
4. [Coordinate Systems — The #1 Gotcha](#coordinate-systems--the-1-gotcha)
5. [Exit Marker Detection](#exit-marker-detection)
6. [Monster Dot Filtering](#monster-dot-filtering)
7. [Tal Rasha Tomb Detection](#tal-rasha-tomb-detection)
8. [Room2 Preset Unit Scanning](#room2-preset-unit-scanning)
9. [Boss Monster Detection](#boss-monster-detection)
10. [Tristram Portal Detection](#tristram-portal-detection)
11. [Off-Screen POI Rendering](#off-screen-poi-rendering)
12. [Level-Change Rebuild Timing](#level-change-rebuild-timing)
13. [Canvas Drawing API](#canvas-drawing-api)
14. [Common Pitfalls & Dead Ends](#common-pitfalls--dead-ends)
15. [Key Files Reference](#key-files-reference)

---

## Architecture Overview

nyx-d2r is a C++ DLL injected into D2R that embeds a V8 JavaScript engine (via
the "nyx" runtime). The overlay scripts run in V8 and draw on an ImGui overlay
rendered on top of the game.

```
D2R.exe
  └─ nyx.d2r.dll (injected)
       ├─ C++ layer: V8 engine, ImGui overlay, game hooks, memory reading
       ├─ JS runtime: scripts/d2r-demo/index.js (entry point)
       │    ├─ markers.js      — monster/player/missile dots
       │    └─ exit-markers.js — exit markers, waypoints, quest items, lines
       └─ lib/d2r/             — memory models (Unit, Monster, Path, etc.)
```

**Key components:**
- `ObjectManager` — Manages game unit snapshots (players, monsters, objects, tiles)
- `background` (from `'gui'`) — ImGui canvas for persistent drawing primitives
- `tryWithGameLock()` / `withGameLock()` — Acquires game thread lock for safe memory reads
- `readMemoryFast()` — Raw memory reads for struct fields not exposed by models
- `worldToAutomap()` — Converts isometric client coords to screen pixel coords

**Tick loop** (20ms interval in index.js):
1. `objMgr.tick()` — Updates all unit snapshots from game memory
2. `exitMarkers.tick()` — Rebuilds/redraws exit markers
3. `debugPanel.refresh()` — Updates debug overlay
4. Level auto-reveal via `revealLevel()`

---

## Build & Deploy Workflow

### Building
```powershell
cmd /c "cd /d c:\GitHubRepos\nyx-d2r\nyx-d2r && call ""C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"" -arch=x64 -host_arch=x64 && cmake --build out/build/x64-release"
```

### Installing (full deploy)
```powershell
cmd /c "cd /d c:\GitHubRepos\nyx-d2r\nyx-d2r && call ""C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"" -arch=x64 -host_arch=x64 && cmake --install out/build/x64-release"
```

### Hot-deploying scripts only (no D2R restart needed)
When D2R is running, the DLL is locked. But **scripts are read from disk at
injection time**, so you can copy them directly:

```powershell
Copy-Item -Path "scripts\d2r-demo\markers.js" `
          -Destination "out\install\x64-release\bin\scripts\d2r-demo\markers.js" -Force
Copy-Item -Path "scripts\d2r-demo\exit-markers.js" `
          -Destination "out\install\x64-release\bin\scripts\d2r-demo\exit-markers.js" -Force
```

> **Important**: C++ changes (canvas.h/cc, bindings) require a full rebuild AND
> D2R restart. JS-only changes can be hot-deployed by copying scripts and
> re-injecting.

### VS Code tasks
Pre-configured tasks exist for configure/build/install in both debug and release
configurations (see `.vscode/tasks.json`).

---

## Memory Structure Reference

### Unit Types
| Value | Type     | UnitTypes enum |
|-------|----------|----------------|
| 0     | Player   | `UnitTypes.Player` |
| 1     | Monster  | `UnitTypes.Monster` |
| 2     | Object   | `UnitTypes.Object` |
| 3     | Missile  | `UnitTypes.Missile` |
| 4     | Item     | `UnitTypes.Item` |
| 5     | Tile     | `UnitTypes.Tile` |

### D2UnitStrc (Unit) — 0x180 bytes
| Offset | Field | Type | Notes |
|--------|-------|------|-------|
| 0x0000 | type | uint32 | Unit type (see above) |
| 0x0004 | classId | uint32 | MonStats row for monsters, Objects.txt row for objects |
| 0x0008 | id | uint32 | Unique instance ID |
| 0x000C | mode | uint32 | Animation/AI mode |
| 0x0010 | data | ptr | → PlayerData / MonsterData / ObjectData / ItemData |
| 0x0020 | drlgAct | ptr | → D2DrlgActStrc |
| 0x0038 | path | ptr | → D2DynamicPathStrc (players/monsters) or D2StaticPathStrc (tiles/objects) |
| 0x00D4 | posX | int16 | World position X |
| 0x00D6 | posY | int16 | World position Y |
| 0x0124 | flags | uint32 | Unit flags |
| 0x0128 | flagsEx | uint32 | Extended flags |

### D2DynamicPathStrc — Used by Players & Monsters
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0020 | room | ptr → D2ActiveRoomStrc (Room1) |

### D2StaticPathStrc — Used by Tiles & Objects
| Offset | Field | Notes |
|--------|-------|-------|
| **0x0000** | **room** | **ptr → D2ActiveRoomStrc (Room1)** |
| 0x0010 | posX | uint32 — subtile X position |
| 0x0014 | posY | uint32 — subtile Y position |

> **CRITICAL**: Static path Room1 is at offset `+0x00`, NOT `+0x20` like
> DynamicPath. This was a major bug that caused all tile positions to read
> as zero.

### D2ActiveRoomStrc (Room1)
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0018 | ptDrlgRoom | ptr → D2DrlgRoomStrc (Room2) |
| 0x0080 | coords | D2DrlgCoordStrc (subtile + tile coords, 32 bytes) |

### D2DrlgRoomStrc (Room2)
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0010 | ptRoomsNear | vector — **ALWAYS EMPTY in D2R, do not use** |
| 0x0048 | ptDrlgRoomNext | ptr → next Room2 in level's linked list |
| 0x0060 | tRoomCoords | D2DrlgCoordStrc — **absolute tile coordinates** |
| 0x0078 | ptRoomTiles | ptr → linked list of warp tiles |
| 0x0090 | ptLevel | ptr → D2DrlgLevelStrc |

### D2DrlgCoordStrc (Room2.tRoomCoords) — 16 bytes
| Offset | Field | Notes |
|--------|-------|-------|
| 0x00 | backX | int32 — tile X origin |
| 0x04 | backY | int32 — tile Y origin |
| 0x08 | sizeX | int32 — tile width |
| 0x0C | sizeY | int32 — tile height |

### RoomTile (ptRoomTiles) linked list — 24 bytes per node
| Offset | Field | Notes |
|--------|-------|-------|
| 0x00 | pDestRoom | ptr → destination Room2 (different level) |
| 0x08 | pNext | ptr → next RoomTile node |
| 0x10 | nNum | uint32 |

### D2DrlgLevelStrc — 0x280 bytes
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0010 | ptRoomFirst | ptr → first Room2 in this level |
| 0x0028 | tCoords | D2DrlgCoordStrc — **DRLG-relative tiles, NOT absolute** |
| 0x01B8 | ptNextLevel | ptr → next level in linked list |
| 0x01C8 | ptDrlg | ptr → D2DrlgStrc (back-pointer) |
| 0x01E4 | tSeed | D2SeedStrc (8 bytes) |
| 0x01F8 | eLevelId | int32 — level ID |
| 0x0208 | nRoom_Center_Warp_X[9] | int32[9] — center warp X positions |
| 0x022C | nRoom_Center_Warp_Y[9] | int32[9] — center warp Y positions |
| 0x0250 | dwNumCenterWarps | uint32 — number of center warps |

### D2DrlgStrc (ActMisc equivalent) — 0x880 bytes
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0000 | tSeed | D2SeedStrc — current PRNG state |
| **0x0120** | **dwStaffLevelOffset** | **uint32 — real tomb = 66 + this value** |
| 0x0840 | dwInitSeed | uint32 — map seed (encrypted) |
| 0x0860 | dwStartSeed | uint32 — game creation seed |
| 0x0868 | ptLevel | ptr → head of DrlgLevel linked list |
| 0x0870 | nActNo | uint8 |
| 0x0874 | dwBossLevelOffset | uint32 |

### D2DrlgActStrc
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0018 | ptRoom | ptr → D2ActiveRoomStrc |
| 0x0020 | dwActId | uint32 |
| 0x0070 | ptDrlg | ptr → D2DrlgStrc |

### D2MonsterDataStrc
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0000 | txtRecord | ptr → MonStatsTxt |
| 0x001A | typeFlag | uint8 — monster tier (0=normal, 8=unique, 10=super-unique, 12=champion, 16=minion) |
| 0x001B | lastAnimMode | uint8 |
| 0x001C | durielFlag | uint32 |
| 0x0020 | monUMod[10] | uint8[10] — enchant modifiers |
| 0x002A | uniqueId | uint16 — boss line ID |
| 0x003C | ownerType | uint32 — for pets/summons |
| 0x0040 | ownerId | uint32 — for pets/summons |

---

## Coordinate Systems — The #1 Gotcha

**There are THREE different coordinate systems. Confusing them causes invisible
markers or markers in wrong positions.**

### 1. Game-world subtile coordinates
- Used by: unit positions (posX/posY), StaticPath posX/posY
- Scale: 1 tile = 5 subtiles
- These are absolute — same across all levels in the same act
- **worldToAutomap() expects ISOMETRIC CLIENT coords, not subtiles directly**

### 2. Room2 absolute tile coordinates (tRoomCoords)
- Used by: `Room2+0x60` (D2DrlgCoordStrc)
- These are absolute tiles — multiply by 5 to get subtile coords
- Same coordinate space as game-world subtiles (just ÷5)
- **Use these for bounding boxes and border detection**

### 3. DrlgLevel DRLG-relative tile coordinates (tCoords at +0x28)
- Used by: `DrlgLevel+0x28`
- **DIFFERENT coordinate system from Room2 absolute tiles**
- Values like ~5600 vs Room2 absolute ~15000 for the same level
- **NEVER use these for positioning markers**

### Converting subtiles to screen
```javascript
// Step 1: subtile → isometric client coords
function subtileToClient(subX, subY) {
  return { x: (subX - subY) * 16, y: (subX + subY) * 8 };
}

// Step 2: isometric client → screen pixel (requires game lock)
const screen = worldToAutomap(clientX, clientY);
// screen.x, screen.y = pixel coords on screen
```

### Key insight: Room2 tile * 5 = subtile coords
This was verified empirically:
```
Room2 walk tBB = 3004,1154 → *5 = 15020,5770
ActiveRoom sBB = 15020,5770  ✓ matches exactly
```

---

## Exit Marker Detection

Exit markers use two complementary detection strategies:

### Strategy 1: Tile Units (Type 5) with ptRoomTiles
**Works for**: Dungeon entrances, stairs, portals, doorway warps.

How it works:
1. Read all Type 5 units from ObjectManager
2. For each tile, read static path (+0x00 → Room1, +0x10/+0x14 → position)
3. Read Room1 → Room2 (Room1+0x18)
4. Read Room2+0x78 → ptRoomTiles linked list
5. Walk linked list: each node has [destRoom*, nextTile*]
6. Read destRoom → ptLevel (+0x90) → eLevelId (+0x1F8) = destination level

**What works:**
- ptRoomTiles (Strategy B in code) — **RELIABLE**, gives exact destination level
- Correctly identifies dungeon exits, tower entrances, etc.

**What doesn't work:**
- ptRoomsNear (Strategy A) — **ALWAYS EMPTY in D2R**, dead approach
- Unit data pointer (Strategy C) — **dp=0**, unused

### Strategy 2: Shared Tile Border Detection
**Works for**: Outdoor walk-across transitions (Dark Wood ↔ Black Marsh, etc.)

How it works:
1. Walk current level's Room2 linked list → build bounding box (absolute tiles)
2. Walk each adjacent level's Room2 linked list → build their bounding boxes
3. Compare bounding boxes to find shared edges (N/S/E/W)
4. Place exit marker at center of shared edge

**Why this works when center warps don't:**
Center warps (`DrlgLevel+0x208`) are inter-room connections WITHIN a level, not
level exit positions. They connect rooms that belong to the same level, so
matching them to adjacent levels produces wrong results.

### Out-of-bounds tile filtering
Dungeon tiles from adjacent loaded levels appear in the unit list with positions
far outside the current level (e.g., coords at 7637,9530 when current level is
around 15000,5500). Filter these using the current level's Room2 bounding box
± small margin.

---

## Monster Dot Filtering

### The problem
D2R loads many non-enemy "monster" units: town NPCs, hirelings, critters
(chickens, rats, birds), traps, spawner objects, decorative townsfolk, and
player summons. These all have `UnitType = 1` (Monster), so they appear as dots.

### The solution
There is **no struct-level `isNPC` or `isEnemy` flag** in D2R's memory. The only
reliable way to filter is by `classId` lookup table.

Three filter sets derived from PrimeMH's `npc.rs get_type()`:
- **TOWN_NPC_IDS** (42 entries): Cain, Charsi, Akara, etc.
- **PET_IDS** (23 entries): Hirelings, golems, valkyrie, druid summons, etc.
- **DUMMY_IDS** (60 entries): Critters, traps, spawners, ambient townsfolk

Any monster whose `classId` is NOT in these sets is treated as an enemy.

### typeFlag for monster tier
| Value | Tier | Color | Radius |
|-------|------|-------|--------|
| 0 | Normal | Red | 4 |
| 16 | Minion | Dim red | 3 |
| 12 | Champion | Blue | 6 + ring |
| 8 | Unique | Gold | 7 + ring |
| 10 | Super Unique | Gold | 7 + ring |

### Dead monster filtering
Check `unit.isAlive` (computes `mode !== Death && mode !== Dead`) before drawing.

---

## Tal Rasha Tomb Detection

### The problem
Canyon of the Magi (level 46) has 7 tomb entrances (levels 66-72). Only one is
the "real" tomb containing Duriel's Lair (level 73). The real tomb is randomly
determined per game seed.

### The solution
`D2DrlgStrc+0x0120` contains the real tomb's **level ID** directly (66-72).
In D2R Resurrected, this field stores the actual level ID, not a 0-6 offset.
The code handles both interpretations for safety:

```javascript
if (staffOff >= 66 && staffOff <= 72) {
  this._realTombLevel = staffOff;          // value IS the level ID
} else if (staffOff <= 6) {
  this._realTombLevel = 66 + staffOff;     // fallback: legacy offset
}
```

**Pointer chain to read it:**
```
Player unit (+0x38) → DynamicPath → (+0x20) Room1 → (+0x18) Room2
→ (+0x90) DrlgLevel → (+0x1C8) D2DrlgStrc → (+0x120) dwStaffLevelOffset
```

### Canyon: showing all 7 tombs from waypoint
Tile units (type 5) only load when the player is near each tomb entrance.
To show all 7 markers simultaneously, we scan every Room2 in the current
level's Room2 linked list and check `ptRoomTiles (+0x78)` for connections
to tomb levels. This gives all entrance positions from Room2 centers
(Phase 1.5: `roomTileExits`).

### Canyon special behavior
- Real tomb: green diamond + green line + ★ label
- Fake tombs: magenta diamond (marker only, no line)

---

## Room2 Preset Unit Scanning

### Overview
Every Room2 has a linked list of **preset units** at `Room2+0x98`. These
represent pre-placed objects, monsters, and tiles baked into the map layout
at level generation time. Unlike ObjectManager units (which only exist when
the room is "activated" / nearby), preset data is **always available** for
all rooms in the level.

### D2PresetUnitStrc layout (D2R x64)

**IMPORTANT**: Preset unit types differ from ObjectManager unit types!
- Preset type 0 = object (ObjectManager type 2)
- Preset type 1 = monster (ObjectManager type 1)

```
+0x00  uint32   nUnitType      0=object, 1=monster (NOT same as UnitTypes enum!)
+0x04  uint32   nClassId       txtFileNo / classId
+0x08  uint32   nPosX          X position (room-relative SUBTILES, not tiles)
+0x0C  (padding)
+0x10  ptr      pNext          next node in linked list
+0x18  (padding)
+0x24  uint32   nPosY          Y position (room-relative SUBTILES, not tiles)
```

### Coordinate conversion
Preset positions are **room-relative subtiles** (verified via hex dump).
The Room2 back coordinates are tiles. To get absolute subtiles:
```javascript
// Room2.tRoomCoords.backX is in tiles, preset posX is in subtiles
const absSubX = room2BackX * 5 + presetPosX;
const absSubY = room2BackY * 5 + presetPosY;
```

> **CRITICAL**: The formula is `backTile * 5 + presetSubtile`, NOT
> `(backTile + presetPos) * 5`. The preset positions are already in subtile
> units, confirmed empirically with Nihlathak marker at +0x08=28, rtX=2572:
> `2572*5 + 28 = 12888` (correct) vs `(2572+28)*5 = 13000` (wrong).

### Use cases
| Use case | Preset type | Details |
|----------|-------------|--------|
| Inactive waypoints | type 0, WAYPOINT_CLASS_IDS | Shows WP marker before player activates it |
| Boss positions (Summoner) | type 1, BOSS_MONSTERS classIds | Immediate line to boss from level entry |
| Nihlathak quadrant flip | type 1, any NPC in level 124 | Marker NPC on opposite side → flip coords |
| Tristram portal | type 0, CAIRN_STONE_CLASS_IDS (17-22) | Centroid of Cairn Stones = portal location |

---

## Boss Monster Detection

### Architecture
Boss detection uses a two-tier approach:

1. **Preset scan (preferred)** — during the Room2 walk, scan `ptPresetUnits`
   for monster (type 1) classIds matching `BOSS_MONSTERS[levelId]`. Always
   available regardless of distance.

2. **Live monster scan (fallback)** — if no presets found, scan ObjectManager
   monsters. Only works when the boss's room is loaded (player nearby).

### Configured bosses

| Level | ClassId | Name | Special handling |
|-------|---------|------|------------------|
| 74 (Arcane Sanctuary) | 250 | The Summoner | Direct preset position |
| 124 (Halls of Vaught) | 526 | Nihlathak | Quadrant flip from marker NPC |

### Nihlathak quadrant flip
Nihlathak's actual position is **not** in the preset data. Instead, a marker
NPC spawns on the **opposite** side of the map. PrimeMH's `pois.rs` documents
the flip table (level-relative tile coords):

```javascript
// NIHLATHAK_FLIP: marker position → Nihlathak position
'30,208'  → [395, 210]   // bottom right → top left
'206,32'  → [210, 395]   // bottom left → top right
'207,393' → [210, 25]    // top right → bottom left
'388,216' → [25, 210]    // top left → bottom right
```

Level-relative = `(roomBackX + presetPosX) - levelOriginX` where
`levelOriginX = curLevelBounds.minX / 5` (the minimum tile X across all
Room2s in the level).

### Adding a new boss
1. Find the classId in `PrimeMH/src/memory/types/npc.rs` enum (0-indexed)
2. Add entry to `BOSS_MONSTERS`: `levelId: new Map([[classId, 'Name']])`
3. If the boss uses indirect positioning (like Nihlathak), add special
   handling in the boss POI section

### Inactive waypoint detection
Waypoint objects (preset type 0) may not be in the ObjectManager if the player
hasn't visited the room containing the (unactivated) waypoint. As a fallback,
we scan Room2 preset units for type 0 objects with `WAYPOINT_CLASS_IDS` and
create waypoint POIs from the preset positions when `wpCount === 0`.

---

## Tristram Portal Detection

### The problem
Stony Field (level 4) contains Cairn Stones that open a red portal to Tristram
(level 38). Unlike normal exits, this portal has no tile unit and the Tristram
level has `NOCOORDS` in the adjacency data. The portal needs to be marked as
a special green exit with a line, like the real Tal Rasha tomb.

### How it works

**Primary: Preset-based detection (works from any distance)**
1. During the Room2 preset scan, collect all type 0 (object) presets with
   classIds in `CAIRN_STONE_CLASS_IDS` (17-22: Alpha through Theta)
2. Compute the centroid of all found Cairn Stone positions
3. Create a `POI_GOOD_EXIT` at the centroid with label "★ Tristram"

**Fallback: ObjectManager detection (only when nearby)**
If no preset Cairn Stones found (shouldn't happen with correct type 0 check),
fall back to scanning ObjectManager for classIds 17-22.

### Key classIds
| ClassId | Object | Notes |
|---------|--------|-------|
| 17 | CairnStoneAlpha | Part of the stone circle |
| 18 | CairnStoneBeta | Part of the stone circle |
| 19 | CairnStoneGamma | Part of the stone circle |
| 20 | CairnStoneDelta | Part of the stone circle |
| 21 | CairnStoneLambda | Part of the stone circle (also in QUEST_OBJECT_IDS) |
| 22 | CairnStoneTheta | Part of the stone circle |
| 60 | PermanentTownPortal | Red portal object (NOT used for detection) |
| 61 | (near Cairn Stones) | Unknown object at portal center |

### Display
- Green diamond marker (same as real Tal Rasha tomb)
- Green line from player to portal location
- Label: "★ Tristram"
- Tome marker (classId 8) suppressed in Stony Field (not useful)

---

## Off-Screen POI Rendering

### The problem
When a POI (e.g., The Summoner in Arcane Sanctuary) is very far from the
player, `worldToAutomap()` returns screen coordinates with negative X values.
The original filter `screen.x >= 0` rejected these as invalid, causing the
line and marker to disappear.

### The fix
`worldToAutomap()` returns `(-1, -1)` as a sentinel when the automap system
is unavailable. The filter now only rejects this exact sentinel:
```javascript
if (screen.x === -1 && screen.y === -1) continue; // automap unavailable
// Negative screen.x/y for off-screen POIs is valid — ImGui clips automatically
```

### Why this matters
ImGui automatically clips drawing primitives to the visible screen area.
Off-screen lines and markers render correctly because only the visible
portion is drawn. The line from the player to a far-away POI remains visible
even when the POI itself is off-screen.

---

## Level-Change Rebuild Timing

### The problem
When the player enters a new level, adjacent level data (Room2 lists, bounding
boxes) loads asynchronously. On the first rebuild after entry, `adjFound` may
be 0 or incomplete, causing missing exit markers.

### The fix
Track `_adjExpected` (from LEVEL_ADJACENCY table) vs `_adjFound` (actual adj
levels with Room2 data). When `adjFound < adjExpected`, trigger periodic
rebuilds every ~2 seconds for up to 10 seconds after `_levelChangeTime`:

```javascript
// In tick():
const adjIncomplete = this._adjFound < this._adjExpected;
const timeSinceChange = now - this._levelChangeTime;
if (adjIncomplete && timeSinceChange < 10000 && (now - this._lastRebuild) > 2000) {
  this._rebuild();
}
```

This ensures exits appear even when adjacent level data loads late.

---

## Canvas Drawing API

### Available methods on `background` (Canvas object)
```typescript
// Lines
addLine(key: string, p1: [x, y], p2: [x, y], color: number, thickness?: number): void;

// Shapes
addRect(key: string, p1: [x, y], p2: [x, y], color: number, rounding?: number, flags?: number, thickness?: number): void;
addRectFilled(key: string, p1: [x, y], p2: [x, y], color: number, rounding?: number, flags?: number): void;
addCircle(key: string, center: [x, y], radius: number, color: number, segments?: number): void;
addCircleFilled(key: string, center: [x, y], radius: number, color: number, segments?: number): void;

// Text
addText(key: string, pos: [x, y], color: number, text: string, fontSize?: number): void;
// fontSize: 0 or omitted = ImGui default (~13px). Custom sizes use ImGui's
// AddText(font, font_size, ...) overload internally (added Feb 2026).

// Cleanup
remove(key: string): void;
clear(): void;
```

### Color format
`0xAABBGGRR` — Alpha, Blue, Green, Red (ImGui's `IM_COL32` format, NOT web RGBA).

Examples:
- `0xFF0000FF` = opaque red
- `0x80FF00FF` = 50% alpha magenta
- `0xFF00FF00` = opaque green
- `0xFF00FFFF` = opaque yellow (R=FF, G=FF, B=00)

### Key management
Each primitive is identified by a string key. Calling `addLine/addText/etc.` with
the same key replaces the previous primitive. Use `remove(key)` to delete.

Track all keys in a `Set` and clear them on redraw to avoid stale primitives.

---

## Common Pitfalls & Dead Ends

### ❌ ptRoomsNear is ALWAYS empty
`Room2+0x10` (ptRoomsNear vector begin/end) consistently reads as zero in D2R.
This was the classic D2LOD approach for finding adjacent level rooms. **Do not
waste time on this** — it's a dead end in D2R.

### ❌ Center warps are NOT level exits
`DrlgLevel.nRoom_Center_Warp_X/Y` are inter-room connections WITHIN a level.
They do NOT point to where level transitions occur. Matching them to adjacent
levels produces seemingly random results.

### ❌ DrlgLevel.tCoords uses a different coordinate system
`DrlgLevel+0x28` (tCoords) uses DRLG-relative tiles. Room2.tRoomCoords uses
absolute tiles. The offset between them varies by level and is NOT a simple
constant. **Never use tCoords for absolute positioning.**

### ❌ Unit data pointer (pUnitData) is zero for tiles
`unit+0x10` for tile units reads as `0n`. Cannot be used for destination lookup.

### ❌ Monster typeFlag does NOT distinguish NPCs
`typeFlag = 0` applies to regular monsters, town NPCs, hirelings, critters,
and dummies alike. You MUST use `classId` lookup to filter non-enemies.

### ✅ StaticPath Room1 is at +0x00, not +0x20
Tile and object units use D2StaticPathStrc. Room1 pointer is at offset `+0x00`.
DynamicPath (players/monsters) has Room1 at `+0x20`. Mixing these up causes
all tile positions to read as garbage.

### ✅ Room2 absolute tile * 5 = game-world subtile
Verified empirically. This is the correct conversion.

### ✅ ptRoomTiles walks give accurate destination levels
Strategy B in the tile reading code. Walk the linked list at Room2+0x78.
Each node's first qword is a destination Room2 pointer → ptLevel → eLevelId.

### ✅ Shared tile border detection works for outdoor exits
Compare Room2 bounding boxes of current and adjacent levels. Shared edge
(within TOL=2 tile tolerance) gives both direction and position.

### ✅ dwStaffLevelOffset gives the real tomb
`D2DrlgStrc+0x120` — value is the actual level ID (66-72) in D2R. The code
also handles a legacy interpretation as a 0-6 offset for safety.

### ✅ Room2 ptPresetUnits gives boss/waypoint/portal positions
`Room2+0x98` → linked list of `D2PresetUnitStrc`. Available for ALL rooms
regardless of player distance. Used for immediate boss lines (Summoner,
Nihlathak), inactive waypoint detection, and Tristram portal detection.

### ✅ Preset type 0 = object, type 1 = monster
D2PresetUnitStrc type field uses DIFFERENT values than ObjectManager unit types.
Preset type 0 = object (ObjMgr type 2), type 1 = monster (ObjMgr type 1).
Confirmed via diagnostic dump: Cairn Stones (classIds 17-22) appear as `t0`.
**This was a major bug that prevented Cairn Stone and waypoint preset detection.**

### ✅ Preset positions are room-relative SUBTILES, not tiles
Confirmed via hex dump of Nihlathak marker. The formula is
`absSubX = roomBackTile * 5 + presetSubX`, NOT `(backTile + presetPos) * 5`.

### ⚠️ Off-screen POIs have negative screen coordinates
`worldToAutomap()` returns negative X/Y for POIs far from the player. This is
valid — ImGui clips automatically. Only reject the sentinel `(-1, -1)` which
means the automap system is unavailable. Do NOT filter `screen.x >= 0`.

### ⚠️ Adjacent levels load asynchronously after level change
When entering a new level, `adjFound` may be 0 initially. Rebuild periodically
for ~10 seconds until `adjFound` matches `adjExpected`.

### ⚠️ Adjacent level Room2 lists may not be loaded
When in Canyon of the Magi, the tomb level Room2 lists (`DrlgLevel.ptRoomFirst`)
are null because those levels haven't been visited. This means shared border
detection fails. For unvisited dungeon levels, you must rely on tile units
(Strategy 1) which appear as the player approaches the entrance.

### ⚠️ Game lock required for memory reads
All `readMemoryFast()` calls must happen inside `tryWithGameLock()` or
`withGameLock()`. Without the lock, memory can be modified mid-read causing
crashes or garbage data.

### ⚠️ DLL locked while D2R is running
`cmake --install` will fail to copy the DLL if D2R has it loaded. Either:
1. Close D2R, install, restart D2R
2. Copy just the scripts manually for JS-only changes

---

## Key Files Reference

### Source (editable)
| File | Purpose |
|------|---------|
| `scripts/d2r-demo/index.js` | Entry point — sets up ObjectManager, tick loop, auto-reveal |
| `scripts/d2r-demo/markers.js` | Monster/player dots with classId filtering |
| `scripts/d2r-demo/exit-markers.js` | Exit markers, waypoints, quest items, lines |
| `lib/d2r/models.js` | Memory model definitions (Unit, Monster, Path, DRLG, etc.) |
| `lib/d2r/monster.js` | Monster class with isAlive, isAttacking, monsterData |
| `lib/d2r/types.js` | Enums: MonsterModes, UnitTypes |
| `src/d2r_structs.h` | C struct definitions for all D2R memory structures |
| `vendor/nyx/src/nyx/gui/canvas.h` | Canvas Primitive struct (C++) |
| `vendor/nyx/src/nyx/gui/canvas.cc` | Canvas rendering + addText with font size |
| `vendor/nyx/typings/gui.d.ts` | TypeScript typings for gui module |

### Build output
| Path | Notes |
|------|-------|
| `out/build/x64-release/nyx.d2r.dll` | Built DLL |
| `out/install/x64-release/bin/` | Installed DLL + scripts + typings |
| `out/install/x64-release/bin/scripts/d2r-demo/` | Deployed scripts (hot-deployable) |

### Reference (read-only)
| File | What to learn from it |
|------|----------------------|
| `PrimeMH/src/memory/types/npc.rs` | Monster classId → NPC type classification |
| `PrimeMH/src/memory/structs.rs` | Rust struct definitions matching D2R memory |
| `PrimeMH/src/mapgeneration/pois.rs` | Preset POI logic (Nihlathak flip, Summoner, seals) |

---

## Pointer Chain Quick Reference

### Player unit → Level ID
```
unit+0x38 → DynamicPath
  +0x20 → Room1 (ActiveRoom)
    +0x18 → Room2 (DrlgRoom)
      +0x90 → DrlgLevel
        +0x1F8 → eLevelId
```

### Player unit → D2DrlgStrc (ActMisc)
```
unit+0x38 → DynamicPath
  +0x20 → Room1
    +0x18 → Room2
      +0x90 → DrlgLevel
        +0x1C8 → D2DrlgStrc
```

### D2DrlgStrc → Level linked list head
```
D2DrlgStrc+0x868 → ptLevel (first DrlgLevel)
  +0x1B8 → ptNextLevel (walk the list)
  +0x1F8 → eLevelId
```

### Tile unit → Destination level
```
tile+0x38 → StaticPath
  +0x00 → Room1  (NOT +0x20!)
    +0x18 → Room2
      +0x78 → ptRoomTiles linked list
        [0] → destRoom2
          +0x90 → DrlgLevel
            +0x1F8 → eLevelId (destination)
```

### Adjacent level Room2 bounding box
```
DrlgLevel+0x10 → ptRoomFirst (first Room2)
  +0x48 → ptDrlgRoomNext (walk list)
  +0x60 → tRoomCoords { backX, backY, sizeX, sizeY } (absolute tiles)
  absolute tile * 5 = game-world subtile
```

### Real tomb detection
```
D2DrlgStrc+0x120 → dwStaffLevelOffset (uint32, value 66-72 = level ID directly)
```

### Room2 preset units
```
Room2+0x98 → ptPresetUnits (first D2PresetUnitStrc)
  +0x00 nUnitType (0=object, 1=monster), +0x04 nClassId,
  +0x08 nPosX (room-relative subtiles), +0x10 pNext,
  +0x24 nPosY (room-relative subtiles)
  absSubX = Room2.backX * 5 + nPosX
```
