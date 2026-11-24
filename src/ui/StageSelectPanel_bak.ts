import { RunTracker } from '../gameplay/RunTracker';
import { CheckpointState } from '../physics/GoldSrcPhysicsEngine';

export interface StageSelectCallbacks {
  onSelectStage: (stage: CheckpointState, isFullRunStart: boolean) => void;
  onResetRecords: () => void;
}

const d45 = Math.SQRT1_2;
const S3_DECK_X = 7020 + d45 * 2860;
const S3_DECK_Y = 1270 + d45 * 2860;

export const SANDBOX_STAGES: ReadonlyArray<{
  badge: string;
  title: string;
  subtitle: string;
  isFullRunStart: boolean;
  checkpoint: CheckpointState;
}> = [
  {
    badge: '01',
    title: 'STAGE 1 — DROP-IN & CURVE',
    subtitle: '50° Entry • 54° Transfer • 52°–58° Bank',
    isFullRunStart: true,
    checkpoint: {
      index: 1,
      label: 'STAGE 1 — SPAWN',
      x: -190,
      y: 0,
      z: 1038,
      yaw: 0,
      pitch: -0.07,
      velX: 0,
      velY: 0,
      velZ: 0,
    },
  },
  {
    badge: '02',
    title: 'STAGE 2 — DUAL SPLIT',
    subtitle: '48° Smooth Glide vs. 60° Steep Branch',
    isFullRunStart: false,
    checkpoint: {
      index: 2,
      label: 'STAGE 2 — DUAL SPLIT',
      x: 6920,
      y: 1365,
      z: 365,
      yaw: Math.PI * 0.25,
      pitch: -0.05,
      velX: 660,
      velY: 660,
      velZ: 0,
    },
  },
  {
    badge: '03',
    title: 'STAGE 3 — HIGH APEX',
    subtitle: '55°/58° Sky Spine • 60° Arch Dive • Blast Canyon',
    isFullRunStart: false,
    checkpoint: {
      index: 3,
      label: 'STAGE 3 — HIGH APEX',
      x: S3_DECK_X,
      y: S3_DECK_Y,
      z: 778,
      yaw: 0.38,
      pitch: -0.05,
      velX: 0,
      velY: 0,
      velZ: 0,
    },
  },
  {
    badge: '04',
    title: 'STAGE 4 — SOUTH SLALOM',
    subtitle: '54°/58° Slalom • 62° Hyper-Wedge • Citadel Finish',
    isFullRunStart: false,
    checkpoint: {
      index: 4,
      label: 'STAGE 4 — SOUTH SLALOM',
      x: 12420,
      y: 860,
      z: 430,
      yaw: -1.836,
      pitch: -0.05,
      velX: -230,
      velY: -850,
      velZ: 0,
    },
  },
  {
    badge: 'LAB',
    title: 'VPHYSICS & SLOPE LAB',
    subtitle: '30°–60° Wedges • 48u Crouch Tunnel • Crates',
    isFullRunStart: false,
    checkpoint: {
      index: 0,
      label: 'VPHYSICS & SLOPE LAB',
      x: -80,
      y: 1120,
      z: 1038,
      yaw: Math.PI * 0.42,
      pitch: -0.08,
      velX: 0,
      velY: 0,
      velZ: 0,
    },
  },
];

const SPLIT_ROWS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 2, label: 'CP 2 • Dual Split' },
  { index: 3, label: 'CP 3 • High Apex' },
  { index: 4, label: 'CP 4 • South Slalom' },
  { index: 99, label: 'FIN • Citadel Finish' },
];

export class StageSelectPanel {
  private readonly root: HTMLElement;
  private readonly splitsBody: HTMLTableSectionElement;
  private readonly pbHeaderLabel: HTMLSpanElement;
  private readonly runTracker: RunTracker;
  private readonly callbacks: StageSelectCallbacks;

