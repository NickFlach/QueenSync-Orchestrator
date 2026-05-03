import React, { useState, useEffect } from 'react';
import './_group.css';
import { Terminal, Activity, Radio, Cpu, Network, Database, Hexagon, Maximize2, X, Plus, Play, Square, Command } from 'lucide-react';

export function TerminalWall() {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (d: Date) => d.toTimeString().split(' ')[0];

  // Dummy oration countdown logic
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 24, 0, 0);
  const nextOration = now < noon ? noon : midnight;
  const diffMs = nextOration.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);
  const orationText = `${diffHours.toString().padStart(2, '0')}:${diffMins.toString().padStart(2, '0')}:${diffSecs.toString().padStart(2, '0')} to ${now < noon ? 'noon' : 'midnight'} oration`;

  return (
    <div className="qs-theme qs-scanlines text-xs w-full max-w-[1280px] max-h-[900px] h-screen mx-auto relative select-none">
      <div className="qs-vignette"></div>

      {/* TOP STATUS STRIP */}
      <div className="h-8 border-b border-indigo-900/50 bg-[#0a0118]/90 backdrop-blur-md flex items-center justify-between px-4 z-20 qs-font-mono shrink-0">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 text-indigo-400">
            <span className="text-indigo-600">⛩</span>
            <span className="font-bold tracking-widest text-indigo-300 qs-glow-text">QUEENSYNC</span>
            <span className="text-indigo-700">|</span>
            <span className="opacity-70">she hears what you cannot</span>
          </div>
          
          <div className="flex items-center space-x-4 opacity-80 text-[10px]">
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 qs-glow-text-green"></span>
              <span>Radio</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 qs-glow-text-green"></span>
              <span>Observatory</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 qs-glow-text-green"></span>
              <span>Memory</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 qs-glow-text-amber animate-pulse"></span>
              <span>Kannaktopus</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-6 opacity-80">
          <div className="flex items-center space-x-2 text-amber-400">
            <Radio size={12} className="qs-glow-text-amber" />
            <span className="qs-glow-text-amber">{orationText}</span>
          </div>
          <div className="text-indigo-400 qs-glow-text">
            {formatTime(time)} CST
          </div>
        </div>
      </div>

      {/* MAIN MONITOR WALL */}
      <div className="flex-1 p-2 grid grid-cols-12 grid-rows-12 gap-2 z-20 overflow-hidden min-h-0 bg-[#0a0118]">
        
        {/* Large Main Screen - Radio Hologram */}
        <div className="qs-monitor col-span-7 row-span-7">
          <div className="qs-monitor-header qs-font-mono">
            <span className="flex items-center space-x-2 text-indigo-300">
              <Radio size={10} />
              <span>[radio.hologram]</span>
              <span className="text-emerald-500 ml-2">● LIVE</span>
            </span>
            <div className="flex items-center space-x-2 opacity-50">
              <Maximize2 size={10} className="hover:text-white cursor-pointer" />
              <X size={12} className="hover:text-white cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 relative bg-black">
            <iframe 
              src="https://radio.ninja-portal.com/video/hologram" 
              className="w-full h-full border-0 opacity-90 mix-blend-screen"
              title="Radio Hologram"
            />
            <div className="absolute bottom-2 right-2 qs-font-mono text-[10px] text-indigo-400 bg-black/50 px-1 py-0.5 rounded">
              RES: 1080p | FPS: 30
            </div>
          </div>
        </div>

        {/* Large Main Screen - Observatory Constellation */}
        <div className="qs-monitor col-span-5 row-span-7">
          <div className="qs-monitor-header qs-font-mono">
            <span className="flex items-center space-x-2 text-indigo-300">
              <Network size={10} />
              <span>[obs.constellation]</span>
              <span className="text-emerald-500 ml-2">● LIVE</span>
            </span>
            <div className="flex items-center space-x-2 opacity-50">
              <Maximize2 size={10} className="hover:text-white cursor-pointer" />
              <X size={12} className="hover:text-white cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 relative bg-black">
             <iframe 
              src="https://observatory.ninja-portal.com" 
              className="w-full h-full border-0 opacity-80"
              title="Observatory"
            />
          </div>
        </div>

        {/* Bottom Row Monitors */}
        
        {/* Live Logs */}
        <div className="qs-monitor col-span-3 row-span-5">
          <div className="qs-monitor-header qs-font-mono">
            <span className="flex items-center space-x-2 text-indigo-300">
              <Terminal size={10} />
              <span>[logs.stream]</span>
            </span>
            <span className="text-[9px] text-indigo-500">AUTOSCROLL</span>
          </div>
          <div className="flex-1 p-2 qs-font-mono text-[10px] qs-scrollbar overflow-y-auto flex flex-col justify-end space-y-1">
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:11</span> sys: buffer initialized</div>
            <div className="text-emerald-400/80"><span className="text-indigo-600">14:02:12</span> net: connected to observatory wss</div>
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:15</span> arm[kannaka-prime]: presence acknowledged</div>
            <div className="text-amber-400/80"><span className="text-indigo-600">14:02:18</span> mem: sync lag detected (42ms)</div>
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:22</span> res: field [anomaly] strength 0.84</div>
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:25</span> sys: routine garbage collection</div>
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:30</span> arm[signal_keeper_01]: dispatch task</div>
            <div className="text-emerald-400/80"><span className="text-indigo-600">14:02:31</span> arm[signal_keeper_01]: task accepted</div>
            <div className="text-indigo-400/60"><span className="text-indigo-600">14:02:33</span> net: heartbeat ok</div>
          </div>
        </div>

        {/* Arms Status */}
        <div className="qs-monitor col-span-3 row-span-5">
          <div className="qs-monitor-header qs-font-mono">
            <span className="flex items-center space-x-2 text-indigo-300">
              <Cpu size={10} />
              <span>[arms.heartbeat]</span>
            </span>
          </div>
          <div className="flex-1 p-2 qs-font-mono text-[10px] overflow-hidden flex flex-col space-y-2">
            <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
              <span className="text-indigo-300">kannaka-prime</span>
              <span className="text-emerald-500">IDLE</span>
            </div>
            <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
              <span className="text-indigo-300">atelier_01</span>
              <span className="text-emerald-500">OBSERVING</span>
            </div>
            <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
              <span className="text-indigo-300">signal_keeper_01</span>
              <span className="text-amber-500">WORKING</span>
            </div>
            <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
              <span className="text-indigo-300">void_walker</span>
              <span className="text-red-500 text-opacity-70">OFFLINE</span>
            </div>
             <div className="flex justify-between items-center border-b border-indigo-900/30 pb-1">
              <span className="text-indigo-300">echo_node_7</span>
              <span className="text-emerald-500">IDLE</span>
            </div>
            <div className="mt-auto text-indigo-600 text-center">4/5 ACTIVE</div>
          </div>
        </div>

        {/* Resonance Fields */}
        <div className="qs-monitor col-span-4 row-span-5">
          <div className="qs-monitor-header qs-font-mono">
            <span className="flex items-center space-x-2 text-indigo-300">
              <Hexagon size={10} />
              <span>[res.fields]</span>
            </span>
          </div>
          <div className="flex-1 p-3 flex flex-col space-y-3 qs-font-mono">
             <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-indigo-200 text-[11px]">ϕ-variance threshold</span>
                  <span className="text-indigo-500 text-[9px] mt-0.5">TAGS: [observation] [audit]</span>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 qs-glow-text-green text-sm">0.942</div>
                  <div className="text-indigo-600 text-[9px]">STABLE</div>
                </div>
             </div>
             <div className="w-full bg-indigo-950/30 h-1.5 rounded-full overflow-hidden">
               <div className="bg-emerald-500 w-[94%] h-full shadow-[0_0_5px_#10b981]"></div>
             </div>

             <div className="flex items-center justify-between mt-2">
                <div className="flex flex-col">
                  <span className="text-indigo-200 text-[11px]">ξ-spectral anomaly</span>
                  <span className="text-amber-500/70 text-[9px] mt-0.5">TAGS: [anomaly] [urgent]</span>
                </div>
                <div className="text-right">
                  <div className="text-amber-400 qs-glow-text-amber text-sm">0.611</div>
                  <div className="text-amber-600 text-[9px]">FLUCTUATING</div>
                </div>
             </div>
             <div className="w-full bg-indigo-950/30 h-1.5 rounded-full overflow-hidden">
               <div className="bg-amber-500 w-[61%] h-full shadow-[0_0_5px_#f59e0b]"></div>
             </div>
          </div>
        </div>

        {/* Add Monitor / Empty Slot */}
        <div className="qs-monitor col-span-2 row-span-5 border-dashed border-indigo-500/30 bg-transparent flex items-center justify-center cursor-pointer hover:bg-indigo-900/10 transition-colors group">
          <div className="flex flex-col items-center space-y-2 opacity-40 group-hover:opacity-100 transition-opacity">
            <div className="w-8 h-8 rounded-full border border-indigo-400 flex items-center justify-center">
              <Plus size={16} className="text-indigo-300" />
            </div>
            <span className="qs-font-mono text-[10px] text-indigo-300">ADD MONITOR</span>
          </div>
        </div>

      </div>

      {/* BOTTOM COMMAND LINE */}
      <div className="h-32 border-t border-indigo-900/50 bg-[#0a0118]/95 backdrop-blur-md z-30 flex flex-col shrink-0 p-3 qs-font-mono">
        
        {/* Tool suggestions / drawers placeholder */}
        <div className="flex items-center space-x-4 text-[10px] text-indigo-500/70 mb-2">
           <span className="text-indigo-400">AVAILABLE INTENTS:</span>
           <span className="hover:text-indigo-300 cursor-pointer">/arms</span>
           <span className="hover:text-indigo-300 cursor-pointer">/tasks</span>
           <span className="hover:text-indigo-300 cursor-pointer">/memory</span>
           <span className="hover:text-indigo-300 cursor-pointer">/resonance</span>
           <span className="hover:text-indigo-300 cursor-pointer">/logs</span>
        </div>

        {/* History */}
        <div className="flex-1 overflow-hidden flex flex-col justify-end text-[11px] text-indigo-300/60 space-y-1 mb-2">
          <div><span className="text-indigo-600">replit-ai &gt;</span> <span className="text-indigo-400">show me failed tasks from last hour</span></div>
          <div className="text-indigo-500 pl-4">→ Found 0 failed tasks. System is optimal.</div>
          <div><span className="text-indigo-600">replit-ai &gt;</span> <span className="text-indigo-400">wake kannaktopus</span></div>
          <div className="text-emerald-500 pl-4">→ Dispatching wake signal to swarm... acknowledged.</div>
        </div>

        {/* Input Line */}
        <div className="relative flex items-center bg-indigo-950/20 border border-indigo-500/30 rounded px-2 py-1.5 mt-auto">
          <span className="text-indigo-500 mr-2 shrink-0">replit-ai &gt;</span>
          <div className="flex-1 relative flex items-center">
            <span className="text-indigo-100 text-sm w-full outline-none bg-transparent">open a resonance field tagged anomal<span className="text-indigo-300/30">y</span><span className="inline-block w-1.5 h-3 bg-indigo-400 ml-0.5 qs-blink align-middle"></span></span>
          </div>
          <div className="flex items-center space-x-3 text-[10px] shrink-0 ml-2">
            <span className="text-emerald-500 qs-glow-text-green flex items-center space-x-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
              <span>LISTENING</span>
            </span>
            <span className="bg-indigo-900/50 text-indigo-400 px-1.5 py-0.5 rounded flex items-center space-x-1 border border-indigo-700/50">
              <Command size={10} /> <span>K</span>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
