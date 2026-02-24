#pragma once

#include <cstddef>
#include <cstdint>

// ═══════════════════════════════════════════════════════════════════════
//  D2R v3.0.26199.0 — Hardcoded RVA offsets reference
//
//  NOTE: nyx-d2r uses pattern scanning (see offsets.h) for version-
//  independent offset resolution.  This file serves as a reference
//  catalogue of known RVAs for v3.0.26199.0 and struct field offsets.
// ═══════════════════════════════════════════════════════════════════════

namespace d2r::offsets {

    // ═══════════════════════════════════════════════════════════════════
    //  D2R v3.0.26199.0 — All RVAs relative to D2R.exe base
    //
    //  Updated from v3.0.26100.0. Regional shift summary:
    //    0x6xxxx  +0x100–0x120    0xCxxxx    +0x380
    //    0x7-8xxx +0x0E0–0x120    0xE-Fxxxx  +0x380
    //    0xBxxxx  +0x160–0x390    0x14xxxx   +0x2D0–0x3C0
    //    0x15xxxx +0x4A0          0x17-18xxx +0x5A0
    //    0x21-2Fxxx +0x530        0x4B-4Cxxx +0xAC0
    //    0x65-68xxx +0xF60–0x1280 0xBE-C0xxx +0x1660–0x1D30
    //    0xD1xxxx +0x26D0
    // ═══════════════════════════════════════════════════════════════════


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 1: GLOBAL VARIABLES
    // ─────────────────────────────────────────────────────────────────

    namespace globals {

        // ── Player / Units ──
        constexpr uintptr_t LocalPlayerIndex   = 0x1EA1354;  // DWORD — current player slot
        constexpr uintptr_t UnitHashTables     = 0x1E9E350;  // Primary unit hash table (6 types × 128 buckets)
        constexpr uintptr_t UnitHashTableAlt   = 0x1E9FB50;  // Secondary table (units with flag 0x200000)
        constexpr uintptr_t ghAct              = 0x1DF1450;  // Global Act pointer
        constexpr uintptr_t GameClient         = 0x1DF1468;  // Game client state (qword, +0x0C = connection seq)
        constexpr uintptr_t PlayerRoster       = 0x1EB4668;  // Roster linked list head

        // ── Game State (struct at 0x1D48040) ──
        //   +0x00  DWORD  CurrentLevelId
        //   +0x04  BYTE   Difficulty
        //   +0x05  BYTE   GameTickReady
        //   +0x06  WORD   CurrentAct
        //   +0x21  BYTE   Loading (session inactive flag)
        //   +0x24  DWORD  InGame
        //   +0x2C  DWORD  PanelFlags
        //   +0x30  QWORD  GameSessionPtr
        //   +0x5C  DWORD  GameMode
        constexpr uintptr_t GameState           = 0x1D48040;
        constexpr uintptr_t CurrentLevelId_GS   = 0x1D48040;  // DWORD
        constexpr uintptr_t GameStateDifficulty = 0x1D48044;  // BYTE — 0=Normal, 1=NM, 2=Hell
        constexpr uintptr_t GameTickReady       = 0x1D48045;  // BYTE
        constexpr uintptr_t CurrentAct          = 0x1D48046;  // WORD — 0-4
        constexpr uintptr_t InGame              = 0x1D48064;  // DWORD — 1=in game (32 xrefs confirmed)
        constexpr uintptr_t Loading             = 0x1D48061;  // BYTE — 0=loading/init, 1=session inactive (39 xrefs)
        constexpr uintptr_t GameMode            = 0x1D4809C;  // DWORD — 0=none, 1-2=connected, 5-8=lobby/menu

        // ── Input / Mouse ──
        constexpr uintptr_t LMB_STATE          = 0x19B417C;  // DWORD — left click state (8 when held)
        constexpr uintptr_t RMB_STATE          = 0x19B4478;  // DWORD — right click state (8/16)
        constexpr uintptr_t LMB_HELD           = 0x1EA13B8;  // DWORD — left mouse held flag
        constexpr uintptr_t RMB_HELD           = 0x1EA13B0;  // DWORD — right mouse held flag
        constexpr uintptr_t ActivityTimer      = 0x1EA13BC;  // DWORD — AFK timer (GetTickCount, 30s timeout)
        constexpr uintptr_t PlayerInputState   = 0x1DF2001;  // BYTE[16*N] — per-player input state

        // ── UI Panels / Dialogs ──
        constexpr uintptr_t PanelFlagsBase     = 0x1EAE040;  // BYTE[] — panel open flags (idx 19 = waypoint, 11 xrefs)
        constexpr uintptr_t WaypointPanelFlag  = 0x1EAE053;  // BYTE — PanelFlags[19]
        constexpr uintptr_t CursorItemState    = 0x1EBAE30;  // DWORD (17 xrefs confirmed)
        constexpr uintptr_t CursorItemId       = 0x1EBAE34;  // DWORD — cursor item guid
        constexpr uintptr_t NPCDialogState     = 0x1EBAE28;  // DWORD
        constexpr uintptr_t TradeMode          = 0x19C9584;  // DWORD
        constexpr uintptr_t PanelMode          = 0x19C9580;  // DWORD
        constexpr uintptr_t NopickupFlag       = 0x1EB46E4;  // BYTE — toggled by /nopickup

        // ── UI Widget System ──
        constexpr uintptr_t WidgetManager      = 0x1ED6678;  // QWORD ptr — widget tree root
        constexpr uintptr_t UIStateHashMap     = 0x1ED6680;  // QWORD ptr — UI component state hash map

        // ── Automap ──
        constexpr uintptr_t AutomapData        = 0x1EB01C8;  // QWORD ptr — active automap context
        constexpr uintptr_t AutomapVisible     = 0x1EA13EE;  // BYTE — toggled by Tab key
        constexpr uintptr_t AutomapBaseScale   = 0x1EB01C0;  // float[2] {scaleX, scaleY}
        constexpr uintptr_t MarkerSpriteDims   = 0x1EB01B0;  // QWORD — packed {LODWORD=width, HIDWORD=height}
        constexpr uintptr_t AutomapScrollOff   = 0x1EAE198;  // int32[2] {scrollX, scrollY} user pan offset
        constexpr uintptr_t ShowPartyMarkers   = 0x1EB01D0;  // DWORD
        constexpr uintptr_t ShowMarkerNames    = 0x1EB01B8;  // DWORD
        constexpr uintptr_t AutomapFontSize    = 0x1EAE1AC;  // DWORD
        constexpr uintptr_t AutomapUnitsSprite = 0x1DF1930;  // QWORD — "AUTOMAP/Units" sprite handle
        constexpr uintptr_t PaletteColors      = 0x1D707B0;  // byte[13×3] — classic RGB for 13 color indices

