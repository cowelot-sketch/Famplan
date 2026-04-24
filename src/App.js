import { useState, useEffect, useRef, useCallback } from "react";
import './tablet.css';
import { isConfigured, loadFromCloud, saveToCloud, subscribeToChanges } from './sync';

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CHORE_TEMPLATES = ["Make bed","Clean room","Do homework","Take out trash","Wash dishes","Feed pet","Vacuum","Set the table","Laundry","Tidy up"];
const PRIZE_EMOJIS = ["🍦","🎮","🎬","🛍️","🎉","🏕️","🍕","🎨","📚","🎵","🧁","🚴","🎯","🏊","🎪"];

const BADGES = [
  { id:"first",   emoji:"🌱", label:"First Chore!",   desc:"Complete your very first chore" },
  { id:"streak3", emoji:"🔥", label:"3-Day Streak",   desc:"Complete chores 3 days in a row" },
  { id:"perfect", emoji:"👑", label:"Perfect Week",   desc:"Complete ALL chores in a week" },
  { id:"allstar", emoji:"🌟", label:"All-Star",       desc:"Earn 100 points total" },
  { id:"helper",  emoji:"🤝", label:"Big Helper",     desc:"Complete 10 chores total" },
  { id:"century", emoji:"💯", label:"Century Club",   desc:"Earn 200 points total" },
];

const DEFAULT_PRIZES = [
  { id:"p1", emoji:"🍦", label:"Ice Cream",               cost:20 },
  { id:"p2", emoji:"🎮", label:"30 min Extra Screen Time", cost:30 },
  { id:"p3", emoji:"🎬", label:"Movie Night Pick",         cost:50 },
  { id:"p4", emoji:"🛍️", label:"$5 Spend",                cost:75 },
  { id:"p5", emoji:"🎉", label:"Choose Dinner",            cost:40 },
  { id:"p6", emoji:"🏕️", label:"Camping Trip",            cost:200 },
];

const DEFAULT_CHORES = {
  kid1: [
    { id:1, text:"Make bed",      days:["Mon","Tue","Wed","Thu","Fri"], done:{}, points:5  },
    { id:2, text:"Do homework",   days:["Mon","Tue","Wed","Thu"],       done:{}, points:10 },
    { id:3, text:"Take out trash",days:["Wed","Sat"],                   done:{}, points:8  },
  ],
  kid2: [
    { id:4, text:"Make bed",   days:["Mon","Tue","Wed","Thu","Fri"], done:{}, points:5  },
    { id:5, text:"Wash dishes",days:["Tue","Thu","Sat"],              done:{}, points:8  },
    { id:6, text:"Vacuum",     days:["Sat"],                          done:{}, points:10 },
  ],
};

const DEFAULT_EVENTS = [
  { id:1, title:"Soccer Practice", date:"2026-04-26", member:"kid1", time:"3:00 PM" },
  { id:2, title:"Piano Lesson",    date:"2026-04-28", member:"kid2", time:"4:30 PM" },
  { id:3, title:"Family Dinner",   date:"2026-04-25", member:"family", time:"6:00 PM" },
  { id:4, title:"Doctor Appt",     date:"2026-04-30", member:"kid1", time:"10:00 AM" },
];