  constructor(runTracker: RunTracker, callbacks: StageSelectCallbacks) {
    this.runTracker = runTracker;
    this.callbacks = callbacks;

    this.root = document.createElement('aside');
    this.root.id = 'stage-select-panel';
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '20px',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '320px',
      maxHeight: '86vh',
      overflowY: 'auto',
      zIndex: '45',
      background: 'rgba(9, 13, 22, 0.90)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(56, 189, 248, 0.28)',
      borderRadius: '10px',
      padding: '14px 16px',
      color: '#e2e8f0',
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: '12px',
      boxShadow: '0 18px 42px rgba(0, 0, 0, 0.55)',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '10px',
      paddingBottom: '8px',
      borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
    });
    header.innerHTML = `
      <span style="font-weight:800; letter-spacing:0.06em; color:#38bdf8; font-size:12px;">STAGE SELECT</span>
      <span style="font-size:10px; color:#94a3b8;">B: CP • C/V: SAVE</span>
    `;
    this.root.appendChild(header);

    // Stage Buttons List
    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      marginBottom: '14px',
    });

    for (const stage of SANDBOX_STAGES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      Object.assign(btn.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        background: 'rgba(30, 41, 59, 0.65)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: '7px',
        color: '#f8fafc',
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      });

      const badgeColor = stage.isFullRunStart
        ? '#34d399'
        : stage.badge === 'LAB'
          ? '#fbbf24'
          : '#c084fc';

      btn.innerHTML = `
        <span style="
          min-width: 30px;
          text-align: center;
          padding: 3px 5px;
          border-radius: 5px;
          font-weight: 800;
          font-size: 10px;
          color: ${badgeColor};
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid ${badgeColor}55;
        ">${stage.badge}</span>
        <span style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
          <span style="font-weight:700; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${stage.title}
          </span>
          <span style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${stage.subtitle}
          </span>
        </span>
      `;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(51, 65, 85, 0.85)';
        btn.style.borderColor = badgeColor;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(30, 41, 59, 0.65)';
        btn.style.borderColor = 'rgba(148, 163, 184, 0.2)';
      });
      btn.addEventListener('click', () => {
        this.callbacks.onSelectStage(stage.checkpoint, stage.isFullRunStart);
      });

      list.appendChild(btn);
    }
    this.root.appendChild(list);

    // PB Splits & Gold Segments Section
    const splitHeader = document.createElement('div');
    Object.assign(splitHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '6px',
      paddingTop: '8px',
      borderTop: '1px solid rgba(148, 163, 184, 0.16)',
    });

    this.pbHeaderLabel = document.createElement('span');
    Object.assign(this.pbHeaderLabel.style, {
      fontWeight: '700',
      fontSize: '11px',
      color: '#fbbf24',
    });
    this.pbHeaderLabel.textContent = 'PB SPLITS: --';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Clear PBs';
    Object.assign(resetBtn.style, {
      background: 'rgba(244, 63, 94, 0.14)',
      border: '1px solid rgba(244, 63, 94, 0.35)',
      color: '#fda4af',
      borderRadius: '5px',
      padding: '2px 7px',
      fontSize: '10px',
      cursor: 'pointer',
    });
    resetBtn.addEventListener('click', () => {
      this.callbacks.onResetRecords();
      this.refresh();
    });

    splitHeader.appendChild(this.pbHeaderLabel);
    splitHeader.appendChild(resetBtn);
    this.root.appendChild(splitHeader);

    const table = document.createElement('table');
    Object.assign(table.style, {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '10px',
    });
    table.innerHTML = `
      <thead>
        <tr style="color:#64748b; text-align:left; border-bottom:1px solid rgba(148,163,184,0.14);">
          <th style="padding:4px 2px;">Checkpoint</th>
          <th style="padding:4px 2px; text-align:right;">PB</th>
          <th style="padding:4px 2px; text-align:right;">Best Seg</th>
          <th style="padding:4px 2px; text-align:right;">Delta</th>
        </tr>
      </thead>
    `;
    this.splitsBody = document.createElement('tbody');
    table.appendChild(this.splitsBody);
    this.root.appendChild(table);

    document.body.appendChild(this.root);
    document.addEventListener('pointerlockchange', this.syncVisibility);

    this.refresh();
    this.syncVisibility();
  }

  public syncVisibility = (): void => {
    const locked = Boolean(document.pointerLockElement);
    this.root.style.display = locked ? 'none' : 'block';
    if (!locked) {
      this.refresh();
    }
  };

  public refresh(): void {
    const pb = this.runTracker.pbSec;
    this.pbHeaderLabel.textContent =
      pb !== null ? `FULL RUN PB: ${RunTracker.formatTime(pb)}` : 'FULL RUN PB: --';

    const pbSplits = this.runTracker.getPbSplits();
    const bestSegs = this.runTracker.getBestSegments();
    const currentSplits = this.runTracker.getCurrentSplits();

    this.splitsBody.innerHTML = '';

    for (const row of SPLIT_ROWS) {
      const pbEntry = pbSplits[row.index];
      const bestSeg = bestSegs[row.index];
      const cur = currentSplits.get(row.index);

      const pbText = pbEntry ? RunTracker.formatTime(pbEntry.elapsedSec) : '--';
      const segText = bestSeg !== undefined ? RunTracker.formatTime(bestSeg) : '--';

      let deltaText = '--';
      let deltaColor = '#94a3b8';
      if (cur && cur.deltaSec !== null) {
        deltaText = RunTracker.formatDelta(cur.deltaSec);
        deltaColor = cur.deltaSec <= 0 ? '#34d399' : '#fb7185';
      } else if (row.index === 99 && this.runTracker.lastDeltaSec !== null && this.runTracker.state === 'FINISHED') {
        deltaText = RunTracker.formatDelta(this.runTracker.lastDeltaSec);
        deltaColor = this.runTracker.lastDeltaSec <= 0 ? '#34d399' : '#fb7185';
      }

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(148, 163, 184, 0.08)';
      tr.innerHTML = `
        <td style="padding:5px 2px; color:#cbd5e1;">${row.label}</td>
        <td style="padding:5px 2px; text-align:right; color:#e2e8f0;">${pbText}</td>
        <td style="padding:5px 2px; text-align:right; color:#fbbf24;">${segText}</td>
        <td style="padding:5px 2px; text-align:right; font-weight:700; color:${deltaColor};">${deltaText}</td>
      `;
      this.splitsBody.appendChild(tr);
    }
  }
}
