import { useState, useEffect, useRef } from "react";
import './tablet.css';
import { isConfigured, loadFromCloud, saveToCloud, subscribeToChanges } from './sync';

// ── Theme ────────────────────────────────────────────────────
const T = {
  bg:        "#F8F7F4",
  bgCard:    "#FFFFFF",
  bgMuted:   "#F1EFE9",
  border:    "#E8E4DC",
  gold:      "#C9A84C",
  goldLight: "#F5EDD6",
  goldDark:  "#9A7B2F",
  text:      "#1A1814",
  textMid:   "#6B6456",
  textLight: "#A39B8E",
  kid1:      "#C9A84C",
  kid2:      "#5B7FA6",
  family:    "#7A6E62",
  green:     "#3D8C5F",
  greenLight:"#E8F4EE",
  red:       "#C0392B",
  redLight:  "#FDECEA",
  shadow:    "0 2px 12px rgba(0,0,0,0.08)",
  shadowMd:  "0 4px 24px rgba(0,0,0,0.12)",
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CHORE_TEMPLATES = ["Make bed","Clean room","Do homework","Take out trash","Wash dishes","Feed pet","Vacuum","Set the table","Laundry","Tidy up"];
const PRIZE_EMOJIS = ["🍦","🎮","🎬","🛍️","🎉","🏕️","🍕","🎨","📚","🎵","🧁","🚴","🎯","🏊","🎪"];

const BADGES = [
  { id:"first",   emoji:"🌱", label:"First Chore!",  desc:"Complete your very first chore" },
  { id:"streak3", emoji:"🔥", label:"3-Day Streak",  desc:"Complete chores 3 days in a row" },
  { id:"perfect", emoji:"👑", label:"Perfect Week",  desc:"Complete ALL chores in a week" },
  { id:"allstar", emoji:"⭐", label:"All-Star",      desc:"Earn 100 points total" },
  { id:"helper",  emoji:"🤝", label:"Big Helper",    desc:"Complete 10 chores total" },
  { id:"century", emoji:"💯", label:"Century Club",  desc:"Earn 200 points total" },
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
    { id:1, text:"Make bed",       days:["Mon","Tue","Wed","Thu","Fri"], done:{}, points:5  },
    { id:2, text:"Do homework",    days:["Mon","Tue","Wed","Thu"],       done:{}, points:10 },
    { id:3, text:"Take out trash", days:["Wed","Sat"],                   done:{}, points:8  },
  ],
  kid2: [
    { id:4, text:"Make bed",    days:["Mon","Tue","Wed","Thu","Fri"], done:{}, points:5  },
    { id:5, text:"Wash dishes", days:["Tue","Thu","Sat"],              done:{}, points:8  },
    { id:6, text:"Vacuum",      days:["Sat"],                          done:{}, points:10 },
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

const STORAGE_KEY = "famplan-v3";
function loadState(){
  try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch { return null; }
}
function saveState(s){
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(s)); } catch {}
}

