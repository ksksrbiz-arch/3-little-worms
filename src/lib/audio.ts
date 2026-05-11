class AudioManager {
  ctx: AudioContext | null = null;
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playCollect() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playDeath() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.5);
    
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  startBoost() {
    if (!this.ctx) return;
    if (this.boostOsc) return;

    this.boostOsc = this.ctx.createOscillator();
    this.boostGain = this.ctx.createGain();
    
    this.boostOsc.connect(this.boostGain);
    this.boostGain.connect(this.ctx.destination);

    this.boostOsc.type = 'triangle';
    this.boostOsc.frequency.setValueAtTime(120, this.ctx.currentTime);
    
    this.boostGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.boostGain.gain.linearRampToValueAtTime(0.02, this.ctx.currentTime + 0.1);

    this.boostOsc.start();
  }

  stopBoost() {
    if (!this.ctx || !this.boostOsc || !this.boostGain) return;
    
    this.boostGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    this.boostOsc.stop(this.ctx.currentTime + 0.1);
    
    this.boostOsc = null;
    this.boostGain = null;
  }
}

export const audioManager = new AudioManager();