function getDaysInMonth(y,m){ return new Date(y,m+1,0).getDate(); }
function getFirstDay(y,m){ return new Date(y,m,1).getDay(); }
function todayKey(){
  const d=new Date();
  return `${DAYS[d.getDay()]}-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function getWeekId(){
  const d=new Date();
  const jan1=new Date(d.getFullYear(),0,1);
  const wk=Math.ceil(((d-jan1)/86400000+jan1.getDay()+1)/7);
  return `${d.getFullYear()}-W${wk}`;
}

// ── Persistent storage helpers ──
const STORAGE_KEY = "famplan-v2";
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveState(s){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ── iCal helpers ──
function parseTime(timeStr) {
  if (!timeStr) return { h: 9, m: 0 };
  const cleaned = timeStr.trim().toUpperCase();
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return { h: 9, m: 0 };
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || "0", 10);
  const period = match[3];
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return { h, m };
}

function toIcsDate(dateStr, timeStr, durationHours = 1) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const { h, m } = parseTime(timeStr);
  const pad = n => String(n).padStart(2, "0");
  const start = `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(m)}00`;
  const endH = h + durationHours;
  const end   = `${y}${pad(mo)}${pad(d)}T${pad(endH < 24 ? endH : 23)}${pad(endH < 24 ? m : 59)}00`;
  return { start, end };
}

function generateICS(events, members) {
  const getMember = id => members.find(m => m.id === id) || members[0];
  const escape = s => (s || "").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FamPlan//Family Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:FamPlan Family Calendar",
    "X-WR-TIMEZONE:America/New_York",
  ];
  events.forEach(ev => {
    const member = getMember(ev.member);
    const { start, end } = toIcsDate(ev.date, ev.time);
    const uid = `famplan-${ev.id}@famplan.local`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").split(".")[0]}Z`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escape(ev.title)}`,
      `DESCRIPTION:${escape(`${member.emoji} ${member.name}`)}`,
      `CATEGORIES:${escape(member.name)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadICS(icsContent, filename = "famplan-calendar.ics") {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function googleCalendarUrl(ev) {
  const { start, end } = toIcsDate(ev.date, ev.time);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${start}/${end}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function outlookCalendarUrl(ev) {
  const [y, mo, d] = ev.date.split("-");
  const { h, m } = parseTime(ev.time);
  const pad = n => String(n).padStart(2, "0");
  const startDt = `${y}-${mo}-${d}T${pad(h)}:${pad(m)}:00`;
  const endDt   = `${y}-${mo}-${d}T${pad(h+1)}:${pad(m)}:00`;
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: startDt,
    enddt: endDt,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

function parseICS(text) {
  const imported = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  blocks.forEach(block => {
    const get = key => {
      const m = block.match(new RegExp(`^${key}[^:]*:(.+)$`, "m"));
      return m ? m[1].trim().replace(/\\,/g, ",").replace(/\\n/g, "\n") : "";
    };
    const summary = get("SUMMARY");
    const dtstart = get("DTSTART");
    if (!summary || !dtstart) return;
    // Parse DTSTART — handle YYYYMMDD and YYYYMMDDTHHmmss
    const clean = dtstart.replace(/[TZ]/g, "");
    const y  = clean.slice(0, 4);
    const mo = clean.slice(4, 6);
    const d  = clean.slice(6, 8);
    const h  = clean.slice(8, 10) || "09";
    const mi = clean.slice(10, 12) || "00";
    const dateStr = `${y}-${mo}-${d}`;
    const timeStr = h ? `${parseInt(h) % 12 || 12}:${mi} ${parseInt(h) >= 12 ? "PM" : "AM"}` : "";
    imported.push({ id: Date.now() + Math.random(), title: summary, date: dateStr, time: timeStr, member: "family" });
  });
  return imported;
}

function Confetti(){
  const items=["🌟","⭐","✨","🎉","🏆","💫"];
  return(
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999}}>
      <style>{`
        @keyframes cf0{0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1)}100%{opacity:0;transform:translateY(260px) rotate(400deg) scale(0.5)}}
        @keyframes cf1{0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1)}100%{opacity:0;transform:translateY(200px) rotate(-250deg) scale(0.3)}}
        @keyframes cf2{0%{opacity:1;transform:translateY(0) rotate(0deg) scale(1)}100%{opacity:0;transform:translateY(230px) rotate(200deg) scale(0.6)}}
      `}</style>
      {Array.from({length:22}).map((_,i)=>(
        <div key={i} style={{position:"absolute",left:`${5+Math.floor(i*4.3)%90}%`,top:`${(i*6)%30}%`,fontSize:28,animation:`cf${i%3} 1.4s ease-out ${i*0.06}s forwards`,opacity:0}}>{items[i%6]}</div>
      ))}
    </div>
  );
}

function Modal({onClose, children}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#1a1640",borderRadius:24,padding:28,width:"100%",maxWidth:400,border:"1px solid rgba(255,255,255,0.12)",maxHeight:"90vh",overflowY:"auto"}}>
        {children}
      </div>
    </div>
  );
}

const INP = {width:"100%",background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 12px",color:"#fff",fontFamily:"'Nunito',sans-serif",fontSize:14,boxSizing:"border-box"};

export default function App(){
  const today = new Date();

  // ── Load persisted state or defaults ──
  const saved = loadState();

  const [kid1Name,  setKid1Name]  = useState(saved?.kid1Name  ?? "Kid 1");
  const [kid2Name,  setKid2Name]  = useState(saved?.kid2Name  ?? "Kid 2");
  const [events,    setEvents]    = useState(saved?.events    ?? DEFAULT_EVENTS);
  const [chores,    setChores]    = useState(saved?.chores    ?? DEFAULT_CHORES);
  const [pts,       setPts]       = useState(saved?.pts       ?? {kid1:45,kid2:30});
  const [allTimePts,setAllTimePts]= useState(saved?.allTimePts?? {kid1:45,kid2:30});
  const [totalDone, setTotalDone] = useState(saved?.totalDone ?? {kid1:0,kid2:0});
  const [badges,    setBadges]    = useState(saved?.badges    ?? {kid1:["first","helper"],kid2:["first"]});
  const [redeemed,  setRedeemed]  = useState(saved?.redeemed  ?? {kid1:[],kid2:[]});
  const [prizes,    setPrizes]    = useState(saved?.prizes    ?? DEFAULT_PRIZES);
  const [lastWeek,  setLastWeek]  = useState(saved?.lastWeek  ?? getWeekId());
  const [weekHistory,setWeekHistory]=useState(saved?.weekHistory??[]);

  const [view,      setView]      = useState("calendar");
  const [kidView,   setKidView]   = useState(null);
  const [kidTab,    setKidTab]    = useState("chores");
  const [curYear,   setCurYear]   = useState(today.getFullYear());
  const [curMonth,  setCurMonth]  = useState(today.getMonth());
  const [selDay,    setSelDay]    = useState(null);
  const [confetti,  setConfetti]  = useState(false);
  const [editName,  setEditName]  = useState(null);

  // Modals
  const [showAddEvent,    setShowAddEvent]    = useState(false);
  const [showAddChore,    setShowAddChore]    = useState(false);
  const [showAddPrize,    setShowAddPrize]    = useState(false);
  const [showEditPrize,   setShowEditPrize]   = useState(null);
  const [showReset,       setShowReset]       = useState(false);
  const [showBadgeToast,  setShowBadgeToast]  = useState(null);
  const [prizeConfirm,    setPrizeConfirm]    = useState(null);
  const [showIcsModal,    setShowIcsModal]    = useState(false);
  const [showEventMenu,   setShowEventMenu]   = useState(null);
  const [icsImportMsg,    setIcsImportMsg]    = useState("");

  const [newEvent, setNewEvent] = useState({title:"",date:"",member:"family",time:""});
  const [newChore, setNewChore] = useState({text:"",kid:"kid1",days:[],points:5});
  const [newPrize, setNewPrize] = useState({emoji:"🎁",label:"",cost:30});
  const [editPrizeData, setEditPrizeData] = useState({emoji:"",label:"",cost:0});

  const members = [
    {id:"family",name:"Family",  color:"#6366f1",emoji:"🏠"},
    {id:"kid1",  name:kid1Name,  color:"#f59e0b",emoji:"⭐"},
    {id:"kid2",  name:kid2Name,  color:"#10b981",emoji:"🌟"},
  ];

  // ── Auto-save ──
  useEffect(()=>{
    saveState({kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory});
  },[kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory]);

  // ── Auto week reset check ──
  useEffect(()=>{
    const wk = getWeekId();
    if(wk !== lastWeek){
      doWeekReset(false);
      setLastWeek(wk);
    }
  // eslint-disable-next-line
  },[]);

  // ── Cloud sync state ──
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | loading | saving | saved | error | offline
  const [cloudEnabled] = useState(isConfigured);
  const saveTimer = useRef(null);
  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

  // ── Load from cloud on first mount ──
  useEffect(() => {
    if (!cloudEnabled) return;
    setSyncStatus("loading");
    loadFromCloud().then(cloudState => {
      if (!isMounted.current) return;
      if (cloudState) {
        // Merge cloud state (cloud wins over local defaults)
        if (cloudState.kid1Name)    setKid1Name(cloudState.kid1Name);
        if (cloudState.kid2Name)    setKid2Name(cloudState.kid2Name);
        if (cloudState.events)      setEvents(cloudState.events);
        if (cloudState.chores)      setChores(cloudState.chores);
        if (cloudState.pts)         setPts(cloudState.pts);
        if (cloudState.allTimePts)  setAllTimePts(cloudState.allTimePts);
        if (cloudState.totalDone)   setTotalDone(cloudState.totalDone);
        if (cloudState.badges)      setBadges(cloudState.badges);
        if (cloudState.redeemed)    setRedeemed(cloudState.redeemed);
        if (cloudState.prizes)      setPrizes(cloudState.prizes);
        if (cloudState.lastWeek)    setLastWeek(cloudState.lastWeek);
        if (cloudState.weekHistory) setWeekHistory(cloudState.weekHistory);
      }
      setSyncStatus("saved");
    }).catch(() => {
      if (isMounted.current) setSyncStatus("error");
    });
  // eslint-disable-next-line
  }, [cloudEnabled]);

  // ── Debounced save to cloud (fires 2s after last change) ──
  const currentState = { kid1Name, kid2Name, events, chores, pts, allTimePts, totalDone, badges, redeemed, prizes, lastWeek, weekHistory };
  useEffect(() => {
    if (!cloudEnabled) return;
    if (syncStatus === "loading") return; // don't overwrite while loading
    clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current = setTimeout(() => {
      saveToCloud(currentState)
        .then(() => { if (isMounted.current) setSyncStatus("saved"); })
        .catch(() => { if (isMounted.current) setSyncStatus("error"); });
    }, 2000);
    return () => clearTimeout(saveTimer.current);
  // eslint-disable-next-line
  }, [kid1Name, kid2Name, events, chores, pts, allTimePts, totalDone, badges, redeemed, prizes, lastWeek, weekHistory]);

  // ── Real-time: listen for changes from other devices ──
  useEffect(() => {
    if (!cloudEnabled) return;
    const unsub = subscribeToChanges((cloudState) => {
      if (!isMounted.current) return;
      setSyncStatus("saved");
      if (cloudState.kid1Name)    setKid1Name(cloudState.kid1Name);
      if (cloudState.kid2Name)    setKid2Name(cloudState.kid2Name);
      if (cloudState.events)      setEvents(cloudState.events);
      if (cloudState.chores)      setChores(cloudState.chores);
      if (cloudState.pts)         setPts(cloudState.pts);
      if (cloudState.allTimePts)  setAllTimePts(cloudState.allTimePts);
      if (cloudState.totalDone)   setTotalDone(cloudState.totalDone);
      if (cloudState.badges)      setBadges(cloudState.badges);
      if (cloudState.redeemed)    setRedeemed(cloudState.redeemed);
      if (cloudState.prizes)      setPrizes(cloudState.prizes);
      if (cloudState.lastWeek)    setLastWeek(cloudState.lastWeek);
      if (cloudState.weekHistory) setWeekHistory(cloudState.weekHistory);
    });
    return unsub;
  // eslint-disable-next-line
  }, [cloudEnabled]);

  function pop(){ setConfetti(true); setTimeout(()=>setConfetti(false),1600); }

  function awardBadge(kid, id){
    setBadges(prev=>{
      const b=[...(prev[kid]||[])];
      if(b.includes(id)) return prev;
      b.push(id);
      const badge = BADGES.find(x=>x.id===id);
      setShowBadgeToast({...badge, kid});
      setTimeout(()=>setShowBadgeToast(null),3000);
      return {...prev,[kid]:b};
    });
  }

  function checkBadges(kid, newAllTime, newTotal){
    if(newAllTime>=100) awardBadge(kid,"allstar");
    if(newAllTime>=200) awardBadge(kid,"century");
    if(newTotal>=10)    awardBadge(kid,"helper");
  }

  function toggleChore(kid, choreId, key){
    let delta=0, wasFirst=false;
    setChores(prev=>{
      const list=prev[kid].map(c=>{
        if(c.id!==choreId) return c;
        const d={...c.done};
        const was=!!d[key];
        d[key]=!was;
        delta=was?-(c.points||5):(c.points||5);
        wasFirst=!was&&Object.values(d).filter(Boolean).length===1&&Object.values(prev[kid].reduce((a,x)=>({...a,...x.done}),{})).filter(Boolean).length===0;
        return {...c,done:d};
      });
      return {...prev,[kid]:list};
    });
    setPts(prev=>({...prev,[kid]:Math.max(0,prev[kid]+delta)}));
    if(delta>0){
      pop();
      setAllTimePts(prev=>{
        const nv={...prev,[kid]:prev[kid]+delta};
        setTotalDone(td=>{
          const nt={...td,[kid]:td[kid]+1};
          checkBadges(kid,nv[kid],nt[kid]);
          return nt;
        });
        return nv;
      });
      awardBadge(kid,"first");
    }
  }

  function redeemPrize(kid, prize){
    if(pts[kid]<prize.cost) return;
    setPts(prev=>({...prev,[kid]:prev[kid]-prize.cost}));
    setRedeemed(prev=>({...prev,[kid]:[...prev[kid],{...prize,date:new Date().toLocaleDateString()}]}));
    setPrizeConfirm(null);
    pop();
  }

  function doWeekReset(manual=true){
    // Archive week stats
    const snapshot = {
      week: getWeekId(),
      date: new Date().toLocaleDateString(),
      pts: {...pts},
      kid1Name, kid2Name,
      summary: {
        kid1: { done: Object.values(chores.kid1).reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0), total: chores.kid1.reduce((a,c)=>a+c.days.length,0) },
        kid2: { done: Object.values(chores.kid2).reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0), total: chores.kid2.reduce((a,c)=>a+c.days.length,0) },
      }
    };

    // Award perfect week badges
    ["kid1","kid2"].forEach(kid=>{
      const s=snapshot.summary[kid];
      if(s.total>0 && s.done===s.total) awardBadge(kid,"perfect");
    });

    setWeekHistory(prev=>[snapshot,...prev].slice(0,8));
    // Clear chore done states
    setChores(prev=>{
      const reset={};
      for(const kid of["kid1","kid2"]){
        reset[kid]=prev[kid].map(c=>({...c,done:{}}));
      }
      return reset;
    });
    if(manual) setShowReset(false);
  }

  function addEvent(){
    if(!newEvent.title||!newEvent.date) return;
    setEvents(prev=>[...prev,{...newEvent,id:Date.now()}]);
    setNewEvent({title:"",date:"",member:"family",time:""});
    setShowAddEvent(false);
  }

  function addChore(){
    if(!newChore.text||newChore.days.length===0) return;
    setChores(prev=>({...prev,[newChore.kid]:[...prev[newChore.kid],{id:Date.now(),text:newChore.text,days:newChore.days,done:{},points:newChore.points}]}));
    setNewChore({text:"",kid:"kid1",days:[],points:5});
    setShowAddChore(false);
  }

  function addPrize(){
    if(!newPrize.label||newPrize.cost<1) return;
    setPrizes(prev=>[...prev,{...newPrize,id:`custom-${Date.now()}`}]);
    setNewPrize({emoji:"🎁",label:"",cost:30});
    setShowAddPrize(false);
  }

  function savePrizeEdit(){
    setPrizes(prev=>prev.map(p=>p.id===showEditPrize?{...p,...editPrizeData}:p));
    setShowEditPrize(null);
  }

  function deletePrize(id){
    setPrizes(prev=>prev.filter(p=>p.id!==id));
    setShowEditPrize(null);
  }

  function getMember(id){ return members.find(m=>m.id===id)||members[0]; }
  function prevMonth(){ curMonth===0?(setCurMonth(11),setCurYear(y=>y-1)):setCurMonth(m=>m-1); }
  function nextMonth(){ curMonth===11?(setCurMonth(0),setCurYear(y=>y+1)):setCurMonth(m=>m+1); }
  function getEventsForDay(day){
    const ds=`${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(e=>e.date===ds);
  }

  const todayDayName = DAYS[today.getDay()];
  const selEvents = selDay ? getEventsForDay(selDay) : [];

  // ══════════════════════════════════════════════════════
  // KID MODE
  // ══════════════════════════════════════════════════════
  if(kidView){
    const member = getMember(kidView);
    const myPts  = pts[kidView];
    const kidChores = chores[kidView];
    const todayChores = kidChores.filter(c=>c.days.includes(todayDayName));
    const myBadges = badges[kidView]||[];

    return(
      <div style={{minHeight:"100vh",background:`linear-gradient(160deg,${member.color}18 0%,#0f0c29 50%,#1a1040 100%)`,fontFamily:"'Nunito',sans-serif",color:"#fff"}}>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap" rel="stylesheet"/>
        {confetti&&<Confetti/>}

        {/* Badge toast */}
        {showBadgeToast&&(
          <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:"#1a1640",border:`2px solid ${member.color}`,borderRadius:20,padding:"14px 24px",zIndex:500,display:"flex",alignItems:"center",gap:12,boxShadow:`0 8px 32px ${member.color}44`,animation:"slideDown 0.3s ease"}}>
            <style>{`@keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
            <span style={{fontSize:32}}>{showBadgeToast.emoji}</span>
            <div><div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:member.color}}>New Badge!</div><div style={{fontWeight:700,fontSize:14}}>{showBadgeToast.label}</div></div>
          </div>
        )}

        {/* Kid header */}
        <div style={{background:`${member.color}20`,borderBottom:`2px solid ${member.color}44`,padding:"16px 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{fontSize:50,lineHeight:1}}>{member.emoji}</div>
              <div>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:26,color:member.color}}>{member.name}'s Board</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>{todayDayName}, {MONTHS[today.getMonth()]} {today.getDate()}</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
              <div style={{background:member.color,borderRadius:20,padding:"10px 22px",fontFamily:"'Fredoka One',cursive",fontSize:22,color:"#fff",boxShadow:`0 4px 20px ${member.color}55`}}>⭐ {myPts} pts</div>
              <button onClick={()=>setKidView(null)} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"rgba(255,255,255,0.5)",borderRadius:10,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:700}}>👪 Parent View</button>
            </div>
          </div>
        </div>

        <div style={{maxWidth:680,margin:"0 auto",padding:"18px 16px"}}>
          <div style={{display:"flex",gap:10,marginBottom:22}}>
            {[["chores","✅ My Chores"],["rewards","🎁 Prizes"]].map(([t,label])=>(
              <button key={t} onClick={()=>setKidTab(t)} style={{flex:1,padding:"13px",borderRadius:16,border:"none",cursor:"pointer",fontFamily:"'Fredoka One',cursive",fontSize:18,background:kidTab===t?member.color:"rgba(255,255,255,0.07)",color:"#fff",transition:"all 0.2s",boxShadow:kidTab===t?`0 4px 16px ${member.color}55`:"none"}}>{label}</button>
            ))}
          </div>

          {kidTab==="chores"&&(
            <div>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:21,color:member.color,marginBottom:12}}>📋 Today's Chores</div>
              {todayChores.length===0?(
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:20,padding:30,textAlign:"center",fontSize:18,color:"rgba(255,255,255,0.4)"}}>🎉 No chores today — enjoy your day!</div>
              ):todayChores.map(chore=>{
                const key=todayKey();
                const done=!!chore.done[key];
                return(
                  <div key={chore.id} onClick={()=>toggleChore(kidView,chore.id,key)} style={{display:"flex",alignItems:"center",gap:16,background:done?`${member.color}25`:"rgba(255,255,255,0.05)",border:`2px solid ${done?member.color:"rgba(255,255,255,0.1)"}`,borderRadius:20,padding:"18px 20px",marginBottom:12,cursor:"pointer",transition:"all 0.2s",transform:done?"scale(1.01)":"scale(1)"}}>
                    <div style={{width:44,height:44,borderRadius:14,background:done?member.color:"rgba(255,255,255,0.08)",border:`3px solid ${done?member.color:"rgba(255,255,255,0.2)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0,transition:"all 0.2s"}}>{done?"✓":""}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:19,textDecoration:done?"line-through":"none",opacity:done?0.55:1}}>{chore.text}</div>
                      <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",marginTop:2}}>{done?"Great job! Tap to undo":"Tap when done!"}</div>
                    </div>
                    <div style={{background:`${member.color}30`,borderRadius:14,padding:"8px 16px",fontFamily:"'Fredoka One',cursive",fontSize:20,color:member.color}}>+{chore.points}⭐</div>
                  </div>
                );
              })}

              {kidChores.filter(c=>!c.days.includes(todayDayName)).length>0&&(
                <div style={{marginTop:22}}>
                  <div style={{fontFamily:"'Fredoka One',cursive",fontSize:16,color:"rgba(255,255,255,0.3)",marginBottom:10}}>📅 Other Days</div>
                  {kidChores.filter(c=>!c.days.includes(todayDayName)).map(chore=>(
                    <div key={chore.id} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:14,padding:"11px 16px",marginBottom:8,opacity:0.6}}>
                      <div style={{fontWeight:700,fontSize:15,flex:1}}>{chore.text}</div>
                      <div style={{fontSize:12,color:"rgba(255,255,255,0.35)"}}>{chore.days.join(", ")}</div>
                      <div style={{fontSize:13,color:member.color,fontWeight:700}}>+{chore.points}⭐</div>
                    </div>
                  ))}
                </div>
              )}

              {myBadges.length>0&&(
                <div style={{marginTop:26}}>
                  <div style={{fontFamily:"'Fredoka One',cursive",fontSize:19,color:member.color,marginBottom:10}}>🏅 My Badges</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                    {myBadges.map(bid=>{const b=BADGES.find(x=>x.id===bid);return b?(
                      <div key={bid} title={b.desc} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:14,padding:"10px 16px",display:"flex",alignItems:"center",gap:8,cursor:"default"}}>
                        <span style={{fontSize:20}}>{b.emoji}</span>
                        <span style={{fontWeight:700,fontSize:12}}>{b.label}</span>
                      </div>
                    ):null;})}
                  </div>
                </div>
              )}

              {/* Unearned badges */}
              <div style={{marginTop:20}}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:16,color:"rgba(255,255,255,0.25)",marginBottom:8}}>🔒 Badges to Earn</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {BADGES.filter(b=>!myBadges.includes(b.id)).map(b=>(
                    <div key={b.id} title={b.desc} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"8px 14px",display:"flex",alignItems:"center",gap:6,opacity:0.5,cursor:"default"}}>
                      <span style={{fontSize:16,filter:"grayscale(1)"}}>{b.emoji}</span>
                      <span style={{fontWeight:700,fontSize:11,color:"rgba(255,255,255,0.5)"}}>{b.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {kidTab==="rewards"&&(
            <div>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:21,color:member.color,marginBottom:4}}>🎁 Prize Store</div>
              <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginBottom:20}}>You have <span style={{color:member.color,fontWeight:800}}>{myPts} ⭐</span> points!</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {prizes.map(prize=>{
                  const can=myPts>=prize.cost;
                  return(
                    <div key={prize.id} style={{background:can?`${member.color}15`:"rgba(255,255,255,0.04)",border:`2px solid ${can?member.color+"55":"rgba(255,255,255,0.08)"}`,borderRadius:18,padding:"18px 14px",textAlign:"center",opacity:can?1:0.5,transition:"all 0.2s"}}>
                      <div style={{fontSize:40,marginBottom:8}}>{prize.emoji}</div>
                      <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{prize.label}</div>
                      <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:member.color,marginBottom:14}}>{prize.cost} ⭐</div>
                      <button onClick={()=>can&&setPrizeConfirm({kid:kidView,prize})} style={{width:"100%",padding:"10px",borderRadius:12,border:"none",background:can?member.color:"rgba(255,255,255,0.1)",color:"#fff",cursor:can?"pointer":"not-allowed",fontFamily:"'Fredoka One',cursive",fontSize:15,boxShadow:can?`0 3px 12px ${member.color}44`:"none"}}>
                        {can?"Redeem! 🎉":`Need ${prize.cost-myPts} more ⭐`}
                      </button>
                    </div>
                  );
                })}
              </div>

              {redeemed[kidView]?.length>0&&(
                <div style={{marginTop:26}}>
                  <div style={{fontFamily:"'Fredoka One',cursive",fontSize:17,color:"rgba(255,255,255,0.35)",marginBottom:10}}>✅ Redeemed</div>
                  {redeemed[kidView].map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.04)",borderRadius:12,padding:"10px 14px",marginBottom:8}}>
                      <span style={{fontSize:20}}>{p.emoji}</span>
                      <span style={{fontWeight:700,fontSize:14}}>{p.label}</span>
                      <div style={{flex:1}}/>
                      <span style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>{p.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prize confirm */}
        {prizeConfirm&&(
          <Modal onClose={()=>setPrizeConfirm(null)}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:56,marginBottom:12}}>{prizeConfirm.prize.emoji}</div>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:6}}>Redeem this?</div>
              <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>{prizeConfirm.prize.label}</div>
              <div style={{color:member.color,fontFamily:"'Fredoka One',cursive",fontSize:20,marginBottom:10}}>{prizeConfirm.prize.cost} ⭐</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginBottom:22}}>👪 Ask a parent to approve!</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setPrizeConfirm(null)} style={{flex:1,padding:"12px",borderRadius:12,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                <button onClick={()=>redeemPrize(prizeConfirm.kid,prizeConfirm.prize)} style={{flex:1,padding:"12px",borderRadius:12,border:"none",background:member.color,color:"#fff",cursor:"pointer",fontFamily:"'Fredoka One',cursive",fontSize:17,boxShadow:`0 4px 14px ${member.color}55`}}>Yes! 🎉</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════
  // PARENT MODE
  // ══════════════════════════════════════════════════════
  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)",fontFamily:"'Nunito',sans-serif",color:"#fff"}}>
      <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fredoka+One&display=swap" rel="stylesheet"/>
      {confetti&&<Confetti/>}
      {showBadgeToast&&(
        <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:"#1a1640",border:"2px solid #a78bfa",borderRadius:20,padding:"14px 24px",zIndex:500,display:"flex",alignItems:"center",gap:12,boxShadow:"0 8px 32px #a78bfa44"}}>
          <span style={{fontSize:32}}>{showBadgeToast.emoji}</span>
          <div><div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:"#a78bfa"}}>Badge Earned!</div><div style={{fontWeight:700,fontSize:14}}>{showBadgeToast.label} — {showBadgeToast.kid==="kid1"?kid1Name:kid2Name}</div></div>
        </div>
      )}

      {/* Header */}
      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.1)",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:26}}>🏡</span>
          <div>
            <div style={{fontFamily:"'Fredoka One',cursive",fontSize:20,color:"#a78bfa"}}>FamPlan</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>Family Calendar & Chores</div>
          </div>
          {/* Sync status badge */}
          {cloudEnabled && (
            <div style={{
              display:"flex",alignItems:"center",gap:4,
              background: syncStatus==="saved"?"rgba(52,211,153,0.15)": syncStatus==="error"?"rgba(248,113,113,0.15)":"rgba(167,139,250,0.15)",
              border: `1px solid ${syncStatus==="saved"?"rgba(52,211,153,0.3)": syncStatus==="error"?"rgba(248,113,113,0.3)":"rgba(167,139,250,0.3)"}`,
              borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,
              color: syncStatus==="saved"?"#34d399": syncStatus==="error"?"#f87171":"#a78bfa",
            }}>
              <span>{syncStatus==="loading"?"⏳":syncStatus==="saving"?"🔄":syncStatus==="saved"?"☁️":syncStatus==="error"?"⚠️":"💾"}</span>
              {syncStatus==="loading"?"Loading…":syncStatus==="saving"?"Syncing…":syncStatus==="saved"?"Synced":"Sync Error"}
            </div>
          )}
          {!cloudEnabled && (
            <div style={{display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.3)"}}>
              💾 Local only
            </div>
          )}
        </div>

        {/* Kid switchers */}
        <div style={{display:"flex",gap:8}}>
          {members.slice(1).map(m=>(
            <button key={m.id} onClick={()=>{setKidView(m.id);setKidTab("chores");}} style={{display:"flex",alignItems:"center",gap:8,background:`${m.color}20`,border:`2px solid ${m.color}55`,borderRadius:20,padding:"6px 14px",cursor:"pointer",color:"#fff",transition:"all 0.15s",minHeight:44}}>
              <span style={{fontSize:16}}>{m.emoji}</span>
              <div>
                <div style={{fontWeight:800,fontSize:11,color:m.color}}>{m.id==="kid1"?kid1Name:kid2Name}</div>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>⭐ {pts[m.id]} pts</div>
              </div>
            </button>
          ))}
        </div>

        {/* Top nav – tablet+ only, phone uses bottom tabs */}
        <div className="famplan-topnav" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["calendar","📅"],["chores","✅"],["rewards","🏆"],["settings","⚙️"]].map(([v,icon])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"7px 12px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:12,background:view===v?"#a78bfa":"rgba(255,255,255,0.08)",color:view===v?"#fff":"rgba(255,255,255,0.55)",textTransform:"capitalize",minHeight:38}}>
              {icon} {v.charAt(0).toUpperCase()+v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Sidebar + content layout (tablet landscape) ── */}
      <div className="famplan-layout" style={{display:"block"}}>

        {/* Sidebar nav – visible only on landscape 1024px+ via CSS */}
        <div className="famplan-sidenav" style={{display:"none"}}>
          <div style={{fontFamily:"'Fredoka One',cursive",fontSize:13,color:"rgba(255,255,255,0.25)",letterSpacing:1,marginBottom:8,paddingLeft:8}}>NAVIGATE</div>
          {[["calendar","📅","Calendar"],["chores","✅","Chores"],["rewards","🏆","Rewards"],["settings","⚙️","Settings"]].map(([v,icon,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,border:"none",cursor:"pointer",background:view===v?"rgba(167,139,250,0.15)":"transparent",color:view===v?"#a78bfa":"rgba(255,255,255,0.5)",fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:14,width:"100%",textAlign:"left",borderLeft:view===v?"3px solid #a78bfa":"3px solid transparent",minHeight:48,marginBottom:2}}>
              <span style={{fontSize:20}}>{icon}</span>{label}
            </button>
          ))}
          <div style={{flex:1}}/>
          <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:14}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.25)",letterSpacing:1,marginBottom:8,paddingLeft:8}}>KID VIEW</div>
            {members.slice(1).map(m=>(
              <button key={m.id} onClick={()=>{setKidView(m.id);setKidTab("chores");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:12,border:"none",cursor:"pointer",background:`${m.color}18`,color:"#fff",fontFamily:"'Nunito',sans-serif",fontWeight:700,fontSize:13,width:"100%",marginBottom:6,minHeight:44}}>
                <span style={{fontSize:18}}>{m.emoji}</span>
                <div style={{textAlign:"left"}}><div style={{color:m.color,fontSize:13}}>{m.id==="kid1"?kid1Name:kid2Name}</div><div style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>⭐ {pts[m.id]}</div></div>
              </button>
            ))}
          </div>
        </div>

        {/* Main scrollable content */}
        <div className="famplan-content famplan-main-content" style={{maxWidth:920,margin:"0 auto",padding:"22px 16px"}}>

        {/* ── CALENDAR ── */}
        {view==="calendar"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:8,flexWrap:"wrap"}}>
              <button onClick={prevMonth} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",borderRadius:12,padding:"8px 16px",cursor:"pointer",fontSize:18}}>‹</button>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:26,color:"#a78bfa"}}>{MONTHS[curMonth]} {curYear}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>setShowIcsModal(true)} style={{background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.4)",color:"#a78bfa",borderRadius:12,padding:"7px 14px",cursor:"pointer",fontWeight:700,fontSize:12}}>📅 Export / Import</button>
                <button onClick={nextMonth} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",borderRadius:12,padding:"8px 16px",cursor:"pointer",fontSize:18}}>›</button>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
              {DAYS.map(d=><div key={d} style={{textAlign:"center",fontWeight:800,fontSize:11,color:"rgba(255,255,255,0.3)",padding:"4px 0",letterSpacing:1}}>{d}</div>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
              {Array.from({length:getFirstDay(curYear,curMonth)}).map((_,i)=><div key={`e${i}`}/>)}
              {Array.from({length:getDaysInMonth(curYear,curMonth)}).map((_,i)=>{
                const day=i+1;
                const de=getEventsForDay(day);
                const isToday=day===today.getDate()&&curMonth===today.getMonth()&&curYear===today.getFullYear();
                const isSel=selDay===day;
                return(
                  <div key={day} onClick={()=>setSelDay(isSel?null:day)} style={{background:isSel?"rgba(167,139,250,0.25)":isToday?"rgba(167,139,250,0.12)":"rgba(255,255,255,0.04)",border:isSel?"2px solid #a78bfa":isToday?"2px solid rgba(167,139,250,0.4)":"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"8px 6px",cursor:"pointer",minHeight:66}}>
                    <div style={{fontWeight:800,fontSize:13,color:isToday?"#a78bfa":"rgba(255,255,255,0.85)",marginBottom:4}}>{day}</div>
                    {de.slice(0,3).map(ev=>{const m=getMember(ev.member);return(<div key={ev.id} style={{background:m.color+"33",borderLeft:`3px solid ${m.color}`,borderRadius:"0 4px 4px 0",padding:"1px 4px",fontSize:10,fontWeight:700,color:m.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>{ev.title}</div>);})}
                    {de.length>3&&<div style={{fontSize:9,color:"rgba(255,255,255,0.3)"}}>+{de.length-3}</div>}
                  </div>
                );
              })}
            </div>

            {selDay&&(
              <div style={{marginTop:16,background:"rgba(255,255,255,0.06)",borderRadius:16,padding:18,border:"1px solid rgba(255,255,255,0.1)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:"#a78bfa"}}>{MONTHS[curMonth]} {selDay}</div>
                  <button onClick={()=>{setNewEvent(e=>({...e,date:`${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(selDay).padStart(2,"0")}`}));setShowAddEvent(true);}} style={{background:"#a78bfa",border:"none",color:"#fff",borderRadius:10,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:13}}>+ Add Event</button>
                </div>
                {selEvents.length===0?<div style={{color:"rgba(255,255,255,0.3)",fontSize:14}}>No events — add one!</div>:
                  selEvents.map(ev=>{const m=getMember(ev.member);return(
                    <div key={ev.id} style={{background:m.color+"18",borderRadius:12,marginBottom:8,borderLeft:`4px solid ${m.color}`,overflow:"hidden"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px"}}>
                        <span style={{fontSize:16}}>{m.emoji}</span>
                        <div style={{flex:1}}><div style={{fontWeight:800,fontSize:14}}>{ev.title}</div><div style={{fontSize:12,color:"rgba(255,255,255,0.4)"}}>{ev.time} · {m.name}</div></div>
                        <button onClick={()=>setShowEventMenu(showEventMenu===ev.id?null:ev.id)} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"rgba(255,255,255,0.6)",borderRadius:8,padding:"4px 8px",cursor:"pointer",fontSize:12}}>⋯</button>
                        <button onClick={()=>setEvents(p=>p.filter(e=>e.id!==ev.id))} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:15}}>✕</button>
                      </div>
                      {showEventMenu===ev.id&&(
                        <div style={{display:"flex",gap:8,padding:"6px 14px 10px",flexWrap:"wrap"}}>
                          <a href={googleCalendarUrl(ev)} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:"rgba(66,133,244,0.2)",border:"1px solid rgba(66,133,244,0.4)",borderRadius:8,padding:"5px 10px",color:"#7ab4f8",textDecoration:"none",fontWeight:700,fontSize:11}}>
                            <span>📅</span> Add to Google
                          </a>
                          <a href={outlookCalendarUrl(ev)} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:"rgba(0,120,212,0.2)",border:"1px solid rgba(0,120,212,0.4)",borderRadius:8,padding:"5px 10px",color:"#60a5fa",textDecoration:"none",fontWeight:700,fontSize:11}}>
                            <span>📆</span> Add to Outlook
                          </a>
                          <button onClick={()=>{downloadICS(generateICS([ev],members),`${ev.title.replace(/\s+/g,"-")}.ics`);setShowEventMenu(null);}} style={{display:"inline-flex",alignItems:"center",gap:5,background:"rgba(167,139,250,0.2)",border:"1px solid rgba(167,139,250,0.4)",borderRadius:8,padding:"5px 10px",color:"#a78bfa",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                            ⬇️ Download .ics
                          </button>
                        </div>
                      )}
                    </div>
                  );})}
              </div>
            )}

            {showAddEvent&&(
              <Modal onClose={()=>setShowAddEvent(false)}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:18,color:"#a78bfa"}}>New Event</div>
                {[{l:"Title",k:"title",t:"text",ph:"e.g. Soccer practice"},{l:"Date",k:"date",t:"date"},{l:"Time",k:"time",t:"text",ph:"e.g. 3:00 PM"}].map(f=>(
                  <div key={f.k} style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>{f.l}</div>
                    <input type={f.t} placeholder={f.ph||""} value={newEvent[f.k]} onChange={e=>setNewEvent(p=>({...p,[f.k]:e.target.value}))} style={INP}/>
                  </div>
                ))}
                <div style={{marginBottom:18}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Who</div>
                  <div style={{display:"flex",gap:8}}>
                    {members.map(m=><button key={m.id} onClick={()=>setNewEvent(p=>({...p,member:m.id}))} style={{flex:1,padding:"7px 4px",borderRadius:10,border:`2px solid ${newEvent.member===m.id?m.color:"rgba(255,255,255,0.1)"}`,background:newEvent.member===m.id?m.color+"33":"transparent",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:11}}>{m.emoji} {m.name}</button>)}
                  </div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setShowAddEvent(false)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                  <button onClick={addEvent} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#a78bfa",color:"#fff",cursor:"pointer",fontWeight:800}}>Add</button>
                </div>
              </Modal>
            )}
            {showIcsModal&&(
              <Modal onClose={()=>{setShowIcsModal(false);setIcsImportMsg("");}}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:6,color:"#a78bfa"}}>📅 Calendar Sync</div>
                <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginBottom:20}}>Export your events or import from another calendar app.</div>

                {/* Export */}
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:14,padding:16,marginBottom:16}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>⬇️ Export All Events</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:12}}>Download a .ics file you can import into Google Calendar, Apple Calendar, or Outlook.</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={()=>downloadICS(generateICS(events,members))} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#a78bfa",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>⬇️ Download .ics</button>
                    <a href={`https://calendar.google.com/calendar/r?cid=`} target="_blank" rel="noreferrer"
                      onClick={e=>{e.preventDefault();const ics=generateICS(events,members);const blob=new Blob([ics],{type:"text/calendar"});alert("Download the .ics file, then go to Google Calendar → + Other Calendars → Import");downloadICS(ics);}}
                      style={{flex:1,padding:"10px",borderRadius:10,background:"rgba(66,133,244,0.2)",border:"1px solid rgba(66,133,244,0.4)",color:"#7ab4f8",cursor:"pointer",fontWeight:700,fontSize:13,textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                      📅 Google Cal Guide
                    </a>
                  </div>
                </div>

                {/* Import */}
                <div style={{background:"rgba(255,255,255,0.05)",borderRadius:14,padding:16,marginBottom:16}}>
                  <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>⬆️ Import .ics File</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:12}}>Import events from an .ics file exported from another calendar.</div>
                  <input type="file" accept=".ics,text/calendar" onChange={e=>{
                    const file=e.target.files[0];
                    if(!file){ return; }
                    const reader=new FileReader();
                    reader.onload=ev=>{
                      const text=ev.target.result;
                      const imported=parseICS(text);
                      if(imported.length===0){ setIcsImportMsg("⚠️ No events found in this file."); return; }
                      setEvents(prev=>[...prev,...imported]);
                      setIcsImportMsg(`✅ Imported ${imported.length} event${imported.length===1?"":"s"}!`);
                    };
                    reader.readAsText(file);
                    e.target.value="";
                  }} style={{...INP,cursor:"pointer",marginBottom:8}}/>
                  {icsImportMsg&&<div style={{fontSize:13,fontWeight:700,color:icsImportMsg.startsWith("✅")?"#34d399":"#f87171"}}>{icsImportMsg}</div>}
                </div>

                {/* How-to note */}
                <div style={{background:"rgba(167,139,250,0.08)",borderRadius:12,padding:12,fontSize:12,color:"rgba(255,255,255,0.5)",lineHeight:1.6}}>
                  <div style={{fontWeight:700,color:"rgba(255,255,255,0.7)",marginBottom:4}}>💡 How to sync with your phone calendar</div>
                  <div>1. Click <strong>Download .ics</strong> above</div>
                  <div>2. Open the file on your phone — iOS/Android will offer to add it to your calendar</div>
                  <div>3. Or go to <strong>Google Calendar → Settings → Import</strong> and upload the file</div>
                  <div style={{marginTop:6,color:"rgba(255,255,255,0.35)"}}>Note: This is a one-time snapshot. Re-export whenever you add new events.</div>
                </div>

                <button onClick={()=>{setShowIcsModal(false);setIcsImportMsg("");}} style={{width:"100%",padding:"11px",borderRadius:12,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700,marginTop:16}}>Close</button>
              </Modal>
            )}
          </div>
        )}
        {view==="chores"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:26,color:"#a78bfa"}}>Weekly Chores</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setShowReset(true)} style={{background:"rgba(255,100,100,0.15)",border:"1px solid rgba(255,100,100,0.3)",color:"#ff8080",borderRadius:12,padding:"8px 14px",cursor:"pointer",fontWeight:700,fontSize:13}}>🔄 Reset Week</button>
                <button onClick={()=>setShowAddChore(true)} style={{background:"#a78bfa",border:"none",color:"#fff",borderRadius:12,padding:"8px 16px",cursor:"pointer",fontWeight:800,fontSize:13}}>+ Add Chore</button>
              </div>
            </div>

            {members.slice(1).map(member=>{
              const kc=chores[member.id];
              const doneCount=kc.reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0);
              const totalCount=kc.reduce((a,c)=>a+c.days.length,0);
              return(
                <div key={member.id} style={{background:"rgba(255,255,255,0.04)",borderRadius:20,padding:18,marginBottom:18,border:`1px solid ${member.color}33`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                    <span style={{fontSize:22}}>{member.emoji}</span>
                    <div style={{fontFamily:"'Fredoka One',cursive",fontSize:19,color:member.color}}>{member.name}</div>
                    <div style={{flex:1}}/>
                    <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.4)"}}>{doneCount}/{totalCount} this week</div>
                    <div style={{background:member.color+"22",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:800,color:member.color}}>⭐ {pts[member.id]}</div>
                    <button onClick={()=>{setKidView(member.id);setKidTab("chores");}} style={{background:member.color,border:"none",color:"#fff",borderRadius:10,padding:"5px 11px",cursor:"pointer",fontWeight:700,fontSize:11}}>Kid View →</button>
                  </div>
                  {/* Mini progress bar */}
                  <div style={{background:"rgba(255,255,255,0.08)",borderRadius:99,height:6,marginBottom:14,overflow:"hidden"}}>
                    <div style={{background:member.color,height:"100%",width:`${totalCount?Math.round(doneCount/totalCount*100):0}%`,borderRadius:99,transition:"width 0.4s"}}/>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>
                        <th style={{textAlign:"left",padding:"5px 8px",fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:700,width:"28%"}}>Chore</th>
                        {DAYS.map(d=><th key={d} style={{textAlign:"center",padding:"5px 4px",fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:700}}>{d}</th>)}
                        <th style={{textAlign:"center",padding:"5px 4px",fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:700}}>Pts</th>
                        <th style={{width:26}}></th>
                      </tr></thead>
                      <tbody>
                        {kc.map(chore=>(
                          <tr key={chore.id} style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                            <td style={{padding:"9px 8px",fontSize:13,fontWeight:600}}>{chore.text}</td>
                            {DAYS.map(d=>{
                              const active=chore.days.includes(d);
                              const key=`${d}-week`;
                              const done=!!chore.done[key];
                              return(
                                <td key={d} style={{textAlign:"center",padding:"5px 4px"}}>
                                  {active?(
                                    <button onClick={()=>toggleChore(member.id,chore.id,key)} style={{width:26,height:26,borderRadius:7,border:`2px solid ${done?member.color:"rgba(255,255,255,0.2)"}`,background:done?member.color:"transparent",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#fff",transition:"all 0.15s"}}>{done?"✓":""}</button>
                                  ):<div style={{width:26,height:26,margin:"0 auto",opacity:0.08,fontSize:12,lineHeight:"26px",textAlign:"center"}}>—</div>}
                                </td>
                              );
                            })}
                            <td style={{textAlign:"center",fontSize:12,fontWeight:700,color:member.color}}>{chore.points}</td>
                            <td style={{textAlign:"center"}}><button onClick={()=>setChores(p=>({...p,[member.id]:p[member.id].filter(c=>c.id!==chore.id)}))} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",cursor:"pointer",fontSize:13}}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Week history */}
            {weekHistory.length>0&&(
              <div style={{marginTop:10}}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:"rgba(255,255,255,0.4)",marginBottom:12}}>📜 Past Weeks</div>
                {weekHistory.map((wk,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.04)",borderRadius:14,padding:"12px 16px",marginBottom:8,border:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",minWidth:80}}>{wk.date}</div>
                    {["kid1","kid2"].map(kid=>{
                      const s=wk.summary[kid];
                      const name=kid==="kid1"?wk.kid1Name:wk.kid2Name;
                      const m=getMember(kid);
                      return(
                        <div key={kid} style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:14}}>{m.emoji}</span>
                          <span style={{fontWeight:700,fontSize:13,color:m.color}}>{name}</span>
                          <span style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>{s.done}/{s.total} chores</span>
                          <span style={{fontSize:12,color:m.color,fontWeight:700}}>⭐{wk.pts[kid]}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {showAddChore&&(
              <Modal onClose={()=>setShowAddChore(false)}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:18,color:"#a78bfa"}}>New Chore</div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>Chore</div>
                  <input list="chore-s" value={newChore.text} onChange={e=>setNewChore(p=>({...p,text:e.target.value}))} placeholder="e.g. Make bed" style={INP}/>
                  <datalist id="chore-s">{CHORE_TEMPLATES.map(t=><option key={t} value={t}/>)}</datalist>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Points per completion</div>
                  <div style={{display:"flex",gap:8}}>
                    {[5,8,10,15,20].map(p=><button key={p} onClick={()=>setNewChore(prev=>({...prev,points:p}))} style={{flex:1,padding:"8px 4px",borderRadius:10,border:`2px solid ${newChore.points===p?"#a78bfa":"rgba(255,255,255,0.1)"}`,background:newChore.points===p?"#a78bfa33":"transparent",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>{p}⭐</button>)}
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Assign to</div>
                  <div style={{display:"flex",gap:8}}>
                    {members.slice(1).map(m=><button key={m.id} onClick={()=>setNewChore(p=>({...p,kid:m.id}))} style={{flex:1,padding:"8px",borderRadius:10,border:`2px solid ${newChore.kid===m.id?m.color:"rgba(255,255,255,0.1)"}`,background:newChore.kid===m.id?m.color+"33":"transparent",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:13}}>{m.emoji} {m.name}</button>)}
                  </div>
                </div>
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Days</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {DAYS.map(d=><button key={d} onClick={()=>setNewChore(prev=>({...prev,days:prev.days.includes(d)?prev.days.filter(x=>x!==d):[...prev.days,d]}))} style={{padding:"6px 10px",borderRadius:10,border:`2px solid ${newChore.days.includes(d)?"#a78bfa":"rgba(255,255,255,0.1)"}`,background:newChore.days.includes(d)?"#a78bfa33":"transparent",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:12}}>{d}</button>)}
                  </div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setShowAddChore(false)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                  <button onClick={addChore} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#a78bfa",color:"#fff",cursor:"pointer",fontWeight:800}}>Add Chore</button>
                </div>
              </Modal>
            )}

            {showReset&&(
              <Modal onClose={()=>setShowReset(false)}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:52,marginBottom:12}}>🔄</div>
                  <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:10}}>Reset the Week?</div>
                  <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginBottom:6}}>This will:</div>
                  <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",marginBottom:20,textAlign:"left"}}>
                    {["✅ Save this week's results to history","🏅 Award Perfect Week badges if earned","🔄 Clear all chore checkboxes","⭐ Keep all earned points"].map(t=><div key={t} style={{fontSize:13,marginBottom:6,color:"rgba(255,255,255,0.7)"}}>{t}</div>)}
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setShowReset(false)} style={{flex:1,padding:"11px",borderRadius:12,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                    <button onClick={()=>doWeekReset(true)} style={{flex:1,padding:"11px",borderRadius:12,border:"none",background:"#ef4444",color:"#fff",cursor:"pointer",fontWeight:800,fontSize:15}}>Reset Week</button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── REWARDS ── */}
        {view==="rewards"&&(
          <div>
            <div style={{fontFamily:"'Fredoka One',cursive",fontSize:26,color:"#a78bfa",marginBottom:18}}>🏆 Rewards Overview</div>

            {/* Kid cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginBottom:28}}>
              {members.slice(1).map(member=>(
                <div key={member.id} style={{background:`${member.color}12`,border:`2px solid ${member.color}44`,borderRadius:20,padding:18}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <span style={{fontSize:24}}>{member.emoji}</span>
                    <div style={{fontFamily:"'Fredoka One',cursive",fontSize:19,color:member.color}}>{member.name}</div>
                  </div>
                  <div style={{background:member.color,borderRadius:14,padding:"10px",textAlign:"center",marginBottom:12,boxShadow:`0 4px 16px ${member.color}44`}}>
                    <div style={{fontFamily:"'Fredoka One',cursive",fontSize:28,color:"#fff"}}>⭐ {pts[member.id]}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.8)"}}>available · {allTimePts[member.id]} earned all-time</div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1,marginBottom:6}}>BADGES ({(badges[member.id]||[]).length}/{BADGES.length})</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {BADGES.map(b=>{
                        const has=(badges[member.id]||[]).includes(b.id);
                        return(<div key={b.id} title={b.desc} style={{background:has?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.03)",borderRadius:10,padding:"4px 8px",fontSize:12,fontWeight:700,opacity:has?1:0.35,filter:has?"none":"grayscale(1)"}}>
                          {b.emoji} {b.label}
                        </div>);
                      })}
                    </div>
                  </div>
                  {redeemed[member.id]?.length>0&&(
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.35)",letterSpacing:1,marginBottom:6}}>REDEEMED</div>
                      {redeemed[member.id].slice(-3).map((p,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,marginBottom:4}}>
                          <span>{p.emoji}</span><span style={{fontWeight:700}}>{p.label}</span><div style={{flex:1}}/><span style={{fontSize:11,color:"rgba(255,255,255,0.3)"}}>{p.date}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Prize catalog management */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:20,color:"rgba(255,255,255,0.6)"}}>🎁 Prize Catalog</div>
              <button onClick={()=>setShowAddPrize(true)} style={{background:"#a78bfa",border:"none",color:"#fff",borderRadius:12,padding:"7px 16px",cursor:"pointer",fontWeight:800,fontSize:13}}>+ Add Prize</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              {prizes.map(prize=>(
                <div key={prize.id} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,padding:"14px",textAlign:"center",position:"relative"}}>
                  <button onClick={()=>{setShowEditPrize(prize.id);setEditPrizeData({emoji:prize.emoji,label:prize.label,cost:prize.cost});}} style={{position:"absolute",top:8,right:8,background:"rgba(255,255,255,0.1)",border:"none",color:"rgba(255,255,255,0.5)",borderRadius:8,width:24,height:24,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
                  <div style={{fontSize:28,marginBottom:6}}>{prize.emoji}</div>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{prize.label}</div>
                  <div style={{fontFamily:"'Fredoka One',cursive",color:"#a78bfa",fontSize:15}}>{prize.cost} ⭐</div>
                </div>
              ))}
            </div>

            {/* Add Prize modal */}
            {showAddPrize&&(
              <Modal onClose={()=>setShowAddPrize(false)}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:18,color:"#a78bfa"}}>New Prize</div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Pick an Emoji</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                    {PRIZE_EMOJIS.map(e=>(
                      <button key={e} onClick={()=>setNewPrize(p=>({...p,emoji:e}))} style={{width:38,height:38,borderRadius:10,border:`2px solid ${newPrize.emoji===e?"#a78bfa":"rgba(255,255,255,0.1)"}`,background:newPrize.emoji===e?"#a78bfa33":"transparent",cursor:"pointer",fontSize:20}}>{e}</button>
                    ))}
                  </div>
                  <input value={newPrize.emoji} onChange={e=>setNewPrize(p=>({...p,emoji:e.target.value}))} placeholder="Or type any emoji" style={{...INP,width:"auto"}} maxLength={2}/>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>Prize Name</div>
                  <input value={newPrize.label} onChange={e=>setNewPrize(p=>({...p,label:e.target.value}))} placeholder="e.g. Extra dessert" style={INP}/>
                </div>
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Cost (⭐ points)</div>
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    {[10,25,50,100,200].map(c=><button key={c} onClick={()=>setNewPrize(p=>({...p,cost:c}))} style={{flex:1,padding:"7px 4px",borderRadius:10,border:`2px solid ${newPrize.cost===c?"#a78bfa":"rgba(255,255,255,0.1)"}`,background:newPrize.cost===c?"#a78bfa33":"transparent",color:"#fff",cursor:"pointer",fontWeight:700,fontSize:12}}>{c}</button>)}
                  </div>
                  <input type="number" value={newPrize.cost} onChange={e=>setNewPrize(p=>({...p,cost:Number(e.target.value)}))} placeholder="Custom cost" style={INP} min={1}/>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setShowAddPrize(false)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                  <button onClick={addPrize} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#a78bfa",color:"#fff",cursor:"pointer",fontWeight:800}}>Add Prize</button>
                </div>
              </Modal>
            )}

            {/* Edit Prize modal */}
            {showEditPrize&&(
              <Modal onClose={()=>setShowEditPrize(null)}>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:22,marginBottom:18,color:"#a78bfa"}}>Edit Prize</div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:6}}>Emoji</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                    {PRIZE_EMOJIS.map(e=>(
                      <button key={e} onClick={()=>setEditPrizeData(p=>({...p,emoji:e}))} style={{width:36,height:36,borderRadius:10,border:`2px solid ${editPrizeData.emoji===e?"#a78bfa":"rgba(255,255,255,0.1)"}`,background:editPrizeData.emoji===e?"#a78bfa33":"transparent",cursor:"pointer",fontSize:18}}>{e}</button>
                    ))}
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>Name</div>
                  <input value={editPrizeData.label} onChange={e=>setEditPrizeData(p=>({...p,label:e.target.value}))} style={INP}/>
                </div>
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",marginBottom:4}}>Cost (⭐)</div>
                  <input type="number" value={editPrizeData.cost} onChange={e=>setEditPrizeData(p=>({...p,cost:Number(e.target.value)}))} style={INP} min={1}/>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>deletePrize(showEditPrize)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid rgba(255,80,80,0.3)",background:"rgba(255,80,80,0.1)",color:"#ff8080",cursor:"pointer",fontWeight:700}}>Delete</button>
                  <button onClick={()=>setShowEditPrize(null)} style={{flex:1,padding:"10px",borderRadius:10,border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#fff",cursor:"pointer",fontWeight:700}}>Cancel</button>
                  <button onClick={savePrizeEdit} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:"#a78bfa",color:"#fff",cursor:"pointer",fontWeight:800}}>Save</button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {view==="settings"&&(
          <div>
            <div style={{fontFamily:"'Fredoka One',cursive",fontSize:26,color:"#a78bfa",marginBottom:20}}>⚙️ Settings</div>

            {/* Rename kids */}
            <div style={{background:"rgba(255,255,255,0.05)",borderRadius:20,padding:20,marginBottom:18,border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:"rgba(255,255,255,0.7)",marginBottom:14}}>👦 Kid Names</div>
              {[["kid1",kid1Name,setKid1Name],["kid2",kid2Name,setKid2Name]].map(([id,name,setter])=>{
                const m=getMember(id);
                return(
                  <div key={id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                    <span style={{fontSize:22}}>{m.emoji}</span>
                    <input value={name} onChange={e=>setter(e.target.value)} style={{...INP,flex:1,borderColor:m.color+"55"}} placeholder="Enter name"/>
                  </div>
                );
              })}
            </div>

            {/* Data */}
            <div style={{background:"rgba(255,255,255,0.05)",borderRadius:20,padding:20,marginBottom:18,border:"1px solid rgba(255,255,255,0.1)"}}>
              <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:"rgba(255,255,255,0.7)",marginBottom:14}}>💾 Data</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginBottom:16}}>All your data is automatically saved to this browser. It will persist even if you close the tab.</div>
              <button onClick={()=>{if(window.confirm("This will erase ALL data and reset to defaults. Are you sure?")){ localStorage.removeItem(STORAGE_KEY); window.location.reload(); }}} style={{background:"rgba(255,80,80,0.12)",border:"1px solid rgba(255,80,80,0.3)",color:"#ff8080",borderRadius:12,padding:"10px 20px",cursor:"pointer",fontWeight:700,fontSize:14}}>
                🗑️ Clear All Data & Reset
              </button>
            </div>

            {/* Cloud sync */}
            <div style={{background:"rgba(255,255,255,0.05)",borderRadius:20,padding:20,border:`1px solid ${cloudEnabled?"rgba(52,211,153,0.25)":"rgba(255,255,255,0.1)"}`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <span style={{fontSize:22}}>☁️</span>
                <div style={{fontFamily:"'Fredoka One',cursive",fontSize:18,color:cloudEnabled?"#34d399":"rgba(255,255,255,0.7)"}}>
                  {cloudEnabled ? "Cloud Sync Active" : "Enable Cloud Sync"}
                </div>
                {cloudEnabled && <div style={{background:"rgba(52,211,153,0.2)",border:"1px solid rgba(52,211,153,0.4)",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:800,color:"#34d399"}}>ON</div>}
              </div>

              {cloudEnabled ? (
                <div>
                  <div style={{background:"rgba(52,211,153,0.08)",borderRadius:12,padding:14,marginBottom:14,fontSize:13,color:"rgba(255,255,255,0.6)",lineHeight:1.7}}>
                    <div style={{color:"#34d399",fontWeight:700,marginBottom:6}}>✅ Real-time sync is enabled!</div>
                    <div>All devices in your family see the same data instantly.</div>
                    <div>Current status: <strong style={{color:syncStatus==="saved"?"#34d399":"#f87171"}}>{syncStatus==="saved"?"Synced ☁️":"Syncing… 🔄"}</strong></div>
                  </div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.35)"}}>
                    To change your Supabase credentials, update the <code style={{background:"rgba(255,255,255,0.08)",borderRadius:4,padding:"1px 5px"}}>.env</code> file and redeploy.
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",marginBottom:16,lineHeight:1.7}}>
                    Add a free Supabase backend so all your family's devices share the same calendar, chores, and points in real time.
                  </div>
                  <div style={{background:"rgba(167,139,250,0.08)",borderRadius:14,padding:16,marginBottom:16}}>
                    <div style={{fontWeight:800,fontSize:14,marginBottom:12,color:"rgba(255,255,255,0.8)"}}>🛠️ Setup (takes ~5 minutes)</div>
                    {[
                      ["1","Go to supabase.com → New project (free tier)"],
                      ["2","Open SQL Editor → paste contents of supabase-setup.sql → Run"],
                      ["3","Go to Settings → API → copy Project URL and anon key"],
                      ["4","Add to Vercel/Netlify environment variables:\n  REACT_APP_SUPABASE_URL\n  REACT_APP_SUPABASE_ANON_KEY\n  REACT_APP_FAMILY_ID"],
                      ["5","Redeploy — cloud sync starts automatically"],
                    ].map(([n,t])=>(
                      <div key={n} style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start"}}>
                        <div style={{background:"#a78bfa",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,flexShrink:0,marginTop:1}}>{n}</div>
                        <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",lineHeight:1.6,whiteSpace:"pre-line"}}>{t}</div>
                      </div>
                    ))}
                  </div>
                  <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(52,211,153,0.15)",border:"1px solid rgba(52,211,153,0.3)",borderRadius:12,padding:"10px 18px",color:"#34d399",fontWeight:700,fontSize:13,textDecoration:"none"}}>
                    🚀 Go to Supabase (free)
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        </div>{/* end famplan-content */}
      </div>{/* end famplan-layout */}

      {/* ── Bottom tab bar – phone only, via CSS ── */}
      <div className="famplan-bottom-tabs">
        {[["calendar","📅","Calendar"],["chores","✅","Chores"],["rewards","🏆","Rewards"],["settings","⚙️","More"]].map(([v,icon,label])=>(
          <button key={v} className={`famplan-bottom-tab${view===v?" active":""}`} onClick={()=>setView(v)}>
            <span className="famplan-bottom-tab-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
