import { v4 as uuidv4 } from 'uuid';
import { GameState, WORLD_SIZE, INITIAL_LENGTH, SEGMENT_SPACING, TURN_SPEED, BASE_SPEED, BOOST_SPEED } from '../shared/types';

const COLORS = [
  '#ff7eb3', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9',
];

interface BotAI {
  targetId: string | null;
  targetType: 'orb' | 'attack' | 'flee' | null;
  reTargetTimer: number;
}

export const botsAI: Record<string, BotAI> = {};
const TARGET_BOTS = 15;

export function updateBots(state: GameState, delta: number, spawnOrb: (x: number, y: number, v: number, c: string, f: boolean) => void) {
  let aliveBots = 0;
  for (const id in state.players) {
    if (state.players[id].isBot && state.players[id].state === 'alive') {
      aliveBots++;
    }
  }

  // Spawn bots
  if (aliveBots < TARGET_BOTS && Math.random() < 0.1) {
    const id = 'bot-' + uuidv4();
    const angle = Math.random() * Math.PI * 2;
    const startX = (Math.random() - 0.5) * (WORLD_SIZE - 20);
    const startY = (Math.random() - 0.5) * (WORLD_SIZE - 20);
    
    const segments = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      segments.push({
        x: startX - Math.cos(angle) * i * SEGMENT_SPACING,
        y: startY - Math.sin(angle) * i * SEGMENT_SPACING,
      });
    }

    state.players[id] = {
      id,
      name: `Bot-${Math.floor(Math.random() * 9999)}`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      segments,
      score: INITIAL_LENGTH,
      isBoosting: false,
      state: 'alive',
      currentAngle: angle,
      inputs: { left: false, right: false, boost: false },
      isBot: true
    };
    botsAI[id] = { targetId: null, targetType: null, reTargetTimer: 0 };
  }

  // Update bots
  for (const id in botsAI) {
    const botPlayer = state.players[id];
    if (!botPlayer || botPlayer.state !== 'alive') {
      delete botsAI[id];
      continue;
    }
    
    if (botPlayer.segments.length === 0) continue;
    const ai = botsAI[id];
    const head = botPlayer.segments[0];

    // Sub-routine to find target
    ai.reTargetTimer -= delta;
    if (ai.reTargetTimer <= 0 || !ai.targetId) {
      ai.reTargetTimer = 0.5 + Math.random(); 
      // 1. Check for nearby players (flee if bigger, attack if smaller)
      let closestThreatSq = Infinity;
      let closestPreySq = Infinity;
      let closestThreatId = null;
      let closestPreyId = null;

      for (const pId in state.players) {
          if (pId === id) continue;
          const p = state.players[pId];
          if (p.state !== 'alive' || p.segments.length === 0) continue;
          
          const dx = p.segments[0].x - head.x;
          const dy = p.segments[0].y - head.y;
          const distSq = dx*dx + dy*dy;
          
          if (distSq < 900) { // Within 30 units radius
              if (p.score > botPlayer.score + 5) {
                  if (distSq < closestThreatSq) {
                      closestThreatSq = distSq;
                      closestThreatId = pId;
                  }
              } else if (p.score < botPlayer.score - 5) {
                  if (distSq < closestPreySq) {
                      closestPreySq = distSq;
                      closestPreyId = pId;
                  }
              }
          }
      }

      if (closestThreatId) {
          ai.targetId = closestThreatId;
          ai.targetType = 'flee';
          if (Math.random() < 0.5) botPlayer.isBoosting = true;
      } else if (closestPreyId) {
          ai.targetId = closestPreyId;
          ai.targetType = 'attack';
          if (Math.random() < 0.3) botPlayer.isBoosting = true;
      } else {
          // Pick closest orb
          let closestOrbSq = Infinity;
          let closestOrbId = null;
          for (const orbId in state.orbs) {
              const orb = state.orbs[orbId];
              const dx = orb.x - head.x;
              const dy = orb.y - head.y;
              const distSq = dx*dx + dy*dy;
              if (distSq < closestOrbSq) {
                  closestOrbSq = distSq;
                  closestOrbId = orbId;
              }
          }
          if (closestOrbId) {
             ai.targetId = closestOrbId;
             ai.targetType = 'orb';
          }
      }
    }

    // Determine target position
    let targetX = head.x;
    let targetY = head.y;
    let hasTarget = false;

    if (ai.targetType === 'orb' && ai.targetId && state.orbs[ai.targetId]) {
      const orb = state.orbs[ai.targetId];
      targetX = orb.x;
      targetY = orb.y;
      hasTarget = true;
    } else if (ai.targetType === 'attack' && ai.targetId && state.players[ai.targetId] && state.players[ai.targetId].state === 'alive') {
      const prey = state.players[ai.targetId].segments[0];
      targetX = prey.x;
      targetY = prey.y;
      hasTarget = true;
    } else if (ai.targetType === 'flee' && ai.targetId && state.players[ai.targetId] && state.players[ai.targetId].state === 'alive') {
      const threat = state.players[ai.targetId].segments[0];
      // Flee in opposite direction
      targetX = head.x + (head.x - threat.x);
      targetY = head.y + (head.y - threat.y);
      hasTarget = true;
    } else {
        ai.targetId = null;
        ai.targetType = null;
    }

    // Steering
    if (hasTarget) {
      const targetAngle = Math.atan2(targetY - head.y, targetX - head.x);
      // Diff between targetAngle and currentAngle
      let diff = targetAngle - botPlayer.currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (diff > 0.1) {
          botPlayer.currentAngle += TURN_SPEED * delta;
      } else if (diff < -0.1) {
          botPlayer.currentAngle -= TURN_SPEED * delta;
      }
    }

    // Obstacle avoidance (simple push away)
    let avoidAngle = 0;
    let avoidStength = 0;
    for (const hId in state.hazards) {
        const haz = state.hazards[hId];
        const dx = head.x - haz.x;
        const dy = head.y - haz.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < haz.radius + 5) {
             avoidAngle = Math.atan2(dy, dx);
             avoidStength = 1;
        }
    }
    if (avoidStength > 0) {
       // Steer towards avoidAngle
       let diff = avoidAngle - botPlayer.currentAngle;
       while (diff > Math.PI) diff -= Math.PI * 2;
       while (diff < -Math.PI) diff += Math.PI * 2;
       botPlayer.currentAngle += Math.sign(diff) * TURN_SPEED * delta;
    }


    // Move bot
    // Random boost if high score
    if (botPlayer.score > 20 && Math.random() < 0.01) botPlayer.isBoosting = true;
    if (botPlayer.score <= 12 || Math.random() < 0.05) botPlayer.isBoosting = false;

    const speed = botPlayer.isBoosting ? BOOST_SPEED : BASE_SPEED;
    const newHead = { ...head };
    newHead.x += Math.cos(botPlayer.currentAngle) * speed * delta;
    newHead.y += Math.sin(botPlayer.currentAngle) * speed * delta;

    // Boundaries
    const boundary = WORLD_SIZE / 2;
    if (newHead.x < -boundary) newHead.x = -boundary;
    if (newHead.x > boundary) newHead.x = boundary;
    if (newHead.y < -boundary) newHead.y = -boundary;
    if (newHead.y > boundary) newHead.y = boundary;

    botPlayer.segments.unshift(newHead);

    if (botPlayer.isBoosting) {
       botPlayer.score -= 2 * delta;
       if (botPlayer.score <= 10) {
          botPlayer.isBoosting = false;
          botPlayer.score = 10;
       }
    }

    const targetLength = Math.max(INITIAL_LENGTH, Math.floor(botPlayer.score));
    while (botPlayer.segments.length > targetLength) {
       botPlayer.segments.pop();
    }

    // Bot Collection of Orbs
    for (const orbId in state.orbs) {
      const orb = state.orbs[orbId];
      const dx = newHead.x - orb.x;
      const dy = newHead.y - orb.y;
      if (dx*dx + dy*dy < 4) {
          botPlayer.score += orb.value;
          delete state.orbs[orbId];
      }
    }

    // Bot Collision Check
    let collided = false;
    // 1. Players
    for (const otherId in state.players) {
       if (otherId === id) continue;
       const other = state.players[otherId];
       if (other.state !== 'alive') continue;
       for (const seg of other.segments) {
           const dx = newHead.x - seg.x;
           const dy = newHead.y - seg.y;
           if (dx*dx+dy*dy < 2.25) {
               collided = true;
               break;
           }
       }
       if (collided) break;
    }
    // 3. Hazards
    if (!collided) {
       for (const hazId in state.hazards) {
          const haz = state.hazards[hazId];
          if (haz.state === 'active') {
             const dx = newHead.x - haz.x;
             const dy = newHead.y - haz.y;
             if (dx*dx + dy*dy < (haz.radius + 0.8) * (haz.radius + 0.8)) {
                botPlayer.score -= 20 * delta;
                if (botPlayer.score <= 10) collided = true;
             }
          }
       }
    }

    if (collided) {
        botPlayer.state = 'dead';
        botPlayer.segments.forEach((seg, i) => {
           if (i % 2 === 0) spawnOrb(seg.x, seg.y, 1, botPlayer.color, true);
        });
    }
  }
}
