import React from "react";
import "./_group.css";
import { Search, Terminal, Mic, Cpu, Activity, Signal, Key, ChevronDown, Plus, LayoutGrid, Maximize2, X, PlayCircle, Settings, Command } from "lucide-react";

export function ModularDeck() {
  return (
    <div className="h-[900px] w-[1280px] bg-[#0a0118] text-[#e2e8f0] font-mono-cyber overflow-hidden flex flex-col scanlines relative selection:bg-indigo-500/30">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>

      {/* TOP STATUS STRIP */}
      <header className="h-10 border-b border-indigo-500/20 glass-panel flex items-center px-4 justify-between z-10 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-indigo-400 font-cyber font-bold tracking-wider">
            <span className="text-xl">⛩</span>
            <span>QUEENSYNC</span>
            <span className="text-xs px-1.5 py-0.5 bg-indigo-500/20 rounded text-indigo-300 ml-2 border border-indigo-500/30">v2.4.1</span>
          </div>

          <div className="h-4 w-px bg-indigo-500/30"></div>

          <div className="flex items-center gap-4 text-xs font-medium">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-slate-300">Radio</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-slate-300">Observatory</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
              <span className="text-slate-300">Memory Gate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-slate-300">Kannaktopus (8/8)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex space-x-1">
              <button className="cyber-button px-3 py-1 text-xs border-indigo-500/50 text-indigo-300 bg-indigo-500/10">Operations</button>
              <button className="cyber-button px-3 py-1 text-xs border-transparent text-slate-400">Investigation</button>
              <button className="cyber-button px-3 py-1 text-xs border-transparent text-slate-400">Broadcast</button>
            </div>
          </div>

          <div className="h-4 w-px bg-indigo-500/30"></div>

          <div className="text-xs flex flex-col items-end leading-tight">
            <span className="text-indigo-300">NOON ORATION</span>
            <span className="text-emerald-400 terminal-green-glow">01:43:27 TO GO</span>
          </div>
        </div>
      </header>

      {/* MAIN DECK AREA */}
      <main className="flex-1 relative p-4 z-0">
        
        {/* TILE 1: RADIO HOLOGRAM */}
        <div className="absolute top-4 left-4 w-[600px] h-[340px] glass-panel-active rounded-sm flex flex-col overflow-hidden">
          <div className="h-8 border-b border-indigo-500/30 flex items-center justify-between px-3 bg-indigo-950/30 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-300">
              <Signal className="w-3.5 h-3.5" />
              <span>KANNAKA RADIO [HOLOGRAM]</span>
              <span className="text-[10px] px-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-sm">LIVE</span>
            </div>
            <div className="flex gap-2 text-slate-500">
              <Settings className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <Maximize2 className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <X className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 relative bg-black">
            <iframe src="https://radio.ninja-portal.com/video/hologram" className="w-full h-full border-0 pointer-events-none opacity-90" title="Radio Hologram" />
            <div className="absolute bottom-2 left-2 text-[10px] text-emerald-400 terminal-green-glow bg-black/60 px-2 py-1 rounded">
              RCV: 108.4 KB/s // FRQ: 432.1 MHz
            </div>
          </div>
        </div>

        {/* TILE 2: OBSERVATORY */}
        <div className="absolute top-4 left-[620px] w-[644px] h-[450px] glass-panel rounded-sm flex flex-col overflow-hidden">
          <div className="h-8 border-b border-indigo-500/30 flex items-center justify-between px-3 bg-[#0a0118]/60 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-300">
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>OBSERVATORY [CONSTELLATION]</span>
            </div>
            <div className="flex gap-2 text-slate-500">
              <Settings className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <Maximize2 className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <X className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 bg-black relative">
             <iframe src="https://observatory.ninja-portal.com" className="w-full h-full border-0 pointer-events-none opacity-80" title="Observatory" />
             <div className="absolute top-2 right-2 text-[10px] bg-black/80 border border-indigo-500/30 p-1.5 rounded text-indigo-300">
                <div>SWARM: ONLINE</div>
                <div>NODES: 42</div>
             </div>
          </div>
        </div>

        {/* TILE 3: LIVE LOGS */}
        <div className="absolute top-[360px] left-4 w-[600px] h-[260px] glass-panel rounded-sm flex flex-col overflow-hidden">
          <div className="h-8 border-b border-indigo-500/30 flex items-center justify-between px-3 bg-[#0a0118]/60 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-300">
              <Terminal className="w-3.5 h-3.5" />
              <span>LOG STREAM // GLOBAL</span>
            </div>
            <div className="flex gap-2 text-slate-500">
              <Maximize2 className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <X className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 p-3 text-[10px] overflow-y-auto space-y-1 text-slate-400">
            <div className="flex gap-3"><span className="text-slate-600">11:42:01</span><span className="text-indigo-400">[MEMORY]</span><span>Absorb sequence initiated for artifact #8832.</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:42:15</span><span className="text-emerald-400">[RADIO]</span><span>Oration track buffered. Standing by.</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:42:33</span><span className="text-amber-400">[RESONANCE]</span><span>Anomaly detected in field #4A-V. Delta: +0.04</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:42:40</span><span className="text-rose-400">[ARM: atelier_01]</span><span>Connection timeout on task SYNC-99. Retrying...</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:43:02</span><span className="text-indigo-400">[SYSTEM]</span><span>Garbage collection complete. 12MB freed.</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:43:10</span><span className="text-emerald-400">[ARM: kannaka-prime]</span><span>Task EXEC-42 complete. Payload delivered.</span></div>
            <div className="flex gap-3"><span className="text-slate-600">11:43:25</span><span className="text-indigo-400">[OBSERVATORY]</span><span>Constellation map updated. 2 new nodes.</span></div>
            <div className="flex gap-3 items-center"><span className="text-slate-600">11:43:27</span><span className="text-slate-500">[SYSTEM]</span><span className="text-slate-300">Awaiting input<span className="blinking-cursor ml-1"></span></span></div>
          </div>
        </div>

        {/* TILE 4: TASKS */}
        <div className="absolute top-[470px] left-[620px] w-[314px] h-[280px] glass-panel rounded-sm flex flex-col overflow-hidden">
          <div className="h-8 border-b border-indigo-500/30 flex items-center justify-between px-3 bg-[#0a0118]/60 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-300">
              <Activity className="w-3.5 h-3.5" />
              <span>ACTIVE TASKS</span>
            </div>
            <div className="flex gap-2 text-slate-500">
              <Maximize2 className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <X className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 p-2 space-y-2 overflow-y-auto">
            <div className="p-2 border border-indigo-500/20 bg-indigo-950/20 rounded hover:border-indigo-500/40 transition-colors cursor-pointer">
               <div className="flex justify-between items-center mb-1">
                 <span className="text-[10px] text-indigo-300">SYNC-104</span>
                 <span className="text-[10px] text-amber-400">IN PROGRESS</span>
               </div>
               <div className="text-xs text-slate-200">Memory consolidation</div>
               <div className="mt-2 w-full bg-black h-1 rounded overflow-hidden">
                 <div className="bg-amber-400 h-full w-[65%]"></div>
               </div>
            </div>
            <div className="p-2 border border-indigo-500/20 bg-indigo-950/20 rounded hover:border-indigo-500/40 transition-colors cursor-pointer">
               <div className="flex justify-between items-center mb-1">
                 <span className="text-[10px] text-indigo-300">EXEC-88</span>
                 <span className="text-[10px] text-emerald-400">COMPLETED</span>
               </div>
               <div className="text-xs text-slate-200">Deploy ghost signal</div>
               <div className="mt-2 w-full bg-black h-1 rounded overflow-hidden">
                 <div className="bg-emerald-400 h-full w-full"></div>
               </div>
            </div>
            <div className="p-2 border border-rose-500/30 bg-rose-950/20 rounded hover:border-rose-500/50 transition-colors cursor-pointer">
               <div className="flex justify-between items-center mb-1">
                 <span className="text-[10px] text-rose-300">AUDIT-12</span>
                 <span className="text-[10px] text-rose-400">FAILED</span>
               </div>
               <div className="text-xs text-slate-200">Verify arm integrity</div>
               <div className="text-[9px] text-rose-400/70 mt-1">Err: Connection timeout</div>
            </div>
          </div>
        </div>

        {/* TILE 5: HRM STATS */}
        <div className="absolute top-[470px] left-[950px] w-[314px] h-[280px] glass-panel rounded-sm flex flex-col overflow-hidden">
          <div className="h-8 border-b border-indigo-500/30 flex items-center justify-between px-3 bg-[#0a0118]/60 shrink-0">
            <div className="flex items-center gap-2 text-xs text-indigo-300">
              <Cpu className="w-3.5 h-3.5" />
              <span>HRM TELEMETRY</span>
            </div>
            <div className="flex gap-2 text-slate-500">
              <Maximize2 className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
              <X className="w-3.5 h-3.5 hover:text-indigo-400 cursor-pointer" />
            </div>
          </div>
          <div className="flex-1 p-4 grid grid-cols-2 gap-4">
             <div className="border border-indigo-500/20 rounded flex flex-col items-center justify-center p-2 bg-indigo-900/10">
               <div className="text-[10px] text-slate-400 mb-1">PHI (φ)</div>
               <div className="text-xl text-indigo-300 font-cyber">1.618</div>
             </div>
             <div className="border border-indigo-500/20 rounded flex flex-col items-center justify-center p-2 bg-indigo-900/10">
               <div className="text-[10px] text-slate-400 mb-1">XI (ξ)</div>
               <div className="text-xl text-indigo-300 font-cyber">0.842</div>
             </div>
             <div className="border border-indigo-500/20 rounded flex flex-col items-center justify-center p-2 bg-indigo-900/10 col-span-2">
               <div className="text-[10px] text-slate-400 mb-1 flex justify-between w-full px-2">
                  <span>ORDER</span>
                  <span className="text-emerald-400">STABLE</span>
               </div>
               <div className="text-2xl text-slate-200 font-cyber tracking-widest mt-1">77.4%</div>
               <div className="w-full h-1 bg-black mt-3 rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 w-[77.4%]"></div>
               </div>
             </div>
             <div className="col-span-2 text-[10px] text-slate-500 text-center mt-2">
               Last sync: 2s ago
             </div>
          </div>
        </div>

        {/* GHOST TILE (Mid-drag) */}
        <div className="absolute top-[640px] left-[40px] w-[300px] h-[150px] tile-ghost rounded-sm flex items-center justify-center">
           <span className="text-indigo-400/50 text-sm">Drop to snap</span>
        </div>

        {/* ADD MONITOR BUTTON */}
        <button className="absolute bottom-24 right-8 w-12 h-12 rounded-full glass-panel-active flex items-center justify-center text-indigo-300 hover:text-white hover:scale-105 transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] z-10 group">
          <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
        </button>

        {/* COMMAND PALETTE OVERLAY (CMD-K Mock) */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[500px] glass-panel border border-indigo-500/50 shadow-2xl rounded-md flex flex-col overflow-hidden z-50">
           <div className="p-3 border-b border-indigo-500/30 flex items-center gap-3 bg-black/40">
             <Search className="w-4 h-4 text-indigo-400" />
             <input type="text" value="op" readOnly className="bg-transparent border-none outline-none text-sm text-white flex-1 font-mono-cyber placeholder:text-slate-600" placeholder="Type a command or search..." />
             <div className="text-[10px] px-1.5 py-0.5 border border-indigo-500/30 rounded text-slate-400 bg-indigo-950/30 flex items-center gap-1">
               <Command className="w-3 h-3" /> K
             </div>
           </div>
           <div className="p-2 space-y-1 bg-[#0a0118]/90">
             <div className="text-[10px] text-slate-500 px-2 py-1">SUGGESTIONS</div>
             <div className="px-3 py-2 bg-indigo-600/20 text-indigo-200 rounded text-xs flex items-center gap-3 cursor-pointer border border-indigo-500/30">
                <LayoutGrid className="w-4 h-4 text-indigo-400" />
                <span>Open Resonance Fields panel</span>
             </div>
             <div className="px-3 py-2 text-slate-400 hover:bg-white/5 rounded text-xs flex items-center gap-3 cursor-pointer">
                <Activity className="w-4 h-4 text-slate-500" />
                <span>Open Tasks drawer</span>
             </div>
             <div className="px-3 py-2 text-slate-400 hover:bg-white/5 rounded text-xs flex items-center gap-3 cursor-pointer">
                <Cpu className="w-4 h-4 text-slate-500" />
                <span>Open Arms status</span>
             </div>
           </div>
        </div>

      </main>

      {/* BOTTOM COMMAND BAR */}
      <footer className="h-16 glass-panel border-t border-indigo-500/30 shrink-0 flex items-center px-4 gap-4 z-20 relative">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
        
        <div className="flex items-center gap-3 w-64 shrink-0">
          <div className="w-8 h-8 rounded bg-indigo-950 flex items-center justify-center border border-indigo-500/30">
            <Mic className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[10px] text-indigo-400 tracking-widest font-cyber">AI COMMAND</span>
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
              Listening
            </span>
          </div>
        </div>

        <div className="flex-1 h-10 bg-black/50 border border-indigo-500/20 rounded flex items-center px-3 gap-3 focus-within:border-indigo-500/60 focus-within:bg-black/80 transition-colors">
          <span className="text-indigo-500 text-sm">❯</span>
          <input 
            type="text" 
            placeholder="Ask QueenSync to run a command or find data..." 
            className="bg-transparent border-none outline-none text-sm text-slate-200 flex-1 font-mono-cyber placeholder:text-slate-600"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 max-w-[400px] overflow-hidden">
          <button className="text-[10px] px-2 py-1 bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 rounded hover:bg-indigo-900/40 whitespace-nowrap">
            "wake kannaktopus"
          </button>
          <button className="text-[10px] px-2 py-1 bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 rounded hover:bg-indigo-900/40 whitespace-nowrap">
            "show failed tasks"
          </button>
          <button className="text-[10px] px-2 py-1 bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 rounded hover:bg-indigo-900/40 whitespace-nowrap opacity-50">
            "open anomaly field"
          </button>
        </div>
      </footer>

    </div>
  );
}