// ── iCal helpers ─────────────────────────────────────────────
function parseTime(t){
  if(!t) return {h:9,m:0};
  const c=t.trim().toUpperCase();
  const x=c.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if(!x) return {h:9,m:0};
  let h=parseInt(x[1]);const m=parseInt(x[2]||"0");const p=x[3];
  if(p==="PM"&&h!==12) h+=12;
  if(p==="AM"&&h===12) h=0;
  return {h,m};
}
function toIcsDate(dateStr,timeStr,dur=1){
  const [y,mo,d]=dateStr.split("-").map(Number);
  const {h,m}=parseTime(timeStr);
  const pad=n=>String(n).padStart(2,"0");
  const s=`${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(m)}00`;
  const eh=h+dur;
  const e=`${y}${pad(mo)}${pad(d)}T${pad(eh<24?eh:23)}${pad(eh<24?m:59)}00`;
  return {start:s,end:e};
}
function generateICS(evts,members){
  const gm=id=>members.find(m=>m.id===id)||members[0];
  const esc=s=>(s||"").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\n/g,"\\n");
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//FamPlan//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:FamPlan"];
  evts.forEach(ev=>{
    const mb=gm(ev.member);
    const {start,end}=toIcsDate(ev.date,ev.time);
    lines.push("BEGIN:VEVENT",`UID:famplan-${ev.id}@famplan.local`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").split(".")[0]}Z`,
      `DTSTART:${start}`,`DTEND:${end}`,`SUMMARY:${esc(ev.title)}`,
      `DESCRIPTION:${esc(mb.name)}`,"END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function downloadICS(c,f="famplan.ics"){
  const b=new Blob([c],{type:"text/calendar;charset=utf-8"});
  const u=URL.createObjectURL(b);const a=document.createElement("a");
  a.href=u;a.download=f;a.click();URL.revokeObjectURL(u);
}
function googleCalUrl(ev){
  const {start,end}=toIcsDate(ev.date,ev.time);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${start}/${end}`;
}
function parseICS(text){
  const out=[];
  text.split("BEGIN:VEVENT").slice(1).forEach(block=>{
    const get=k=>{const x=block.match(new RegExp(`^${k}[^:]*:(.+)$`,"m"));return x?x[1].trim():""};
    const sum=get("SUMMARY"),dts=get("DTSTART");
    if(!sum||!dts) return;
    const c=dts.replace(/[TZ]/g,"");
    const y=c.slice(0,4),mo=c.slice(4,6),d=c.slice(6,8),h=c.slice(8,10)||"09",mi=c.slice(10,12)||"00";
    out.push({id:Date.now()+Math.random(),title:sum,date:`${y}-${mo}-${d}`,time:`${parseInt(h)%12||12}:${mi} ${parseInt(h)>=12?"PM":"AM"}`,member:"family"});
  });
  return out;
}

// ── UI primitives ─────────────────────────────────────────────
function Confetti(){
  return(
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999}}>
      <style>{`
        @keyframes cf0{0%{opacity:1;transform:translateY(0) rotate(0deg)}100%{opacity:0;transform:translateY(280px) rotate(400deg)}}
        @keyframes cf1{0%{opacity:1;transform:translateY(0) rotate(0deg)}100%{opacity:0;transform:translateY(220px) rotate(-250deg)}}
        @keyframes cf2{0%{opacity:1;transform:translateY(0) rotate(0deg)}100%{opacity:0;transform:translateY(260px) rotate(200deg)}}
      `}</style>
      {Array.from({length:20}).map((_,i)=>(
        <div key={i} style={{position:"absolute",left:`${5+Math.floor(i*4.7)%90}%`,top:`${(i*7)%35}%`,fontSize:22,animation:`cf${i%3} 1.4s ease-out ${i*0.07}s forwards`,opacity:0}}>
          {["✨","⭐","🌟","💛","🏆"][i%5]}
        </div>
      ))}
    </div>
  );
}

function Modal({onClose,children}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.bgCard,borderRadius:20,padding:28,width:"100%",maxWidth:420,border:`1px solid ${T.border}`,maxHeight:"90vh",overflowY:"auto",boxShadow:T.shadowMd}}>
        {children}
      </div>
    </div>
  );
}

const INP = {width:"100%",background:T.bgMuted,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px",color:T.text,fontFamily:"'Inter',sans-serif",fontSize:14,boxSizing:"border-box",outline:"none"};
const BTN = (bg,color="#fff",border="none")=>({background:bg,border,color,borderRadius:10,padding:"10px 18px",cursor:"pointer",fontWeight:600,fontSize:14,fontFamily:"'Inter',sans-serif"});

// ── Member colors ─────────────────────────────────────────────
function memberColor(id){ return id==="kid1"?T.kid1:id==="kid2"?T.kid2:T.family; }

export default function App(){
  const today=new Date();
  const saved=loadState();

  const [kid1Name,  setKid1Name]  = useState(saved?.kid1Name  ??"Kid 1");
  const [kid2Name,  setKid2Name]  = useState(saved?.kid2Name  ??"Kid 2");
  const [events,    setEvents]    = useState(saved?.events    ??DEFAULT_EVENTS);
  const [chores,    setChores]    = useState(saved?.chores    ??DEFAULT_CHORES);
  const [pts,       setPts]       = useState(saved?.pts       ??{kid1:0,kid2:0});
  const [allTimePts,setAllTimePts]= useState(saved?.allTimePts??{kid1:0,kid2:0});
  const [totalDone, setTotalDone] = useState(saved?.totalDone ??{kid1:0,kid2:0});
  const [badges,    setBadges]    = useState(saved?.badges    ??{kid1:[],kid2:[]});
  const [redeemed,  setRedeemed]  = useState(saved?.redeemed  ??{kid1:[],kid2:[]});
  const [prizes,    setPrizes]    = useState(saved?.prizes    ??DEFAULT_PRIZES);
  const [lastWeek,  setLastWeek]  = useState(saved?.lastWeek  ??getWeekId());
  const [weekHistory,setWeekHistory]=useState(saved?.weekHistory??[]);

  const [view,     setView]    = useState("calendar");
  const [kidView,  setKidView] = useState(null);
  const [kidTab,   setKidTab]  = useState("chores");
  const [curYear,  setCurYear] = useState(today.getFullYear());
  const [curMonth, setCurMonth]= useState(today.getMonth());
  const [selDay,   setSelDay]  = useState(null);
  const [confetti, setConfetti]= useState(false);

  const [showAddEvent,  setShowAddEvent]  = useState(false);
  const [showAddChore,  setShowAddChore]  = useState(false);
  const [showAddPrize,  setShowAddPrize]  = useState(false);
  const [showEditPrize, setShowEditPrize] = useState(null);
  const [showReset,     setShowReset]     = useState(false);
  const [showPtsReset,  setShowPtsReset]  = useState(false);
  const [showBadgeToast,setShowBadgeToast]= useState(null);
  const [prizeConfirm,  setPrizeConfirm]  = useState(null);
  const [showIcsModal,  setShowIcsModal]  = useState(false);
  const [showEventMenu, setShowEventMenu] = useState(null);
  const [icsMsg,        setIcsMsg]        = useState("");

  const [newEvent,    setNewEvent]    = useState({title:"",date:"",member:"family",time:""});
  const [newChore,    setNewChore]    = useState({text:"",kid:"kid1",days:[],points:5});
  const [newPrize,    setNewPrize]    = useState({emoji:"🎁",label:"",cost:30});
  const [editPrizeData,setEditPrizeData]=useState({emoji:"",label:"",cost:0});

  const members=[
    {id:"family",name:"Family",color:T.family,emoji:"🏠"},
    {id:"kid1",  name:kid1Name,color:T.kid1,  emoji:"★"},
    {id:"kid2",  name:kid2Name,color:T.kid2,  emoji:"◆"},
  ];

  // ── Persist locally ──
  useEffect(()=>{
    saveState({kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory});
  },[kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory]);

  useEffect(()=>{
    if(getWeekId()!==lastWeek){ doWeekReset(false); setLastWeek(getWeekId()); }
  // eslint-disable-next-line
  },[]);

  // ── Cloud sync ──
  const [syncStatus,setSyncStatus]=useState("idle");
  const [cloudEnabled]=useState(isConfigured);
  const saveTimer=useRef(null);
  const isMounted=useRef(true);
  useEffect(()=>(()=>{isMounted.current=false;}),[]);

  useEffect(()=>{
    if(!cloudEnabled) return;
    setSyncStatus("loading");
    loadFromCloud().then(s=>{
      if(!isMounted.current) return;
      if(s){
        if(s.kid1Name)    setKid1Name(s.kid1Name);
        if(s.kid2Name)    setKid2Name(s.kid2Name);
        if(s.events)      setEvents(s.events);
        if(s.chores)      setChores(s.chores);
        if(s.pts)         setPts(s.pts);
        if(s.allTimePts)  setAllTimePts(s.allTimePts);
        if(s.totalDone)   setTotalDone(s.totalDone);
        if(s.badges)      setBadges(s.badges);
        if(s.redeemed)    setRedeemed(s.redeemed);
        if(s.prizes)      setPrizes(s.prizes);
        if(s.lastWeek)    setLastWeek(s.lastWeek);
        if(s.weekHistory) setWeekHistory(s.weekHistory);
      }
      setSyncStatus("saved");
    }).catch(()=>{ if(isMounted.current) setSyncStatus("error"); });
  // eslint-disable-next-line
  },[cloudEnabled]);

  const currentState={kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory};
  useEffect(()=>{
    if(!cloudEnabled||syncStatus==="loading") return;
    clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current=setTimeout(()=>{
      saveToCloud(currentState)
        .then(()=>{ if(isMounted.current) setSyncStatus("saved"); })
        .catch(()=>{ if(isMounted.current) setSyncStatus("error"); });
    },2000);
    return ()=>clearTimeout(saveTimer.current);
  // eslint-disable-next-line
  },[kid1Name,kid2Name,events,chores,pts,allTimePts,totalDone,badges,redeemed,prizes,lastWeek,weekHistory]);

  useEffect(()=>{
    if(!cloudEnabled) return;
    const unsub=subscribeToChanges(s=>{
      if(!isMounted.current) return;
      setSyncStatus("saved");
      if(s.kid1Name)    setKid1Name(s.kid1Name);
      if(s.kid2Name)    setKid2Name(s.kid2Name);
      if(s.events)      setEvents(s.events);
      if(s.chores)      setChores(s.chores);
      if(s.pts)         setPts(s.pts);
      if(s.allTimePts)  setAllTimePts(s.allTimePts);
      if(s.totalDone)   setTotalDone(s.totalDone);
      if(s.badges)      setBadges(s.badges);
      if(s.redeemed)    setRedeemed(s.redeemed);
      if(s.prizes)      setPrizes(s.prizes);
      if(s.lastWeek)    setLastWeek(s.lastWeek);
      if(s.weekHistory) setWeekHistory(s.weekHistory);
    });
    return unsub;
  // eslint-disable-next-line
  },[cloudEnabled]);

  function pop(){ setConfetti(true); setTimeout(()=>setConfetti(false),1600); }

  function awardBadge(kid,id){
    setBadges(prev=>{
      const b=[...(prev[kid]||[])];
      if(b.includes(id)) return prev;
      b.push(id);
      const badge=BADGES.find(x=>x.id===id);
      setShowBadgeToast({...badge,kid});
      setTimeout(()=>setShowBadgeToast(null),3000);
      return {...prev,[kid]:b};
    });
  }
  function checkBadges(kid,at,td){
    if(at>=100) awardBadge(kid,"allstar");
    if(at>=200) awardBadge(kid,"century");
    if(td>=10)  awardBadge(kid,"helper");
  }

  function toggleChore(kid,choreId,key){
    let delta=0;
    setChores(prev=>{
      const list=prev[kid].map(c=>{
        if(c.id!==choreId) return c;
        const d={...c.done};const was=!!d[key];
        d[key]=!was;delta=was?-(c.points||5):(c.points||5);
        return {...c,done:d};
      });
      return {...prev,[kid]:list};
    });
    setPts(prev=>({...prev,[kid]:Math.max(0,prev[kid]+delta)}));
    if(delta>0){
      pop();
      setAllTimePts(prev=>{
        const nv={...prev,[kid]:prev[kid]+delta};
        setTotalDone(td=>{const nt={...td,[kid]:td[kid]+1};checkBadges(kid,nv[kid],nt[kid]);return nt;});
        return nv;
      });
      awardBadge(kid,"first");
    }
  }

  function redeemPrize(kid,prize){
    if(pts[kid]<prize.cost) return;
    setPts(prev=>({...prev,[kid]:prev[kid]-prize.cost}));
    setRedeemed(prev=>({...prev,[kid]:[...prev[kid],{...prize,date:new Date().toLocaleDateString()}]}));
    setPrizeConfirm(null); pop();
  }

  function doWeekReset(manual=true){
    const snap={week:getWeekId(),date:new Date().toLocaleDateString(),pts:{...pts},kid1Name,kid2Name,
      summary:{
        kid1:{done:chores.kid1.reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0),total:chores.kid1.reduce((a,c)=>a+c.days.length,0)},
        kid2:{done:chores.kid2.reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0),total:chores.kid2.reduce((a,c)=>a+c.days.length,0)},
      }
    };
    ["kid1","kid2"].forEach(kid=>{ const s=snap.summary[kid]; if(s.total>0&&s.done===s.total) awardBadge(kid,"perfect"); });
    setWeekHistory(prev=>[snap,...prev].slice(0,8));
    setChores(prev=>{ const r={}; for(const k of["kid1","kid2"]) r[k]=prev[k].map(c=>({...c,done:{}})); return r; });
    if(manual) setShowReset(false);
  }

  function resetPoints(kid){
    if(kid==="both"){
      setPts({kid1:0,kid2:0});
    } else {
      setPts(prev=>({...prev,[kid]:0}));
    }
    setShowPtsReset(false);
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
    setNewChore({text:"",kid:"kid1",days:[],points:5}); setShowAddChore(false);
  }
  function addPrize(){
    if(!newPrize.label||newPrize.cost<1) return;
    setPrizes(prev=>[...prev,{...newPrize,id:`c-${Date.now()}`}]);
    setNewPrize({emoji:"🎁",label:"",cost:30}); setShowAddPrize(false);
  }
  function savePrizeEdit(){ setPrizes(prev=>prev.map(p=>p.id===showEditPrize?{...p,...editPrizeData}:p)); setShowEditPrize(null); }
  function deletePrize(id){ setPrizes(prev=>prev.filter(p=>p.id!==id)); setShowEditPrize(null); }

  function getMember(id){ return members.find(m=>m.id===id)||members[0]; }
  function prevMonth(){ if(curMonth===0){setCurMonth(11);setCurYear(y=>y-1);}else{setCurMonth(m=>m-1);} }
  function nextMonth(){ if(curMonth===11){setCurMonth(0);setCurYear(y=>y+1);}else{setCurMonth(m=>m+1);} }
  function getEventsForDay(day){
    const ds=`${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return events.filter(e=>e.date===ds);
  }

  const todayDayName=DAYS[today.getDay()];
  const selEvents=selDay?getEventsForDay(selDay):[];

  // ── Sync badge ──
  const syncBadge = cloudEnabled ? (
    <div style={{display:"flex",alignItems:"center",gap:5,background:syncStatus==="saved"?T.greenLight:syncStatus==="error"?T.redLight:T.goldLight,border:`1px solid ${syncStatus==="saved"?"#A7D7BC":syncStatus==="error"?"#F5B7B1":T.gold}`,borderRadius:20,padding:"3px 11px",fontSize:11,fontWeight:600,color:syncStatus==="saved"?T.green:syncStatus==="error"?T.red:T.goldDark}}>
      {syncStatus==="loading"?"⏳ Loading":syncStatus==="saving"?"↻ Syncing":syncStatus==="saved"?"☁ Synced":"⚠ Sync Error"}
    </div>
  ) : (
    <div style={{display:"flex",alignItems:"center",gap:5,background:T.bgMuted,border:`1px solid ${T.border}`,borderRadius:20,padding:"3px 11px",fontSize:11,fontWeight:600,color:T.textLight}}>
      💾 Local
    </div>
  );

  // ════════════════════════════════════════════════
  // KID MODE
  // ════════════════════════════════════════════════
  if(kidView){
    const member=getMember(kidView);
    const myPts=pts[kidView];
    const kidChores=chores[kidView];
    const todayChores=kidChores.filter(c=>c.days.includes(todayDayName));
    const myBadges=badges[kidView]||[];

    return(
      <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Inter',sans-serif",color:T.text}}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
        {confetti&&<Confetti/>}

        {/* Badge toast */}
        {showBadgeToast&&(
          <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:T.bgCard,border:`1px solid ${T.gold}`,borderRadius:14,padding:"12px 20px",zIndex:500,display:"flex",alignItems:"center",gap:10,boxShadow:T.shadowMd}}>
            <span style={{fontSize:26}}>{showBadgeToast.emoji}</span>
            <div><div style={{fontWeight:700,fontSize:14,color:T.goldDark}}>New Badge!</div><div style={{fontSize:13,color:T.textMid}}>{showBadgeToast.label}</div></div>
          </div>
        )}

        {/* Header */}
        <div style={{background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,boxShadow:T.shadow}}>
          <div>
            <div style={{fontWeight:700,fontSize:20,color:T.text}}>{member.name}</div>
            <div style={{fontSize:12,color:T.textLight}}>{todayDayName}, {MONTHS[today.getMonth()]} {today.getDate()}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{background:T.gold,borderRadius:20,padding:"8px 18px",fontWeight:700,fontSize:18,color:"#fff",boxShadow:`0 2px 10px ${T.gold}55`}}>
              {myPts} pts
            </div>
            <button onClick={()=>setKidView(null)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),padding:"8px 14px",fontSize:13}}>
              ← Parent
            </button>
          </div>
        </div>

        <div style={{maxWidth:680,margin:"0 auto",padding:"20px 16px"}}>
          {/* Tabs */}
          <div style={{display:"flex",gap:2,marginBottom:20,background:T.bgMuted,borderRadius:12,padding:4}}>
            {[["chores","My Chores"],["rewards","Prize Store"]].map(([t,label])=>(
              <button key={t} onClick={()=>setKidTab(t)} style={{flex:1,padding:"10px",borderRadius:9,border:"none",cursor:"pointer",fontWeight:600,fontSize:14,fontFamily:"'Inter',sans-serif",background:kidTab===t?T.bgCard:T.bgMuted,color:kidTab===t?T.text:T.textMid,boxShadow:kidTab===t?T.shadow:"none",transition:"all 0.15s"}}>
                {label}
              </button>
            ))}
          </div>

          {kidTab==="chores"&&(
            <div>
              <div style={{fontWeight:600,fontSize:13,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Today's Chores</div>
              {todayChores.length===0?(
                <div style={{background:T.bgCard,borderRadius:14,padding:28,textAlign:"center",color:T.textLight,border:`1px solid ${T.border}`}}>
                  No chores today — enjoy your day! 🎉
                </div>
              ):todayChores.map(chore=>{
                const key=todayKey();
                const done=!!chore.done[key];
                return(
                  <div key={chore.id} onClick={()=>toggleChore(kidView,chore.id,key)} style={{display:"flex",alignItems:"center",gap:14,background:done?T.goldLight:T.bgCard,border:`1px solid ${done?T.gold:T.border}`,borderRadius:14,padding:"16px 18px",marginBottom:10,cursor:"pointer",transition:"all 0.15s",boxShadow:done?"none":T.shadow}}>
                    <div style={{width:26,height:26,borderRadius:8,background:done?T.gold:"transparent",border:`2px solid ${done?T.gold:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                      {done&&<span style={{color:"#fff",fontSize:14,fontWeight:700}}>✓</span>}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:16,textDecoration:done?"line-through":"none",color:done?T.textLight:T.text}}>{chore.text}</div>
                      <div style={{fontSize:12,color:T.textLight,marginTop:2}}>{done?"Done! Tap to undo":"Tap to mark complete"}</div>
                    </div>
                    <div style={{fontWeight:700,fontSize:14,color:done?T.goldDark:T.gold}}>+{chore.points} pts</div>
                  </div>
                );
              })}

              {kidChores.filter(c=>!c.days.includes(todayDayName)).length>0&&(
                <div style={{marginTop:24}}>
                  <div style={{fontWeight:600,fontSize:13,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Other Days</div>
                  {kidChores.filter(c=>!c.days.includes(todayDayName)).map(chore=>(
                    <div key={chore.id} style={{display:"flex",alignItems:"center",gap:12,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 16px",marginBottom:8,opacity:0.7}}>
                      <div style={{flex:1,fontWeight:500,fontSize:14}}>{chore.text}</div>
                      <div style={{fontSize:12,color:T.textLight}}>{chore.days.join(", ")}</div>
                      <div style={{fontSize:13,color:T.gold,fontWeight:600}}>+{chore.points}</div>
                    </div>
                  ))}
                </div>
              )}

              {myBadges.length>0&&(
                <div style={{marginTop:24}}>
                  <div style={{fontWeight:600,fontSize:13,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Badges Earned</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {myBadges.map(bid=>{const b=BADGES.find(x=>x.id===bid);return b?(
                      <div key={bid} style={{background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:10,padding:"6px 14px",display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:16}}>{b.emoji}</span>
                        <span style={{fontWeight:600,fontSize:12,color:T.goldDark}}>{b.label}</span>
                      </div>
                    ):null;})}
                  </div>
                </div>
              )}
            </div>
          )}

          {kidTab==="rewards"&&(
            <div>
              <div style={{background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:14,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontWeight:600,fontSize:14,color:T.goldDark}}>Your Balance</div>
                <div style={{fontWeight:700,fontSize:24,color:T.gold}}>{myPts} pts</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {prizes.map(prize=>{
                  const can=myPts>=prize.cost;
                  return(
                    <div key={prize.id} style={{background:T.bgCard,border:`1px solid ${can?T.gold:T.border}`,borderRadius:14,padding:"16px 12px",textAlign:"center",opacity:can?1:0.6,boxShadow:can?T.shadow:"none"}}>
                      <div style={{fontSize:34,marginBottom:6}}>{prize.emoji}</div>
                      <div style={{fontWeight:600,fontSize:13,marginBottom:4,color:T.text}}>{prize.label}</div>
                      <div style={{fontWeight:700,fontSize:14,color:T.gold,marginBottom:12}}>{prize.cost} pts</div>
                      <button onClick={()=>can&&setPrizeConfirm({kid:kidView,prize})} style={{...BTN(can?T.gold:T.bgMuted,can?"#fff":T.textLight),width:"100%",padding:"8px",fontSize:13,borderRadius:8}}>
                        {can?"Redeem":`Need ${prize.cost-myPts} more`}
                      </button>
                    </div>
                  );
                })}
              </div>
              {redeemed[kidView]?.length>0&&(
                <div style={{marginTop:24}}>
                  <div style={{fontWeight:600,fontSize:13,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Redeemed</div>
                  {redeemed[kidView].map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px",marginBottom:8}}>
                      <span style={{fontSize:18}}>{p.emoji}</span>
                      <span style={{fontWeight:500,fontSize:14,flex:1}}>{p.label}</span>
                      <span style={{fontSize:12,color:T.textLight}}>{p.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {prizeConfirm&&(
          <Modal onClose={()=>setPrizeConfirm(null)}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:52,marginBottom:12}}>{prizeConfirm.prize.emoji}</div>
              <div style={{fontWeight:700,fontSize:20,marginBottom:6,color:T.text}}>Redeem this?</div>
              <div style={{fontWeight:500,fontSize:15,marginBottom:4}}>{prizeConfirm.prize.label}</div>
              <div style={{fontWeight:700,fontSize:18,color:T.gold,marginBottom:10}}>{prizeConfirm.prize.cost} pts</div>
              <div style={{fontSize:13,color:T.textLight,marginBottom:22}}>Ask a parent to approve first!</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setPrizeConfirm(null)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                <button onClick={()=>redeemPrize(prizeConfirm.kid,prizeConfirm.prize)} style={{...BTN(T.gold),flex:1}}>Yes, Redeem!</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // PARENT MODE
  // ════════════════════════════════════════════════
  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Inter',sans-serif",color:T.text}}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {confetti&&<Confetti/>}

      {/* Badge toast */}
      {showBadgeToast&&(
        <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:T.bgCard,border:`1px solid ${T.gold}`,borderRadius:14,padding:"12px 20px",zIndex:500,display:"flex",alignItems:"center",gap:10,boxShadow:T.shadowMd}}>
          <span style={{fontSize:26}}>{showBadgeToast.emoji}</span>
          <div><div style={{fontWeight:700,fontSize:14,color:T.goldDark}}>Badge Earned!</div><div style={{fontSize:13,color:T.textMid}}>{showBadgeToast.label} — {showBadgeToast.kid==="kid1"?kid1Name:kid2Name}</div></div>
        </div>
      )}

      {/* Header */}
      <div style={{background:T.bgCard,borderBottom:`1px solid ${T.border}`,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,boxShadow:T.shadow,position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:32,height:32,background:T.gold,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🏡</div>
          <div>
            <div style={{fontWeight:700,fontSize:17,color:T.text,letterSpacing:"-0.02em"}}>FamPlan</div>
            <div style={{fontSize:10,color:T.textLight}}>Family Calendar & Chores</div>
          </div>
          {syncBadge}
        </div>

        {/* Kid switchers */}
        <div style={{display:"flex",gap:8}}>
          {members.slice(1).map(m=>(
            <button key={m.id} onClick={()=>{setKidView(m.id);setKidTab("chores");}} style={{display:"flex",alignItems:"center",gap:8,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:20,padding:"6px 14px",cursor:"pointer",minHeight:40,boxShadow:T.shadow}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:m.color,flexShrink:0}}/>
              <div>
                <div style={{fontWeight:600,fontSize:12,color:T.text}}>{m.name}</div>
                <div style={{fontSize:10,color:T.textLight}}>{pts[m.id]} pts</div>
              </div>
            </button>
          ))}
        </div>

        {/* Top nav */}
        <div className="famplan-topnav" style={{display:"flex",gap:4}}>
          {[["calendar","Calendar"],["chores","Chores"],["rewards","Rewards"],["settings","Settings"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:13,background:view===v?T.gold:T.bgMuted,color:view===v?"#fff":T.textMid,minHeight:36}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Layout */}
      <div className="famplan-layout" style={{display:"block"}}>
        {/* Sidebar */}
        <div className="famplan-sidenav" style={{display:"none",background:T.bgCard,borderRight:`1px solid ${T.border}`}}>
          <div style={{fontSize:11,fontWeight:600,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,paddingLeft:4}}>Navigate</div>
          {[["calendar","Calendar"],["chores","Chores"],["rewards","Rewards"],["settings","Settings"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,border:"none",cursor:"pointer",background:view===v?T.goldLight:"transparent",color:view===v?T.goldDark:T.textMid,fontFamily:"'Inter',sans-serif",fontWeight:view===v?600:400,fontSize:14,width:"100%",textAlign:"left",minHeight:44,marginBottom:2}}>
              {label}
            </button>
          ))}
          <div style={{flex:1}}/>
          <div style={{borderTop:`1px solid ${T.border}`,paddingTop:14}}>
            <div style={{fontSize:11,fontWeight:600,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,paddingLeft:4}}>Kid View</div>
            {members.slice(1).map(m=>(
              <button key={m.id} onClick={()=>{setKidView(m.id);setKidTab("chores");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,border:"none",cursor:"pointer",background:"transparent",color:T.text,fontFamily:"'Inter',sans-serif",fontWeight:500,fontSize:13,width:"100%",marginBottom:4,minHeight:44}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:m.color}}/>
                <div style={{textAlign:"left"}}>
                  <div>{m.name}</div>
                  <div style={{fontSize:11,color:T.textLight}}>{pts[m.id]} pts</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="famplan-content famplan-main-content" style={{maxWidth:920,margin:"0 auto",padding:"24px 20px"}}>

          {/* ── CALENDAR ── */}
          {view==="calendar"&&(
            <div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,gap:8,flexWrap:"wrap"}}>
                <button onClick={prevMonth} style={{...BTN(T.bgCard,T.text,`1px solid ${T.border}`),padding:"8px 14px",fontSize:16,boxShadow:T.shadow}}>‹</button>
                <div style={{fontWeight:700,fontSize:22,color:T.text}}>{MONTHS[curMonth]} {curYear}</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button onClick={()=>setShowIcsModal(true)} style={{...BTN(T.bgCard,T.goldDark,`1px solid ${T.gold}`),padding:"7px 14px",fontSize:12,boxShadow:T.shadow}}>Export / Import</button>
                  <button onClick={nextMonth} style={{...BTN(T.bgCard,T.text,`1px solid ${T.border}`),padding:"8px 14px",fontSize:16,boxShadow:T.shadow}}>›</button>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,marginBottom:1,background:T.border,borderRadius:"12px 12px 0 0",overflow:"hidden"}}>
                {DAYS.map(d=><div key={d} style={{textAlign:"center",fontWeight:600,fontSize:11,color:T.textLight,padding:"8px 0",background:T.bgMuted,letterSpacing:"0.05em",textTransform:"uppercase"}}>{d}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:T.border,borderRadius:"0 0 12px 12px",overflow:"hidden"}}>
                {Array.from({length:getFirstDay(curYear,curMonth)}).map((_,i)=><div key={`e${i}`} style={{background:T.bgMuted,minHeight:70}}/>)}
                {Array.from({length:getDaysInMonth(curYear,curMonth)}).map((_,i)=>{
                  const day=i+1;
                  const de=getEventsForDay(day);
                  const isToday=day===today.getDate()&&curMonth===today.getMonth()&&curYear===today.getFullYear();
                  const isSel=selDay===day;
                  return(
                    <div key={day} onClick={()=>setSelDay(isSel?null:day)} style={{background:isSel?T.goldLight:isToday?"#FFFBF0":T.bgCard,cursor:"pointer",padding:"8px 6px",minHeight:70,borderTop:isToday?`2px solid ${T.gold}`:isSel?`2px solid ${T.gold}`:"none"}}>
                      <div style={{fontWeight:isToday?700:500,fontSize:13,color:isToday?T.gold:T.text,marginBottom:4}}>{day}</div>
                      {de.slice(0,3).map(ev=>{const m=getMember(ev.member);return(<div key={ev.id} style={{background:m.color+"18",borderLeft:`2px solid ${m.color}`,padding:"1px 4px",fontSize:10,fontWeight:600,color:m.color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2,borderRadius:"0 3px 3px 0"}}>{ev.title}</div>);})}
                      {de.length>3&&<div style={{fontSize:9,color:T.textLight}}>+{de.length-3} more</div>}
                    </div>
                  );
                })}
              </div>

              {selDay&&(
                <div style={{marginTop:16,background:T.bgCard,borderRadius:14,padding:18,border:`1px solid ${T.border}`,boxShadow:T.shadow}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontWeight:600,fontSize:16}}>{MONTHS[curMonth]} {selDay}</div>
                    <button onClick={()=>{setNewEvent(e=>({...e,date:`${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(selDay).padStart(2,"0")}`}));setShowAddEvent(true);}} style={{...BTN(T.gold),padding:"6px 14px",fontSize:13}}>+ Add Event</button>
                  </div>
                  {selEvents.length===0?<div style={{color:T.textLight,fontSize:14}}>No events — add one!</div>:
                    selEvents.map(ev=>{const m=getMember(ev.member);return(
                      <div key={ev.id} style={{background:T.bgMuted,borderRadius:10,marginBottom:8,overflow:"hidden",borderLeft:`3px solid ${m.color}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px"}}>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:600,fontSize:14}}>{ev.title}</div>
                            <div style={{fontSize:12,color:T.textLight}}>{ev.time} · {m.name}</div>
                          </div>
                          <button onClick={()=>setShowEventMenu(showEventMenu===ev.id?null:ev.id)} style={{...BTN(T.bgCard,T.textMid,`1px solid ${T.border}`),padding:"4px 10px",fontSize:12}}>•••</button>
                          <button onClick={()=>setEvents(p=>p.filter(e=>e.id!==ev.id))} style={{background:"none",border:"none",color:T.textLight,cursor:"pointer",fontSize:16,padding:"0 4px"}}>✕</button>
                        </div>
                        {showEventMenu===ev.id&&(
                          <div style={{display:"flex",gap:8,padding:"6px 14px 10px",flexWrap:"wrap"}}>
                            <a href={googleCalUrl(ev)} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",color:T.textMid,textDecoration:"none",fontWeight:600,fontSize:11}}>
                              Add to Google Calendar
                            </a>
                            <button onClick={()=>{downloadICS(generateICS([ev],members),`${ev.title.replace(/\s+/g,"-")}.ics`);setShowEventMenu(null);}} style={{...BTN(T.bgCard,T.textMid,`1px solid ${T.border}`),padding:"5px 10px",fontSize:11}}>
                              Download .ics
                            </button>
                          </div>
                        )}
                      </div>
                    );})}
                </div>
              )}

              {showAddEvent&&(
                <Modal onClose={()=>setShowAddEvent(false)}>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:18,color:T.text}}>New Event</div>
                  {[{l:"Title",k:"title",t:"text",ph:"e.g. Soccer practice"},{l:"Date",k:"date",t:"date"},{l:"Time",k:"time",t:"text",ph:"e.g. 3:00 PM"}].map(f=>(
                    <div key={f.k} style={{marginBottom:14}}>
                      <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:4}}>{f.l}</div>
                      <input type={f.t} placeholder={f.ph||""} value={newEvent[f.k]} onChange={e=>setNewEvent(p=>({...p,[f.k]:e.target.value}))} style={INP}/>
                    </div>
                  ))}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Assign to</div>
                    <div style={{display:"flex",gap:8}}>
                      {members.map(m=><button key={m.id} onClick={()=>setNewEvent(p=>({...p,member:m.id}))} style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1px solid ${newEvent.member===m.id?m.color:T.border}`,background:newEvent.member===m.id?m.color+"15":"transparent",color:T.text,cursor:"pointer",fontWeight:500,fontSize:12,fontFamily:"'Inter',sans-serif"}}>{m.name}</button>)}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setShowAddEvent(false)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                    <button onClick={addEvent} style={{...BTN(T.gold),flex:1}}>Add Event</button>
                  </div>
                </Modal>
              )}

              {showIcsModal&&(
                <Modal onClose={()=>{setShowIcsModal(false);setIcsMsg("");}}>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:16,color:T.text}}>Calendar Sync</div>
                  <div style={{background:T.bgMuted,borderRadius:12,padding:14,marginBottom:14}}>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Export All Events</div>
                    <button onClick={()=>downloadICS(generateICS(events,members))} style={{...BTN(T.gold),width:"100%",padding:"10px",fontSize:13}}>Download .ics File</button>
                  </div>
                  <div style={{background:T.bgMuted,borderRadius:12,padding:14,marginBottom:14}}>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Import .ics File</div>
                    <input type="file" accept=".ics,text/calendar" onChange={e=>{
                      const file=e.target.files[0]; if(!file) return;
                      const r=new FileReader();
                      r.onload=ev=>{const imp=parseICS(ev.target.result);if(!imp.length){setIcsMsg("No events found.");return;}setEvents(p=>[...p,...imp]);setIcsMsg(`Imported ${imp.length} events!`);};
                      r.readAsText(file); e.target.value="";
                    }} style={{...INP,cursor:"pointer",marginBottom:8}}/>
                    {icsMsg&&<div style={{fontSize:13,fontWeight:600,color:T.green}}>{icsMsg}</div>}
                  </div>
                  <button onClick={()=>{setShowIcsModal(false);setIcsMsg("");}} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),width:"100%",padding:"10px"}}>Close</button>
                </Modal>
              )}
            </div>
          )}

          {/* ── CHORES ── */}
          {view==="chores"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:10}}>
                <div style={{fontWeight:700,fontSize:22,color:T.text}}>Weekly Chores</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowReset(true)} style={{...BTN(T.bgCard,T.red,`1px solid ${T.redLight}`),padding:"8px 14px",fontSize:13}}>Reset Week</button>
                  <button onClick={()=>setShowAddChore(true)} style={{...BTN(T.gold),padding:"8px 16px",fontSize:13}}>+ Add Chore</button>
                </div>
              </div>

              {members.slice(1).map(member=>{
                const kc=chores[member.id];
                const done=kc.reduce((a,c)=>a+Object.values(c.done).filter(Boolean).length,0);
                const total=kc.reduce((a,c)=>a+c.days.length,0);
                return(
                  <div key={member.id} style={{background:T.bgCard,borderRadius:16,padding:20,marginBottom:16,border:`1px solid ${T.border}`,boxShadow:T.shadow}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:member.color}}/>
                      <div style={{fontWeight:600,fontSize:16,color:T.text}}>{member.name}</div>
                      <div style={{flex:1}}/>
                      <div style={{fontSize:13,color:T.textLight}}>{done}/{total} this week</div>
                      <div style={{background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:600,color:T.goldDark}}>{pts[member.id]} pts</div>
                      <button onClick={()=>{setKidView(member.id);setKidTab("chores");}} style={{...BTN(member.color),padding:"5px 12px",fontSize:12}}>Kid View →</button>
                    </div>
                    <div style={{background:T.bgMuted,borderRadius:99,height:4,marginBottom:16,overflow:"hidden"}}>
                      <div style={{background:T.gold,height:"100%",width:`${total?Math.round(done/total*100):0}%`,borderRadius:99,transition:"width 0.4s"}}/>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                        <thead><tr>
                          <th style={{textAlign:"left",padding:"6px 8px",fontSize:11,color:T.textLight,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",width:"30%"}}>Chore</th>
                          {DAYS.map(d=><th key={d} style={{textAlign:"center",padding:"6px 4px",fontSize:11,color:T.textLight,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{d}</th>)}
                          <th style={{textAlign:"center",fontSize:11,color:T.textLight,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Pts</th>
                          <th style={{width:28}}></th>
                        </tr></thead>
                        <tbody>
                          {kc.map(chore=>(
                            <tr key={chore.id} style={{borderTop:`1px solid ${T.border}`}}>
                              <td style={{padding:"10px 8px",fontWeight:500}}>{chore.text}</td>
                              {DAYS.map(d=>{
                                const active=chore.days.includes(d);
                                const key=`${d}-week`;
                                const isDone=!!chore.done[key];
                                return(
                                  <td key={d} style={{textAlign:"center",padding:"6px 4px"}}>
                                    {active?(
                                      <button onClick={()=>toggleChore(member.id,chore.id,key)} style={{width:26,height:26,borderRadius:6,border:`1.5px solid ${isDone?T.gold:T.border}`,background:isDone?T.gold:"transparent",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff",transition:"all 0.15s"}}>
                                        {isDone?"✓":""}
                                      </button>
                                    ):<div style={{width:26,height:26,margin:"0 auto",opacity:0.1,lineHeight:"26px",textAlign:"center",fontSize:12}}>—</div>}
                                  </td>
                                );
                              })}
                              <td style={{textAlign:"center",fontSize:12,fontWeight:600,color:T.gold}}>{chore.points}</td>
                              <td style={{textAlign:"center"}}><button onClick={()=>setChores(p=>({...p,[member.id]:p[member.id].filter(c=>c.id!==chore.id)}))} style={{background:"none",border:"none",color:T.textLight,cursor:"pointer",fontSize:14,padding:4}}>✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {weekHistory.length>0&&(
                <div style={{marginTop:8}}>
                  <div style={{fontWeight:600,fontSize:13,color:T.textLight,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Past Weeks</div>
                  {weekHistory.map((wk,i)=>(
                    <div key={i} style={{background:T.bgCard,borderRadius:12,padding:"12px 16px",marginBottom:8,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                      <div style={{fontSize:12,color:T.textLight,minWidth:80}}>{wk.date}</div>
                      {["kid1","kid2"].map(kid=>{
                        const s=wk.summary[kid];const name=kid==="kid1"?wk.kid1Name:wk.kid2Name;const m=getMember(kid);
                        return(
                          <div key={kid} style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:8,height:8,borderRadius:"50%",background:m.color}}/>
                            <span style={{fontWeight:600,fontSize:13}}>{name}</span>
                            <span style={{fontSize:12,color:T.textLight}}>{s.done}/{s.total} chores</span>
                            <span style={{fontSize:12,color:T.gold,fontWeight:600}}>{wk.pts[kid]} pts</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {showAddChore&&(
                <Modal onClose={()=>setShowAddChore(false)}>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:18,color:T.text}}>New Chore</div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:4}}>Chore</div>
                    <input list="chore-s" value={newChore.text} onChange={e=>setNewChore(p=>({...p,text:e.target.value}))} placeholder="e.g. Make bed" style={INP}/>
                    <datalist id="chore-s">{CHORE_TEMPLATES.map(t=><option key={t} value={t}/>)}</datalist>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Points per completion</div>
                    <div style={{display:"flex",gap:8}}>
                      {[5,8,10,15,20].map(p=><button key={p} onClick={()=>setNewChore(prev=>({...prev,points:p}))} style={{flex:1,padding:"8px 4px",borderRadius:8,border:`1px solid ${newChore.points===p?T.gold:T.border}`,background:newChore.points===p?T.goldLight:"transparent",color:T.text,cursor:"pointer",fontWeight:600,fontSize:13,fontFamily:"'Inter',sans-serif"}}>{p}</button>)}
                    </div>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Assign to</div>
                    <div style={{display:"flex",gap:8}}>
                      {members.slice(1).map(m=><button key={m.id} onClick={()=>setNewChore(p=>({...p,kid:m.id}))} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${newChore.kid===m.id?m.color:T.border}`,background:newChore.kid===m.id?m.color+"15":"transparent",color:T.text,cursor:"pointer",fontWeight:500,fontSize:13,fontFamily:"'Inter',sans-serif"}}>{m.name}</button>)}
                    </div>
                  </div>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Days</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {DAYS.map(d=><button key={d} onClick={()=>setNewChore(prev=>({...prev,days:prev.days.includes(d)?prev.days.filter(x=>x!==d):[...prev.days,d]}))} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${newChore.days.includes(d)?T.gold:T.border}`,background:newChore.days.includes(d)?T.goldLight:"transparent",color:T.text,cursor:"pointer",fontWeight:500,fontSize:12,fontFamily:"'Inter',sans-serif"}}>{d}</button>)}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setShowAddChore(false)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                    <button onClick={addChore} style={{...BTN(T.gold),flex:1}}>Add Chore</button>
                  </div>
                </Modal>
              )}

              {showReset&&(
                <Modal onClose={()=>setShowReset(false)}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:42,marginBottom:12}}>🔄</div>
                    <div style={{fontWeight:700,fontSize:18,marginBottom:10}}>Reset the Week?</div>
                    <div style={{background:T.bgMuted,borderRadius:12,padding:14,marginBottom:20,textAlign:"left"}}>
                      {["Saves results to history","Awards Perfect Week badge if earned","Clears all chore checkboxes","Keeps all earned points"].map(t=>(
                        <div key={t} style={{fontSize:13,marginBottom:6,color:T.textMid,display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{color:T.green}}>✓</span>{t}
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:10}}>
                      <button onClick={()=>setShowReset(false)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                      <button onClick={()=>doWeekReset(true)} style={{...BTN(T.red),flex:1}}>Reset Week</button>
                    </div>
                  </div>
                </Modal>
              )}
            </div>
          )}

          {/* ── REWARDS ── */}
          {view==="rewards"&&(
            <div>
              <div style={{fontWeight:700,fontSize:22,color:T.text,marginBottom:20}}>Rewards</div>

              {/* Kid point cards */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
                {members.slice(1).map(member=>(
                  <div key={member.id} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:18,boxShadow:T.shadow}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:member.color}}/>
                      <div style={{fontWeight:600,fontSize:15,color:T.text}}>{member.name}</div>
                    </div>
                    <div style={{background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:12,padding:12,textAlign:"center",marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:28,color:T.gold}}>{pts[member.id]}</div>
                      <div style={{fontSize:11,color:T.textLight}}>pts available · {allTimePts[member.id]} all-time</div>
                    </div>
                    <div style={{marginBottom:12}}>
                      <div style={{fontSize:11,fontWeight:600,color:T.textLight,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>Badges ({(badges[member.id]||[]).length}/{BADGES.length})</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {BADGES.map(b=>{const has=(badges[member.id]||[]).includes(b.id);return(
                          <div key={b.id} title={b.desc} style={{background:has?T.goldLight:T.bgMuted,border:`1px solid ${has?T.gold:T.border}`,borderRadius:8,padding:"3px 8px",fontSize:11,fontWeight:500,opacity:has?1:0.5,filter:has?"none":"grayscale(1)"}}>
                            {b.emoji} {b.label}
                          </div>
                        );})}
                      </div>
                    </div>
                    {redeemed[member.id]?.length>0&&(
                      <div>
                        <div style={{fontSize:11,fontWeight:600,color:T.textLight,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>Redeemed</div>
                        {redeemed[member.id].slice(-3).map((p,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12,marginBottom:4}}>
                            <span>{p.emoji}</span><span style={{fontWeight:500}}>{p.label}</span><div style={{flex:1}}/><span style={{color:T.textLight}}>{p.date}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Prize catalog */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
                <div style={{fontWeight:600,fontSize:15,color:T.text}}>Prize Catalog</div>
                <button onClick={()=>setShowAddPrize(true)} style={{...BTN(T.gold),padding:"7px 16px",fontSize:13}}>+ Add Prize</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
                {prizes.map(prize=>(
                  <div key={prize.id} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,padding:14,textAlign:"center",position:"relative",boxShadow:T.shadow}}>
                    <button onClick={()=>{setShowEditPrize(prize.id);setEditPrizeData({emoji:prize.emoji,label:prize.label,cost:prize.cost});}} style={{position:"absolute",top:8,right:8,background:T.bgMuted,border:`1px solid ${T.border}`,color:T.textLight,borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
                    <div style={{fontSize:26,marginBottom:6}}>{prize.emoji}</div>
                    <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{prize.label}</div>
                    <div style={{fontWeight:700,color:T.gold,fontSize:14}}>{prize.cost} pts</div>
                  </div>
                ))}
              </div>

              {showAddPrize&&(
                <Modal onClose={()=>setShowAddPrize(false)}>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:18,color:T.text}}>New Prize</div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Emoji</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {PRIZE_EMOJIS.map(e=><button key={e} onClick={()=>setNewPrize(p=>({...p,emoji:e}))} style={{width:36,height:36,borderRadius:8,border:`1px solid ${newPrize.emoji===e?T.gold:T.border}`,background:newPrize.emoji===e?T.goldLight:"transparent",cursor:"pointer",fontSize:18}}>{e}</button>)}
                    </div>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:4}}>Name</div>
                    <input value={newPrize.label} onChange={e=>setNewPrize(p=>({...p,label:e.target.value}))} placeholder="e.g. Extra dessert" style={INP}/>
                  </div>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Cost (pts)</div>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      {[10,25,50,100,200].map(c=><button key={c} onClick={()=>setNewPrize(p=>({...p,cost:c}))} style={{flex:1,padding:"7px 4px",borderRadius:8,border:`1px solid ${newPrize.cost===c?T.gold:T.border}`,background:newPrize.cost===c?T.goldLight:"transparent",color:T.text,cursor:"pointer",fontWeight:500,fontSize:12,fontFamily:"'Inter',sans-serif"}}>{c}</button>)}
                    </div>
                    <input type="number" value={newPrize.cost} onChange={e=>setNewPrize(p=>({...p,cost:Number(e.target.value)}))} placeholder="Custom" style={INP} min={1}/>
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setShowAddPrize(false)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                    <button onClick={addPrize} style={{...BTN(T.gold),flex:1}}>Add Prize</button>
                  </div>
                </Modal>
              )}

              {showEditPrize&&(
                <Modal onClose={()=>setShowEditPrize(null)}>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:18,color:T.text}}>Edit Prize</div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:6}}>Emoji</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {PRIZE_EMOJIS.map(e=><button key={e} onClick={()=>setEditPrizeData(p=>({...p,emoji:e}))} style={{width:34,height:34,borderRadius:8,border:`1px solid ${editPrizeData.emoji===e?T.gold:T.border}`,background:editPrizeData.emoji===e?T.goldLight:"transparent",cursor:"pointer",fontSize:17}}>{e}</button>)}
                    </div>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:4}}>Name</div>
                    <input value={editPrizeData.label} onChange={e=>setEditPrizeData(p=>({...p,label:e.target.value}))} style={INP}/>
                  </div>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.textMid,marginBottom:4}}>Cost (pts)</div>
                    <input type="number" value={editPrizeData.cost} onChange={e=>setEditPrizeData(p=>({...p,cost:Number(e.target.value)}))} style={INP} min={1}/>
                  </div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>deletePrize(showEditPrize)} style={{...BTN(T.bgCard,T.red,`1px solid ${T.redLight}`),flex:1}}>Delete</button>
                    <button onClick={()=>setShowEditPrize(null)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
                    <button onClick={savePrizeEdit} style={{...BTN(T.gold),flex:1}}>Save</button>
                  </div>
                </Modal>
              )}
            </div>
          )}

          {/* ── SETTINGS ── */}
          {view==="settings"&&(
            <div>
              <div style={{fontWeight:700,fontSize:22,color:T.text,marginBottom:20}}>Settings</div>

              {/* Names */}
              <div style={{background:T.bgCard,borderRadius:14,padding:20,marginBottom:14,border:`1px solid ${T.border}`,boxShadow:T.shadow}}>
                <div style={{fontWeight:600,fontSize:14,color:T.text,marginBottom:14}}>Kid Names</div>
                {[["kid1",kid1Name,setKid1Name],["kid2",kid2Name,setKid2Name]].map(([id,name,setter])=>{
                  const m=getMember(id);
                  return(
                    <div key={id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                      <input value={name} onChange={e=>setter(e.target.value)} style={{...INP,flex:1}} placeholder="Enter name"/>
                    </div>
                  );
                })}
              </div>

              {/* Points reset */}
              <div style={{background:T.bgCard,borderRadius:14,padding:20,marginBottom:14,border:`1px solid ${T.border}`,boxShadow:T.shadow}}>
                <div style={{fontWeight:600,fontSize:14,color:T.text,marginBottom:6}}>Reset Points</div>
                <div style={{fontSize:13,color:T.textLight,marginBottom:14}}>Clear earned points for one or both kids. This cannot be undone.</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {members.slice(1).map(m=>(
                    <button key={m.id} onClick={()=>setShowPtsReset(m.id)} style={{...BTN(T.bgCard,T.red,`1px solid ${T.redLight}`),padding:"8px 16px",fontSize:13}}>
                      Reset {m.name} ({pts[m.id]} pts)
                    </button>
                  ))}
                  <button onClick={()=>setShowPtsReset("both")} style={{...BTN(T.bgCard,T.red,`1px solid ${T.redLight}`),padding:"8px 16px",fontSize:13}}>
                    Reset Both
                  </button>
                </div>
              </div>

              {/* Data */}
              <div style={{background:T.bgCard,borderRadius:14,padding:20,marginBottom:14,border:`1px solid ${T.border}`,boxShadow:T.shadow}}>
                <div style={{fontWeight:600,fontSize:14,color:T.text,marginBottom:6}}>Local Data</div>
                <div style={{fontSize:13,color:T.textLight,marginBottom:14}}>All data saves automatically to this browser.</div>
                <button onClick={()=>{if(window.confirm("Erase ALL data and reset to defaults? This cannot be undone.")){ localStorage.removeItem(STORAGE_KEY);window.location.reload();}}} style={{...BTN(T.bgCard,T.red,`1px solid ${T.redLight}`),padding:"8px 16px",fontSize:13}}>
                  Clear All Data & Reset
                </button>
              </div>

              {/* Cloud */}
              <div style={{background:T.bgCard,borderRadius:14,padding:20,border:`1px solid ${cloudEnabled?"#A7D7BC":T.border}`,boxShadow:T.shadow}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <div style={{fontWeight:600,fontSize:14,color:T.text}}>Cloud Sync</div>
                  {cloudEnabled&&<div style={{background:T.greenLight,border:"1px solid #A7D7BC",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:600,color:T.green}}>Active</div>}
                </div>
                {cloudEnabled?(
                  <div style={{fontSize:13,color:T.textMid,lineHeight:1.6}}>
                    Real-time sync is enabled. All family devices share the same data.<br/>
                    Status: <strong style={{color:syncStatus==="saved"?T.green:T.red}}>{syncStatus==="saved"?"Synced":"Syncing…"}</strong>
                  </div>
                ):(
                  <div>
                    <div style={{fontSize:13,color:T.textLight,marginBottom:14,lineHeight:1.6}}>Add a free Supabase backend so all family devices share the same data in real time.</div>
                    <a href="https://supabase.com" target="_blank" rel="noreferrer" style={{...BTN(T.green),display:"inline-flex",alignItems:"center",gap:6,textDecoration:"none",padding:"8px 16px",fontSize:13}}>
                      Set Up Cloud Sync →
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Bottom tab bar */}
      <div className="famplan-bottom-tabs">
        {[["calendar","📅","Calendar"],["chores","✅","Chores"],["rewards","★","Rewards"],["settings","⚙","More"]].map(([v,icon,label])=>(
          <button key={v} className={`famplan-bottom-tab${view===v?" active":""}`} onClick={()=>setView(v)}>
            <span className="famplan-bottom-tab-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Points reset confirm modal */}
      {showPtsReset&&(
        <Modal onClose={()=>setShowPtsReset(false)}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:38,marginBottom:12}}>⚠️</div>
            <div style={{fontWeight:700,fontSize:18,marginBottom:10}}>Reset Points?</div>
            <div style={{fontSize:14,color:T.textMid,marginBottom:6}}>
              {showPtsReset==="both"
                ? `This will reset both ${kid1Name} (${pts.kid1} pts) and ${kid2Name} (${pts.kid2} pts) to zero.`
                : `This will reset ${showPtsReset==="kid1"?kid1Name:kid2Name}'s points (${pts[showPtsReset]} pts) to zero.`}
            </div>
            <div style={{fontSize:13,color:T.textLight,marginBottom:22}}>This cannot be undone.</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowPtsReset(false)} style={{...BTN(T.bgMuted,T.textMid,`1px solid ${T.border}`),flex:1}}>Cancel</button>
              <button onClick={()=>resetPoints(showPtsReset)} style={{...BTN(T.red),flex:1}}>Reset Points</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