        // ── Network / Packet Dispatch ──
        constexpr uintptr_t NetworkVtable      = 0x1A048C0;  // vtable at [rax]+30h = send fn
        constexpr uintptr_t S2CHandlerTable   = 0x19B54B0;  // 175 entries × 24 bytes (xref from ProcessServerPacket)
                                                               // {handler:ptr8, size:int32+pad32, secondary:ptr8}
        constexpr uintptr_t PerClassDataArray  = 0x1DF4A20;  // QWORD[] — per-class data ptrs
                                                               // Access: [2 * classIdx], classIdx = difficulty + 1
        constexpr uintptr_t HotkeyTable        = 0x1DF2110;  // Hotkey slot data

        // ── Waypoints ──
        constexpr uintptr_t WaypointFlags      = 0x1C468B0;  // DEAD in v3.0 — now via *(unitData + 8*diff + 64)
        constexpr uintptr_t InteractedEntityId = 0x1EBACBC;  // DWORD — last interacted NPC/object entity ID
        constexpr uintptr_t SelectedWaypointId = 0x1EBACC4;  // WORD — selected waypoint classId
        constexpr uintptr_t WaypointInteractData = 0x1EBACD8; // QWORD ptr — waypoint interaction data
        constexpr uintptr_t WaypointPersistent   = 0x1DF4678; // QWORD ptr — 48×72-byte waypoint menu entries
        constexpr uintptr_t WaypointTable      = 0x19CEB10;  // 43 entries × 28 bytes — classId lookup table
        constexpr uintptr_t WaypointBitPos     = 0x19CFFA0;  // WORD[2*N] — waypoint bit positions (7 code xrefs)
        constexpr uintptr_t WaypointBitMask    = 0x19CFFA2;  // WORD[2*N] — interleaved with BitPos

        // ── Game Creation / Exit ──
        constexpr uintptr_t ExitRequested      = 0x1EA13CC;  // DWORD — 1 when "Save & Exit" requested
        constexpr uintptr_t DisconnectReason   = 0x1EA13D4;  // DWORD — reason code (0-32)
        constexpr uintptr_t DisconnectTimeout  = 0x1EA13A8;  // QWORD — nanosecond timestamp + 2.5s
        constexpr uintptr_t SessionToken       = 0x1D47C2A;  // char[] — session token
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 2: RETCHECK BYPASS
    // ─────────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────────
    //  SECTION 3: FUNCTIONS
    // ─────────────────────────────────────────────────────────────────

    namespace functions {

        // ── Unit Queries ──
        constexpr uintptr_t GetUnitFromPlayerSlot = 0x72AD0;   // Unit* (int slot) — requires retcheck bypass
        constexpr uintptr_t GetUnitData           = 0x27F550;  // void* (Unit*) — reads Unit+56 based on type
        constexpr uintptr_t GetUnitById           = 0x6C960;   // Unit* (uint id, uint type) — hash table lookup
        constexpr uintptr_t GetUnitName           = 0x72D20;   // char* (Unit*) — base name for any unit
        constexpr uintptr_t GetUnitStat           = 0x255470;  // int (Unit*, int statId)
        constexpr uintptr_t GetUnitSizeX          = 0x27EEB0;  // int (Unit*)
        constexpr uintptr_t GetUnitSizeY          = 0x27EF60;  // int (Unit*)
        constexpr uintptr_t SetUnitMode           = 0xCCDA0;   // void (Unit*, int mode)

        // ── Skills ──
        constexpr uintptr_t FindSkillInList       = 0x290380;  // SkillInfo* (unit, skillId, ownerType)
        constexpr uintptr_t SetRightSkill         = 0x290BF0;  // void (unit, skillId, ownerType)
        constexpr uintptr_t SetLeftSkill          = 0x290CB0;  // void (unit, skillId, ownerType)
        constexpr uintptr_t AllocateSkillNode     = 0x290620;  // SkillInfo* (unit, skillId)
        constexpr uintptr_t SetSkillBaseLevel     = 0x290840;  // void (unit, skillId, level, flag)
        constexpr uintptr_t CalcSkillBonus        = 0x292AE0;  // int (unit, skillNode, flag)
        constexpr uintptr_t UpdatePassiveStats    = 0x28FD30;  // void (unit, skillId)
        constexpr uintptr_t CanCastSkill          = 0x292900;  // bool (a1, a2, skillId)
        constexpr uintptr_t CalcManaCost          = 0x296690;  // int (classIdx, skillId, skillLevel)
        constexpr uintptr_t CanSelectSkill        = 0x1518B0;  // bool (skillId, ownerType)
        constexpr uintptr_t HandleSelectSkill     = 0x151920;  // bool (skillId, isRight, ownerType) — sends 0x3C + local
        constexpr uintptr_t ActivateHotkeySlot    = 0x151A30;  // bool (slotIndex, clearFlag)
        constexpr uintptr_t GetHotkeySkillId      = 0x151800;  // uint (slotIndex)
        constexpr uintptr_t CycleSkillHotkey      = 0x1514B0;  // void (direction)
        constexpr uintptr_t HandleClearHotkey      = 0x151670;  // void (slotIndex)

        // ── Skill Actions / Input ──
        constexpr uintptr_t StartSkillAction      = 0xCBAA0;   // void (actionType, unit, targetX, targetY)
        constexpr uintptr_t DispatchSkillPacket   = 0xCB790;   // void (actionType, unit, x, y)
        constexpr uintptr_t ExecuteSkill          = 0xEF110;   // void (...) — 4160 bytes
        constexpr uintptr_t ProcessInput          = 0xF2EF0;   // uint32 (Unit*, int mode, uint32 x, uint32 y, uint16 flags)
        constexpr uintptr_t SetUnitMoveTarget     = 0xF0600;   // int64 (int64 mode, Unit*, int targetX, uint32 targetY)
        constexpr uintptr_t HandleEntityClick     = 0xCAD60;   // void (uint16 unitType, uint32 unitId) — sends interaction packet

        // ── Packets ──
        constexpr uintptr_t SendPacketToServer    = 0x146B70;  // void (byte*, size) — Arxan obfuscator
        constexpr uintptr_t SendRawPacket         = 0x146120;  // int64 (uint8_t*, size_t) — NO Arxan obfuscation
        constexpr uintptr_t SendPacket5B          = 0x1486B0;  // void (cmd, x, y) → [cmd:1][x:2][y:2]
        constexpr uintptr_t SendPacket5B_1x32     = 0x148A90;  // void (cmd, arg) → [cmd:1][arg:4]
        constexpr uintptr_t SendPacket9B          = 0x148E60;  // void (cmd, a1, a2) → [cmd:1][a:4][b:4]
        constexpr uintptr_t SendPacket13B         = 0x149250;  // void (cmd, a, b, c) → [cmd:1][a:4][b:4][c:4]
        constexpr uintptr_t ProcessServerPacket   = 0x103EB0;  // void (uint8_t** range)
        constexpr uintptr_t ProcessControlPacket  = 0xF9A10;   // void (buf)
        constexpr uintptr_t PollNetworkPackets    = 0x7A1F0;   // void ()

