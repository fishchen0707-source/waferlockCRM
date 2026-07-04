// B路信令測試：對「真實 Supabase Realtime」驗證信令協定，比照 public/js/rtc-client.js 的 hello 探索模式。
// 兩種進場順序各跑一次（agent 先 / customer 先＝agent 後進房），證明無論誰先進，
// 都能完成握手：hello → offer（重送直到 answer）→ answer → ice → bye。
// 關鍵：所有 send 都在 SUBSCRIBED 之後才發（否則會退回 REST 而對端收不到）。
// 跑法：node test-signal-supabase.js
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://nkyanyjgfrmovjoqevro.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5reWFueWpnZnJtb3Zqb3FldnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2ODIxMTMsImV4cCI6MjA5NzI1ODExM30.LPnQyceYS7Z1-rlqUtXm3B8dGBOqnmnavTV-PAOSPZ8';

// 一個端點：比照 rtc-client.js —— SUBSCRIBED 後才週期性送 hello，收 sig 交給 onSignal
function peer(room, role, onSignal) {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const ch = sb.channel('rtc-' + room, { config: { broadcast: { self: false } } });
  const sig = (obj) => ch.send({ type: 'broadcast', event: 'sig', payload: obj });
  let helloTimer = null, done = false;
  const stopHello = () => { if (helloTimer) { clearInterval(helloTimer); helloTimer = null; } };
  ch.on('broadcast', { event: 'sig' }, (e) => onSignal(e.payload, { sig, stopHello, setDone: () => { done = true; stopHello(); } }))
    .subscribe((st) => {
      // 比照 rtc-client.js：SUBSCRIBED 後立即送 hello 並每秒重送。即使首則因剛訂閱走 REST 而遺失，
      // 後續（頻道已 join）走 WebSocket 會補上——重送機制本身就容忍首則遺失。
      if (st === 'SUBSCRIBED') { let n = 0; const ping = () => { if (done || n++ > 20) return stopHello(); sig({ type: 'hello', role }); }; ping(); helloTimer = setInterval(ping, 1000); }
    });
  return { sb, ch, sig, stopHello };
}

function runScenario(label, firstRole) {
  return new Promise((resolve) => {
    const room = 'test_' + label + '_' + Date.now();
    const got = { offerByAgent: false, custGotOffer: false, agentGotAnswer: false, custGotIce: false, agentGotBye: false };
    let agent, customer, offering = false, answered = false, custAnswered = false, offerTimer = null;

    function agentSignal(m, ctx) {
      if (m.type === 'hello') { // 收到對端 hello → 發 offer 並重送直到 answer
        if (offering || answered) return; offering = true; got.offerByAgent = true;
        let t = 0; const blast = () => { if (answered || t++ >= 8) return clearInterval(offerTimer); agent.sig({ type: 'offer', sdp: 'FAKE_OFFER' }); };
        blast(); offerTimer = setInterval(blast, 1000);
      }
      if (m.type === 'answer') { if (!answered) { answered = true; clearInterval(offerTimer); agent.sig({ type: 'ice', candidate: 'FAKE_ICE' }); } got.agentGotAnswer = true; ctx.setDone(); }
      if (m.type === 'bye') got.agentGotBye = true;
    }
    function custSignal(m, ctx) {
      if (m.type === 'offer') { got.custGotOffer = true; custAnswered = true; ctx.stopHello(); customer.sig({ type: 'answer', sdp: 'FAKE_ANSWER' }); }
      if (m.type === 'ice') { got.custGotIce = true; if (custAnswered) { custAnswered = false; ctx.setDone(); setTimeout(() => customer.sig({ type: 'bye' }), 300); } }
    }
    const mk = (role) => role === 'agent' ? (agent = peer(room, 'agent', agentSignal)) : (customer = peer(room, 'customer', custSignal));
    mk(firstRole);
    setTimeout(() => mk(firstRole === 'agent' ? 'customer' : 'agent'), 1500);
    setTimeout(() => { try { agent.sb.removeChannel(agent.ch); customer.sb.removeChannel(customer.ch); } catch (e) {} resolve({ label, got }); }, 8000);
  });
}

(async () => {
  const results = [];
  results.push(await runScenario('agentFirst', 'agent'));
  results.push(await runScenario('customerFirst', 'customer')); // agent 後進房：原設計會 hang 的關鍵情境
  let pass = true;
  results.forEach(({ label, got }) => {
    console.log(`\n=== 情境：${label}進房 ===`);
    [['agent 發出 offer', got.offerByAgent], ['customer 收到 offer', got.custGotOffer], ['agent 收到 answer', got.agentGotAnswer], ['customer 收到 ice', got.custGotIce], ['agent 收到 bye（優雅掛斷）', got.agentGotBye]]
      .forEach(([n, ok]) => { console.log((ok ? '✅ ' : '❌ ') + n); if (!ok) pass = false; });
  });
  console.log(pass ? '\n兩種進場順序全部通過 ✅' : '\n有失敗 ❌');
  process.exit(pass ? 0 : 1);
})();
