// src/gameplay/TeamMatchManager.ts
import {
  ACTOR_I32_BASE_INDEX,
  ACTOR_I32_STRIDE,
  ActorI32,
  MAX_ACTORS,
  PhysicsMemoryAbi,
  TeamId,
} from '../core/memoryAbi';
import { GoldSrcPhysicsEngine, SpawnPoint } from '../physics/GoldSrcPhysicsEngine';
import { BotController } from './BotController';

export interface TeamSpawnConfig {
  tSpawns?: SpawnPoint[];
  ctSpawns?: SpawnPoint[];
  fallbackSpawn: SpawnPoint;
}

export interface MatchScoreSnapshot {
  tScore: number;
  ctScore: number;
  tAlive: number;
  ctAlive: number;
  roundNumber: number;
  roundTimeLeftSec: number;
  playerTeam: TeamId;
}

export class TeamMatchManager {
  private readonly abi: PhysicsMemoryAbi;
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly bots: BotController;
  private spawns: TeamSpawnConfig;
  private tScore = 0;
  private ctScore = 0;
  private roundNumber = 1;
  private roundEndTick = 0;
  private botsPerTeam = 3;
  private playerTeam: TeamId = TeamId.CT;

  constructor(
    abi: PhysicsMemoryAbi,
    physics: GoldSrcPhysicsEngine,
    bots: BotController,
    spawns: TeamSpawnConfig,
  ) {
    this.abi = abi;
    this.physics = physics;
    this.bots = bots;
    this.spawns = spawns;
  }

  public configure(spawns: TeamSpawnConfig, playerTeam: TeamId, botsPerTeam = 3): void {
    this.spawns = spawns;
    this.playerTeam = playerTeam;
    this.botsPerTeam = Math.max(0, Math.min(7, botsPerTeam));
    this.startNewRound(0);
  }

  public startNewRound(currentTick: number): void {
    this.bots.clearBots();
    this.roundEndTick = currentTick + 115 * 100; // 1:55 round timer at 100 Hz

    // Deactivate all slots first
    for (let id = 0; id < MAX_ACTORS; id++) {
      this.abi.i32[ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE + ActorI32.ACTIVE] = 0;
    }

    // Slot 0 = Local player
    const pSpawn = this.pickSpawn(this.playerTeam, 0);
    this.physics.spawnActor(0, this.playerTeam, pSpawn, false, { cash: 1600, armor: 100, helmet: true });

    let nextId = 1;
    // Populate Terrorist bots
    const tCount = this.playerTeam === TeamId.T ? Math.max(0, this.botsPerTeam - 1) : this.botsPerTeam;
    for (let k = 0; k < tCount && nextId < MAX_ACTORS; k++, nextId++) {
      this.physics.spawnActor(nextId, TeamId.T, this.pickSpawn(TeamId.T, k + 1), true, { cash: 3200 });
      this.bots.registerBot(nextId);
    }

    // Populate Counter-Terrorist bots
    const ctCount = this.playerTeam === TeamId.CT ? Math.max(0, this.botsPerTeam - 1) : this.botsPerTeam;
    for (let k = 0; k < ctCount && nextId < MAX_ACTORS; k++, nextId++) {
      this.physics.spawnActor(nextId, TeamId.CT, this.pickSpawn(TeamId.CT, k + 1), true, { cash: 3200 });
      this.bots.registerBot(nextId);
    }
  }

  public awardFrag(killerId: number): void {
    if (killerId < 0 || killerId >= MAX_ACTORS) return;
    const i = ACTOR_I32_BASE_INDEX + killerId * ACTOR_I32_STRIDE;
    this.abi.i32[i + ActorI32.CASH] = Math.min(16000, this.abi.i32[i + ActorI32.CASH] + 300);
  }

  public evaluateRound(currentTick: number): { winner: TeamId | null; snapshot: MatchScoreSnapshot } {
    let tAlive = 0;
    let ctAlive = 0;
    let tTotal = 0;
    let ctTotal = 0;

    for (let id = 0; id < MAX_ACTORS; id++) {
      const i = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      if (this.abi.i32[i + ActorI32.ACTIVE] === 0) continue;
      const team = this.abi.i32[i + ActorI32.TEAM] as TeamId;
      const alive = this.abi.i32[i + ActorI32.ALIVE] === 1;
      if (team === TeamId.T) {
        tTotal++;
        if (alive) tAlive++;
      } else if (team === TeamId.CT) {
        ctTotal++;
        if (alive) ctAlive++;
      }
    }

    let winner: TeamId | null = null;
    if (tTotal > 0 && ctTotal > 0) {
      if (tAlive === 0) winner = TeamId.CT;
      else if (ctAlive === 0) winner = TeamId.T;
      else if (currentTick >= this.roundEndTick) winner = TeamId.CT;
    }

    if (winner === TeamId.T) {
      this.tScore++;
      this.roundNumber++;
    } else if (winner === TeamId.CT) {
      this.ctScore++;
      this.roundNumber++;
    }

    return {
      winner,
      snapshot: {
        tScore: this.tScore,
        ctScore: this.ctScore,
        tAlive,
        ctAlive,
        roundNumber: this.roundNumber,
        roundTimeLeftSec: Math.max(0, (this.roundEndTick - currentTick) * 0.01),
        playerTeam: this.playerTeam,
      },
    };
  }

  private pickSpawn(team: TeamId, index: number): SpawnPoint {
    const list = team === TeamId.T ? this.spawns.tSpawns : this.spawns.ctSpawns;
    if (list && list.length > 0) {
      return list[index % list.length];
    }
    // Fallback grid offset around map's single spawn so bots never start overlapping
    const row = Math.floor(index / 4);
    const col = index % 4;
    const sideOffset = team === TeamId.T ? 180 : -60;
    return {
      x: this.spawns.fallbackSpawn.x + sideOffset + row * 48,
      y: this.spawns.fallbackSpawn.y + (col - 1.5) * 48,
      z: this.spawns.fallbackSpawn.z,
      yaw: team === TeamId.T ? Math.PI : this.spawns.fallbackSpawn.yaw,
      pitch: 0,
    };
  }
}