        // ── Items ──
        constexpr uintptr_t GetItemColorType     = 0x8E2B0;   // int (Unit*) — returns color index 13-28
        constexpr uintptr_t GetItemDisplayInfo    = 0x8E590;   // void (Unit*, char* name, void*, int* color)
        constexpr uintptr_t FormatItemName        = 0x190070;  // void (Unit*, char* out) — full name builder (8468 bytes)
        constexpr uintptr_t GetItemTypeCode       = 0x26ED30;  // int (Unit*) — ItemRecord+302 type code
        constexpr uintptr_t CheckItemGemLevel     = 0x26EDB0;  // bool (Unit*)
        constexpr uintptr_t ItemHasType           = 0x274210;  // bool (Unit*, int typeId) — bitmap type hierarchy (confirmed)
        constexpr uintptr_t GetItemVariantId      = 0x2743F0;  // int (Unit*) — ItemData+0x34
        constexpr uintptr_t GetItemTier           = 0x2350C0;  // STALE — not found in v3.0, not used in code
        constexpr uintptr_t GetMaxSockets         = 0x230A50;  // STALE — not found in v3.0, not used in code
        constexpr uintptr_t HandleUseItem         = 0x169120;  // int64 (Unit* item, uint8_t is_inventory)
        constexpr uintptr_t GetItemTypeData       = 0x27F0F0;  // int (Unit*) — packed item type pair (2x WORD)
        constexpr uintptr_t GetInventory          = 0x27E000;  // void* (Unit*) — inventory structure

        // ── Belt / Potions ──
        constexpr uintptr_t SendBeltBatchPacket   = 0x14B4D0;  // int64 (int, int guid, void* start, void* end)
        constexpr uintptr_t BeltWidgetHandler     = 0x18C060;  // int64 (widget*) — reads widget+1076 for column (confirmed)
        constexpr uintptr_t SendItemPlacement36B  = 0x14BA80;  // int64 (...) — 36-byte placement packet (0x26)
        constexpr uintptr_t GetBeltPositionData   = 0xC2C70;   // void* (buf, inventory, item)
        constexpr uintptr_t GetBeltRecord         = 0x242A70;  // char* (uint8 classIdx, Unit*)

        // ── NPC / Waypoint Dialog ──
        constexpr uintptr_t HandleNPCInteract     = 0x178D90;  // int64 (uint8 unitType, uint32 unitId, void* data, char a4)
        constexpr uintptr_t HandleCloseNPCDialog  = 0x181BC0;  // void (int entity_id) — sends 0x30 packet
        constexpr uintptr_t HandleWaypointTravel  = 0x177F40;  // char () — sends travel packet (uses globals)
        constexpr uintptr_t HandleSwapWeapons     = 0x1922C0;  // void (bool flag) — sends 0x50 weapon swap packet (858 bytes)

        // ── Automap ──
        constexpr uintptr_t AddAutomapCell        = 0xB4470;   // void (int16 cellIdx, int64 packedXY, ptr tree, int isNew)
        constexpr uintptr_t GetOrCreateAutomap    = 0xB6DE0;   // Automap* (int automapGroup) — 176-byte alloc, 4 RB-trees
        constexpr uintptr_t RevealRoomAutomap     = 0xB7630;   // void (uint8 classIdx, Room2Ex*, int forceReveal, Automap*)
                                                                 // NOTE: v3.0 added classIdx = *(unit+445)
        constexpr uintptr_t OnEnterRoom           = 0xB7C60;   // void (Room1*) — calls RevealRoomAutomap
        constexpr uintptr_t SyncExplorationData   = 0xA6390;   // STALE — not found in v3.0, not used in code
        constexpr uintptr_t AddRoomObjectCells    = 0xB72C0;   // void (Room2Ex*, Automap*) — iterates room units, calls AddObjectAutomapCell
        constexpr uintptr_t AddObjectAutomapCell  = 0xB4560;   // void (Unit*, int cellIdx, Automap*) — isometric xform + RB-tree insert
        constexpr uintptr_t LookupAutomapCell     = 0x2A3640;  // int (levelType, tileStyle, seq, idx)

        // ── Automap Rendering ──
        constexpr uintptr_t AutomapRenderFrame    = 0xB97E0;   // main per-frame entry (confirmed: calls SetupView, RenderLayer, RenderParty)
        constexpr uintptr_t AutomapSetupView      = 0xB2130;   // builds 60-byte view struct (NO retcheck)
        constexpr uintptr_t AutomapGetMarkerType  = 0xB8970;   // bool (Unit*, &spriteFrame, &colorIdx)
        constexpr uintptr_t AutomapDrawSprite     = 0xB92B0;   // void (screenXY, spriteIdx, scale) — NO retcheck
        constexpr uintptr_t AutomapDrawNameLabel  = 0xB8E80;   // void (char*, screenXY, float, int colorIdx)
        constexpr uintptr_t AutomapDrawUnitName   = 0xB9210;   // void (char*, screenXY, float, int colorIdx)
        constexpr uintptr_t AutomapUnitToScreen   = 0xB2B80;   // void (view*, &result, isoCoords) — has retcheck
        constexpr uintptr_t AutomapApplyTransform = 0xB2330;   // void (view*, &result, isoCoords) — has retcheck
        constexpr uintptr_t IsometricDivBy10      = 0xB1D10;   // int64 (int64 packedXY) — has retcheck
        constexpr uintptr_t AutomapGetCameraPos   = 0x8F650;   // int64 () — has retcheck
        constexpr uintptr_t AutomapRenderParty    = 0xB93C0;   // void (Unit*, view*)
        constexpr uintptr_t AutomapRenderPortal   = 0xB97E0;   // INLINED into AutomapRenderFrame — no separate function
        constexpr uintptr_t AutomapRenderLayer    = 0xB8560;   // void (layerIdx, rbTree*, view*, colors)
        constexpr uintptr_t AutomapRenderEnd      = 0x5E3DB0;  // void () — confirmed from AutomapRenderFrame tail call
        constexpr uintptr_t AutomapRenderBegin    = 0x5E3C50;  // void (viewport*) — confirmed from AutomapRenderFrame early call

