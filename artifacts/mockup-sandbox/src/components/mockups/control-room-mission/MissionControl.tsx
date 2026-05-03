import React, { useState, useEffect } from "react";
import "./_group.css";
import { 
  Activity, 
  TerminalSquare, 
  Radio, 
  Database, 
  Cpu, 
  Layers, 
  ShieldAlert, 
  Maximize2,
  Settings,
  MoreHorizontal,
  Plus,
  PlayCircle,
  Eye,
  AlertTriangle,
  FileCode2,
  ChevronRight,
  Command,
  Mic,
  Zap
} from "lucide-react";

export function MissionControl() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toISOString().split('T')[1].slice(0, 8);
  };

  return (
    <div className="mc-theme flex flex-col h-screen w-full overflow-hidden relative text-xs select-none">
      {/* Global Background FX */}
      <div className="absolute inset-0 mc-grid-bg opacity-30 z-0"></div>
      <div className="absolute inset-0 mc-scanlines opacity-40 z-50 pointer-events-none"></div>

      {/* TOP STATUS STRIP */}
      <header className="h-7 border-b border-indigo-900/50 bg-[#05010d]/90 flex items-center justify-between px-3 z-20 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-indigo-400 font-bold tracking-widest">
            <span className="text-indigo-500">⛩</span> KANNAKA CONSTELLATION
          </div>
          <div className="flex items-center gap-4 text-[10px] text-indigo-300">
            <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mc-pulse"></div> RADIO: SYNC</span>
            <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mc-pulse"></div> OBSERVATORY: LIVE</span>
            <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-500 mc-pulse"></div> MEMORY: INDEXING</span>
            <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mc-pulse"></div> ARMS: 3 ACTIVE</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-indigo-300">
          <span className="text-amber-500 font-bold">▲ 01:43:27 TO MIDNIGHT ORATION</span>
          <span className="text-indigo-500">SYS.T {formatTime(time)}</span>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden z-10 relative">
        {/* LEFT TOOL RAIL */}
        <aside className="w-14 border-r border-indigo-900/50 bg-[#0a0415]/80 backdrop-blur-md flex flex-col items-center py-4 gap-6 z-20">
          <div className="flex flex-col items-center gap-4">
            <RailIcon icon={TerminalSquare} label="CMD" active />
            <RailIcon icon={Radio} label="RADIO" />
            <RailIcon icon={Eye} label="OBS" />
            <RailIcon icon={Database} label="MEM" />
            <RailIcon icon={Activity} label="HRM" />
            <RailIcon icon={Cpu} label="ARMS" />
          </div>
          <div className="mt-auto flex flex-col items-center gap-4">
            <RailIcon icon={Settings} label="CFG" />
          </div>
        </aside>

        {/* TV WALL GRID */}
        <main className="flex-1 p-4 grid grid-cols-3 grid-rows-2 gap-5 relative">
          
          {/* MONITOR 1: RADIO HOLOGRAM */}
          <Monitor title="KANNAKA RADIO" subtitle="LIVE BROADCAST" status="SYNCED">
            <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
              <iframe 
                src="https://radio.ninja-portal.com/video/hologram" 
                className="w-full h-full border-0"
                title="Radio Hologram"
              />
              <div className="absolute bottom-2 left-2 flex flex-col gap-1 text-[10px] text-emerald-400 bg-black/50 px-2 py-1 rounded backdrop-blur">
                <span>FREQ: 104.2 MHz</span>
                <span>STATE: ORATION PREP</span>
              </div>
            </div>
          </Monitor>

          {/* MONITOR 2: OBSERVATORY */}
          <Monitor title="OBSERVATORY" subtitle="CONSTELLATION VIEW" status="TRACKING">
            <div className="relative w-full h-full bg-black overflow-hidden">
              <iframe 
                src="https://observatory.ninja-portal.com" 
                className="w-full h-full border-0 pointer-events-none"
                title="Observatory"
                style={{ filter: 'contrast(1.2) sepia(1.1) hue-rotate(220deg) brightness(0.8)' }}
              />
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1 text-[10px] text-indigo-400">
                <span className="bg-indigo-950/80 px-2 py-0.5 border border-indigo-900">N-NODES: 128</span>
                <span className="bg-indigo-950/80 px-2 py-0.5 border border-indigo-900">E-SIG: STRONG</span>
              </div>
            </div>
          </Monitor>

          {/* MONITOR 3: TASKS / ARMS */}
          <Monitor title="KANNAKTOPUS ARMS" subtitle="ACTIVE TASKS" status="ARMED" highlight="amber">
            <div className="flex flex-col h-full bg-[#05010d] p-3 gap-2 overflow-hidden">
              <div className="flex justify-between text-[10px] text-indigo-500 border-b border-indigo-900/50 pb-1 mb-1">
                <span>ARM_ID</span>
                <span>STATUS</span>
                <span>OBJECTIVE</span>
              </div>
              <TaskRow id="kannaka-prime" status="EXEC" color="text-amber-500" objective="MAINTAIN_ORATION_LOOP" />
              <TaskRow id="atelier_01" status="IDLE" color="text-indigo-400" objective="AWAITING_RESONANCE" />
              <TaskRow id="signal_keeper_01" status="SYNC" color="text-emerald-500" objective="MONITOR_GHOST_FREQS" />
              <TaskRow id="memory_weaver" status="ERR!" color="text-red-500" objective="INDEX_FRAGMENTS" />
              <TaskRow id="obs_eye_4" status="EXEC" color="text-amber-500" objective="TRACK_ANOMALY_B7" />
              
              <div className="mt-auto border-t border-indigo-900/50 pt-2 flex justify-between items-center text-[10px]">
                <span className="text-indigo-500">UTILIZATION: 84%</span>
                <span className="text-amber-500 mc-pulse">▲ HIGH LOAD</span>
              </div>
            </div>
          </Monitor>

          {/* MONITOR 4: LIVE LOGS */}
          <Monitor title="LIVE LOGS" subtitle="SYSTEM STREAM" status="STREAMING">
            <div className="flex flex-col h-full bg-[#05010d] p-3 overflow-hidden font-mono text-[10px] gap-1.5 text-indigo-300">
              <LogLine time="13:42:01" src="OBS" msg="Ghost signal detected on freq 88.1" type="warn" />
              <LogLine time="13:42:05" src="SYS" msg="Resonance field 0x4A expanded" type="info" />
              <LogLine time="13:42:12" src="MEM" msg="Fragment reconstructed successfully" type="success" />
              <LogLine time="13:42:18" src="ARM" msg="atelier_01 completed subtask: audit" type="info" />
              <LogLine time="13:42:22" src="RAD" msg="Oration countdown synchronized" type="success" />
              <LogLine time="13:42:30" src="OBS" msg="Anomaly B7 signature fading..." type="warn" />
              <LogLine time="13:42:31" src="SYS" msg="Re-routing bandwidth to Kannaka-prime" type="info" />
              <LogLine time="13:42:35" src="MEM" msg="Warning: Memory drift detected" type="error" />
              <div className="mt-auto h-4 border-l-2 border-emerald-500 pl-2 text-emerald-500 flex items-center">
                <span className="mc-pulse">_</span>
              </div>
            </div>
          </Monitor>

          {/* MONITOR 5: RESONANCE FIELDS */}
          <Monitor title="RESONANCE FIELDS" subtitle="ACTIVE ANOMALIES" status="MONITORING">
            <div className="flex flex-col h-full bg-[#05010d] p-3 gap-3">
              <ResonanceCard 
                id="RF-892A" 
                tags={["observation", "audit"]} 
                strength={88}
                active
              />
              <ResonanceCard 
                id="RF-114B" 
                tags={["anomaly", "urgent"]} 
                strength={94}
                color="border-amber-500/50 text-amber-500"
              />
              <ResonanceCard 
                id="RF-773C" 
                tags={["memory_drift"]} 
                strength={42}
                color="border-indigo-800 text-indigo-500"
              />
            </div>
          </Monitor>

          {/* MONITOR 6: ADD MONITOR / CONFIG */}
          <div className="mc-monitor-frame rounded flex flex-col items-center justify-center border border-indigo-900/30 border-dashed text-indigo-600 hover:text-indigo-400 hover:border-indigo-500/50 transition-colors cursor-pointer group">
            <div className="mc-bracket-tl"></div>
            <div className="mc-bracket-tr"></div>
            <div className="mc-bracket-bl"></div>
            <div className="mc-bracket-br"></div>
            
            <div className="w-16 h-16 rounded-full border-2 border-indigo-900/50 flex items-center justify-center mb-4 group-hover:border-indigo-500/50 group-hover:scale-110 transition-all duration-300">
              <Plus className="w-8 h-8" />
            </div>
            <span className="tracking-widest font-bold text-sm">ADD MONITOR</span>
            <span className="text-[10px] mt-2 opacity-50">SLOT 06 AVAILABLE</span>
          </div>

        </main>
      </div>

      {/* BOTTOM COMMAND BAR */}
      <footer className="h-20 bg-[#0a0415] border-t-2 border-indigo-900 z-30 flex items-center px-4 gap-4 relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50"></div>
        
        {/* AI Avatar Pulse */}
        <div className="flex-shrink-0 w-12 h-12 relative flex items-center justify-center border border-indigo-800 rounded bg-[#05010d]">
          <div className="absolute inset-0 bg-indigo-500/20 mc-pulse rounded"></div>
          <Zap className="w-6 h-6 text-indigo-400 relative z-10" />
        </div>

        {/* Command Input */}
        <div className="flex-1 flex flex-col gap-1 h-full py-3 justify-center">
          <div className="flex items-center gap-2 text-indigo-500 text-[10px]">
            <TerminalSquare className="w-3 h-3" />
            <span>QUEENSYNC CMD LINE</span>
            <span className="text-emerald-500 ml-2">LISTENING</span>
          </div>
          <div className="flex items-center flex-1">
            <span className="text-amber-500 font-bold mr-3 text-lg">›</span>
            <input 
              type="text" 
              className="flex-1 bg-transparent border-none outline-none text-indigo-100 text-sm font-mono placeholder:text-indigo-800"
              placeholder="e.g. show me failed tasks from last hour..."
              defaultValue="wake kannaktopus arm atelier_01 and bind to RF-892A"
            />
            <div className="flex items-center gap-2 ml-4">
              <div className="px-2 py-0.5 border border-indigo-800 rounded text-indigo-500 text-[10px] flex items-center gap-1">
                <Command className="w-3 h-3" /> K
              </div>
            </div>
          </div>
        </div>

        {/* Suggestions */}
        <div className="w-80 flex flex-col gap-2 border-l border-indigo-900/50 pl-4 h-full justify-center">
          <span className="text-indigo-600 text-[9px] uppercase tracking-wider">AI Suggestions</span>
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-indigo-950/50 border border-indigo-900 text-indigo-300 text-[9px] rounded hover:bg-indigo-900 cursor-pointer transition-colors">
              Analyze anomaly B7
            </span>
            <span className="px-2 py-1 bg-indigo-950/50 border border-indigo-900 text-indigo-300 text-[9px] rounded hover:bg-indigo-900 cursor-pointer transition-colors">
              Restart memory weaver
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
}