        // ── Room / Level ──
        constexpr uintptr_t InitRoom2Data         = 0x2595F0;  // void (uint8 classIdx, DrlgRoom2*)
        constexpr uintptr_t FindRoom2ByCoords     = 0x2597B0;  // Room2* (difficulty, x, y, level, a5, room2_hint)
        constexpr uintptr_t EnsureRoom1Active     = 0x2C7B50;  // Room2Ex* (uint8 classIdx, DrlgRoom1*)
                                                                 // NOTE: v3.0 added classIdx = *(unit+445)
        constexpr uintptr_t RemoveRoomData        = 0x2FBB50;  // void (DrlgRoom1*, int keepFlag)
        constexpr uintptr_t AddRoomData           = 0x21E820;  // STALE — not found in v3.0, not used in code

        // ── Game Lifecycle ──
        constexpr uintptr_t SaveAndExit           = 0x791E0;   // char (int64) — server-initiated disconnect
        constexpr uintptr_t ExitGameToLobby       = 0x78060;   // int64 () — "Save & Exit" (PausePanel → ExitGame)
        constexpr uintptr_t ClosePausePanel       = 0xCBC650;  // int64 () — closes PausePanel UI
        constexpr uintptr_t GameHandleDisconnect  = 0x146210;  // int64 (int64) — queues disconnect (type=13)
        constexpr uintptr_t DisconnectWithReason  = 0x7F3E0;   // int64 (int reason) — low-level disconnect
        constexpr uintptr_t RequestCharacterRead  = 0xBED0B0;  // void (bool) — calls GetBackendManager, GetCharacterInfo
        constexpr uintptr_t GameMainLoop          = 0x80490;   // _DWORD* (int64, _DWORD*) — QPC timing, input, AFK
        constexpr uintptr_t InitGameSession       = 0x7D7F0;   // int64 () — inits session, timers, assets
        constexpr uintptr_t SessionInitHandler    = 0x7E2E0;   // void (int64) — refs DisconnectReason, GameSessionPtr
        constexpr uintptr_t CloseAllPanels        = 0xA1120;   // int64 (char a1, uint8 a2) — iterates all panels, calls per-panel close

        // ── Game Creation (Battle.net RPC) ──
        constexpr uintptr_t GetBackendManager     = 0xBF08D0;  // int64* () — TLS singleton
        constexpr uintptr_t QueueBackendRequest   = 0xC0D290;  // int64 (int64 nsm, int64 req) — NetworkStateManager
        constexpr uintptr_t CheckNetworkState     = 0xC0D020;  // int64 (int64 nsm, int state_idx, int64* out)
                                                                 // state_idx: 0=char, 1=lobby, 2=game, 3=root
        constexpr uintptr_t InitCreateGameReq     = 0x4C8820;  // int64 (int64 buf, char) — init type=9 request (vtable, SSO caps)
        constexpr uintptr_t CleanupCreateGameReq  = 0x4C89A0;  // void (int64 req_buf) — free SSO strings
        constexpr uintptr_t CreateGamePanel       = 0xD1FB70;  // char (int64, int64*) — UI handler (hash 0xF32FFEA4066738AF)
        constexpr uintptr_t CreateGameCallback    = 0xD20550;  // char (int64, int64, int64) — completion callback
        constexpr uintptr_t PopulateCreatePanel   = 0xD1F810;  // void (int64) — populate panel from cached globals
        constexpr uintptr_t SetCreateDifficulty   = 0xD206A0;  // void (int64, int)
        constexpr uintptr_t GetCharacterInfo      = 0x4C45D0;  // int64 () — current character selection data
        constexpr uintptr_t AutoGameNameGen       = 0xC5F020;  // void (int64, char* buf) — FNV1a hash, QPC seed, 10 retries
        constexpr uintptr_t SSOStringCopy         = 0x69130;   // void* (QWORD* sso, char* src, size_t len)

        // ── UI Widgets ──
        constexpr uintptr_t GetWidgetByName       = 0x688FD0;  // int64 (void* mgr, const char* name)
        constexpr uintptr_t FindWidgetRecursive   = 0x660AC0;  // int64 (int64 widget, const char* name)
        constexpr uintptr_t ClickWidget           = 0x66D790;  // int64 (void* widget, int64 click_val)
        constexpr uintptr_t SetWidgetText         = 0x5BD600;  // STALE in v3.0 — UNVERIFIED
        constexpr uintptr_t WriteUIState          = 0xCF0DA0;  // void (hash_map*, int64, void* state16) — confirmed via hash 0x6D7AE5124A736863
        constexpr uintptr_t TblLookup             = 0x4BF2F0;  // char* (TextPair*) — TBL string table lookup

    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 4: UNIT STRUCTURES
    // ─────────────────────────────────────────────────────────────────

    namespace unit {
        constexpr ptrdiff_t Type        = 0x000;  // DWORD — UnitType enum
        constexpr ptrdiff_t ClassId     = 0x004;  // DWORD — class/monster/item ID
        constexpr ptrdiff_t UnitId      = 0x008;  // DWORD — unique ID
        constexpr ptrdiff_t Mode        = 0x00C;  // DWORD — current mode
        constexpr ptrdiff_t TypeData    = 0x010;  // ptr — MonsterData/ItemData
        constexpr ptrdiff_t Act         = 0x018;  // BYTE — current act (0-4)
        constexpr ptrdiff_t Path        = 0x038;  // ptr — PathData/position
        constexpr ptrdiff_t StatList    = 0x088;  // ptr — stats
        constexpr ptrdiff_t Inventory   = 0x090;  // ptr — inventory
        constexpr ptrdiff_t SkillInfo   = 0x100;  // ptr — active skill
        constexpr ptrdiff_t Flags       = 0x124;  // DWORD — unit flags
        constexpr ptrdiff_t HashNext    = 0x158;  // ptr — next in hash bucket
        constexpr ptrdiff_t RoomNext    = 0x160;  // ptr — next in room list
    }

    /// Dynamic path (Player/Monster units)
    namespace path {
        constexpr ptrdiff_t PosX        = 0x000;  // DWORD — X (16.16 fixed-point)
        constexpr ptrdiff_t TileX       = 0x002;  // WORD — tile X (high 16 bits)
        constexpr ptrdiff_t PosY        = 0x004;  // DWORD — Y (16.16 fixed-point)
        constexpr ptrdiff_t TileY       = 0x006;  // WORD — tile Y (high 16 bits)
        constexpr ptrdiff_t TargetX     = 0x010;  // DWORD
        constexpr ptrdiff_t TargetY     = 0x014;  // DWORD
        constexpr ptrdiff_t Room        = 0x020;  // ptr
    }

    /// Static path (Object/Item units) — different layout from dynamic path!
    namespace static_path {
        constexpr ptrdiff_t Room        = 0x000;  // ptr — Room2Ex or parent reference
        constexpr ptrdiff_t PosX        = 0x010;  // DWORD — X (subtile coords)
        constexpr ptrdiff_t PosY        = 0x014;  // DWORD — Y (subtile coords)
    }

    /// MonsterData (Unit+0x10 for type=1)
    namespace monster_data {
        constexpr ptrdiff_t MonStats    = 0x000;  // ptr — MonStats entry
        constexpr ptrdiff_t Flags       = 0x018;  // WORD — monster flags
        constexpr ptrdiff_t Name        = 0x020;  // char[16] — custom name
        constexpr ptrdiff_t Enchants    = 0x030;  // WORD[3] — enchantments
        constexpr ptrdiff_t AiData      = 0x038;  // ptr
        constexpr ptrdiff_t Target      = 0x040;  // ptr — target unit
        constexpr ptrdiff_t OwnerId     = 0x048;  // DWORD — owner unit ID
        constexpr ptrdiff_t BossId      = 0x04C;  // WORD — super unique ID
    }

    /// ItemData (at Unit+0x10 aka TypeData — NOT via GetUnitData!)
    namespace item_data {
        constexpr ptrdiff_t Quality         = 0x000;  // DWORD — quality enum (1-9)
        constexpr ptrdiff_t Seed1           = 0x004;  // DWORD — client: always 1
        constexpr ptrdiff_t Seed2           = 0x008;  // DWORD — always 666 (0x29A)
        constexpr ptrdiff_t CreateSeed      = 0x00C;  // DWORD — init -1, unique per-instance
        constexpr ptrdiff_t Flags           = 0x018;  // DWORD — 0x10=Identified, 0x400=Ethereal,
                                                       //   0x800=Personalized, 0x4000=Quest/NoTrade,
                                                       //   0x1000000=Inscribed, 0x4000000=Runeword
        constexpr ptrdiff_t VariantId       = 0x034;  // DWORD — SetId/UniqueId/LowQualId
        constexpr ptrdiff_t ItemLevel       = 0x038;  // DWORD — always 1 on client (server sends 0)
        constexpr ptrdiff_t FileIndex       = 0x040;  // WORD — .dc6 file index
        constexpr ptrdiff_t RarePrefixId    = 0x042;  // WORD
        constexpr ptrdiff_t RareSuffixId    = 0x044;  // WORD
        constexpr ptrdiff_t MagicPrefixId   = 0x048;  // WORD — or runeword name index
        constexpr ptrdiff_t MagicSuffixId   = 0x04E;  // WORD
        constexpr ptrdiff_t FilledSockets   = 0x05D;  // BYTE — gems/runes inserted
        constexpr ptrdiff_t PersonalizedName = 0x05F; // char[] — inscription (~62 chars)
    }

    /// Extended ItemData — socket chain (doubly-linked list)
    namespace item_data_ext {
        constexpr ptrdiff_t PrevSocketed   = 0x0A8;  // ptr — prev socketed item Unit*
        constexpr ptrdiff_t NextSocketed   = 0x0B0;  // ptr — next socketed item Unit*
    }

    /// Inventory structure (at Unit+0x90)
    namespace inventory {
        constexpr ptrdiff_t FirstSocketed  = 0x010;  // ptr — head of socketed items list
        constexpr ptrdiff_t LastSocketed   = 0x018;  // ptr — tail of socketed items list
        constexpr ptrdiff_t DirtyListHead  = 0x030;  // ptr — items needing state update (next: unit+0x150)
        constexpr ptrdiff_t SocketCount    = 0x04C;  // DWORD
        constexpr ptrdiff_t ItemListHead   = 0x0A8;  // ptr — all items (next: unit+0x160)
    }

    /// SkillList (at Unit+0x100)
    namespace skill_list {
        constexpr ptrdiff_t FirstSkill     = 0x000;  // ptr — head of SkillInfo linked list
        constexpr ptrdiff_t RightSkill     = 0x008;  // ptr — active right-hand SkillInfo*
        constexpr ptrdiff_t LeftSkill      = 0x010;  // ptr — active left-hand SkillInfo*
        constexpr ptrdiff_t CurrentSkill   = 0x018;  // ptr — skill being cast
    }

    /// SkillInfo node (88 bytes, linked list element)
    namespace skill_info {
        constexpr ptrdiff_t SkillData      = 0x000;  // ptr — SkillData* (748-byte record)
        constexpr ptrdiff_t Next           = 0x008;  // ptr — next SkillInfo
        constexpr ptrdiff_t StartFrame     = 0x010;  // DWORD — anim start frame (from SkillData+48/49)
        constexpr ptrdiff_t BaseLevel      = 0x040;  // DWORD — hard points invested
        constexpr ptrdiff_t BonusLevel     = 0x044;  // DWORD — cached bonus from +skills gear
        constexpr ptrdiff_t Charges        = 0x048;  // DWORD — item charges (quantity)
        constexpr ptrdiff_t OwnerType      = 0x04C;  // DWORD — -1=natural, ≥0=item-granted
    }

    /// StatList (at Unit+0x88)
    namespace stat_list {
        constexpr ptrdiff_t UnitType       = 0x008;  // DWORD
        constexpr ptrdiff_t UnitId         = 0x00C;  // DWORD
        constexpr ptrdiff_t Stats          = 0x030;  // ptr — sorted stat array
        constexpr ptrdiff_t StatCount      = 0x038;  // DWORD
        constexpr ptrdiff_t OwnerUnit      = 0x0A0;  // ptr
    }

    /// RosterEntry (party/multiplayer)
    namespace roster {
        constexpr ptrdiff_t Name           = 0x000;  // char[60]
        constexpr ptrdiff_t BNetId         = 0x040;  // QWORD
        constexpr ptrdiff_t UnitId         = 0x048;  // DWORD
        constexpr ptrdiff_t Health         = 0x04C;  // BYTE (0-128 scale)
        constexpr ptrdiff_t PartyId        = 0x05A;  // SHORT (-1 = solo)
        constexpr ptrdiff_t Relations      = 0x070;  // ptr
        constexpr ptrdiff_t Level          = 0x088;  // DWORD
        constexpr ptrdiff_t Next           = 0x148;  // ptr — next roster entry
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 5: ROOM / LEVEL STRUCTURES
    // ─────────────────────────────────────────────────────────────────