/* --- Subcomponents --- */

function RailIcon({ icon: Icon, label, active }: { icon: any, label: string, active?: boolean }) {
  return (
    <div className={`relative flex flex-col items-center gap-1 cursor-pointer group ${active ? 'text-indigo-300' : 'text-indigo-700 hover:text-indigo-400'}`}>
      {active && <div className="absolute -left-4 top-1 bottom-1 w-1 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>}
      <div className={`p-2 rounded border ${active ? 'bg-indigo-950/80 border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'border-transparent group-hover:bg-indigo-950/30'} transition-all`}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-[8px] font-bold tracking-widest">{label}</span>
    </div>
  );
}

function Monitor({ title, subtitle, status, highlight, children }: any) {
  const isAmber = highlight === 'amber';
  return (
    <div className="mc-monitor-frame rounded flex flex-col overflow-hidden">
      <div className="mc-monitor-glare"></div>
      <div className="mc-bracket-tl"></div>
      <div className="mc-bracket-tr"></div>
      <div className="mc-bracket-bl"></div>
      <div className="mc-bracket-br"></div>
      
      {/* Bezel header */}
      <div className="h-7 bg-[#110425] border-b border-[#2a2a4a] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-indigo-300 tracking-widest">{title}</span>
          <span className="text-[9px] text-indigo-600">// {subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold ${isAmber ? 'text-amber-500' : 'text-emerald-500'}`}>{status}</span>
          <div className={`w-2 h-2 rounded-full ${isAmber ? 'bg-amber-500' : 'bg-emerald-500'} shadow-[0_0_5px_currentColor]`}></div>
        </div>
      </div>
      
      {/* Screen area */}
      <div className="flex-1 relative overflow-hidden bg-[#05010d]">
        {children}
      </div>
    </div>
  );
}

function TaskRow({ id, status, color, objective }: any) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-indigo-900/30 hover:bg-indigo-900/20 transition-colors cursor-pointer group">
      <span className="text-indigo-300 font-bold group-hover:text-indigo-100 flex items-center gap-2">
        <ChevronRight className="w-3 h-3 text-indigo-600 group-hover:text-indigo-400" />
        {id}
      </span>
      <div className="flex items-center gap-4 text-right">
        <span className="text-indigo-500 truncate w-32">{objective}</span>
        <span className={`w-10 font-bold ${color}`}>{status}</span>
      </div>
    </div>
  );
}

function LogLine({ time, src, msg, type }: any) {
  const colors = {
    info: "text-indigo-400",
    warn: "text-amber-400",
    error: "text-red-400",
    success: "text-emerald-400"
  };
  return (
    <div className="flex items-start gap-2 leading-tight">
      <span className="text-indigo-700 shrink-0">[{time}]</span>
      <span className="text-indigo-500 font-bold shrink-0">{src}</span>
      <span className={colors[type as keyof typeof colors]}>{msg}</span>
    </div>
  );
}

function ResonanceCard({ id, tags, strength, active, color = "border-indigo-800 text-indigo-300" }: any) {
  return (
    <div className={`border ${color} bg-indigo-950/20 p-2 flex flex-col gap-2 rounded relative overflow-hidden group hover:bg-indigo-900/30 transition-colors`}>
      {active && <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>}
      <div className="flex justify-between items-center">
        <span className="font-bold tracking-widest pl-2">{id}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] opacity-70">STR</span>
          <span className="font-bold font-mono">{strength}%</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 pl-2">
        {tags.map((t: string) => (
          <span key={t} className="px-1.5 py-0.5 bg-[#05010d] border border-current text-[8px] uppercase">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