    /// Room1/Room2Ex (runtime room, created by AddRoomData)
    namespace room {
        constexpr ptrdiff_t Adjacent           = 0x000;  // ptr — adjacent rooms array
        constexpr ptrdiff_t TileData           = 0x008;  // ptr — tile data (used by RevealRoomAutomap)
        constexpr ptrdiff_t Room2              = 0x018;  // ptr — DrlgRoom1 back-pointer
        constexpr ptrdiff_t Collision          = 0x038;  // ptr — CollisionGrid (Room2Ex only!)
        constexpr ptrdiff_t UnitCount          = 0x044;  // DWORD
        constexpr ptrdiff_t NextRoom1InRoom2   = 0x048;  // ptr — next Room1 within same Room2
        constexpr ptrdiff_t PosX               = 0x060;  // DWORD
        constexpr ptrdiff_t PosY               = 0x064;  // DWORD
        constexpr ptrdiff_t SizeX              = 0x068;  // DWORD
        constexpr ptrdiff_t SizeY              = 0x06C;  // DWORD
        constexpr ptrdiff_t FirstUnit          = 0x0A8;  // ptr — unit list head
        constexpr ptrdiff_t NextRoom           = 0x0B0;  // ptr — next in act-wide Room1 list
    }

    /// DrlgRoom2
    namespace room2 {
        constexpr ptrdiff_t Room1Ptr           = 0x010;  // ptr — Room1 list head
        constexpr ptrdiff_t PosX               = 0x024;  // DWORD
        constexpr ptrdiff_t PosY               = 0x028;  // DWORD
        constexpr ptrdiff_t SizeX              = 0x02C;  // DWORD
        constexpr ptrdiff_t SizeY              = 0x030;  // DWORD
        constexpr ptrdiff_t Level              = 0x1C8;  // ptr — parent Level/DrlgMisc
        constexpr ptrdiff_t NextRoom2          = 0x1B8;  // ptr — next DrlgRoom2
        constexpr ptrdiff_t LevelId            = 0x1F8;  // DWORD — level ID

        // Room2Ex fields (at Room1+0x18)
        constexpr ptrdiff_t Room2ExAdjacentArray = 0x010;
        constexpr ptrdiff_t Room2ExAdjacentCount = 0x018;
        constexpr ptrdiff_t Room2ExRoom1         = 0x058;
        constexpr ptrdiff_t DrlgLevel            = 0x090;
    }

    /// Level structure
    namespace level {
        constexpr ptrdiff_t FirstRoom          = 0x058;
        constexpr ptrdiff_t Room2List          = 0x868;
    }

    /// CollisionGrid (at Room2Ex+0x38)
    namespace collision {
        constexpr ptrdiff_t OriginX            = 0x000;
        constexpr ptrdiff_t OriginY            = 0x004;
        constexpr ptrdiff_t Width              = 0x008;
        constexpr ptrdiff_t Height             = 0x00C;
        constexpr ptrdiff_t Map                = 0x020;  // ptr — WORD per tile
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 6: DATA TABLES — Per-Class + Field Offsets
    // ─────────────────────────────────────────────────────────────────

    /// Per-class data sub-table offsets (within PerClassDataArray[2*classIdx])
    namespace per_class {
        constexpr ptrdiff_t StatesPtr           = 0x290;
        constexpr ptrdiff_t StatesCount         = 0x298;
        constexpr ptrdiff_t PassiveStatesPtr    = 0x420;
        constexpr ptrdiff_t PassiveStatesCount  = 0x428;
        constexpr ptrdiff_t HirelingPtr         = 0x520;
        constexpr ptrdiff_t HirelingCount       = 0x528;
        constexpr ptrdiff_t MonStatsPtr         = 0xF58;
        constexpr ptrdiff_t MonStatsCount       = 0xF60;
        constexpr ptrdiff_t MonStats2Ptr        = 0xF98;
        constexpr ptrdiff_t MonStats2Count      = 0xFA0;
        constexpr ptrdiff_t MissilesPtr         = 0x1120;
        constexpr ptrdiff_t MissilesCount       = 0x1128;
        constexpr ptrdiff_t SkillDescPtr        = 0x1190;
        constexpr ptrdiff_t SkillDescCount      = 0x1198;
        constexpr ptrdiff_t SkillsPtr           = 0x11B0;
        constexpr ptrdiff_t SkillsCount         = 0x11B8;
        constexpr ptrdiff_t OverlaysPtr         = 0x1228;
        constexpr ptrdiff_t OverlaysCount       = 0x1230;
        constexpr ptrdiff_t CharStatsPtr        = 0x1240;
        constexpr ptrdiff_t CharStatsCount      = 0x1248;
        constexpr ptrdiff_t StatDescPtr         = 0x1258;
        constexpr ptrdiff_t StatDescCount       = 0x1260;
        constexpr ptrdiff_t PetTypePtr          = 0x12D8;
        constexpr ptrdiff_t PetTypeCount        = 0x12E0;
        constexpr ptrdiff_t SetItemsPtr         = 0x13A8;
        constexpr ptrdiff_t SetItemsCount       = 0x13B0;
        constexpr ptrdiff_t UniqueItemsPtr      = 0x13C8;
        constexpr ptrdiff_t UniqueItemsCount    = 0x13D0;
        constexpr ptrdiff_t LevelsPtr           = 0x1460;
        constexpr ptrdiff_t LevelsCount         = 0x1468;
        constexpr ptrdiff_t LevelDefsPtr        = 0x14A0;
        constexpr ptrdiff_t ExperienceShift     = 0x14D0;
        constexpr ptrdiff_t ExperienceMask      = 0x14D4;
        constexpr ptrdiff_t ExperienceTable     = 0x14E0;
        constexpr ptrdiff_t ObjectsPtr          = 0x1528;
        constexpr ptrdiff_t ObjectsCount        = 0x1530;
        constexpr ptrdiff_t BeltsPtr            = 0x1558;
        constexpr ptrdiff_t ItemRecordsPtr      = 0x15A0;
        constexpr ptrdiff_t ItemRecordsCount    = 0x15A8;
        constexpr ptrdiff_t ShrinesPtr          = 0x19B0;
        constexpr ptrdiff_t ShrinesCount        = 0x19B8;
    }

    /// SkillData record (skills.txt, 748 B/entry)
    namespace skill_data {
        constexpr size_t    EntrySize   = 748;
        constexpr ptrdiff_t SkillId     = 0x000;
        constexpr ptrdiff_t CharClass   = 0x01F;
        constexpr ptrdiff_t Flags       = 0x027;
        constexpr ptrdiff_t StartFrame  = 0x030;
        constexpr ptrdiff_t StartFrameM = 0x031;
        constexpr ptrdiff_t CastType    = 0x035;
        constexpr ptrdiff_t StateId     = 0x0B0;
        constexpr ptrdiff_t MinMana     = 0x1EE;
        constexpr ptrdiff_t ManaShift   = 0x1F0;
        constexpr ptrdiff_t Mana        = 0x1F2;
        constexpr ptrdiff_t LvlMana     = 0x1F4;
        constexpr ptrdiff_t SkillDesc   = 0x23C;
    }

    /// Levels (levels.txt, 396 B/entry)
    namespace levels_txt {
        constexpr size_t    EntrySize   = 396;
        constexpr ptrdiff_t Id          = 0x004;
        constexpr ptrdiff_t LevelGroup  = 0x006;
        constexpr ptrdiff_t Act         = 0x00D;
        constexpr ptrdiff_t Teleport    = 0x00E;
        constexpr ptrdiff_t WarpDist    = 0x014;
        constexpr ptrdiff_t Waypoint    = 0x0EC;
        constexpr ptrdiff_t LevelName   = 0x0FD;
        constexpr ptrdiff_t LevelWarp   = 0x125;
        constexpr ptrdiff_t LevelEntry  = 0x14D;
    }

    /// LevelDef (leveldefs, 156 B/entry)
    namespace leveldef {
        constexpr ptrdiff_t Layer       = 0x008;
        constexpr ptrdiff_t AutomapType = 0x034;
    }

    /// MonStats (monstats.txt, 508 B/entry)
    namespace monstats_txt {
        constexpr size_t    EntrySize    = 508;
        constexpr ptrdiff_t MonStats2Idx = 0x04C;
        constexpr ptrdiff_t Align        = 0x087;
    }

    /// MonStats2 (monstats2.txt, 296 B/entry)
    namespace monstats2_txt {
        constexpr ptrdiff_t Flags       = 0x004;
        constexpr ptrdiff_t SpecialFlag = 0x03D;
        constexpr ptrdiff_t AutomapCel  = 0x118;
    }

    /// Objects (objects.txt, 360 B/entry)
    namespace objects_txt {
        constexpr size_t    EntrySize   = 360;
        constexpr ptrdiff_t Name        = 0x042;
        constexpr size_t    NameMaxLen  = 63;
        constexpr ptrdiff_t Token       = 0x082;
        constexpr ptrdiff_t Selectable0 = 0x085;
        constexpr ptrdiff_t SizeX       = 0x090;
        constexpr ptrdiff_t SizeY       = 0x094;
        constexpr ptrdiff_t SubClass    = 0x127;
        constexpr ptrdiff_t NameOffset  = 0x128;
        constexpr ptrdiff_t ShrineFunc  = 0x12E;
        constexpr ptrdiff_t OperateFn   = 0x15E;
        constexpr ptrdiff_t AutoMap     = 0x164;
    }

    /// Hireling (hireling.txt, 336 B/entry)
    namespace hireling_txt {
        constexpr size_t    EntrySize   = 336;
        constexpr ptrdiff_t ExpansionId = 0x000;
        constexpr ptrdiff_t ClassId     = 0x008;
    }

    /// ItemRecord (armor/weapons/misc.txt, 448 B/entry)
    namespace item_record {
        constexpr size_t    EntrySize   = 448;
        constexpr ptrdiff_t Code        = 0x080;
        constexpr ptrdiff_t NameStrIdx  = 0x0FC;
        constexpr ptrdiff_t Width       = 0x11E;
        constexpr ptrdiff_t Height      = 0x11F;
        constexpr ptrdiff_t TypeCode    = 0x12E;
    }

    /// Waypoint table entry (43 entries × 28 bytes at globals::WaypointTable)
    namespace waypoint_entry {
        constexpr size_t    EntrySize   = 28;
        constexpr ptrdiff_t ClassId     = 0x000;
        constexpr ptrdiff_t LevelId     = 0x00C;
        constexpr size_t    Count       = 43;
    }

    /// Hotkey entry (28 bytes × 16 slots at globals::HotkeyTable)
    namespace hotkey_entry {
        constexpr size_t    EntrySize   = 28;
        constexpr ptrdiff_t SkillId     = 0x000;
        constexpr ptrdiff_t OwnerType   = 0x004;
        constexpr ptrdiff_t IsRight     = 0x008;
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 7: AUTOMAP VIEW
    // ─────────────────────────────────────────────────────────────────

    /// AutomapView struct (60 bytes, stack-allocated by AutomapSetupView)
    namespace automap_view {
        constexpr ptrdiff_t ClipOriginX  = 0x00;
        constexpr ptrdiff_t ClipOriginY  = 0x04;
        constexpr ptrdiff_t ClipExtentW  = 0x08;
        constexpr ptrdiff_t ClipExtentH  = 0x0C;
        constexpr ptrdiff_t ViewCenterX  = 0x10;
        constexpr ptrdiff_t ViewCenterY  = 0x14;
        constexpr ptrdiff_t ScreenLeft   = 0x18;
        constexpr ptrdiff_t ScreenTop    = 0x1C;
        constexpr ptrdiff_t ScreenWidth  = 0x20;
        constexpr ptrdiff_t ScreenHeight = 0x24;
        constexpr ptrdiff_t PixelCenterX = 0x28;
        constexpr ptrdiff_t PixelCenterY = 0x2C;
        constexpr ptrdiff_t ScaleX       = 0x30;
        constexpr ptrdiff_t ScaleY       = 0x34;
        constexpr ptrdiff_t SpriteScale  = 0x38;
        constexpr size_t    StructSize   = 0x3C;
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 8: RENDERER / DX12
    // ─────────────────────────────────────────────────────────────────

    namespace renderer {
        // pm_dxgi::Instance (base at PlatformInstance + 664)
        constexpr ptrdiff_t DxgiModule          = 0x088;
        constexpr ptrdiff_t CreateFactory1      = 0x090;
        constexpr ptrdiff_t CreateFactory2      = 0x098;
        constexpr ptrdiff_t DebugInterface      = 0x0A0;

        // pm_dx12::Instance
        constexpr ptrdiff_t D3D12Module         = 0x028;
        constexpr ptrdiff_t D3D12CreateDevice   = 0x038;
        constexpr ptrdiff_t D3D12SerializeRoot  = 0x040;

        // SwapChainWrapper (288 bytes)
        constexpr ptrdiff_t SwapChainId         = 0x000;
        constexpr ptrdiff_t SwapChain           = 0x008;
        constexpr ptrdiff_t SwapChain1          = 0x010;
        constexpr ptrdiff_t SwapChain2          = 0x018;
        constexpr ptrdiff_t SwapChain3          = 0x020;
        constexpr ptrdiff_t SwapChain4          = 0x028;
        constexpr ptrdiff_t FrameLatencyHandle  = 0x030;
        constexpr ptrdiff_t IsFullscreen        = 0x038;
        constexpr ptrdiff_t InitFailed          = 0x039;
        constexpr ptrdiff_t BackBufferCount     = 0x03C;
        constexpr ptrdiff_t ClientRect          = 0x040;
        constexpr ptrdiff_t SyncInterval        = 0x050;

        // pm_dx12::Device (3400 bytes)
        constexpr ptrdiff_t DeviceContext       = 0x020;
        constexpr ptrdiff_t PlatformInstance    = 0x030;
        constexpr ptrdiff_t D3D12Device         = 0x068;
        constexpr ptrdiff_t IsDX12Mode          = 0x070;
        constexpr ptrdiff_t CommandList         = 0x098;

        // pm_dx12::Device command queue storage
        constexpr ptrdiff_t CommandQueueArray   = 0x2A0;
        constexpr ptrdiff_t DirectQueueCount    = 0x2B8;
        constexpr ptrdiff_t ComputeQueueCount   = 0x2BC;
        constexpr ptrdiff_t CopyQueueCount      = 0x2C0;

        // pm_dx12::CmdQueueImpl
        constexpr size_t CmdQueueEntrySize      = 192;
        constexpr ptrdiff_t CmdQueueDevice      = 0x020;
        constexpr ptrdiff_t CmdQueueNative      = 0x030;
        constexpr ptrdiff_t CmdQueueType        = 0x038;
        constexpr ptrdiff_t CmdQueueFence       = 0x040;
        constexpr ptrdiff_t CmdQueueEvent       = 0x048;
    }

    /// IDXGISwapChain vtable indices
    namespace dxgi_vtable {
        constexpr size_t QueryInterface             = 0;
        constexpr size_t AddRef                     = 1;
        constexpr size_t Release                    = 2;
        constexpr size_t SetPrivateData             = 3;
        constexpr size_t SetPrivateDataInterface    = 4;
        constexpr size_t GetPrivateData             = 5;
        constexpr size_t GetParent                  = 6;
        constexpr size_t GetDevice                  = 7;
        constexpr size_t Present                    = 8;
        constexpr size_t GetBuffer                  = 9;
        constexpr size_t SetFullscreenState         = 10;
        constexpr size_t GetFullscreenState         = 11;
        constexpr size_t GetDesc                    = 12;
        constexpr size_t ResizeBuffers              = 13;
        constexpr size_t ResizeTarget               = 14;
        constexpr size_t GetContainingOutput        = 15;
        constexpr size_t GetFrameStatistics         = 16;
        constexpr size_t GetLastPresentCount        = 17;
        constexpr size_t GetDesc1                   = 18;
        constexpr size_t GetFullscreenDesc          = 19;
        constexpr size_t GetHwnd                    = 20;
        constexpr size_t GetCoreWindow              = 21;
        constexpr size_t Present1                   = 22;
        constexpr size_t IsTemporaryMonoSupported   = 23;
        constexpr size_t GetRestrictToOutput        = 24;
        constexpr size_t SetBackgroundColor         = 25;
        constexpr size_t GetBackgroundColor         = 26;
        constexpr size_t SetRotation                = 27;
        constexpr size_t GetRotation                = 28;
        constexpr size_t SetSourceSize              = 29;
        constexpr size_t GetSourceSize              = 30;
        constexpr size_t SetMaximumFrameLatency     = 31;
        constexpr size_t GetMaximumFrameLatency     = 32;
        constexpr size_t GetFrameLatencyWaitableObj = 33;
        constexpr size_t SetMatrixTransform         = 34;
        constexpr size_t GetMatrixTransform         = 35;
        constexpr size_t GetCurrentBackBufferIndex  = 36;
    }

    /// ID3D12CommandQueue vtable indices
    namespace d3d12_vtable {
        constexpr size_t QueryInterface             = 0;
        constexpr size_t AddRef                     = 1;
        constexpr size_t Release                    = 2;
        constexpr size_t GetPrivateData             = 3;
        constexpr size_t SetPrivateData             = 4;
        constexpr size_t SetPrivateDataInterface    = 5;
        constexpr size_t SetName                    = 6;
        constexpr size_t GetDevice                  = 7;
        constexpr size_t UpdateTileMappings         = 8;
        constexpr size_t CopyTileMappings           = 9;
        constexpr size_t ExecuteCommandLists        = 10;
        constexpr size_t SetMarker                  = 11;
        constexpr size_t BeginEvent                 = 12;
        constexpr size_t EndEvent                   = 13;
        constexpr size_t Signal                     = 14;
        constexpr size_t Wait                       = 15;
        constexpr size_t GetTimestampFrequency      = 16;
        constexpr size_t GetClockCalibration        = 17;
        constexpr size_t GetDesc                    = 18;
    }

    /// UI Widget struct offsets
    namespace widget {
        constexpr ptrdiff_t Visible     = 0x050;
        constexpr ptrdiff_t Enabled     = 0x051;
        constexpr ptrdiff_t Children    = 0x058;
        constexpr ptrdiff_t ChildCount  = 0x060;
        constexpr ptrdiff_t TextSSO     = 0x520;
        constexpr ptrdiff_t InputTextSSO = 0x558;
    }

    /// CreateGamePanel child widget offsets
    namespace create_game_panel {
        constexpr ptrdiff_t DifficultyNormal     = 360;
        constexpr ptrdiff_t DifficultyNightmare  = 368;
        constexpr ptrdiff_t DifficultyHell       = 376;
        constexpr ptrdiff_t Difficulty            = 384;
        constexpr ptrdiff_t CreateGameButton      = 392;
        constexpr ptrdiff_t GameNameLabel         = 400;
        constexpr ptrdiff_t GameNameInput         = 408;
        constexpr ptrdiff_t PasswordLabel         = 416;
        constexpr ptrdiff_t PasswordInput         = 424;
        constexpr ptrdiff_t DescriptionLabel      = 432;
        constexpr ptrdiff_t DescriptionInput      = 440;
        constexpr ptrdiff_t MaxPlayersInput       = 448;
        constexpr ptrdiff_t MaxLevelDiffInput     = 456;
        constexpr ptrdiff_t CharDiffToggle        = 464;
        constexpr ptrdiff_t LadderCheckbox        = 472;
        constexpr ptrdiff_t BnetFriendsCheckbox   = 480;
        constexpr ptrdiff_t DesecratedCheckbox    = 488;

        constexpr uint64_t CreateGameHash = 0xF32FFEA4066738AFull;
    }


    // ─────────────────────────────────────────────────────────────────
    //  SECTION 9: HASH TABLE HELPERS
    // ─────────────────────────────────────────────────────────────────

    namespace hash {
        constexpr size_t BucketsPerType = 128;
        constexpr size_t TypeCount      = 6;

        constexpr uintptr_t type_offset(uint32_t type) {
            return type * BucketsPerType * sizeof(void*);
        }

        constexpr size_t bucket_index(uint32_t unit_id) {
            return unit_id & 0x7F;
        }
    }

} // namespace d2r::offsets
